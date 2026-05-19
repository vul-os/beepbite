// Package storecredit exposes store-credit and loyalty REST endpoints on top
// of migration-25 tables (store_credits, store_credit_transactions,
// loyalty_config, loyalty_transactions). Mount the handler under an already-
// authenticated chi.Router group.
//
// Route layout:
//
//	POST /store-credit/grant
//	POST /store-credit/redeem
//	POST /store-credit/refund-to-credit
//	GET  /store-credit/customers/{customer_id}
//
//	POST /loyalty/earn
//	POST /loyalty/redeem
//	POST /loyalty/expire
//	GET  /loyalty/customers/{customer_id}
package storecredit

import (
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Handler owns both the store-credit and loyalty sub-handlers.
type Handler struct {
	sc      *Store
	loyalty *LoyaltyStore
}

// NewHandler wires up a Handler backed by pool.
func NewHandler(pool *pgxpool.Pool) *Handler {
	return &Handler{
		sc:      NewStore(pool),
		loyalty: NewLoyaltyStore(pool),
	}
}

// Mount registers all routes on r.
func (h *Handler) Mount(r chi.Router) {
	r.Route("/store-credit", func(r chi.Router) {
		r.Post("/grant", h.grantCredit)
		r.Post("/redeem", h.redeemCredit)
		r.Post("/refund-to-credit", h.refundToCredit)
		r.Get("/customers/{customer_id}", h.getCustomerCredits)
	})

	r.Route("/loyalty", func(r chi.Router) {
		r.Post("/earn", h.earnPoints)
		r.Post("/redeem", h.redeemPoints)
		r.Post("/expire", h.expirePoints)
		r.Get("/customers/{customer_id}", h.getCustomerLoyalty)
	})
}

// ---- Request / Response DTOs ----

type grantCreditReq struct {
	CustomerID       string `json:"customer_id"`
	OrganizationID   string `json:"organization_id"`
	AmountCents      int64  `json:"amount_cents"`
	Reason           string `json:"reason"`
	GrantedByStaffID string `json:"granted_by_staff_id"`
}

type redeemCreditReq struct {
	CustomerID         string `json:"customer_id"`
	OrganizationID     string `json:"organization_id"`
	OrderID            string `json:"order_id"`
	AmountCents        int64  `json:"amount_cents"`
	PerformedByStaffID string `json:"performed_by_staff_id"`
}

type refundToCreditReq struct {
	CustomerID         string `json:"customer_id"`
	OrganizationID     string `json:"organization_id"`
	AmountCents        int64  `json:"amount_cents"`
	OrderID            string `json:"order_id"`
	RefundID           string `json:"refund_id"`
	PerformedByStaffID string `json:"performed_by_staff_id"`
	Reason             string `json:"reason"`
}

type earnPointsReq struct {
	CustomerID         string `json:"customer_id"`
	OrganizationID     string `json:"organization_id"`
	OrderID            string `json:"order_id"`
	OrderAmountCents   int64  `json:"order_amount_cents"`
	PerformedByStaffID string `json:"performed_by_staff_id"`
}

type redeemPointsReq struct {
	CustomerID         string `json:"customer_id"`
	OrganizationID     string `json:"organization_id"`
	OrderID            string `json:"order_id"`
	PointsToRedeem     int64  `json:"points_to_redeem"`
	OrderAmountCents   int64  `json:"order_amount_cents"`
	PerformedByStaffID string `json:"performed_by_staff_id"`
}

type expirePointsReq struct {
	OrganizationID string `json:"organization_id"`
}

// ---- Store-credit handlers ----

func (h *Handler) grantCredit(w http.ResponseWriter, r *http.Request) {
	var req grantCreditReq
	if err := decodeJSON(r, &req); err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	if req.CustomerID == "" || req.OrganizationID == "" {
		writeErr(w, http.StatusBadRequest, "customer_id and organization_id required")
		return
	}
	if req.AmountCents <= 0 {
		writeErr(w, http.StatusBadRequest, "amount_cents must be > 0")
		return
	}

	txn, err := h.sc.GrantCredit(
		r.Context(),
		req.OrganizationID, req.CustomerID,
		req.AmountCents,
		req.Reason, req.GrantedByStaffID,
	)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, txn)
}

func (h *Handler) redeemCredit(w http.ResponseWriter, r *http.Request) {
	var req redeemCreditReq
	if err := decodeJSON(r, &req); err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	if req.CustomerID == "" || req.OrganizationID == "" {
		writeErr(w, http.StatusBadRequest, "customer_id and organization_id required")
		return
	}
	if req.AmountCents <= 0 {
		writeErr(w, http.StatusBadRequest, "amount_cents must be > 0")
		return
	}

	txn, err := h.sc.RedeemCredit(
		r.Context(),
		req.OrganizationID, req.CustomerID, req.OrderID,
		req.AmountCents, req.PerformedByStaffID,
	)
	switch {
	case errors.Is(err, ErrStoreCreditNotFound):
		writeErr(w, http.StatusNotFound, err.Error())
	case errors.Is(err, ErrRedeemExceedsBalance):
		writeErr(w, http.StatusUnprocessableEntity, err.Error())
	case err != nil:
		writeErr(w, http.StatusInternalServerError, err.Error())
	default:
		writeJSON(w, http.StatusOK, txn)
	}
}

func (h *Handler) refundToCredit(w http.ResponseWriter, r *http.Request) {
	var req refundToCreditReq
	if err := decodeJSON(r, &req); err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	if req.CustomerID == "" || req.OrganizationID == "" {
		writeErr(w, http.StatusBadRequest, "customer_id and organization_id required")
		return
	}
	if req.AmountCents <= 0 {
		writeErr(w, http.StatusBadRequest, "amount_cents must be > 0")
		return
	}

	txn, err := h.sc.RefundToCredit(
		r.Context(),
		req.OrganizationID, req.CustomerID,
		req.AmountCents,
		req.OrderID, req.RefundID, req.PerformedByStaffID, req.Reason,
	)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, txn)
}

func (h *Handler) getCustomerCredits(w http.ResponseWriter, r *http.Request) {
	customerID := chi.URLParam(r, "customer_id")
	if customerID == "" {
		writeErr(w, http.StatusBadRequest, "customer_id required")
		return
	}

	summary, err := h.sc.GetCustomerCredits(r.Context(), customerID)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, summary)
}

// ---- Loyalty handlers ----

func (h *Handler) earnPoints(w http.ResponseWriter, r *http.Request) {
	var req earnPointsReq
	if err := decodeJSON(r, &req); err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	if req.CustomerID == "" || req.OrganizationID == "" {
		writeErr(w, http.StatusBadRequest, "customer_id and organization_id required")
		return
	}
	if req.OrderAmountCents <= 0 {
		writeErr(w, http.StatusBadRequest, "order_amount_cents must be > 0")
		return
	}

	txn, err := h.loyalty.EarnPoints(
		r.Context(),
		req.OrganizationID, req.CustomerID, req.OrderID,
		req.OrderAmountCents, req.PerformedByStaffID,
	)
	switch {
	case errors.Is(err, ErrLoyaltyConfigNotFound):
		writeErr(w, http.StatusNotFound, err.Error())
	case err != nil:
		writeErr(w, http.StatusInternalServerError, err.Error())
	default:
		writeJSON(w, http.StatusCreated, txn)
	}
}

func (h *Handler) redeemPoints(w http.ResponseWriter, r *http.Request) {
	var req redeemPointsReq
	if err := decodeJSON(r, &req); err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	if req.CustomerID == "" || req.OrganizationID == "" {
		writeErr(w, http.StatusBadRequest, "customer_id and organization_id required")
		return
	}
	if req.PointsToRedeem <= 0 {
		writeErr(w, http.StatusBadRequest, "points_to_redeem must be > 0")
		return
	}
	if req.OrderAmountCents <= 0 {
		writeErr(w, http.StatusBadRequest, "order_amount_cents must be > 0 for cap enforcement")
		return
	}

	txn, err := h.loyalty.RedeemPoints(
		r.Context(),
		req.OrganizationID, req.CustomerID, req.OrderID,
		req.PointsToRedeem, req.OrderAmountCents, req.PerformedByStaffID,
	)
	switch {
	case errors.Is(err, ErrLoyaltyConfigNotFound):
		writeErr(w, http.StatusNotFound, err.Error())
	case errors.Is(err, ErrBelowMinRedemption):
		writeErr(w, http.StatusUnprocessableEntity, err.Error())
	case errors.Is(err, ErrExceedsMaxRedemption):
		writeErr(w, http.StatusUnprocessableEntity, err.Error())
	case errors.Is(err, ErrInsufficientPoints):
		writeErr(w, http.StatusUnprocessableEntity, err.Error())
	case err != nil:
		writeErr(w, http.StatusInternalServerError, err.Error())
	default:
		writeJSON(w, http.StatusOK, txn)
	}
}

func (h *Handler) expirePoints(w http.ResponseWriter, r *http.Request) {
	var req expirePointsReq
	if err := decodeJSON(r, &req); err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	if req.OrganizationID == "" {
		writeErr(w, http.StatusBadRequest, "organization_id required")
		return
	}

	affected, err := h.loyalty.ExpirePoints(r.Context(), req.OrganizationID)
	switch {
	case errors.Is(err, ErrLoyaltyConfigNotFound):
		writeErr(w, http.StatusNotFound, err.Error())
	case err != nil:
		writeErr(w, http.StatusInternalServerError, err.Error())
	default:
		writeJSON(w, http.StatusOK, map[string]int64{"customers_expired": affected})
	}
}

func (h *Handler) getCustomerLoyalty(w http.ResponseWriter, r *http.Request) {
	customerID := chi.URLParam(r, "customer_id")
	if customerID == "" {
		writeErr(w, http.StatusBadRequest, "customer_id required")
		return
	}

	summary, err := h.loyalty.GetCustomerLoyalty(r.Context(), customerID)
	switch {
	case errors.Is(err, ErrCustomerNotFound):
		writeErr(w, http.StatusNotFound, err.Error())
	case err != nil:
		writeErr(w, http.StatusInternalServerError, err.Error())
	default:
		writeJSON(w, http.StatusOK, summary)
	}
}
