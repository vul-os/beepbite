// Package webhooksub manages tenant webhook-endpoint subscriptions (Wave 22).
// It persists webhook_endpoints and exposes recent delivery attempts from
// webhook_deliveries. Signing secrets are stored in plain text so tenants
// can re-copy them; callers must protect this surface with TLS + auth.
package webhooksub

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/beepbite/backend/internal/db"
)

// Sentinel errors surfaced to the HTTP layer.
var (
	ErrEndpointNotFound = errors.New("webhook endpoint not found")
)

// Endpoint mirrors a webhook_endpoints row.
type Endpoint struct {
	ID                      string    `json:"id"`
	OrgID                   string    `json:"org_id"`
	URL                     string    `json:"url"`
	SigningSecretCiphertext string    `json:"signing_secret_ciphertext"`
	Events                  []string  `json:"events"`
	IsActive                bool      `json:"is_active"`
	Description             *string   `json:"description"`
	CreatedAt               time.Time `json:"created_at"`
	UpdatedAt               time.Time `json:"updated_at"`
}

// Delivery mirrors a webhook_deliveries row (subset used for debugging).
type Delivery struct {
	ID           string     `json:"id"`
	EndpointID   string     `json:"endpoint_id"`
	EventType    string     `json:"event_type"`
	Status       string     `json:"status"`
	ResponseCode *int       `json:"response_code"`
	Attempts     int        `json:"attempts"`
	LastError    *string    `json:"last_error"`
	CreatedAt    time.Time  `json:"created_at"`
	DeliveredAt  *time.Time `json:"delivered_at"`
}

// Store handles all DB operations for webhook subscriptions.
type Store struct {
	pool *pgxpool.Pool
}

// NewStore constructs a Store backed by pool.
func NewStore(pool *pgxpool.Pool) *Store { return &Store{pool: pool} }

const endpointCols = `id, org_id, url, signing_secret_ciphertext, events,
	is_active, description, created_at, updated_at`

func scanEndpoint(row pgx.Row, e *Endpoint) error {
	return row.Scan(
		&e.ID, &e.OrgID, &e.URL, &e.SigningSecretCiphertext, &e.Events,
		&e.IsActive, &e.Description, &e.CreatedAt, &e.UpdatedAt,
	)
}

// CreateEndpoint inserts a new webhook endpoint for the org.
func (s *Store) CreateEndpoint(
	ctx context.Context,
	orgID, url, signingSecret string,
	events []string,
	description *string,
) (*Endpoint, error) {
	var out Endpoint
	err := db.Scoped(ctx, s.pool, db.ScopeFromContext(ctx), func(tx pgx.Tx) error {
		return scanEndpoint(tx.QueryRow(ctx, `
INSERT INTO webhook_endpoints (org_id, url, signing_secret_ciphertext, events, description)
VALUES ($1, $2, $3, $4, $5)
RETURNING `+endpointCols,
			orgID, url, signingSecret, events, description,
		), &out)
	})
	if err != nil {
		return nil, err
	}
	return &out, nil
}

// ListEndpoints returns all webhook endpoints for the org, newest first.
func (s *Store) ListEndpoints(ctx context.Context, orgID string) ([]Endpoint, error) {
	out := []Endpoint{}
	err := db.Scoped(ctx, s.pool, db.ScopeFromContext(ctx), func(tx pgx.Tx) error {
		rows, err := tx.Query(ctx,
			`SELECT `+endpointCols+`
			 FROM webhook_endpoints
			 WHERE org_id = $1
			 ORDER BY created_at DESC`, orgID)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var e Endpoint
			if err := scanEndpoint(rows, &e); err != nil {
				return err
			}
			out = append(out, e)
		}
		return rows.Err()
	})
	if err != nil {
		return nil, err
	}
	return out, nil
}

// UpdateEndpointParams carries the fields that PUT /webhook-endpoints/{id} may change.
// A nil pointer means "leave unchanged" for pointer fields; for value fields we
// always overwrite (url, active are always required in the request body).
type UpdateEndpointParams struct {
	URL         string
	Events      []string
	Active      bool
	Description *string
}

// UpdateEndpoint updates a webhook endpoint. Returns ErrEndpointNotFound when
// the row doesn't exist in the org.
func (s *Store) UpdateEndpoint(
	ctx context.Context,
	orgID, endpointID string,
	p UpdateEndpointParams,
) (*Endpoint, error) {
	var out Endpoint
	err := db.Scoped(ctx, s.pool, db.ScopeFromContext(ctx), func(tx pgx.Tx) error {
		err := scanEndpoint(tx.QueryRow(ctx, `
UPDATE webhook_endpoints
SET url         = $3,
    events      = $4,
    is_active   = $5,
    description = $6,
    updated_at  = now()
WHERE id = $1 AND org_id = $2
RETURNING `+endpointCols,
			endpointID, orgID, p.URL, p.Events, p.Active, p.Description,
		), &out)
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrEndpointNotFound
		}
		return err
	})
	if err != nil {
		return nil, err
	}
	return &out, nil
}

// DeleteEndpoint removes a webhook endpoint. Returns ErrEndpointNotFound when
// the row doesn't exist in the org.
func (s *Store) DeleteEndpoint(ctx context.Context, orgID, endpointID string) error {
	return db.Scoped(ctx, s.pool, db.ScopeFromContext(ctx), func(tx pgx.Tx) error {
		tag, err := tx.Exec(ctx,
			`DELETE FROM webhook_endpoints WHERE id = $1 AND org_id = $2`,
			endpointID, orgID,
		)
		if err != nil {
			return err
		}
		if tag.RowsAffected() == 0 {
			return ErrEndpointNotFound
		}
		return nil
	})
}

// ListDeliveries returns recent delivery attempts for an endpoint, capped at
// limit rows (max 100).
func (s *Store) ListDeliveries(
	ctx context.Context,
	orgID, endpointID string,
	limit int,
) ([]Delivery, error) {
	if limit <= 0 || limit > 100 {
		limit = 50
	}

	// Verify endpoint belongs to org first (org-scope guard).
	var exists bool
	if err := db.Scoped(ctx, s.pool, db.ScopeFromContext(ctx), func(tx pgx.Tx) error {
		return tx.QueryRow(ctx,
			`SELECT true FROM webhook_endpoints WHERE id = $1 AND org_id = $2`,
			endpointID, orgID,
		).Scan(&exists)
	}); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrEndpointNotFound
		}
		return nil, err
	}

	out := []Delivery{}
	err := db.Scoped(ctx, s.pool, db.ScopeFromContext(ctx), func(tx pgx.Tx) error {
		rows, err := tx.Query(ctx, `
SELECT id, endpoint_id, event_type, status, response_code,
       attempts, last_error, created_at, delivered_at
FROM webhook_deliveries
WHERE endpoint_id = $1 AND org_id = $2
ORDER BY created_at DESC
LIMIT $3`, endpointID, orgID, limit)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var d Delivery
			if err := rows.Scan(
				&d.ID, &d.EndpointID, &d.EventType, &d.Status, &d.ResponseCode,
				&d.Attempts, &d.LastError, &d.CreatedAt, &d.DeliveredAt,
			); err != nil {
				return err
			}
			out = append(out, d)
		}
		return rows.Err()
	})
	if err != nil {
		return nil, err
	}
	return out, nil
}
