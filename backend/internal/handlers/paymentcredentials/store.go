// Package paymentcredentials manages per-location BYO payment provider keys.
// Secret keys and webhook secrets are stored AES-GCM encrypted (via secretbox);
// they are never returned to the client in plaintext.
package paymentcredentials

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// ErrNotFound is returned when the requested credential row does not exist.
var ErrNotFound = errors.New("payment credential not found")

// Store wraps the pgxpool for database operations.
type Store struct {
	pool *pgxpool.Pool
}

// NewStore constructs a Store.
func NewStore(pool *pgxpool.Pool) *Store { return &Store{pool: pool} }

// upsertParams carries the data needed to create or update a credential row.
type upsertParams struct {
	LocationID              string
	ProviderCode            string
	PublicKey               *string
	SecretKeyCiphertext     string
	WebhookSecretCiphertext string
	ConfiguredBy            *string
}

// Credential is the safe, wire-serialisable view of a
// location_payment_credentials row. Ciphertext columns are never included.
type Credential struct {
	ID           string     `json:"id"`
	LocationID   string     `json:"location_id"`
	ProviderCode string     `json:"provider_code"`
	PublicKey    *string    `json:"public_key"`
	IsActive     bool       `json:"is_active"`
	ConfiguredAt time.Time  `json:"configured_at"`
	UpdatedAt    time.Time  `json:"updated_at"`
	WebhookURL   string     `json:"webhook_url"` // computed by handler
}

// credentialRow is the internal DB row used before the webhook URL is attached.
type credentialRow struct {
	ID           string
	LocationID   string
	ProviderCode string
	PublicKey    *string
	IsActive     bool
	CreatedAt    time.Time
	UpdatedAt    time.Time
}

func scanCredentialRow(row pgx.Row, c *credentialRow) error {
	return row.Scan(
		&c.ID, &c.LocationID, &c.ProviderCode,
		&c.PublicKey, &c.IsActive, &c.CreatedAt, &c.UpdatedAt,
	)
}

const credCols = `id, location_id, provider_code, public_key, is_active, created_at, updated_at`

// Upsert inserts or updates the credential for (location_id, provider_code).
// On conflict it updates keys and sets is_active=true.
func (s *Store) Upsert(ctx context.Context, p upsertParams) (*credentialRow, error) {
	var out credentialRow
	err := scanCredentialRow(s.pool.QueryRow(ctx, `
INSERT INTO location_payment_credentials
    (location_id, provider_code, public_key,
     secret_key_ciphertext, webhook_secret_ciphertext,
     is_active, configured_by)
VALUES ($1, $2, $3, $4, $5, true, $6)
ON CONFLICT (location_id, provider_code) DO UPDATE
    SET public_key                  = EXCLUDED.public_key,
        secret_key_ciphertext       = EXCLUDED.secret_key_ciphertext,
        webhook_secret_ciphertext   = EXCLUDED.webhook_secret_ciphertext,
        is_active                   = true,
        configured_by               = EXCLUDED.configured_by,
        updated_at                  = timezone('utc'::text, now())
RETURNING `+credCols,
		p.LocationID, p.ProviderCode, p.PublicKey,
		p.SecretKeyCiphertext, p.WebhookSecretCiphertext, p.ConfiguredBy,
	), &out)
	if err != nil {
		return nil, err
	}
	return &out, nil
}

// GetByLocation returns all active credentials for a location.
func (s *Store) GetByLocation(ctx context.Context, locationID string) ([]credentialRow, error) {
	rows, err := s.pool.Query(ctx, `
SELECT `+credCols+`
FROM location_payment_credentials
WHERE location_id = $1 AND is_active = true
ORDER BY created_at DESC
`, locationID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []credentialRow
	for rows.Next() {
		var c credentialRow
		if err := scanCredentialRow(rows, &c); err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	if out == nil {
		out = []credentialRow{}
	}
	return out, rows.Err()
}

// SoftDelete sets is_active=false for the given credential ID.
// Returns ErrNotFound if the row doesn't exist or is already inactive.
func (s *Store) SoftDelete(ctx context.Context, id string) error {
	tag, err := s.pool.Exec(ctx, `
UPDATE location_payment_credentials
SET is_active = false, updated_at = timezone('utc'::text, now())
WHERE id = $1 AND is_active = true
`, id)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// GetByID returns the full row (including ciphertexts) for test-key purposes.
// Ciphertexts must NOT be sent to clients; this is handler-internal only.
type credentialFull struct {
	credentialRow
	SecretKeyCiphertext     string
	WebhookSecretCiphertext string
}

func (s *Store) GetByIDFull(ctx context.Context, id string) (*credentialFull, error) {
	var out credentialFull
	err := s.pool.QueryRow(ctx, `
SELECT `+credCols+`, secret_key_ciphertext, webhook_secret_ciphertext
FROM location_payment_credentials
WHERE id = $1
`, id).Scan(
		&out.ID, &out.LocationID, &out.ProviderCode,
		&out.PublicKey, &out.IsActive, &out.CreatedAt, &out.UpdatedAt,
		&out.SecretKeyCiphertext, &out.WebhookSecretCiphertext,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return &out, nil
}
