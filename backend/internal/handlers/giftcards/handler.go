// Package giftcards exposes REST endpoints for issuing, redeeming, reloading,
// refunding, and looking up gift cards. Mount under an already-authenticated
// chi.Router group.
package giftcards

import (
	"errors"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Handler holds the store dependency.
type Handler struct {
	store *Store
}

// NewHandler constructs the Handler and its Store.
func NewHandler(pool *pgxpool.Pool) *Handler {
	return &Handler{store: NewStore(pool)}
}

// Mount wires the gift-card endpoints onto r. Call as:
//
//	r.Route("/gift-cards", giftcards.NewHandler(pool).Mount)
func (h *Handler) Mount(r chi.Router) {
	r.Post("/issue", h.issue)
	r.Post("/redeem", h.redeem)
	r.Post("/reload", h.reload)
	r.Post("/refund", h.refund)
	r.Get("/lookup", h.lookup)
}

// ── Request/response DTOs ──────────────────────────────────────────────────

type issueReq struct {
	OrganizationID      string  `json:"organization_id"`
	Code                string  `json:"code"`
	CardType            string  `json:"card_type"`
	PIN                 string  `json:"pin"`
	InitialBalanceCents int64   `json:"initial_balance_cents"`
	Currency            string  `json:"currency"`
	IssuedToCustomerID  string  `json:"issued_to_customer_id"`
	IssuedToName        string  `json:"issued_to_name"`
	IssuedToEmail       string  `json:"issued_to_email"`
	IssuedToPhone       string  `json:"issued_to_phone"`
	IssuedByStaffID     string  `json:"issued_by_staff_id"`
	ExpiresAt           *string `json:"expires_at"` // RFC3339 or null
	Notes               string  `json:"notes"`
}

type redeemReq struct {
	Code               string `json:"code"`
	AmountCents        int64  `json:"amount_cents"`
	OrderID            string `json:"order_id"`
	PaymentID          string `json:"payment_id"`
	PerformedByStaffID string `json:"performed_by_staff_id"`
	Notes              string `json:"notes"`
}

type reloadReq struct {
	Code               string `json:"code"`
	AmountCents        int64  `json:"amount_cents"`
	OrderID            string `json:"order_id"`
	PerformedByStaffID string `json:"performed_by_staff_id"`
	Notes              string `json:"notes"`
}

type refundReq struct {
	Code               string `json:"code"`
	AmountCents        int64  `json:"amount_cents"`
	OrderID            string `json:"order_id"`
	PerformedByStaffID string `json:"performed_by_staff_id"`
	Notes              string `json:"notes"`
}

// ── Handlers ──────────────────────────────────────────────────────────────

func (h *Handler) issue(w http.ResponseWriter, r *http.Request) {
	var req issueReq
	if err := decodeJSON(r, &req); err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	if req.OrganizationID == "" {
		writeErr(w, http.StatusBadRequest, "organization_id is required")
		return
	}
	if req.InitialBalanceCents < 0 {
		writeErr(w, http.StatusBadRequest, "initial_balance_cents must be >= 0")
		return
	}
	if req.CardType != "" && req.CardType != "physical" && req.CardType != "digital" {
		writeErr(w, http.StatusBadRequest, "card_type must be 'physical' or 'digital'")
		return
	}

	var expiresAt *time.Time
	if req.ExpiresAt != nil && *req.ExpiresAt != "" {
		t, err := time.Parse(time.RFC3339, *req.ExpiresAt)
		if err != nil {
			writeErr(w, http.StatusBadRequest, "expires_at must be RFC3339")
			return
		}
		expiresAt = &t
	}

	result, err := h.store.Issue(r.Context(), IssueParams{
		OrganizationID:      req.OrganizationID,
		Code:                req.Code,
		CardType:            req.CardType,
		PIN:                 req.PIN,
		InitialBalanceCents: req.InitialBalanceCents,
		Currency:            req.Currency,
		IssuedToCustomerID:  req.IssuedToCustomerID,
		IssuedToName:        req.IssuedToName,
		IssuedToEmail:       req.IssuedToEmail,
		IssuedToPhone:       req.IssuedToPhone,
		IssuedByStaffID:     req.IssuedByStaffID,
		ExpiresAt:           expiresAt,
		Notes:               req.Notes,
	})
	if errors.Is(err, ErrCodeCollision) {
		writeErr(w, http.StatusConflict, err.Error())
		return
	}
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, result)
}

func (h *Handler) redeem(w http.ResponseWriter, r *http.Request) {
	var req redeemReq
	if err := decodeJSON(r, &req); err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	if req.Code == "" {
		writeErr(w, http.StatusBadRequest, "code is required")
		return
	}
	if req.AmountCents <= 0 {
		writeErr(w, http.StatusBadRequest, "amount_cents must be > 0")
		return
	}

	txn, err := h.store.Redeem(r.Context(), TxnParams{
		Code:               req.Code,
		AmountCents:        req.AmountCents,
		OrderID:            req.OrderID,
		PaymentID:          req.PaymentID,
		PerformedByStaffID: req.PerformedByStaffID,
		Notes:              req.Notes,
	})
	h.handleTxnResult(w, txn, err)
}

func (h *Handler) reload(w http.ResponseWriter, r *http.Request) {
	var req reloadReq
	if err := decodeJSON(r, &req); err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	if req.Code == "" {
		writeErr(w, http.StatusBadRequest, "code is required")
		return
	}
	if req.AmountCents <= 0 {
		writeErr(w, http.StatusBadRequest, "amount_cents must be > 0")
		return
	}

	txn, err := h.store.Reload(r.Context(), TxnParams{
		Code:               req.Code,
		AmountCents:        req.AmountCents,
		OrderID:            req.OrderID,
		PerformedByStaffID: req.PerformedByStaffID,
		Notes:              req.Notes,
	})
	h.handleTxnResult(w, txn, err)
}

func (h *Handler) refund(w http.ResponseWriter, r *http.Request) {
	var req refundReq
	if err := decodeJSON(r, &req); err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	if req.Code == "" {
		writeErr(w, http.StatusBadRequest, "code is required")
		return
	}
	if req.AmountCents <= 0 {
		writeErr(w, http.StatusBadRequest, "amount_cents must be > 0")
		return
	}

	txn, err := h.store.Refund(r.Context(), TxnParams{
		Code:               req.Code,
		AmountCents:        req.AmountCents,
		OrderID:            req.OrderID,
		PerformedByStaffID: req.PerformedByStaffID,
		Notes:              req.Notes,
	})
	h.handleTxnResult(w, txn, err)
}

func (h *Handler) lookup(w http.ResponseWriter, r *http.Request) {
	code := r.URL.Query().Get("code")
	if code == "" {
		writeErr(w, http.StatusBadRequest, "code query parameter is required")
		return
	}
	pin := r.URL.Query().Get("pin")

	result, err := h.store.Lookup(r.Context(), LookupParams{Code: code, PIN: pin})
	switch {
	case errors.Is(err, ErrCardNotFound):
		writeErr(w, http.StatusNotFound, err.Error())
	case errors.Is(err, ErrInvalidPIN):
		writeErr(w, http.StatusUnauthorized, err.Error())
	case err != nil:
		writeErr(w, http.StatusInternalServerError, err.Error())
	default:
		writeJSON(w, http.StatusOK, result)
	}
}

// handleTxnResult is a shared helper for the three mutation endpoints that all
// return a GiftCardTransaction on success.
func (h *Handler) handleTxnResult(w http.ResponseWriter, txn *GiftCardTransaction, err error) {
	switch {
	case errors.Is(err, ErrCardNotFound):
		writeErr(w, http.StatusNotFound, err.Error())
	case errors.Is(err, ErrCardExpired):
		writeErr(w, http.StatusUnprocessableEntity, err.Error())
	case errors.Is(err, ErrCardNotActive):
		writeErr(w, http.StatusUnprocessableEntity, err.Error())
	case errors.Is(err, ErrInsufficientFunds):
		writeErr(w, http.StatusUnprocessableEntity, err.Error())
	case err != nil:
		writeErr(w, http.StatusInternalServerError, err.Error())
	default:
		writeJSON(w, http.StatusOK, txn)
	}
}
