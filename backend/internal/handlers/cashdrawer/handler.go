// Package cashdrawer exposes the cash-drawer open/close/movement REST
// surface on top of migration-18 tables. Mount under an already-authenticated
// chi.Router group.
package cashdrawer

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Handler struct {
	store *Store
}

func NewHandler(pool *pgxpool.Pool) *Handler {
	return &Handler{store: NewStore(pool)}
}

func (h *Handler) Mount(r chi.Router) {
	r.Route("/cash-drawers", func(r chi.Router) {
		r.Post("/{drawer_id}/sessions/open", h.openSession)
		r.Get("/{drawer_id}/sessions", h.listSessions)

		r.Post("/sessions/{session_id}/movements", h.postMovement)
		r.Post("/sessions/{session_id}/close", h.closeSession)
		r.Get("/sessions/{session_id}", h.getSession)
	})
}

// --- DTOs ---

type openSessionReq struct {
	OpeningFloatCents int64           `json:"opening_float_cents"`
	OpenedByStaffID   string          `json:"opened_by_staff_id"`
	IsBlindClose      bool            `json:"is_blind_close"`
	Denominations     json.RawMessage `json:"denominations"`
}

type movementReq struct {
	MovementType  string  `json:"movement_type"`
	AmountCents   int64   `json:"amount_cents"`
	Reason        string  `json:"reason"`
	PerformedBy   string  `json:"performed_by"`
	ApprovedBy    string  `json:"approved_by"`
	ReferenceType string  `json:"reference_type"`
	ReferenceID   *string `json:"reference_id"`
}

type closeSessionReq struct {
	ClosedByStaffID      string          `json:"closed_by_staff_id"`
	DeclaredClosingCents int64           `json:"declared_closing_cents"`
	Denominations        json.RawMessage `json:"denominations"`
	Notes                string          `json:"notes"`
}

// --- Handlers ---

func (h *Handler) openSession(w http.ResponseWriter, r *http.Request) {
	drawerID := chi.URLParam(r, "drawer_id")
	if drawerID == "" {
		writeErr(w, http.StatusBadRequest, "drawer_id required")
		return
	}

	var req openSessionReq
	if err := decodeJSON(r, &req); err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	if req.OpeningFloatCents < 0 {
		writeErr(w, http.StatusBadRequest, "opening_float_cents must be >= 0")
		return
	}

	sess, err := h.store.OpenSession(
		r.Context(), drawerID, req.OpeningFloatCents,
		req.OpenedByStaffID, req.IsBlindClose, []byte(req.Denominations),
	)
	switch {
	case errors.Is(err, ErrDrawerHasOpen):
		writeErr(w, http.StatusConflict, "drawer already has an open session")
		return
	case err != nil:
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, sess)
}

// allowedMovementTypes mirrors the CHECK constraint; duplicated here so we
// fail with a 400 instead of surfacing a Postgres error to the client.
var allowedMovementTypes = map[string]struct{}{
	"paid_in": {}, "paid_out": {}, "petty_cash": {}, "tip_out": {},
	"no_sale": {}, "drop": {}, "pickup": {},
}

// Sign convention: paid_in/petty_cash/drop are inflows (>=0);
// paid_out/tip_out/pickup are outflows (<=0); no_sale must be exactly 0.
func validateMovementSign(movementType string, amount int64) error {
	switch movementType {
	case "paid_in", "petty_cash", "drop":
		if amount < 0 {
			return errors.New("amount_cents must be >= 0 for inflow movement")
		}
	case "paid_out", "tip_out", "pickup":
		if amount > 0 {
			return errors.New("amount_cents must be <= 0 for outflow movement")
		}
	case "no_sale":
		if amount != 0 {
			return errors.New("amount_cents must be 0 for no_sale")
		}
	}
	return nil
}

func (h *Handler) postMovement(w http.ResponseWriter, r *http.Request) {
	sessionID := chi.URLParam(r, "session_id")
	if sessionID == "" {
		writeErr(w, http.StatusBadRequest, "session_id required")
		return
	}

	var req movementReq
	if err := decodeJSON(r, &req); err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	if _, ok := allowedMovementTypes[req.MovementType]; !ok {
		writeErr(w, http.StatusBadRequest, "invalid movement_type")
		return
	}
	if err := validateMovementSign(req.MovementType, req.AmountCents); err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}

	refID := ""
	if req.ReferenceID != nil {
		refID = *req.ReferenceID
	}

	m, err := h.store.InsertMovement(
		r.Context(), sessionID, req.MovementType, req.AmountCents,
		req.Reason, req.ReferenceType, req.PerformedBy, req.ApprovedBy, refID,
	)
	switch {
	case errors.Is(err, ErrSessionNotFound), errors.Is(err, ErrSessionNotOpen):
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	case err != nil:
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, m)
}

func (h *Handler) closeSession(w http.ResponseWriter, r *http.Request) {
	sessionID := chi.URLParam(r, "session_id")
	if sessionID == "" {
		writeErr(w, http.StatusBadRequest, "session_id required")
		return
	}

	var req closeSessionReq
	if err := decodeJSON(r, &req); err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	if req.DeclaredClosingCents < 0 {
		writeErr(w, http.StatusBadRequest, "declared_closing_cents must be >= 0")
		return
	}

	sess, err := h.store.CloseSession(
		r.Context(), sessionID, req.ClosedByStaffID,
		req.DeclaredClosingCents, []byte(req.Denominations), req.Notes,
	)
	switch {
	case errors.Is(err, ErrSessionNotFound):
		writeErr(w, http.StatusNotFound, err.Error())
		return
	case errors.Is(err, ErrSessionNotOpen):
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	case err != nil:
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, sess)
}

func (h *Handler) getSession(w http.ResponseWriter, r *http.Request) {
	sessionID := chi.URLParam(r, "session_id")
	if sessionID == "" {
		writeErr(w, http.StatusBadRequest, "session_id required")
		return
	}
	detail, err := h.store.GetSessionDetail(r.Context(), sessionID)
	switch {
	case errors.Is(err, ErrSessionNotFound):
		writeErr(w, http.StatusNotFound, err.Error())
		return
	case err != nil:
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, detail)
}

func (h *Handler) listSessions(w http.ResponseWriter, r *http.Request) {
	drawerID := chi.URLParam(r, "drawer_id")
	if drawerID == "" {
		writeErr(w, http.StatusBadRequest, "drawer_id required")
		return
	}
	status := r.URL.Query().Get("status")
	switch status {
	case "", "open", "closed", "reconciled":
	default:
		writeErr(w, http.StatusBadRequest, "invalid status filter")
		return
	}
	sessions, err := h.store.ListSessions(r.Context(), drawerID, status)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, sessions)
}
