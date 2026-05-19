// Package reservations exposes reservation + waitlist REST endpoints.
// Mount under an already-authenticated chi.Router group.
package reservations

import (
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
	r.Route("/reservations", func(r chi.Router) {
		r.Post("/", h.createReservation)
		r.Get("/", h.listReservations)
		r.Patch("/{id}", h.updateReservation)
		r.Post("/{id}/confirm", h.confirmReservation)
		r.Post("/{id}/seat", h.seatReservation)
		r.Post("/{id}/cancel", h.cancelReservation)
	})

	r.Route("/waitlist", func(r chi.Router) {
		r.Post("/", h.addWaitlist)
		r.Get("/", h.listWaitlist)
		r.Post("/{id}/seat", h.seatWaitlist)
		r.Delete("/{id}", h.removeWaitlist)
	})
}

// --- DTOs ---

type createReservationReq struct {
	OrganizationID   string  `json:"organization_id"`
	LocationID       string  `json:"location_id"`
	CustomerID       *string `json:"customer_id"`
	CustomerName     string  `json:"customer_name"`
	CustomerPhone    *string `json:"customer_phone"`
	CustomerEmail    *string `json:"customer_email"`
	PartySize        int     `json:"party_size"`
	ReservationAt    string  `json:"reservation_at"`
	DurationMinutes  int     `json:"duration_minutes"`
	TableID          *string `json:"table_id"`
	SectionID        *string `json:"section_id"`
	Status           string  `json:"status"`
	SpecialRequests  *string `json:"special_requests"`
	CreatedByStaffID *string `json:"created_by_staff_id"`
}

type updateReservationReq struct {
	Status          *string `json:"status"`
	TableID         *string `json:"table_id"`
	SectionID       *string `json:"section_id"`
	CustomerName    *string `json:"customer_name"`
	CustomerPhone   *string `json:"customer_phone"`
	CustomerEmail   *string `json:"customer_email"`
	PartySize       *int    `json:"party_size"`
	ReservationAt   *string `json:"reservation_at"`
	DurationMinutes *int    `json:"duration_minutes"`
	SpecialRequests *string `json:"special_requests"`
}

type seatReservationReq struct {
	StaffID string `json:"staff_id"`
}

type addWaitlistReq struct {
	OrganizationID    string  `json:"organization_id"`
	LocationID        string  `json:"location_id"`
	CustomerName      string  `json:"customer_name"`
	CustomerPhone     *string `json:"customer_phone"`
	PartySize         int     `json:"party_size"`
	QuotedWaitMinutes *int    `json:"quoted_wait_minutes"`
	Notes             *string `json:"notes"`
}

type removeWaitlistReq struct {
	Reason string `json:"reason"`
}

// --- Reservation handlers ---

func (h *Handler) createReservation(w http.ResponseWriter, r *http.Request) {
	var req createReservationReq
	if err := decodeJSON(r, &req); err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	if req.OrganizationID == "" || req.LocationID == "" {
		writeErr(w, http.StatusBadRequest, "organization_id and location_id required")
		return
	}
	if req.CustomerName == "" {
		writeErr(w, http.StatusBadRequest, "customer_name required")
		return
	}
	if req.PartySize <= 0 {
		writeErr(w, http.StatusBadRequest, "party_size must be > 0")
		return
	}
	if req.ReservationAt == "" {
		writeErr(w, http.StatusBadRequest, "reservation_at required")
		return
	}

	status := req.Status
	if status == "" {
		status = "pending"
	}
	dur := req.DurationMinutes
	if dur == 0 {
		dur = 90
	}

	var out Reservation
	err := h.store.pool.QueryRow(r.Context(), `
INSERT INTO reservations (
	organization_id, location_id, customer_id, customer_name, customer_phone,
	customer_email, party_size, reservation_at, duration_minutes,
	table_id, section_id, status, special_requests, created_by_staff_id
) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::timestamptz,$9,$10,$11,$12,$13,$14)
RETURNING `+resCols,
		req.OrganizationID, req.LocationID, req.CustomerID, req.CustomerName, req.CustomerPhone,
		req.CustomerEmail, req.PartySize, req.ReservationAt, dur,
		req.TableID, req.SectionID, status, req.SpecialRequests, req.CreatedByStaffID,
	).Scan(
		&out.ID, &out.OrganizationID, &out.LocationID, &out.CustomerID,
		&out.CustomerName, &out.CustomerPhone, &out.CustomerEmail,
		&out.PartySize, &out.ReservationAt, &out.DurationMinutes,
		&out.TableID, &out.SectionID, &out.Status, &out.SpecialRequests,
		&out.ConfirmationSentAt, &out.CreatedByStaffID, &out.CreatedAt, &out.UpdatedAt,
	)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, out)
}

func (h *Handler) listReservations(w http.ResponseWriter, r *http.Request) {
	locationID := r.URL.Query().Get("location_id")
	date := r.URL.Query().Get("date")
	if locationID == "" {
		writeErr(w, http.StatusBadRequest, "location_id required")
		return
	}
	if date == "" {
		writeErr(w, http.StatusBadRequest, "date required (YYYY-MM-DD)")
		return
	}
	list, err := h.store.ListReservations(r.Context(), locationID, date)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, list)
}

func (h *Handler) updateReservation(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if id == "" {
		writeErr(w, http.StatusBadRequest, "id required")
		return
	}
	var req updateReservationReq
	if err := decodeJSON(r, &req); err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	fields := map[string]any{}
	if req.Status != nil {
		fields["status"] = *req.Status
	}
	if req.TableID != nil {
		fields["table_id"] = *req.TableID
	}
	if req.SectionID != nil {
		fields["section_id"] = *req.SectionID
	}
	if req.CustomerName != nil {
		fields["customer_name"] = *req.CustomerName
	}
	if req.CustomerPhone != nil {
		fields["customer_phone"] = *req.CustomerPhone
	}
	if req.CustomerEmail != nil {
		fields["customer_email"] = *req.CustomerEmail
	}
	if req.PartySize != nil {
		fields["party_size"] = *req.PartySize
	}
	if req.ReservationAt != nil {
		fields["reservation_at"] = *req.ReservationAt
	}
	if req.DurationMinutes != nil {
		fields["duration_minutes"] = *req.DurationMinutes
	}
	if req.SpecialRequests != nil {
		fields["special_requests"] = *req.SpecialRequests
	}

	out, err := h.store.UpdateReservation(r.Context(), id, fields)
	switch {
	case errors.Is(err, ErrReservationNotFound):
		writeErr(w, http.StatusNotFound, err.Error())
	case err != nil:
		writeErr(w, http.StatusInternalServerError, err.Error())
	default:
		writeJSON(w, http.StatusOK, out)
	}
}

func (h *Handler) confirmReservation(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if id == "" {
		writeErr(w, http.StatusBadRequest, "id required")
		return
	}
	out, err := h.store.ConfirmReservation(r.Context(), id)
	switch {
	case errors.Is(err, ErrReservationNotFound):
		writeErr(w, http.StatusNotFound, err.Error())
	case err != nil:
		writeErr(w, http.StatusInternalServerError, err.Error())
	default:
		writeJSON(w, http.StatusOK, out)
	}
}

func (h *Handler) seatReservation(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if id == "" {
		writeErr(w, http.StatusBadRequest, "id required")
		return
	}
	var req seatReservationReq
	// staff_id is optional; ignore body decode errors.
	_ = decodeJSON(r, &req)

	out, err := h.store.SeatReservation(r.Context(), id, req.StaffID)
	switch {
	case errors.Is(err, ErrReservationNotFound):
		writeErr(w, http.StatusNotFound, err.Error())
	case err != nil:
		writeErr(w, http.StatusInternalServerError, err.Error())
	default:
		writeJSON(w, http.StatusOK, out)
	}
}

func (h *Handler) cancelReservation(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if id == "" {
		writeErr(w, http.StatusBadRequest, "id required")
		return
	}
	out, err := h.store.CancelReservation(r.Context(), id)
	switch {
	case errors.Is(err, ErrReservationNotFound):
		writeErr(w, http.StatusNotFound, err.Error())
	case err != nil:
		writeErr(w, http.StatusInternalServerError, err.Error())
	default:
		writeJSON(w, http.StatusOK, out)
	}
}

// --- Waitlist handlers ---

func (h *Handler) addWaitlist(w http.ResponseWriter, r *http.Request) {
	var req addWaitlistReq
	if err := decodeJSON(r, &req); err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	if req.OrganizationID == "" || req.LocationID == "" {
		writeErr(w, http.StatusBadRequest, "organization_id and location_id required")
		return
	}
	if req.CustomerName == "" {
		writeErr(w, http.StatusBadRequest, "customer_name required")
		return
	}
	if req.PartySize <= 0 {
		writeErr(w, http.StatusBadRequest, "party_size must be > 0")
		return
	}

	entry := &WaitlistEntry{
		OrganizationID:    req.OrganizationID,
		LocationID:        req.LocationID,
		CustomerName:      req.CustomerName,
		CustomerPhone:     req.CustomerPhone,
		PartySize:         req.PartySize,
		QuotedWaitMinutes: req.QuotedWaitMinutes,
		Notes:             req.Notes,
	}
	out, err := h.store.AddToWaitlist(r.Context(), entry)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, out)
}

func (h *Handler) listWaitlist(w http.ResponseWriter, r *http.Request) {
	locationID := r.URL.Query().Get("location_id")
	if locationID == "" {
		writeErr(w, http.StatusBadRequest, "location_id required")
		return
	}
	list, err := h.store.ListActiveWaitlist(r.Context(), locationID)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, list)
}

func (h *Handler) seatWaitlist(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if id == "" {
		writeErr(w, http.StatusBadRequest, "id required")
		return
	}
	out, err := h.store.SeatWaitlistEntry(r.Context(), id)
	switch {
	case errors.Is(err, ErrWaitlistNotFound):
		writeErr(w, http.StatusNotFound, err.Error())
	case err != nil:
		writeErr(w, http.StatusInternalServerError, err.Error())
	default:
		writeJSON(w, http.StatusOK, out)
	}
}

func (h *Handler) removeWaitlist(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if id == "" {
		writeErr(w, http.StatusBadRequest, "id required")
		return
	}
	var req removeWaitlistReq
	// reason is optional; ignore body decode errors.
	_ = decodeJSON(r, &req)

	out, err := h.store.RemoveWaitlistEntry(r.Context(), id, req.Reason)
	switch {
	case errors.Is(err, ErrWaitlistNotFound):
		writeErr(w, http.StatusNotFound, err.Error())
	case err != nil:
		writeErr(w, http.StatusInternalServerError, err.Error())
	default:
		writeJSON(w, http.StatusOK, out)
	}
}
