// Package houseaccounts implements the /house-accounts REST surface for B2B /
// corporate account billing on top of the migration-25 schema
// (house_accounts, house_account_members, house_account_charges,
// house_account_invoices). Mount under an already-authenticated chi.Router
// group.
package houseaccounts

import (
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Handler wires HTTP routes to the Store and invoice logic.
type Handler struct {
	pool  *pgxpool.Pool
	store *Store
}

// NewHandler constructs the handler. pool is kept separately so
// GenerateInvoice can open its own serialisable transaction.
func NewHandler(pool *pgxpool.Pool) *Handler {
	return &Handler{pool: pool, store: NewStore(pool)}
}

// Mount registers all /house-accounts sub-routes on r.
func (h *Handler) Mount(r chi.Router) {
	r.Route("/house-accounts", func(r chi.Router) {
		r.Post("/", h.createAccount)
		r.Get("/{id}", h.getAccount)

		r.Post("/{id}/members", h.addMember)
		r.Delete("/{id}/members/{customer_id}", h.removeMember)

		r.Post("/{id}/charge", h.charge)

		r.Post("/{id}/invoices/generate", h.generateInvoice)
		r.Get("/{id}/invoices", h.listInvoices)

		r.Post("/invoices/{invoice_id}/pay", h.payInvoice)
	})
}

// ---------------------------------------------------------------------------
// Request types
// ---------------------------------------------------------------------------

type createAccountReq struct {
	OrgID            string  `json:"org_id"`
	Name             string  `json:"name"`
	ContactName      *string `json:"contact_name"`
	ContactEmail     *string `json:"contact_email"`
	ContactPhone     *string `json:"contact_phone"`
	BillingAddress   *string `json:"billing_address"`
	CreditLimitCents *int64  `json:"credit_limit_cents"`
	NetTermsDays     *int    `json:"net_terms_days"`
	Notes            *string `json:"notes"`
}

type addMemberReq struct {
	CustomerID         string `json:"customer_id"`
	SpendingLimitCents *int64 `json:"spending_limit_cents"`
}

type chargeReq struct {
	OrderID     string  `json:"order_id"`
	AmountCents int64   `json:"amount_cents"`
	ChargedBy   *string `json:"charged_by"` // customer_id of the member initiating the charge
}

type payInvoiceReq struct {
	PaymentCents int64 `json:"payment_cents"`
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

func (h *Handler) createAccount(w http.ResponseWriter, r *http.Request) {
	var req createAccountReq
	if err := decodeJSON(r, &req); err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	if req.OrgID == "" {
		writeErr(w, http.StatusBadRequest, "org_id is required")
		return
	}
	if req.Name == "" {
		writeErr(w, http.StatusBadRequest, "name is required")
		return
	}
	if req.CreditLimitCents != nil && *req.CreditLimitCents < 0 {
		writeErr(w, http.StatusBadRequest, "credit_limit_cents must be >= 0")
		return
	}

	account, err := h.store.CreateAccount(
		r.Context(),
		req.OrgID, req.Name,
		req.ContactName, req.ContactEmail, req.ContactPhone, req.BillingAddress,
		req.CreditLimitCents, req.NetTermsDays, req.Notes,
	)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, account)
}

func (h *Handler) getAccount(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if id == "" {
		writeErr(w, http.StatusBadRequest, "id is required")
		return
	}

	detail, err := h.store.GetAccountDetail(r.Context(), id)
	switch {
	case errors.Is(err, ErrAccountNotFound):
		writeErr(w, http.StatusNotFound, err.Error())
		return
	case err != nil:
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, detail)
}

func (h *Handler) addMember(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if id == "" {
		writeErr(w, http.StatusBadRequest, "id is required")
		return
	}

	var req addMemberReq
	if err := decodeJSON(r, &req); err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	if req.CustomerID == "" {
		writeErr(w, http.StatusBadRequest, "customer_id is required")
		return
	}

	member, err := h.store.AddMember(r.Context(), id, req.CustomerID, req.SpendingLimitCents)
	switch {
	case errors.Is(err, ErrAccountNotFound):
		writeErr(w, http.StatusNotFound, err.Error())
		return
	case errors.Is(err, ErrAccountClosed):
		writeErr(w, http.StatusConflict, err.Error())
		return
	case errors.Is(err, ErrMemberAlreadyExists):
		writeErr(w, http.StatusConflict, err.Error())
		return
	case err != nil:
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, member)
}

func (h *Handler) removeMember(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	customerID := chi.URLParam(r, "customer_id")
	if id == "" || customerID == "" {
		writeErr(w, http.StatusBadRequest, "id and customer_id are required")
		return
	}

	if err := h.store.RemoveMember(r.Context(), id, customerID); err != nil {
		switch {
		case errors.Is(err, ErrMemberNotFound):
			writeErr(w, http.StatusNotFound, err.Error())
		default:
			writeErr(w, http.StatusInternalServerError, err.Error())
		}
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *Handler) charge(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if id == "" {
		writeErr(w, http.StatusBadRequest, "id is required")
		return
	}

	var req chargeReq
	if err := decodeJSON(r, &req); err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	if req.OrderID == "" {
		writeErr(w, http.StatusBadRequest, "order_id is required")
		return
	}
	if req.AmountCents <= 0 {
		writeErr(w, http.StatusBadRequest, "amount_cents must be > 0")
		return
	}

	charge, err := h.store.CreateCharge(r.Context(), id, req.OrderID, req.ChargedBy, req.AmountCents)
	switch {
	case errors.Is(err, ErrAccountNotFound):
		writeErr(w, http.StatusNotFound, err.Error())
		return
	case errors.Is(err, ErrAccountClosed):
		writeErr(w, http.StatusConflict, err.Error())
		return
	case errors.Is(err, ErrCreditLimitExceeded):
		writeErr(w, http.StatusUnprocessableEntity, err.Error())
		return
	case err != nil:
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, charge)
}

func (h *Handler) generateInvoice(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if id == "" {
		writeErr(w, http.StatusBadRequest, "id is required")
		return
	}

	inv, err := GenerateInvoice(r.Context(), h.pool, id)
	switch {
	case errors.Is(err, ErrAccountNotFound):
		writeErr(w, http.StatusNotFound, err.Error())
		return
	case errors.Is(err, ErrAccountClosed):
		writeErr(w, http.StatusConflict, err.Error())
		return
	case errors.Is(err, ErrNoOpenCharges):
		writeErr(w, http.StatusUnprocessableEntity, err.Error())
		return
	case err != nil:
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, inv)
}

func (h *Handler) listInvoices(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if id == "" {
		writeErr(w, http.StatusBadRequest, "id is required")
		return
	}

	invoices, err := h.store.ListInvoices(r.Context(), id)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, invoices)
}

func (h *Handler) payInvoice(w http.ResponseWriter, r *http.Request) {
	invoiceID := chi.URLParam(r, "invoice_id")
	if invoiceID == "" {
		writeErr(w, http.StatusBadRequest, "invoice_id is required")
		return
	}

	var req payInvoiceReq
	if err := decodeJSON(r, &req); err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	if req.PaymentCents <= 0 {
		writeErr(w, http.StatusBadRequest, "payment_cents must be > 0")
		return
	}

	inv, err := h.store.PayInvoice(r.Context(), invoiceID, req.PaymentCents)
	switch {
	case errors.Is(err, ErrInvoiceNotFound):
		writeErr(w, http.StatusNotFound, err.Error())
		return
	case err != nil:
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, inv)
}
