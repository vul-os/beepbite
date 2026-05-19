// Package transferwebhook receives Paystack transfer.* webhook callbacks,
// verifies the HMAC-SHA512 signature, deduplicates via webhook_event_log, and
// updates merchant_payouts.provider_transfer_status accordingly.
//
// Route (mount under the root router):
//
//	POST /webhooks/paystack/transfer/{region}
//
// The {region} path segment (e.g. "ZA") selects the per-region webhook secret
// from the Paystack Manager so a single endpoint covers all BeepBite regions.
package transferwebhook

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
)

// Handler handles inbound Paystack transfer webhooks.
type Handler struct {
	store    *Store
	paystack *paystack.Manager
}

// NewHandler constructs a Handler.
func NewHandler(pool *pgxpool.Pool, ps *paystack.Manager) *Handler {
	return &Handler{
		store:    NewStore(pool),
		paystack: ps,
	}
}

// Mount registers the transfer-webhook route under the supplied router.
// Callers should mount this on the root router so the full path becomes:
//
//	POST /webhooks/paystack/transfer/{region}
func (h *Handler) Mount(r chi.Router) {
	r.Route("/webhooks", func(r chi.Router) {
		r.Post("/paystack/transfer/{region}", h.handleTransferWebhook)
	})
}

// transferEvent is the minimum shape of Paystack transfer webhook bodies.
type transferEvent struct {
	Event string       `json:"event"`
	Data  transferData `json:"data"`
}

type transferData struct {
	ID           json.RawMessage `json:"id"`
	TransferCode string          `json:"transfer_code"`
	Reference    string          `json:"reference"`
	Status       string          `json:"status"`
	Reason       string          `json:"reason"`
	// Failure details may live in failures[0].reason for some event shapes.
	Failures []struct {
		Reason string `json:"reason"`
	} `json:"failures"`
}

// dedupeKey returns the canonical idempotency string for an event.
// We prefer transfer_code (stable, provider-assigned) over reference.
func dedupeKey(d transferData) string {
	if d.TransferCode != "" {
		return d.TransferCode
	}
	return d.Reference
}

func (h *Handler) handleTransferWebhook(w http.ResponseWriter, r *http.Request) {
	region := chi.URLParam(r, "region")

	body, err := io.ReadAll(io.LimitReader(r.Body, 1<<20))
	if err != nil {
		writeErr(w, http.StatusBadRequest, "cannot read body")
		return
	}

	// Resolve the per-region webhook secret.
	creds, err := h.paystack.ForRegion(region)
	if err != nil {
		// Return 404 so we don't leak which regions are configured.
		http.Error(w, "not found", http.StatusNotFound)
		return
	}

	// Verify HMAC-SHA512 signature.
	sig := r.Header.Get("x-paystack-signature")
	if err := paystack.VerifyWebhookSignature(creds.WebhookSecret, body, sig); err != nil {
		log.Printf("transferwebhook: sig fail region=%s: %v", region, err)
		writeErr(w, http.StatusUnauthorized, "invalid signature")
		return
	}

	var ev transferEvent
	if err := json.Unmarshal(body, &ev); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid JSON")
		return
	}

	dedupe := dedupeKey(ev.Data)
	baseCtx := r.Context()

	// Log the event + idempotency check (outside the process timeout so the
	// INSERT doesn't race with the 15-second deadline).
	logID, err := h.store.LogWebhookEvent(baseCtx, dedupe, ev.Event, body, true)
	if err != nil {
		if err == ErrDuplicate {
			// Already processed — return 200 so Paystack stops retrying.
			w.WriteHeader(http.StatusOK)
			return
		}
		log.Printf("transferwebhook: log event region=%s event=%s: %v", region, ev.Event, err)
		writeErr(w, http.StatusInternalServerError, "internal error")
		return
	}

	processCtx, cancel := context.WithTimeout(baseCtx, 15*time.Second)
	defer cancel()

	var processErr error
	switch ev.Event {
	case "transfer.success":
		processErr = h.store.UpdatePayoutSuccess(processCtx, dedupe)

	case "transfer.failed":
		reason := ev.Data.Reason
		if reason == "" && len(ev.Data.Failures) > 0 {
			reason = ev.Data.Failures[0].Reason
		}
		processErr = h.store.UpdatePayoutFailed(processCtx, dedupe, reason)

	case "transfer.reversed":
		processErr = h.store.UpdatePayoutReversed(processCtx, dedupe)

	default:
		// Unknown event type — mark ignored and return 200.
		_ = h.store.MarkWebhookFailed(baseCtx, logID, "unhandled event type: "+ev.Event)
		w.WriteHeader(http.StatusOK)
		return
	}

	if processErr != nil {
		log.Printf("transferwebhook: process region=%s event=%s dedupe=%s: %v",
			region, ev.Event, dedupe, processErr)
		_ = h.store.MarkWebhookFailed(baseCtx, logID, processErr.Error())
		// Return 200 — Paystack retries on 5xx; a logic error on our side
		// shouldn't keep the queue hot.
		w.WriteHeader(http.StatusOK)
		return
	}

	_ = h.store.MarkWebhookProcessed(baseCtx, logID)
	w.WriteHeader(http.StatusOK)
}
