package receiptdelivery

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/beepbite/backend/internal/auth"
	"github.com/beepbite/backend/internal/db"
	"github.com/beepbite/backend/internal/email"
	"github.com/beepbite/backend/internal/integrations/whatsapp"
	"github.com/beepbite/backend/internal/locations"
	"github.com/beepbite/backend/internal/phone"
	"github.com/beepbite/backend/internal/receiptpdf"
)

// Handler wires the receipt-delivery HTTP routes.
type Handler struct {
	store    *Store
	pool     *pgxpool.Pool    // needed to resolve a location's currency/locale
	emailReg email.Registry   // may be nil — email routes return 503 when absent
	waClient *whatsapp.Client // may be nil — WA route returns 503 when absent
}

// NewHandler constructs a Handler.
//
//	h := receiptdelivery.NewHandler(pool, emailRegistry, waClient)
//	h.Mount(orgScopedRouter)
//
// emailReg and waClient may be nil; those delivery routes will respond with
// HTTP 503 Service Unavailable when the respective integration is not
// configured.
func NewHandler(pool *pgxpool.Pool, emailReg email.Registry, waClient *whatsapp.Client) *Handler {
	return &Handler{
		store:    NewStore(pool),
		pool:     pool,
		emailReg: emailReg,
		waClient: waClient,
	}
}

// Mount registers the receipt-delivery routes onto r.
// Must be called within an org-scoped chi.Router group (auth.RequireOrgScope
// already applied).
//
// Routes:
//
//	GET  /orders/{order_id}/receipt.pdf
//	POST /orders/{order_id}/receipt/email
//	POST /orders/{order_id}/receipt/whatsapp
func (h *Handler) Mount(r chi.Router) {
	r.Get("/orders/{order_id}/receipt.pdf", h.getPDF)
	r.Post("/orders/{order_id}/receipt/email", h.postEmail)
	r.Post("/orders/{order_id}/receipt/whatsapp", h.postWhatsApp)
}

// ─── GET /orders/{order_id}/receipt.pdf ──────────────────────────────────────

func (h *Handler) getPDF(w http.ResponseWriter, r *http.Request) {
	orderID := chi.URLParam(r, "order_id")
	if orderID == "" {
		writeErr(w, http.StatusBadRequest, "order_id required")
		return
	}

	pdfBytes, orgID, err := h.buildPDF(r, orderID)
	if err != nil {
		h.mapErr(w, err)
		return
	}

	// Record delivery — store a short opaque storage_key (first 64 bytes,
	// base64-encoded) as a surrogate for "inline" storage.
	keyLen := 64
	if len(pdfBytes) < keyLen {
		keyLen = len(pdfBytes)
	}
	storageKey := "inline:" + base64.StdEncoding.EncodeToString(pdfBytes[:keyLen])
	_ = h.store.RecordDelivery(r.Context(), orderID, orgID, storageKey, "pdf")

	w.Header().Set("Content-Type", "application/pdf")
	w.Header().Set("Content-Disposition",
		fmt.Sprintf(`attachment; filename="receipt-%s.pdf"`, orderID))
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(pdfBytes)
}

// ─── POST /orders/{order_id}/receipt/email ───────────────────────────────────

// emailRequest is the optional JSON body for the email endpoint.
// When to_email is not provided, the handler falls back to the order's
// associated customer email (if any).
type emailRequest struct {
	ToEmail string `json:"to_email"`
}

func (h *Handler) postEmail(w http.ResponseWriter, r *http.Request) {
	if h.emailReg == nil {
		writeErr(w, http.StatusServiceUnavailable, "email integration not configured")
		return
	}

	orderID := chi.URLParam(r, "order_id")
	if orderID == "" {
		writeErr(w, http.StatusBadRequest, "order_id required")
		return
	}

	var req emailRequest
	_ = json.NewDecoder(r.Body).Decode(&req) // tolerate empty body

	pdfBytes, orgID, err := h.buildPDF(r, orderID)
	if err != nil {
		h.mapErr(w, err)
		return
	}

	toEmail := req.ToEmail
	if toEmail == "" {
		contact, cErr := h.store.GetOrderContact(r.Context(), orderID)
		if cErr == nil {
			toEmail = contact.Email
		}
	}
	if toEmail == "" {
		writeErr(w, http.StatusUnprocessableEntity,
			"no recipient email: provide to_email or attach a customer with an email address")
		return
	}

	// Resolve location_id for the email registry.
	locID, locErr := h.store.OrderLocationID(r.Context(), orderID)
	if locErr != nil {
		h.mapErr(w, locErr)
		return
	}

	provider, _, provErr := h.emailReg.For(r.Context(), locID)
	if provErr != nil {
		writeErr(w, http.StatusServiceUnavailable, "email provider not configured: "+provErr.Error())
		return
	}

	receipt, rErr := h.store.GetReceipt(r.Context(), orderID)
	if rErr != nil {
		h.mapErr(w, rErr)
		return
	}

	set, setErr := locations.SettingsFor(r.Context(), h.pool, locID)
	if setErr != nil {
		writeErr(w, http.StatusInternalServerError, "resolve location settings: "+setErr.Error())
		return
	}

	if sErr := provider.Send(r.Context(), email.Message{
		To:      toEmail,
		Subject: "Your receipt from " + receipt.StoreName,
		Text:    formatReceiptText(receipt, set),
		HTML:    formatReceiptHTML(receipt, set),
	}); sErr != nil {
		writeErr(w, http.StatusBadGateway, "email send failed: "+sErr.Error())
		return
	}

	_ = pdfBytes // rendered for future attachment support
	_ = h.store.RecordDelivery(r.Context(), orderID, orgID, "email:"+toEmail, "email")

	writeJSON(w, http.StatusOK, map[string]string{"status": "sent", "to": toEmail})
}

// ─── POST /orders/{order_id}/receipt/whatsapp ─────────────────────────────────

// whatsAppRequest is the optional JSON body for the whatsapp endpoint.
type whatsAppRequest struct {
	// To is an E.164 phone number including the country code and leading "+",
	// e.g. "+15551234567" or "+441632960123". National formats are rejected:
	// this endpoint has no location context to read them against, and a number
	// interpreted under the wrong country would deliver a customer's receipt —
	// with their name, order and address on it — to an unrelated stranger.
	To string `json:"to"`
}

func (h *Handler) postWhatsApp(w http.ResponseWriter, r *http.Request) {
	if h.waClient == nil {
		writeErr(w, http.StatusServiceUnavailable, "whatsapp integration not configured")
		return
	}

	orderID := chi.URLParam(r, "order_id")
	if orderID == "" {
		writeErr(w, http.StatusBadRequest, "order_id required")
		return
	}

	var req whatsAppRequest
	_ = json.NewDecoder(r.Body).Decode(&req)

	pdfBytes, orgID, err := h.buildPDF(r, orderID)
	if err != nil {
		h.mapErr(w, err)
		return
	}

	to := req.To
	if to != "" {
		// A caller-supplied recipient is untrusted input that redirects a
		// receipt away from the customer on the order, so it must be exactly
		// E.164 — no normalisation guesswork on a value this sensitive.
		// Numbers already on the order (below) are passed through as stored,
		// since rewriting them here would only mask bad data at rest.
		if !phone.IsE164(to) {
			writeErr(w, http.StatusBadRequest,
				"to must be an E.164 phone number including the country code, e.g. +15551234567")
			return
		}
	} else {
		contact, cErr := h.store.GetOrderContact(r.Context(), orderID)
		if cErr == nil {
			to = contact.WhatsAppNumber
		}
	}
	if to == "" {
		writeErr(w, http.StatusUnprocessableEntity,
			"no recipient: provide to or attach a customer with a whatsapp_number")
		return
	}

	receipt, rErr := h.store.GetReceipt(r.Context(), orderID)
	if rErr != nil {
		h.mapErr(w, rErr)
		return
	}

	set, setErr := h.receiptSettings(r.Context(), orderID)
	if setErr != nil {
		h.mapErr(w, setErr)
		return
	}

	body := formatReceiptText(receipt, set)
	if _, wErr := h.waClient.SendText(to, body, false); wErr != nil {
		writeErr(w, http.StatusBadGateway, "whatsapp send failed: "+wErr.Error())
		return
	}

	_ = pdfBytes // future: upload + SendDocument
	_ = h.store.RecordDelivery(r.Context(), orderID, orgID, "whatsapp:"+to, "whatsapp")

	writeJSON(w, http.StatusOK, map[string]string{"status": "sent", "to": to})
}

// ─── Shared helpers ───────────────────────────────────────────────────────────

// buildPDF verifies org-scope, fetches the receipt, renders the PDF, and
// returns the bytes + the orgID (needed to record delivery).
func (h *Handler) buildPDF(r *http.Request, orderID string) ([]byte, string, error) {
	// Org-scope cross-tenant guard — identical pattern to handlers/receipts.
	locID, err := h.store.OrderLocationID(r.Context(), orderID)
	if err != nil {
		return nil, "", err
	}
	if !auth.OrgScopeFrom(r.Context()).AllowsLocation(locID) {
		return nil, "", ErrOrderNotFound // 404 to avoid existence leaks
	}

	receipt, err := h.store.GetReceipt(r.Context(), orderID)
	if err != nil {
		return nil, "", err
	}

	// The currency exponent and locale are properties of the location, not of
	// the renderer: without them a ¥ or KD receipt prints amounts that are off
	// by a factor of 100 or 10.
	set, err := locations.SettingsFor(r.Context(), h.pool, locID)
	if err != nil {
		return nil, "", fmt.Errorf("resolve location settings: %w", err)
	}

	pdfBytes, err := receiptpdf.Render(receipt, receiptpdf.Opts{
		Decimals: set.Decimals(),
		Locale:   set.Locale,
	})
	if err != nil {
		return nil, "", fmt.Errorf("render pdf: %w", err)
	}

	// Extract orgID from the db.Scope injected by RequireOrgScope.
	orgID := db.ScopeFromContext(r.Context()).OrgID

	return pdfBytes, orgID, nil
}

// receiptSettings resolves the currency/locale posture of an order's location,
// which is what every printed amount on that receipt must be formatted with.
func (h *Handler) receiptSettings(ctx context.Context, orderID string) (locations.Settings, error) {
	locID, err := h.store.OrderLocationID(ctx, orderID)
	if err != nil {
		return locations.Settings{}, err
	}
	return locations.SettingsFor(ctx, h.pool, locID)
}

func (h *Handler) mapErr(w http.ResponseWriter, err error) {
	if errors.Is(err, ErrOrderNotFound) {
		writeErr(w, http.StatusNotFound, "not found")
		return
	}
	writeErr(w, http.StatusInternalServerError, err.Error())
}

// ─── JSON helpers ─────────────────────────────────────────────────────────────

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(v)
}

func writeErr(w http.ResponseWriter, code int, msg string) {
	writeJSON(w, code, map[string]string{"error": msg})
}
