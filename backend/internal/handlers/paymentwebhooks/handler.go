// Package paymentwebhooks receives signed Paystack / Stripe webhook
// callbacks, verifies them against the region's central credentials, and
// reconciles the matching order_payments row.
//
// Routes (unauthenticated — signature is the auth):
//
//	POST /payments/webhooks/paystack/{location_id}
//	POST /payments/webhooks/stripe/{location_id}
//
// The location_id in the path maps to a region via
// get_location_payment_provider; the region selects which central key we
// use to verify the signature. We reject any signature that doesn't match
// that region's webhook secret.
package paymentwebhooks

import (
	"context"
	"encoding/json"
	"io"
	"log"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/beepbite/backend/internal/integrations/paystack"
	"github.com/beepbite/backend/internal/integrations/stripe"
)

type Handler struct {
	pool     *pgxpool.Pool
	paystack *paystack.Manager
	stripe   *stripe.Manager
}

func NewHandler(pool *pgxpool.Pool, ps *paystack.Manager, st *stripe.Manager) *Handler {
	return &Handler{pool: pool, paystack: ps, stripe: st}
}

func (h *Handler) Mount(r chi.Router) {
	r.Route("/payments/webhooks", func(r chi.Router) {
		r.Post("/paystack/{location_id}", h.paystackWebhook)
		r.Post("/stripe/{location_id}", h.stripeWebhook)
	})
}

// ---- Paystack ----

func (h *Handler) paystackWebhook(w http.ResponseWriter, r *http.Request) {
	locationID := chi.URLParam(r, "location_id")
	body, err := io.ReadAll(io.LimitReader(r.Body, 1<<20))
	if err != nil {
		http.Error(w, "read body", http.StatusBadRequest)
		return
	}

	_, creds, err := h.paystack.ForLocation(r.Context(), h.pool, locationID)
	if err != nil {
		// Do NOT echo the real error — return 404 to avoid telling a
		// probing attacker which location IDs exist.
		http.Error(w, "not found", http.StatusNotFound)
		return
	}

	sig := r.Header.Get("x-paystack-signature")
	if err := paystack.VerifyWebhookSignature(creds.WebhookSecret, body, sig); err != nil {
		log.Printf("paystack webhook sig fail loc=%s: %v", locationID, err)
		http.Error(w, "invalid signature", http.StatusUnauthorized)
		return
	}

	ev, err := paystack.ParseWebhookEvent(body)
	if err != nil {
		http.Error(w, "bad payload", http.StatusBadRequest)
		return
	}

	if err := h.reconcilePaystack(r.Context(), locationID, ev); err != nil {
		log.Printf("paystack webhook reconcile loc=%s ref=%s: %v", locationID, ev.Data.Reference, err)
		// Return 200 anyway — Paystack retries 5xx indefinitely, and a logic
		// error in our handler shouldn't keep their queue hot.
	}
	w.WriteHeader(http.StatusOK)
}

func (h *Handler) reconcilePaystack(ctx context.Context, locationID string, ev *paystack.WebhookEvent) error {
	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()

	switch ev.Event {
	case "charge.success":
		_, err := h.pool.Exec(ctx, `
UPDATE order_payments
SET payment_status = 'completed',
    confirmed_at = now(),
    paystack_status = $2,
    paystack_gateway_response = COALESCE(paystack_gateway_response, 'webhook: charge.success')
WHERE paystack_reference = $1
   OR payment_reference = $1
`, ev.Data.Reference, ev.Data.Status)
		return err
	case "charge.failed":
		_, err := h.pool.Exec(ctx, `
UPDATE order_payments
SET payment_status = 'failed',
    paystack_status = $2,
    paystack_gateway_response = 'webhook: charge.failed'
WHERE paystack_reference = $1
   OR payment_reference = $1
`, ev.Data.Reference, ev.Data.Status)
		return err
	case "refund.processed":
		_, err := h.pool.Exec(ctx, `
UPDATE order_payments
SET payment_status = CASE
    WHEN amount_paid_cents <= $2 THEN 'refunded'
    ELSE 'partially_refunded'
END
WHERE paystack_reference = $1
   OR payment_reference = $1
`, ev.Data.Reference, ev.Data.Amount)
		return err
	}
	// Other event types we silently accept.
	return nil
}

// ---- Stripe ----

func (h *Handler) stripeWebhook(w http.ResponseWriter, r *http.Request) {
	locationID := chi.URLParam(r, "location_id")
	body, err := io.ReadAll(io.LimitReader(r.Body, 1<<20))
	if err != nil {
		http.Error(w, "read body", http.StatusBadRequest)
		return
	}

	_, creds, err := h.stripe.ForLocation(r.Context(), h.pool, locationID)
	if err != nil {
		http.Error(w, "not found", http.StatusNotFound)
		return
	}
	if creds.WebhookSecret == "" {
		http.Error(w, "webhook not configured", http.StatusServiceUnavailable)
		return
	}

	sig := r.Header.Get("Stripe-Signature")
	if err := stripe.VerifyWebhookSignature(creds.WebhookSecret, body, sig, time.Now()); err != nil {
		log.Printf("stripe webhook sig fail loc=%s: %v", locationID, err)
		http.Error(w, "invalid signature", http.StatusUnauthorized)
		return
	}

	ev, err := stripe.ParseWebhookEvent(body)
	if err != nil {
		http.Error(w, "bad payload", http.StatusBadRequest)
		return
	}

	if err := h.reconcileStripe(r.Context(), locationID, ev); err != nil {
		log.Printf("stripe webhook reconcile loc=%s id=%s: %v", locationID, ev.ID, err)
	}
	w.WriteHeader(http.StatusOK)
}

// stripePIObject is the minimum we need from a PaymentIntent-shaped event.
type stripePIObject struct {
	ID       string            `json:"id"`
	Status   string            `json:"status"`
	Metadata map[string]string `json:"metadata"`
}

func (h *Handler) reconcileStripe(ctx context.Context, locationID string, ev *stripe.WebhookEvent) error {
	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()

	// Stripe wraps the business object in data.object — decode what we need.
	var envelope struct {
		Object stripePIObject `json:"object"`
	}
	if err := json.Unmarshal(ev.Data, &envelope); err != nil {
		return err
	}
	orderID := envelope.Object.Metadata["order_id"]
	if orderID == "" {
		// No order linkage — nothing to reconcile.
		return nil
	}

	switch ev.Type {
	case "payment_intent.succeeded":
		_, err := h.pool.Exec(ctx, `
UPDATE order_payments
SET payment_status = 'completed',
    confirmed_at = now(),
    external_transaction_id = $2
WHERE order_id = $1
`, orderID, envelope.Object.ID)
		return err
	case "payment_intent.payment_failed":
		_, err := h.pool.Exec(ctx, `
UPDATE order_payments
SET payment_status = 'failed',
    external_transaction_id = $2
WHERE order_id = $1
`, orderID, envelope.Object.ID)
		return err
	case "charge.refunded":
		_, err := h.pool.Exec(ctx, `
UPDATE order_payments
SET payment_status = 'refunded'
WHERE order_id = $1
`, orderID)
		return err
	}
	return nil
}
