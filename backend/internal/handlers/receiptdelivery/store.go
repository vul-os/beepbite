// Package receiptdelivery implements org-scoped HTTP endpoints for PDF receipt
// generation and delivery (email + WhatsApp), plus a
// SendReceiptOnCompletion hook the order-complete orchestrator can call.
//
// Allowed files (per task spec):
//
//	backend/migrations/037_receipt_documents.sql  (migration, already created)
//	backend/internal/receiptpdf/**                (PDF renderer, already created)
//	backend/internal/handlers/receiptdelivery/**  (this package)
//
// Mounts (org-scoped JWT group):
//
//	GET  /orders/{order_id}/receipt.pdf     → serve application/pdf
//	POST /orders/{order_id}/receipt/email   → email the receipt
//	POST /orders/{order_id}/receipt/whatsapp → send via WhatsApp
//
// The package reads order + location data via READ-ONLY queries that mirror
// the existing handlers/receipts store. It never writes to the receipts
// package's tables.
package receiptdelivery

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/beepbite/backend/internal/db"
	"github.com/beepbite/backend/internal/handlers/receipts"
)

// ErrOrderNotFound is returned when the order does not exist (or is not
// visible to the current org scope).
var ErrOrderNotFound = errors.New("receiptdelivery: order not found")

// ─── Store ────────────────────────────────────────────────────────────────────

// Store holds the DB pool and runs all queries for the delivery package.
type Store struct {
	pool *pgxpool.Pool
}

// NewStore constructs a Store backed by pool.
func NewStore(pool *pgxpool.Pool) *Store { return &Store{pool: pool} }

// GetReceipt reuses the logic from handlers/receipts to fetch a full receipt
// DTO without importing that package's unexported query. This is a READ-ONLY
// query; it does not modify any receipt state.
func (s *Store) GetReceipt(ctx context.Context, orderID string) (*receipts.Receipt, error) {
	// Delegate to the existing store implementation using the same org scope
	// that the outer handler injected via RequireOrgScope middleware.
	rs := receipts.NewStore(s.pool)
	r, err := rs.GetReceipt(ctx, orderID)
	if errors.Is(err, receipts.ErrOrderNotFound) {
		return nil, ErrOrderNotFound
	}
	return r, err
}

// OrderLocationID returns the location_id for an order so the handler can
// perform the org-scope cross-tenant guard before the heavier query.
func (s *Store) OrderLocationID(ctx context.Context, orderID string) (string, error) {
	rs := receipts.NewStore(s.pool)
	locID, err := rs.OrderLocationID(ctx, orderID)
	if errors.Is(err, receipts.ErrOrderNotFound) {
		return "", ErrOrderNotFound
	}
	return locID, err
}

// OrderContact returns the customer email and/or WhatsApp number for an order,
// resolved through the customers table (JOIN on orders.customer_id).
// Either or both fields may be empty when no customer is attached or the
// customer has no contact recorded.
type OrderContact struct {
	Email          string // customers.email — may be empty
	WhatsAppNumber string // customers.whatsapp_number — may be empty
}

// GetOrderContact resolves the customer contact details for orderID.
// Runs as service-role so it can read the customers table (which uses
// organization_id-based RLS that is already satisfied, but the outer
// handler has already verified org-scope; we use service-role here to
// avoid a second RLS resolution on the customers subquery).
func (s *Store) GetOrderContact(ctx context.Context, orderID string) (OrderContact, error) {
	var contact OrderContact
	err := db.Scoped(ctx, s.pool, db.ServiceRoleScope(), func(tx pgx.Tx) error {
		return tx.QueryRow(ctx, `
			SELECT
				COALESCE(c.email, ''),
				COALESCE(c.whatsapp_number, '')
			FROM orders o
			LEFT JOIN customers c ON c.id = o.customer_id
			WHERE o.id = $1
		`, orderID).Scan(&contact.Email, &contact.WhatsAppNumber)
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return contact, ErrOrderNotFound
	}
	return contact, err
}

// RecordDelivery inserts a receipt_documents row to log the delivery event.
// This always runs as service_role because the RLS INSERT policy on
// receipt_documents allows only service_role.
func (s *Store) RecordDelivery(ctx context.Context, orderID, orgID, storageKey, channel string) error {
	return db.Scoped(ctx, s.pool, db.ServiceRoleScope(), func(tx pgx.Tx) error {
		_, err := tx.Exec(ctx, `
			INSERT INTO receipt_documents
				(order_id, organization_id, storage_key, channel, generated_at, retention_until)
			VALUES
				($1, $2, $3, $4, $5, $5 + INTERVAL '7 years')
		`, orderID, orgID, storageKey, channel, time.Now().UTC())
		return err
	})
}
