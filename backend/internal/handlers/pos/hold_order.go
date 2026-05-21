package pos

// hold_order.go — Wave 32: "held tickets"
//
// A cashier can hold an order (pause it without firing the kitchen) and release
// it later. Holding removes any existing 'fired' KDS tickets so the kitchen
// never sees a held order. Releasing re-fanouts to KDS so the kitchen picks it
// up fresh.
//
// MountHold registers three routes on the provided chi.Router. The orchestrator
// calls h.MountHold(r) after the existing h.Mount(r) call — it does NOT modify
// handler.go or store.go.

import (
	"context"
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"

	"github.com/beepbite/backend/internal/auth"
	"github.com/beepbite/backend/internal/db"
)

// ---------------------------------------------------------------------------
// Sentinel errors
// ---------------------------------------------------------------------------

// ErrOrderAlreadyCompleted is returned when Hold/Release is called on a paid or
// cancelled order.
var ErrOrderAlreadyCompleted = errors.New("order is already paid or cancelled")

// ErrOrderAlreadyHeld is returned when Hold is called on an already-held order.
var ErrOrderAlreadyHeld = errors.New("order is already held")

// ---------------------------------------------------------------------------
// MountHold registers the hold/release/list routes.
// Call this from the orchestrator (main/server setup) AFTER h.Mount(r):
//
//	h.Mount(r)
//	h.MountHold(r)
//
// ---------------------------------------------------------------------------

// MountHold registers the three held-ticket routes under r.
// It is a separate method in this file so handler.go is not touched.
func (h *Handler) MountHold(r chi.Router) {
	r.Post("/pos/orders/{order_id}/hold", h.holdOrder)
	r.Post("/pos/orders/{order_id}/release", h.releaseOrder)
	r.Get("/pos/orders/held", h.listHeldOrders)
}

// ---------------------------------------------------------------------------
// Response types
// ---------------------------------------------------------------------------

// HeldOrderResp is returned from hold and release operations.
type HeldOrderResp struct {
	OrderID      string  `json:"order_id"`
	HeldAt       *string `json:"held_at"`        // RFC 3339 or null on release
	KDSTicketIDs []string `json:"kds_ticket_ids"` // populated on release
}

// HeldOrderSummary is one entry in the GET /pos/orders/held list.
type HeldOrderSummary struct {
	OrderID     string  `json:"order_id"`
	OrderNumber string  `json:"order_number"`
	LocationID  string  `json:"location_id"`
	Status      string  `json:"status"`
	TotalCents  int64   `json:"total_cents"`
	HeldAt      string  `json:"held_at"` // RFC 3339
	Notes       *string `json:"notes"`
}

// ---------------------------------------------------------------------------
// HTTP handlers
// ---------------------------------------------------------------------------

// POST /pos/orders/{order_id}/hold
func (h *Handler) holdOrder(w http.ResponseWriter, r *http.Request) {
	orderID := chi.URLParam(r, "order_id")
	if orderID == "" {
		writeErr(w, http.StatusBadRequest, "order_id is required")
		return
	}

	// Org-scope check: verify the order belongs to a location the caller owns.
	scope := auth.OrgScopeFrom(r.Context())
	orderLocID, err := h.store.GetOrderLocationID(r.Context(), orderID)
	switch {
	case errors.Is(err, ErrOrderNotFound):
		writeErr(w, http.StatusNotFound, "order not found")
		return
	case err != nil:
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	if !scope.AllowsLocation(orderLocID) {
		writeErr(w, http.StatusNotFound, "order not found")
		return
	}

	actorID := scope.UserID

	resp, err := h.store.HoldOrder(r.Context(), orderID, actorID)
	switch {
	case errors.Is(err, ErrOrderNotFound):
		writeErr(w, http.StatusNotFound, "order not found")
	case errors.Is(err, ErrOrderAlreadyCompleted):
		writeErr(w, http.StatusConflict, "order is already paid or cancelled")
	case errors.Is(err, ErrOrderAlreadyHeld):
		writeErr(w, http.StatusConflict, "order is already held")
	case err != nil:
		writeErr(w, http.StatusInternalServerError, err.Error())
	default:
		writeJSON(w, http.StatusOK, resp)
	}
}

// POST /pos/orders/{order_id}/release
func (h *Handler) releaseOrder(w http.ResponseWriter, r *http.Request) {
	orderID := chi.URLParam(r, "order_id")
	if orderID == "" {
		writeErr(w, http.StatusBadRequest, "order_id is required")
		return
	}

	// Org-scope check: verify the order belongs to a location the caller owns.
	scope := auth.OrgScopeFrom(r.Context())
	orderLocID, err := h.store.GetOrderLocationID(r.Context(), orderID)
	switch {
	case errors.Is(err, ErrOrderNotFound):
		writeErr(w, http.StatusNotFound, "order not found")
		return
	case err != nil:
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	if !scope.AllowsLocation(orderLocID) {
		writeErr(w, http.StatusNotFound, "order not found")
		return
	}

	actorID := scope.UserID

	resp, err := h.store.ReleaseOrder(r.Context(), orderID, actorID)
	switch {
	case errors.Is(err, ErrOrderNotFound):
		writeErr(w, http.StatusNotFound, "order not found")
	case errors.Is(err, ErrOrderAlreadyCompleted):
		writeErr(w, http.StatusConflict, "order is already paid or cancelled")
	case err != nil:
		writeErr(w, http.StatusInternalServerError, err.Error())
	default:
		writeJSON(w, http.StatusOK, resp)
	}
}

// GET /pos/orders/held?location_id=
func (h *Handler) listHeldOrders(w http.ResponseWriter, r *http.Request) {
	locationID := r.URL.Query().Get("location_id")
	if locationID == "" {
		writeErr(w, http.StatusBadRequest, "location_id is required")
		return
	}

	// Org-scope check: verify the caller owns the requested location.
	scope := auth.OrgScopeFrom(r.Context())
	if !scope.AllowsLocation(locationID) {
		writeErr(w, http.StatusNotFound, "location not found")
		return
	}

	orders, err := h.store.ListHeldOrders(r.Context(), locationID)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"orders": orders})
}

// ---------------------------------------------------------------------------
// Store methods
// ---------------------------------------------------------------------------

// HoldOrder sets held_at = now() for the order, deletes any 'fired' KDS tickets
// so the kitchen does not see the order, and writes an audit_log entry.
func (s *Store) HoldOrder(
	ctx context.Context,
	orderID string,
	actorID string,
) (*HeldOrderResp, error) {
	scope := db.ScopeFromContext(ctx)

	tx, err := s.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)

	// Set RLS session vars so tenant policies apply.
	if err := setTxScope(ctx, tx, scope); err != nil {
		return nil, err
	}

	// --- 1. Lock the order and read current state ---
	var status string
	var orgID string
	var heldAt *time.Time
	err = tx.QueryRow(ctx,
		`SELECT status, organization_id, held_at
		 FROM orders WHERE id = $1 FOR UPDATE`,
		orderID,
	).Scan(&status, &orgID, &heldAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrOrderNotFound
	}
	if err != nil {
		return nil, err
	}

	// --- 2. Guard: reject if already paid or cancelled ---
	if status == "completed" || status == "cancelled" {
		return nil, ErrOrderAlreadyCompleted
	}

	// --- 3. Guard: reject if already held ---
	if heldAt != nil {
		return nil, ErrOrderAlreadyHeld
	}

	// --- 4. Set held_at = now() ---
	var newHeldAt time.Time
	if err := tx.QueryRow(ctx,
		`UPDATE orders SET held_at = now(), updated_at = now()
		 WHERE id = $1 RETURNING held_at`,
		orderID,
	).Scan(&newHeldAt); err != nil {
		return nil, err
	}

	// --- 5. Delete 'fired' KDS tickets so kitchen board is clear ---
	// kds_ticket_items cascade via FK when the parent ticket is deleted.
	if _, err := tx.Exec(ctx,
		`DELETE FROM kds_tickets WHERE order_id = $1 AND status = 'fired'`,
		orderID,
	); err != nil {
		return nil, err
	}

	// --- 6. Audit log (service-role-elevated insert) ---
	beforeJSON, _ := json.Marshal(map[string]any{"held_at": nil, "status": status})
	afterJSON, _ := json.Marshal(map[string]any{"held_at": newHeldAt.Format(time.RFC3339)})
	auditErr := db.WithTxServiceRole(ctx, tx, func() error {
		_, e := tx.Exec(ctx, `
			INSERT INTO audit_log (
			    organization_id,
			    actor_type, actor_id,
			    action, entity_type, entity_id,
			    before_state, after_state
			)
			VALUES ($1, 'staff', $2, 'order.held', 'orders', $3, $4, $5)
		`, orgID, nullStr(actorID), orderID, beforeJSON, afterJSON)
		return e
	})
	if auditErr != nil {
		log.Printf("pos/hold: audit_log insert failed for order=%s: %v", orderID, auditErr)
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}

	heldAtStr := newHeldAt.Format(time.RFC3339)
	return &HeldOrderResp{
		OrderID:      orderID,
		HeldAt:       &heldAtStr,
		KDSTicketIDs: []string{},
	}, nil
}

// ReleaseOrder clears held_at (sets it to NULL), then re-fanouts to KDS so
// the kitchen sees the order fresh, and writes an audit_log entry.
func (s *Store) ReleaseOrder(
	ctx context.Context,
	orderID string,
	actorID string,
) (*HeldOrderResp, error) {
	scope := db.ScopeFromContext(ctx)

	tx, err := s.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)

	// Set RLS session vars so tenant policies apply.
	if err := setTxScope(ctx, tx, scope); err != nil {
		return nil, err
	}

	// --- 1. Lock the order and read current state ---
	var status string
	var orgID string
	var heldAt *time.Time
	err = tx.QueryRow(ctx,
		`SELECT status, organization_id, held_at
		 FROM orders WHERE id = $1 FOR UPDATE`,
		orderID,
	).Scan(&status, &orgID, &heldAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrOrderNotFound
	}
	if err != nil {
		return nil, err
	}

	// --- 2. Guard: reject if already paid or cancelled ---
	if status == "completed" || status == "cancelled" {
		return nil, ErrOrderAlreadyCompleted
	}

	// --- 3. Clear held_at ---
	if _, err := tx.Exec(ctx,
		`UPDATE orders SET held_at = NULL, updated_at = now() WHERE id = $1`,
		orderID,
	); err != nil {
		return nil, err
	}

	// --- 4. Delete any lingering 'fired' tickets then re-fanout to KDS ---
	// A held order may have no KDS tickets (they were removed on hold), but guard
	// against any stale rows just in case.
	if _, err := tx.Exec(ctx,
		`DELETE FROM kds_tickets WHERE order_id = $1 AND status = 'fired'`,
		orderID,
	); err != nil {
		return nil, err
	}

	kdsTicketIDs, fanoutErr := fanoutInsideTx(ctx, tx, orderID)
	if fanoutErr != nil {
		// Non-fatal: enqueue for the background KDS fanout job so the kitchen is
		// never silently missed.
		qErr := db.WithTxServiceRole(ctx, tx, func() error {
			_, e := tx.Exec(ctx, `
				INSERT INTO kds_fanout_queue (order_id, error_message, retry_count, state)
				VALUES ($1, $2, 0, 'pending')
				ON CONFLICT (order_id) DO UPDATE SET error_message = EXCLUDED.error_message
			`, orderID, fanoutErr.Error())
			return e
		})
		if qErr != nil {
			log.Printf("pos/release: fanout failed (%v) AND enqueue failed (%v) for order=%s", fanoutErr, qErr, orderID)
		}
		kdsTicketIDs = []string{}
	}

	// --- 5. Audit log (service-role-elevated insert) ---
	var heldAtStr string
	if heldAt != nil {
		heldAtStr = heldAt.Format(time.RFC3339)
	}
	beforeJSON, _ := json.Marshal(map[string]any{"held_at": heldAtStr})
	afterJSON, _ := json.Marshal(map[string]any{"held_at": nil, "kds_ticket_ids": kdsTicketIDs})
	auditErr := db.WithTxServiceRole(ctx, tx, func() error {
		_, e := tx.Exec(ctx, `
			INSERT INTO audit_log (
			    organization_id,
			    actor_type, actor_id,
			    action, entity_type, entity_id,
			    before_state, after_state
			)
			VALUES ($1, 'staff', $2, 'order.released', 'orders', $3, $4, $5)
		`, orgID, nullStr(actorID), orderID, beforeJSON, afterJSON)
		return e
	})
	if auditErr != nil {
		log.Printf("pos/release: audit_log insert failed for order=%s: %v", orderID, auditErr)
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}

	return &HeldOrderResp{
		OrderID:      orderID,
		HeldAt:       nil,
		KDSTicketIDs: kdsTicketIDs,
	}, nil
}

// ListHeldOrders returns all currently-held orders (held_at IS NOT NULL, status
// not cancelled) for the given location.
func (s *Store) ListHeldOrders(
	ctx context.Context,
	locationID string,
) ([]HeldOrderSummary, error) {
	scope := db.ScopeFromContext(ctx)
	var out []HeldOrderSummary

	err := db.Scoped(ctx, s.pool, scope, func(tx pgx.Tx) error {
		rows, err := tx.Query(ctx, `
			SELECT id, order_number, location_id, status, total_cents, held_at, notes
			FROM orders
			WHERE location_id = $1
			  AND held_at IS NOT NULL
			  AND status != 'cancelled'
			ORDER BY held_at ASC
		`, locationID)
		if err != nil {
			return err
		}
		defer rows.Close()

		for rows.Next() {
			var o HeldOrderSummary
			var heldAt time.Time
			if err := rows.Scan(
				&o.OrderID, &o.OrderNumber, &o.LocationID, &o.Status,
				&o.TotalCents, &heldAt, &o.Notes,
			); err != nil {
				return err
			}
			o.HeldAt = heldAt.Format(time.RFC3339)
			out = append(out, o)
		}
		return rows.Err()
	})
	if err != nil {
		return nil, err
	}
	if out == nil {
		out = []HeldOrderSummary{}
	}
	return out, nil
}
