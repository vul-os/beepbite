// Package paymentwebhook provides a unified, provider-agnostic webhook receiver.
//
// Primary route (unauthenticated — HMAC is the auth):
//
//	POST /webhooks/{provider}/{location_id}
//
// Backward-compatible shims are also registered so existing provider URLs
// continue to work without breaking deployed integrations:
//
//	POST /payments/webhooks/paystack/{location_id}   → paystack dispatcher
//	POST /webhooks/paystack/transfer/{region}         → transfer dispatcher
//
// Flow per request:
//  1. Extract provider + location_id from URL.
//  2. Look up location_payment_credentials (provider, location_id) → webhook_secret.
//     Falls back to the Paystack Manager per-region secret for the transfer shim.
//     Returns 404 if no row found (don't leak existence).
//  3. Verify provider HMAC signature. Returns 401 on mismatch.
//  4. Persist to webhook_event_log with idempotency key = (provider, provider_txn_id).
//     If already present → 200, no re-processing.
//  5. Dispatch event to the appropriate handler (checkout.*, refund.*, transfer.*).
//  6. Return 200 {"ok":true}.
package paymentwebhook

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/beepbite/backend/internal/integrations/paystack"
	"github.com/beepbite/backend/internal/integrations/stripe"
	"github.com/beepbite/backend/internal/secretbox"
)

// Handler is the unified webhook receiver.
type Handler struct {
	pool     *pgxpool.Pool
	store    *Store
	paystack *paystack.Manager
	stripe   *stripe.Manager
	box      *secretbox.Box // may be nil when BYO keys are not configured
}

// NewHandler constructs a Handler.
// box may be nil; when nil, only region-level (env-var) credentials are used
// for signature verification (no BYO key decryption).
func NewHandler(pool *pgxpool.Pool, ps *paystack.Manager, st *stripe.Manager, box *secretbox.Box) *Handler {
	return &Handler{
		pool:     pool,
		store:    NewStore(pool),
		paystack: ps,
		stripe:   st,
		box:      box,
	}
}

// Mount registers all webhook routes on the supplied router.
// Call this on the root router (outside auth middleware).
func (h *Handler) Mount(r chi.Router) {
	// Primary unified route.
	r.Post("/webhooks/{provider}/{location_id}", h.handleWebhook)

	// Backward-compat shims: keep old URLs working, delegating to the same dispatcher.
	r.Post("/payments/webhooks/paystack/{location_id}", h.handlePaystackShim)
	r.Post("/webhooks/paystack/transfer/{region}", h.handleTransferShim)
}

// ---------------------------------------------------------------------------
// Primary handler
// ---------------------------------------------------------------------------

func (h *Handler) handleWebhook(w http.ResponseWriter, r *http.Request) {
	provider := strings.ToLower(chi.URLParam(r, "provider"))
	locationID := chi.URLParam(r, "location_id")

	body, err := io.ReadAll(io.LimitReader(r.Body, 1<<20))
	if err != nil {
		writeErr(w, http.StatusBadRequest, "cannot read body")
		return
	}

	webhookSecret, err := h.resolveWebhookSecret(r.Context(), provider, locationID)
	if err != nil {
		// Return 404 regardless of the actual cause to avoid leaking info.
		http.NotFound(w, r)
		return
	}

	if err := h.verifySignature(provider, webhookSecret, body, r); err != nil {
		log.Printf("paymentwebhook: sig fail provider=%s loc=%s: %v", provider, locationID, err)
		writeErr(w, http.StatusUnauthorized, "invalid signature")
		return
	}

	h.dispatch(w, r, provider, locationID, body)
}

// ---------------------------------------------------------------------------
// Backward-compat shims
// ---------------------------------------------------------------------------

// handlePaystackShim handles legacy /payments/webhooks/paystack/{location_id}.
func (h *Handler) handlePaystackShim(w http.ResponseWriter, r *http.Request) {
	locationID := chi.URLParam(r, "location_id")

	body, err := io.ReadAll(io.LimitReader(r.Body, 1<<20))
	if err != nil {
		writeErr(w, http.StatusBadRequest, "cannot read body")
		return
	}

	webhookSecret, err := h.resolveWebhookSecret(r.Context(), "paystack", locationID)
	if err != nil {
		http.NotFound(w, r)
		return
	}

	if err := h.verifySignature("paystack", webhookSecret, body, r); err != nil {
		log.Printf("paymentwebhook(shim): sig fail loc=%s: %v", locationID, err)
		writeErr(w, http.StatusUnauthorized, "invalid signature")
		return
	}

	h.dispatch(w, r, "paystack", locationID, body)
}

// handleTransferShim handles legacy /webhooks/paystack/transfer/{region}.
// The region path segment selects a per-region webhook secret from the
// Paystack Manager (env-var credentials, not BYO keys).
func (h *Handler) handleTransferShim(w http.ResponseWriter, r *http.Request) {
	region := chi.URLParam(r, "region")

	body, err := io.ReadAll(io.LimitReader(r.Body, 1<<20))
	if err != nil {
		writeErr(w, http.StatusBadRequest, "cannot read body")
		return
	}

	creds, err := h.paystack.ForRegion(region)
	if err != nil {
		http.NotFound(w, r)
		return
	}

	sig := r.Header.Get("x-paystack-signature")
	if err := paystack.VerifyWebhookSignature(creds.WebhookSecret, body, sig); err != nil {
		log.Printf("paymentwebhook(transfer-shim): sig fail region=%s: %v", region, err)
		writeErr(w, http.StatusUnauthorized, "invalid signature")
		return
	}

	// Transfer events are not location-scoped, so pass region as the location_id
	// placeholder. The transfer dispatcher ignores it.
	h.dispatch(w, r, "paystack", "region:"+region, body)
}

// ---------------------------------------------------------------------------
// Credential resolution
// ---------------------------------------------------------------------------

// resolveWebhookSecret looks up the webhook secret for (provider, locationID).
// It first tries BYO location_payment_credentials; if box is nil or no row
// exists it falls back to the per-region env-var credentials via ForLocation.
func (h *Handler) resolveWebhookSecret(ctx context.Context, provider, locationID string) (string, error) {
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()

	// Try BYO credentials first (encrypted webhook secret).
	if h.box != nil {
		ct, err := h.store.GetWebhookSecretCiphertext(ctx, provider, locationID)
		if err == nil && ct != "" {
			plain, err := h.box.Decrypt(ct)
			if err == nil && plain != "" {
				return plain, nil
			}
		}
	}

	// Fall back to region-level credentials from env.
	switch strings.ToLower(provider) {
	case "paystack":
		_, lc, err := h.paystack.ForLocation(ctx, h.pool, locationID)
		if err != nil {
			return "", err
		}
		return lc.WebhookSecret, nil
	case "stripe":
		if h.stripe != nil {
			_, lc, err := h.stripe.ForLocation(ctx, h.pool, locationID)
			if err != nil {
				return "", err
			}
			return lc.WebhookSecret, nil
		}
	}
	return "", errors.New("paymentwebhook: no webhook secret found")
}

// ---------------------------------------------------------------------------
// Signature verification (provider-dispatch)
// ---------------------------------------------------------------------------

func (h *Handler) verifySignature(provider, secret string, body []byte, r *http.Request) error {
	switch strings.ToLower(provider) {
	case "paystack":
		sig := r.Header.Get("x-paystack-signature")
		return paystack.VerifyWebhookSignature(secret, body, sig)
	case "stripe":
		sig := r.Header.Get("Stripe-Signature")
		return stripe.VerifyWebhookSignature(secret, body, sig, time.Now())
	default:
		return errors.New("paymentwebhook: unsupported provider " + provider)
	}
}

// ---------------------------------------------------------------------------
// Event dispatch
// ---------------------------------------------------------------------------

// dispatch is the main event-routing table. It is called after signature
// verification and handles idempotency + side-effects.
func (h *Handler) dispatch(w http.ResponseWriter, r *http.Request, provider, locationID string, body []byte) {
	// Decode the envelope to get event type and a stable idempotency key.
	var env struct {
		Event string          `json:"event"` // Paystack
		Type  string          `json:"type"`  // Stripe
		Data  json.RawMessage `json:"data"`
	}
	if err := json.Unmarshal(body, &env); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid JSON")
		return
	}

	eventType := env.Event
	if eventType == "" {
		eventType = env.Type
	}

	idempotencyKey := h.idempotencyKey(provider, eventType, env.Data, body)

	baseCtx := r.Context()
	logID, err := h.store.LogWebhookEvent(baseCtx, provider, eventType, idempotencyKey, body)
	if err != nil {
		if errors.Is(err, ErrDuplicate) {
			// Already processed — replay-safe 200.
			writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
			return
		}
		log.Printf("paymentwebhook: log event provider=%s event=%s: %v", provider, eventType, err)
		writeErr(w, http.StatusInternalServerError, "internal error")
		return
	}

	processCtx, cancel := context.WithTimeout(baseCtx, 15*time.Second)
	defer cancel()

	var processErr error

	switch {
	// ---- checkout / charge events ----
	case eventType == "checkout.completed" || eventType == "charge.success":
		processErr = h.store.HandleCheckoutCompleted(processCtx, provider, locationID, env.Data)

	case eventType == "checkout.failed" || eventType == "charge.failed":
		processErr = h.store.HandleCheckoutFailed(processCtx, provider, locationID, env.Data)

	// ---- refund events ----
	case eventType == "refund.succeeded" || eventType == "refund.processed":
		processErr = h.store.HandleRefundSucceeded(processCtx, provider, locationID, env.Data)

	// ---- Stripe-specific payment_intent events ----
	case eventType == "payment_intent.succeeded":
		processErr = h.store.HandleStripePaymentIntentSucceeded(processCtx, env.Data)

	case eventType == "payment_intent.payment_failed":
		processErr = h.store.HandleStripePaymentIntentFailed(processCtx, env.Data)

	case eventType == "charge.refunded":
		processErr = h.store.HandleStripeChargeRefunded(processCtx, env.Data)

	// ---- transfer events (reuse existing logic) ----
	case strings.HasPrefix(eventType, "transfer."):
		processErr = h.handleTransferEvent(processCtx, eventType, env.Data, logID)

	default:
		// Unknown event — mark ignored and return 200.
		_ = h.store.MarkWebhookIgnored(baseCtx, logID, "unhandled event type: "+eventType)
		writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
		return
	}

	if processErr != nil {
		log.Printf("paymentwebhook: process provider=%s event=%s key=%s: %v",
			provider, eventType, idempotencyKey, processErr)
		_ = h.store.MarkWebhookFailed(baseCtx, logID, processErr.Error())
		// Return 200 — providers retry on 5xx; a logic error shouldn't keep
		// their retry queue hot.
		writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
		return
	}

	_ = h.store.MarkWebhookProcessed(baseCtx, logID)
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

// handleTransferEvent routes transfer.* events to the payout store.
func (h *Handler) handleTransferEvent(ctx context.Context, eventType string, data json.RawMessage, logID string) error {
	var td struct {
		TransferCode string `json:"transfer_code"`
		Reference    string `json:"reference"`
		Reason       string `json:"reason"`
		Failures     []struct {
			Reason string `json:"reason"`
		} `json:"failures"`
	}
	if err := json.Unmarshal(data, &td); err != nil {
		return err
	}
	transferCode := td.TransferCode
	if transferCode == "" {
		transferCode = td.Reference
	}

	switch eventType {
	case "transfer.success":
		return h.store.UpdatePayoutSuccess(ctx, transferCode)
	case "transfer.failed":
		reason := td.Reason
		if reason == "" && len(td.Failures) > 0 {
			reason = td.Failures[0].Reason
		}
		return h.store.UpdatePayoutFailed(ctx, transferCode, reason)
	case "transfer.reversed":
		return h.store.UpdatePayoutReversed(ctx, transferCode)
	default:
		_ = h.store.MarkWebhookIgnored(context.Background(), logID, "unhandled transfer event: "+eventType)
		return nil
	}
}

// idempotencyKey derives a stable string to use as external_event_id in
// webhook_event_log. We prefer the provider-assigned transaction/reference
// ID over a hash of the full payload.
func (h *Handler) idempotencyKey(provider, eventType string, data json.RawMessage, _ []byte) string {
	// Try to extract a stable reference from the data envelope.
	var d struct {
		ID           json.RawMessage `json:"id"`
		Reference    string          `json:"reference"`
		TransferCode string          `json:"transfer_code"`
	}
	_ = json.Unmarshal(data, &d)

	if d.TransferCode != "" {
		return provider + ":" + d.TransferCode
	}
	if d.Reference != "" {
		return provider + ":" + d.Reference
	}
	if len(d.ID) > 0 && string(d.ID) != "null" {
		return provider + ":" + eventType + ":" + strings.Trim(string(d.ID), `"`)
	}
	// Last resort: event type + timestamp — not perfectly stable, but won't
	// cause false-positive duplicate suppression across distinct events.
	return provider + ":" + eventType + ":" + time.Now().UTC().Format(time.RFC3339Nano)
}
