// Package tables exposes the dine-in table-session REST surface on top of the
// migration-16 schema (sections, tables, table_sessions, seats, check_splits,
// check_split_items). Mount under an already-authenticated chi.Router group.
package tables

import (
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Handler holds the store and is the only exported type in this package.
type Handler struct {
	store *Store
}

// NewHandler creates a Handler backed by pool.
func NewHandler(pool *pgxpool.Pool) *Handler {
	return &Handler{store: NewStore(pool)}
}

// Mount registers all table/session/seat routes onto r.
// Callers should mount this under "/" (or any prefix) — the routes already
// carry their own /tables and /sessions path segments.
func (h *Handler) Mount(r chi.Router) {
	// Table-scoped
	r.Route("/tables", func(r chi.Router) {
		r.Post("/{table_id}/open-session", h.openSession)
	})

	// Session-scoped
	r.Route("/sessions", func(r chi.Router) {
		r.Get("/{session_id}", h.getSession)
		r.Post("/{session_id}/close", h.closeSession)
		r.Post("/{session_id}/transfer", h.transferSession)
		r.Post("/{session_id}/split-check", h.splitCheck)
		r.Post("/{session_id}/seats", h.createSeat)
		r.Get("/{session_id}/seats", h.listSeats)
	})

	// Seat-scoped
	r.Route("/seats", func(r chi.Router) {
		r.Patch("/{seat_id}", h.updateSeat)
		r.Delete("/{seat_id}", h.deleteSeat)
	})
}

// -------------------------------------------------------------------
// Session handlers
// -------------------------------------------------------------------

func (h *Handler) openSession(w http.ResponseWriter, r *http.Request) {
	tableID := chi.URLParam(r, "table_id")
	if tableID == "" {
		writeErr(w, http.StatusBadRequest, "table_id required")
		return
	}

	var req openSessionReq
	if err := decodeJSON(r, &req); err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	if req.LocationID == "" {
		writeErr(w, http.StatusBadRequest, "location_id required")
		return
	}
	if req.PartySize <= 0 {
		writeErr(w, http.StatusBadRequest, "party_size must be >= 1")
		return
	}

	sess, err := h.store.OpenSession(r.Context(), tableID, req.LocationID, req.OpenedBy, req.PartySize, req.Notes)
	switch {
	case errors.Is(err, ErrTableHasOpenSession):
		writeErr(w, http.StatusConflict, err.Error())
		return
	case err != nil:
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, sess)
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

	sess, err := h.store.CloseSession(r.Context(), sessionID, req.PartySize, req.Notes)
	switch {
	case errors.Is(err, ErrSessionNotFound):
		writeErr(w, http.StatusNotFound, err.Error())
		return
	case errors.Is(err, ErrSessionNotOpen):
		writeErr(w, http.StatusConflict, err.Error())
		return
	case err != nil:
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, sess)
}

func (h *Handler) transferSession(w http.ResponseWriter, r *http.Request) {
	sessionID := chi.URLParam(r, "session_id")
	if sessionID == "" {
		writeErr(w, http.StatusBadRequest, "session_id required")
		return
	}

	var req transferSessionReq
	if err := decodeJSON(r, &req); err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	if req.ToTableID == "" {
		writeErr(w, http.StatusBadRequest, "to_table_id required")
		return
	}

	newSess, err := h.store.TransferSession(
		r.Context(), sessionID, req.ToTableID, req.OpenedBy, req.PartySize, req.Notes,
	)
	switch {
	case errors.Is(err, ErrSessionNotFound):
		writeErr(w, http.StatusNotFound, err.Error())
		return
	case errors.Is(err, ErrSessionNotOpen):
		writeErr(w, http.StatusConflict, "source session is not open")
		return
	case errors.Is(err, ErrTableHasOpenSession):
		writeErr(w, http.StatusConflict, "target table already has an open session")
		return
	case err != nil:
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, newSess)
}

func (h *Handler) splitCheck(w http.ResponseWriter, r *http.Request) {
	sessionID := chi.URLParam(r, "session_id")
	if sessionID == "" {
		writeErr(w, http.StatusBadRequest, "session_id required")
		return
	}

	var req splitCheckReq
	if err := decodeJSON(r, &req); err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	if len(req.Splits) == 0 {
		writeErr(w, http.StatusBadRequest, "splits must not be empty")
		return
	}
	for i, sp := range req.Splits {
		if sp.Label == "" {
			writeErr(w, http.StatusBadRequest, "each split must have a label")
			return
		}
		for j, item := range sp.Items {
			if item.OrderItemID == "" {
				writeErr(w, http.StatusBadRequest, "split item missing order_item_id")
				return
			}
			if item.Quantity <= 0 {
				writeErr(w, http.StatusBadRequest, "split item quantity must be > 0")
				return
			}
			_ = i
			_ = j
		}
	}

	result, err := h.store.SplitCheck(r.Context(), sessionID, req.CreatedBy, req.Splits)
	switch {
	case errors.Is(err, ErrSessionNotFound):
		writeErr(w, http.StatusNotFound, err.Error())
		return
	case errors.Is(err, ErrSessionNotOpen):
		writeErr(w, http.StatusConflict, err.Error())
		return
	case errors.Is(err, ErrDuplicateSplitLabel):
		writeErr(w, http.StatusConflict, err.Error())
		return
	case err != nil:
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, result)
}

// -------------------------------------------------------------------
// Seat handlers
// -------------------------------------------------------------------

func (h *Handler) createSeat(w http.ResponseWriter, r *http.Request) {
	sessionID := chi.URLParam(r, "session_id")
	if sessionID == "" {
		writeErr(w, http.StatusBadRequest, "session_id required")
		return
	}

	var req createSeatReq
	if err := decodeJSON(r, &req); err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	if req.SeatNumber <= 0 {
		writeErr(w, http.StatusBadRequest, "seat_number must be >= 1")
		return
	}

	seat, err := h.store.CreateSeat(r.Context(), sessionID, req.SeatNumber, req.GuestName)
	switch {
	case errors.Is(err, ErrDuplicateSeat):
		writeErr(w, http.StatusConflict, err.Error())
		return
	case err != nil:
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, seat)
}

func (h *Handler) listSeats(w http.ResponseWriter, r *http.Request) {
	sessionID := chi.URLParam(r, "session_id")
	if sessionID == "" {
		writeErr(w, http.StatusBadRequest, "session_id required")
		return
	}

	seats, err := h.store.ListSeats(r.Context(), sessionID)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, seats)
}

func (h *Handler) updateSeat(w http.ResponseWriter, r *http.Request) {
	seatID := chi.URLParam(r, "seat_id")
	if seatID == "" {
		writeErr(w, http.StatusBadRequest, "seat_id required")
		return
	}

	var req updateSeatReq
	if err := decodeJSON(r, &req); err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}

	seat, err := h.store.UpdateSeat(r.Context(), seatID, req.SeatNumber, req.GuestName)
	switch {
	case errors.Is(err, ErrSeatNotFound):
		writeErr(w, http.StatusNotFound, err.Error())
		return
	case errors.Is(err, ErrDuplicateSeat):
		writeErr(w, http.StatusConflict, err.Error())
		return
	case err != nil:
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, seat)
}

func (h *Handler) deleteSeat(w http.ResponseWriter, r *http.Request) {
	seatID := chi.URLParam(r, "seat_id")
	if seatID == "" {
		writeErr(w, http.StatusBadRequest, "seat_id required")
		return
	}

	err := h.store.DeleteSeat(r.Context(), seatID)
	switch {
	case errors.Is(err, ErrSeatNotFound):
		writeErr(w, http.StatusNotFound, err.Error())
		return
	case err != nil:
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
