// Package bankaccounts exposes the bank-account registration surface for
// BeepBite merchants. Account numbers are encrypted with AES-GCM via the
// secretbox package before being stored. Paystack's Transfer Recipient API is
// called at creation time to obtain a recipient_code for future payouts.
//
// Mount under an already-authenticated chi.Router group:
//
//	r.Mount("/bank-accounts", bankaccounts.NewHandler(pool, paystackMgr, box).Routes())
package bankaccounts

import (
	"context"
	"errors"
	"log"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/beepbite/backend/internal/auth"
	"github.com/beepbite/backend/internal/integrations/paystack"
	"github.com/beepbite/backend/internal/secretbox"
)

// Handler wires together the store, Paystack manager, and AES-GCM box.
type Handler struct {
	store    *Store
	paystack *paystack.Manager
	box      *secretbox.Box
}

// NewHandler constructs the handler. All three dependencies are required;
// wiring is done in main.go.
func NewHandler(pool *pgxpool.Pool, ps *paystack.Manager, box *secretbox.Box) *Handler {
	return &Handler{
		store:    NewStore(pool),
		paystack: ps,
		box:      box,
	}
}

// bankCap is the capability required for all bank-account operations.
// Managing bank accounts (registering payout destinations, deleting recipients)
// is a high-privilege action equivalent to controlling where money is sent.
const bankCap = "can_manage_bank"

// Mount attaches the bank-account routes to the given router.
// All routes require the can_manage_bank capability.
func (h *Handler) Mount(r chi.Router) {
	r.Route("/bank-accounts", func(r chi.Router) {
		r.Use(auth.RequireCapability(bankCap))
		r.Post("/", h.create)
		r.Get("/", h.list)
		r.Get("/{id}", h.getByID)
		r.Delete("/{id}", h.softDelete)
	})
}

// Routes is a convenience wrapper that creates and returns a standalone router.
// Callers may prefer Mount when composing into an existing router.
// All routes require the can_manage_bank capability.
func (h *Handler) Routes() chi.Router {
	r := chi.NewRouter()
	r.Use(auth.RequireCapability(bankCap))
	r.Post("/", h.create)
	r.Get("/", h.list)
	r.Get("/{id}", h.getByID)
	r.Delete("/{id}", h.softDelete)
	return r
}

// createReq is the request body for POST /bank-accounts.
type createReq struct {
	OrgID         string  `json:"org_id"`
	LocationID    *string `json:"location_id"`
	BankCode      string  `json:"bank_code"`
	AccountNumber string  `json:"account_number"` // plaintext — never logged
	AccountName   string  `json:"account_name"`
	BankName      string  `json:"bank_name"`
	Currency      string  `json:"currency"`
}

// create handles POST /bank-accounts.
// Steps:
//  1. Decode + validate request.
//  2. Resolve the Paystack client for the org/location's region.
//  3. Encrypt the account number with AES-GCM (secretbox).
//  4. Call Paystack POST /transferrecipient.
//  5. Persist to bank_accounts with the encrypted number and recipient code.
//  6. Audit-log the creation.
func (h *Handler) create(w http.ResponseWriter, r *http.Request) {
	var req createReq
	if err := decodeJSON(r, &req); err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}

	// --- Validate required fields ---
	switch {
	case strings.TrimSpace(req.OrgID) == "":
		writeErr(w, http.StatusBadRequest, "org_id is required")
		return
	case strings.TrimSpace(req.BankCode) == "":
		writeErr(w, http.StatusBadRequest, "bank_code is required")
		return
	case strings.TrimSpace(req.AccountNumber) == "":
		writeErr(w, http.StatusBadRequest, "account_number is required")
		return
	case strings.TrimSpace(req.AccountName) == "":
		writeErr(w, http.StatusBadRequest, "account_name is required")
		return
	case strings.TrimSpace(req.BankName) == "":
		writeErr(w, http.StatusBadRequest, "bank_name is required")
		return
	case strings.TrimSpace(req.Currency) == "":
		writeErr(w, http.StatusBadRequest, "currency is required")
		return
	}

	// Normalise nullable location_id.
	if req.LocationID != nil && strings.TrimSpace(*req.LocationID) == "" {
		req.LocationID = nil
	}

	ctx := r.Context()

	// --- Resolve region (for Paystack client + DB foreign key) ---
	regionCode, err := h.store.resolveRegionCode(ctx, req.OrgID, req.LocationID)
	if err != nil {
		writeErr(w, http.StatusBadRequest, "could not resolve region: "+err.Error())
		return
	}

	regionID, err := h.store.resolveRegionID(ctx, req.OrgID, req.LocationID)
	if err != nil {
		writeErr(w, http.StatusBadRequest, "could not resolve region_id: "+err.Error())
		return
	}

	// --- Obtain Paystack client for this region ---
	psClient, _, err := h.paystack.ClientFor(regionCode)
	if err != nil {
		writeErr(w, http.StatusUnprocessableEntity, "payment provider not configured for region: "+err.Error())
		return
	}

	// --- Encrypt account number (never log the plaintext) ---
	ciphertext, err := h.box.Encrypt(req.AccountNumber)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "failed to encrypt account number")
		return
	}

	// Last 4 for safe display (account numbers are always >= 4 chars in practice).
	last4 := req.AccountNumber
	if len(last4) > 4 {
		last4 = last4[len(last4)-4:]
	}

	// --- Call Paystack Transfer Recipient API ---
	recipientCode, err := psClient.CreateTransferRecipient(ctx,
		req.AccountName, req.AccountNumber, req.BankCode, req.Currency)
	if err != nil {
		writeErr(w, http.StatusBadGateway, "paystack: create transfer recipient failed: "+err.Error())
		return
	}

	// --- Derive actor from context (best-effort; nil if not set) ---
	actorID := actorIDFromContext(ctx)

	// Resolve optional bank_code pointer for store.
	var bankCodePtr *string
	if bc := strings.TrimSpace(req.BankCode); bc != "" {
		bankCodePtr = &bc
	}

	// --- Persist ---
	account, err := h.store.Insert(ctx, insertParams{
		OrgID:                  req.OrgID,
		LocationID:             req.LocationID,
		RegionID:               regionID,
		AccountHolderName:      req.AccountName,
		BankName:               req.BankName,
		BankCode:               bankCodePtr,
		EncryptedAccountNumber: ciphertext,
		AccountNumberLast4:     last4,
		Currency:               req.Currency,
		Provider:               "paystack",
		ProviderRecipientID:    recipientCode,
		CreatedBy:              actorID,
	}, actorID)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "failed to save bank account: "+err.Error())
		return
	}

	writeJSON(w, http.StatusCreated, account)
}

// list handles GET /bank-accounts?org_id=&location_id=
func (h *Handler) list(w http.ResponseWriter, r *http.Request) {
	orgID := r.URL.Query().Get("org_id")
	if strings.TrimSpace(orgID) == "" {
		writeErr(w, http.StatusBadRequest, "org_id query parameter is required")
		return
	}
	locationID := r.URL.Query().Get("location_id")

	accounts, err := h.store.List(r.Context(), orgID, locationID)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, accounts)
}

// getByID handles GET /bank-accounts/{id}
func (h *Handler) getByID(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if id == "" {
		writeErr(w, http.StatusBadRequest, "id is required")
		return
	}

	account, err := h.store.GetByID(r.Context(), id)
	if errors.Is(err, ErrNotFound) {
		writeErr(w, http.StatusNotFound, "bank account not found")
		return
	}
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, account)
}

// softDelete handles DELETE /bank-accounts/{id}.
// Sets is_active=false, then attempts to call Paystack DELETE /transferrecipient/:code.
// The Paystack call is best-effort — if it fails we log and continue.
func (h *Handler) softDelete(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if id == "" {
		writeErr(w, http.StatusBadRequest, "id is required")
		return
	}

	ctx := r.Context()
	actorID := actorIDFromContext(ctx)

	recipientCode, err := h.store.SoftDelete(ctx, id, actorID)
	if errors.Is(err, ErrNotFound) {
		writeErr(w, http.StatusNotFound, "bank account not found or already inactive")
		return
	}
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}

	// Best-effort: inform Paystack the recipient is deactivated.
	if recipientCode != "" {
		// We need a client but don't know the region here; attempt to resolve
		// via the now-deleted account's region code. Since we only support one
		// region at launch this is safe; extend with a region lookup if needed.
		if err := h.deletePaystackRecipient(ctx, recipientCode); err != nil {
			// Non-fatal — log and continue.
			log.Printf("bankaccounts: soft delete %s: paystack delete recipient %q: %v", id, recipientCode, err)
		}
	}

	writeJSON(w, http.StatusOK, map[string]string{"status": "deleted"})
}

// deletePaystackRecipient iterates over configured regions to find a client
// that can reach Paystack. On multi-region setups only the first match is
// tried; extend if needed.
func (h *Handler) deletePaystackRecipient(ctx context.Context, recipientCode string) error {
	// Try common region codes in order. In practice BeepBite is ZA-first.
	for _, region := range []string{"ZA", "KE", "NG"} {
		client, _, err := h.paystack.ClientFor(region)
		if err != nil {
			continue
		}
		return client.DeleteTransferRecipient(ctx, recipientCode)
	}
	return errors.New("no paystack region configured")
}

// actorIDFromContext extracts the authenticated member ID from the request
// context if an auth middleware has placed it there. Returns nil when not set
// so audit rows have a NULL actor_id (system/anonymous action).
//
// The key type is intentionally unexported to avoid collisions. Auth
// middleware must cast with the same key type; update to match your actual
// middleware implementation.
type contextKey string

const contextKeyActorID contextKey = "actor_id"

func actorIDFromContext(ctx interface{ Value(any) any }) *string {
	v := ctx.Value(contextKeyActorID)
	if v == nil {
		return nil
	}
	s, ok := v.(string)
	if !ok || s == "" {
		return nil
	}
	return &s
}
