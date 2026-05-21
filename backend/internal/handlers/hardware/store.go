// Package hardware implements CRUD for location_printers (migration 038),
// plus ESC/POS print endpoints for receipts and kitchen tickets.
//
// All DB work runs through db.Scoped so the six app.* session variables are
// set inside the transaction and RLS policies gate every row by org.
// Mount under an already-authenticated chi.Router group at /hardware.
//
// Endpoint summary (wiring snippet for main.go):
//
//	hw := hardware.NewHandler(pool)
//	r.Route("/hardware", hw.Mount)
//
// Routes exposed:
//
//	GET    /hardware/printers                   — list printers for location
//	POST   /hardware/printers                   — create printer
//	GET    /hardware/printers/{id}              — get printer
//	PUT    /hardware/printers/{id}              — update printer
//	DELETE /hardware/printers/{id}              — delete printer
//	POST   /hardware/printers/{id}/test         — send test ticket
//	POST   /hardware/print/receipt              — print receipt for an order
//	POST   /hardware/print/kitchen              — print kitchen ticket for an order
package hardware

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/beepbite/backend/internal/db"
)

// Sentinel errors mapped to HTTP status codes in handler.go.
var (
	ErrPrinterNotFound = errors.New("printer not found")
	ErrOrderNotFound   = errors.New("order not found")
)

// ---------------------------------------------------------------------------
// DTOs
// ---------------------------------------------------------------------------

// Printer mirrors one location_printers row.
type Printer struct {
	ID         string    `json:"id"`
	LocationID string    `json:"location_id"`
	Name       string    `json:"name"`
	Kind       string    `json:"kind"`       // receipt | kitchen
	Connection string    `json:"connection"` // network | usb
	Host       *string   `json:"host,omitempty"`
	Port       int       `json:"port"`
	StationID  *string   `json:"station_id,omitempty"`
	IsActive   bool      `json:"is_active"`
	CreatedAt  time.Time `json:"created_at"`
	UpdatedAt  time.Time `json:"updated_at"`
}

// CreatePrinterReq is the body for POST /printers.
type CreatePrinterReq struct {
	LocationID string  `json:"location_id"`
	Name       string  `json:"name"`
	Kind       string  `json:"kind"`
	Connection string  `json:"connection"`
	Host       *string `json:"host,omitempty"`
	Port       *int    `json:"port,omitempty"`
	StationID  *string `json:"station_id,omitempty"`
	IsActive   *bool   `json:"is_active,omitempty"`
}

// UpdatePrinterReq is the body for PUT /printers/{id}.
// Only non-nil fields are applied (partial update).
type UpdatePrinterReq struct {
	Name       *string `json:"name,omitempty"`
	Kind       *string `json:"kind,omitempty"`
	Connection *string `json:"connection,omitempty"`
	Host       *string `json:"host,omitempty"`
	Port       *int    `json:"port,omitempty"`
	StationID  *string `json:"station_id,omitempty"`
	IsActive   *bool   `json:"is_active,omitempty"`
}

// OrderSnapshot carries the minimal order fields needed to build a print job.
type OrderSnapshot struct {
	OrderID       string
	OrderNumber   string
	StoreName     string
	StoreAddress  *string
	Items         []OrderItemSnapshot
	SubtotalCents int64
	TaxCents      int64
	TipCents      int64
	TotalCents    int64
	CurrencyCode  string
}

// OrderItemSnapshot is one line item for printing.
type OrderItemSnapshot struct {
	ItemName       string
	Quantity       int64
	UnitPriceCents int64
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

// Store holds the pool and implements all DB operations.
type Store struct {
	pool *pgxpool.Pool
}

// NewStore constructs a Store backed by pool.
func NewStore(pool *pgxpool.Pool) *Store { return &Store{pool: pool} }

// ---------------------------------------------------------------------------
// Printer CRUD
// ---------------------------------------------------------------------------

// ListPrinters returns all printers for locationID, ordered by name.
func (s *Store) ListPrinters(ctx context.Context, locationID string) ([]Printer, error) {
	var out []Printer
	err := db.Scoped(ctx, s.pool, db.ScopeFromContext(ctx), func(tx pgx.Tx) error {
		rows, err := tx.Query(ctx, `
			SELECT id, location_id, name, kind, connection,
			       host, port, station_id, is_active, created_at, updated_at
			  FROM location_printers
			 WHERE location_id = $1
			 ORDER BY name ASC
		`, locationID)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var p Printer
			if err := rows.Scan(
				&p.ID, &p.LocationID, &p.Name, &p.Kind, &p.Connection,
				&p.Host, &p.Port, &p.StationID, &p.IsActive, &p.CreatedAt, &p.UpdatedAt,
			); err != nil {
				return err
			}
			out = append(out, p)
		}
		return rows.Err()
	})
	if out == nil {
		out = []Printer{}
	}
	return out, err
}

// GetPrinter returns a single printer by id.
// Returns ErrPrinterNotFound when not visible under the current scope.
func (s *Store) GetPrinter(ctx context.Context, id string) (*Printer, error) {
	var p Printer
	err := db.Scoped(ctx, s.pool, db.ScopeFromContext(ctx), func(tx pgx.Tx) error {
		return tx.QueryRow(ctx, `
			SELECT id, location_id, name, kind, connection,
			       host, port, station_id, is_active, created_at, updated_at
			  FROM location_printers
			 WHERE id = $1
		`, id).Scan(
			&p.ID, &p.LocationID, &p.Name, &p.Kind, &p.Connection,
			&p.Host, &p.Port, &p.StationID, &p.IsActive, &p.CreatedAt, &p.UpdatedAt,
		)
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrPrinterNotFound
	}
	return &p, err
}

// CreatePrinter inserts a new printer and returns the created row.
func (s *Store) CreatePrinter(ctx context.Context, req CreatePrinterReq) (*Printer, error) {
	port := 9100
	if req.Port != nil {
		port = *req.Port
	}
	isActive := true
	if req.IsActive != nil {
		isActive = *req.IsActive
	}

	var p Printer
	err := db.Scoped(ctx, s.pool, db.ScopeFromContext(ctx), func(tx pgx.Tx) error {
		return tx.QueryRow(ctx, `
			INSERT INTO location_printers
			       (location_id, name, kind, connection, host, port, station_id, is_active)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
			RETURNING id, location_id, name, kind, connection,
			          host, port, station_id, is_active, created_at, updated_at
		`,
			req.LocationID, req.Name, req.Kind, req.Connection,
			req.Host, port, req.StationID, isActive,
		).Scan(
			&p.ID, &p.LocationID, &p.Name, &p.Kind, &p.Connection,
			&p.Host, &p.Port, &p.StationID, &p.IsActive, &p.CreatedAt, &p.UpdatedAt,
		)
	})
	return &p, err
}

// UpdatePrinter applies non-nil fields from req to the printer row.
// Returns ErrPrinterNotFound if no row matches.
func (s *Store) UpdatePrinter(ctx context.Context, id string, req UpdatePrinterReq) (*Printer, error) {
	var p Printer
	err := db.Scoped(ctx, s.pool, db.ScopeFromContext(ctx), func(tx pgx.Tx) error {
		return tx.QueryRow(ctx, `
			UPDATE location_printers SET
			    name       = COALESCE($2, name),
			    kind       = COALESCE($3, kind),
			    connection = COALESCE($4, connection),
			    host       = COALESCE($5, host),
			    port       = COALESCE($6, port),
			    station_id = CASE WHEN $7::boolean THEN $8::uuid ELSE station_id END,
			    is_active  = COALESCE($9, is_active),
			    updated_at = timezone('utc', now())
			WHERE id = $1
			RETURNING id, location_id, name, kind, connection,
			          host, port, station_id, is_active, created_at, updated_at
		`,
			id,
			req.Name,
			req.Kind,
			req.Connection,
			req.Host,
			req.Port,
			req.StationID != nil, // $7: whether to overwrite station_id
			req.StationID,        // $8: new station_id value (may be nil → NULL)
			req.IsActive,
		).Scan(
			&p.ID, &p.LocationID, &p.Name, &p.Kind, &p.Connection,
			&p.Host, &p.Port, &p.StationID, &p.IsActive, &p.CreatedAt, &p.UpdatedAt,
		)
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrPrinterNotFound
	}
	return &p, err
}

// DeletePrinter removes a printer by id.
// Returns ErrPrinterNotFound when no row is deleted (not in scope or gone).
func (s *Store) DeletePrinter(ctx context.Context, id string) error {
	var deleted bool
	err := db.Scoped(ctx, s.pool, db.ScopeFromContext(ctx), func(tx pgx.Tx) error {
		tag, err := tx.Exec(ctx,
			`DELETE FROM location_printers WHERE id = $1`, id)
		if err != nil {
			return err
		}
		deleted = tag.RowsAffected() > 0
		return nil
	})
	if err != nil {
		return err
	}
	if !deleted {
		return ErrPrinterNotFound
	}
	return nil
}

// ---------------------------------------------------------------------------
// Order snapshot for print jobs
// ---------------------------------------------------------------------------

// GetOrderSnapshot fetches the minimal order data needed to build a print job.
// Returns ErrOrderNotFound when the order is not visible under the current scope.
func (s *Store) GetOrderSnapshot(ctx context.Context, orderID string) (*OrderSnapshot, error) {
	var snap OrderSnapshot
	err := db.Scoped(ctx, s.pool, db.ScopeFromContext(ctx), func(tx pgx.Tx) error {
		// Header query
		err := tx.QueryRow(ctx, `
			SELECT
				o.id,
				o.order_number,
				o.subtotal_cents,
				o.tax_cents,
				COALESCE(
					(SELECT SUM(tip_amount_cents) FROM order_payments WHERE order_id = o.id),
					0
				),
				o.total_cents,
				COALESCE(o.currency_code, 'ZAR'),
				l.name,
				l.address
			FROM orders o
			JOIN locations l ON l.id = o.location_id
			WHERE o.id = $1
		`, orderID).Scan(
			&snap.OrderID,
			&snap.OrderNumber,
			&snap.SubtotalCents,
			&snap.TaxCents,
			&snap.TipCents,
			&snap.TotalCents,
			&snap.CurrencyCode,
			&snap.StoreName,
			&snap.StoreAddress,
		)
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrOrderNotFound
		}
		if err != nil {
			return err
		}

		// Line items
		rows, err := tx.Query(ctx, `
			SELECT i.name, oi.quantity, oi.unit_price_cents
			  FROM order_items oi
			  JOIN items i ON i.id = oi.item_id
			 WHERE oi.order_id = $1
			 ORDER BY oi.created_at ASC
		`, orderID)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var item OrderItemSnapshot
			if err := rows.Scan(&item.ItemName, &item.Quantity, &item.UnitPriceCents); err != nil {
				return err
			}
			snap.Items = append(snap.Items, item)
		}
		return rows.Err()
	})
	if err != nil {
		return nil, err
	}
	return &snap, nil
}

// GetPrintersForLocation returns all active printers for locationID.
// Used internally by print job dispatchers.
func (s *Store) GetPrintersForLocation(ctx context.Context, locationID string, kind string) ([]Printer, error) {
	var out []Printer
	err := db.Scoped(ctx, s.pool, db.ScopeFromContext(ctx), func(tx pgx.Tx) error {
		rows, err := tx.Query(ctx, `
			SELECT id, location_id, name, kind, connection,
			       host, port, station_id, is_active, created_at, updated_at
			  FROM location_printers
			 WHERE location_id = $1
			   AND kind = $2
			   AND is_active
			 ORDER BY name ASC
		`, locationID, kind)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var p Printer
			if err := rows.Scan(
				&p.ID, &p.LocationID, &p.Name, &p.Kind, &p.Connection,
				&p.Host, &p.Port, &p.StationID, &p.IsActive, &p.CreatedAt, &p.UpdatedAt,
			); err != nil {
				return err
			}
			out = append(out, p)
		}
		return rows.Err()
	})
	if out == nil {
		out = []Printer{}
	}
	return out, err
}

// GetOrderLocationID returns the location_id for the given order, needed for
// cross-tenant scope checks before heavier queries.
func (s *Store) GetOrderLocationID(ctx context.Context, orderID string) (string, error) {
	var locID string
	err := db.Scoped(ctx, s.pool, db.ScopeFromContext(ctx), func(tx pgx.Tx) error {
		return tx.QueryRow(ctx,
			`SELECT location_id FROM orders WHERE id = $1`, orderID,
		).Scan(&locID)
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return "", ErrOrderNotFound
	}
	return locID, err
}
