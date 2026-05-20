// Package payroll exposes REST endpoints for managing staff pay rates and
// exporting payroll CSVs. Mount under an already-authenticated chi.Router.
//
// Routes (mount prefix /payroll):
//
//	GET  /staff/{staff_id}/rates          — list active + historical rates
//	POST /staff/{staff_id}/rates          — create a new rate (retires current)
//	PATCH /rates/{rate_id}                — edit effective_until / overtime fields
//	GET  /export?location_id=&period_start=&period_end=&format=csv
package payroll

import (
	"errors"
	"fmt"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/beepbite/backend/internal/auth"
)

// Handler holds the store and mounts routes.
type Handler struct {
	store *Store
}

// NewHandler constructs a Handler with its own Store.
func NewHandler(pool *pgxpool.Pool) *Handler {
	return &Handler{store: NewStore(pool)}
}

// Mount wires all /payroll sub-routes onto r. Callers should mount this under
// a group that already applies auth middleware.
//
// Capability gates:
//   - GET  /payroll/* → can_view_reports  (read access to rates + export)
//   - POST /payroll/* → can_manage_payroll (creating / mutating rates)
//   - PATCH /payroll/* → can_manage_payroll
func (h *Handler) Mount(r chi.Router) {
	r.Route("/payroll", func(r chi.Router) {
		// Read-only endpoints: requires can_view_reports.
		r.With(auth.RequireCapability("can_view_reports")).Get("/staff/{staff_id}/rates", h.listRates)
		r.With(auth.RequireCapability("can_view_reports")).Get("/export", h.exportPayroll)

		// Mutating endpoints: requires can_manage_payroll.
		r.With(auth.RequireCapability("can_manage_payroll")).Post("/staff/{staff_id}/rates", h.createRate)
		r.With(auth.RequireCapability("can_manage_payroll")).Patch("/rates/{rate_id}", h.patchRate)
	})
}

// --- Handlers ---

// listRates handles GET /payroll/staff/{staff_id}/rates
func (h *Handler) listRates(w http.ResponseWriter, r *http.Request) {
	staffID := chi.URLParam(r, "staff_id")
	if staffID == "" {
		writeErr(w, http.StatusBadRequest, "staff_id required")
		return
	}

	rates, err := h.store.ListRates(r.Context(), staffID)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, rates)
}

// createRate handles POST /payroll/staff/{staff_id}/rates
func (h *Handler) createRate(w http.ResponseWriter, r *http.Request) {
	staffID := chi.URLParam(r, "staff_id")
	if staffID == "" {
		writeErr(w, http.StatusBadRequest, "staff_id required")
		return
	}

	var in CreateRateInput
	if err := decodeJSON(r, &in); err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}

	// Validate rate_type.
	if _, ok := allowedRateTypes[in.RateType]; !ok {
		writeErr(w, http.StatusBadRequest,
			"rate_type must be one of: hourly, salary, salary_monthly, salary_annual, commission, per_shift")
		return
	}
	if in.AmountCents < 0 {
		writeErr(w, http.StatusBadRequest, "rate_cents must be >= 0")
		return
	}
	if in.OvertimeMultiplier != nil && *in.OvertimeMultiplier < 1 {
		writeErr(w, http.StatusBadRequest, "overtime_multiplier must be >= 1")
		return
	}
	// Validate effective_from format when provided.
	if in.EffectiveFrom != "" {
		if _, err := time.Parse("2006-01-02", in.EffectiveFrom); err != nil {
			writeErr(w, http.StatusBadRequest, "effective_from must be YYYY-MM-DD")
			return
		}
	}

	rate, err := h.store.CreateRate(r.Context(), staffID, in)
	switch {
	case errors.Is(err, ErrUniqueCurrentRate):
		writeErr(w, http.StatusConflict, err.Error())
		return
	case err != nil:
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, rate)
}

// patchRate handles PATCH /payroll/rates/{rate_id}
func (h *Handler) patchRate(w http.ResponseWriter, r *http.Request) {
	rateID := chi.URLParam(r, "rate_id")
	if rateID == "" {
		writeErr(w, http.StatusBadRequest, "rate_id required")
		return
	}

	var in PatchRateInput
	if err := decodeJSON(r, &in); err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}

	// Validate effective_until format when provided.
	if in.EffectiveUntil != nil {
		if _, err := time.Parse("2006-01-02", *in.EffectiveUntil); err != nil {
			writeErr(w, http.StatusBadRequest, "effective_until must be YYYY-MM-DD")
			return
		}
	}
	if in.OvertimeMultiplier != nil && *in.OvertimeMultiplier < 1 {
		writeErr(w, http.StatusBadRequest, "overtime_multiplier must be >= 1")
		return
	}

	rate, err := h.store.PatchRate(r.Context(), rateID, in)
	switch {
	case errors.Is(err, ErrRateNotFound):
		writeErr(w, http.StatusNotFound, err.Error())
		return
	case err != nil:
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, rate)
}

// exportPayroll handles GET /payroll/export
func (h *Handler) exportPayroll(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	locationID := q.Get("location_id")
	periodStart := q.Get("period_start")
	periodEnd := q.Get("period_end")
	format := q.Get("format")

	if locationID == "" {
		writeErr(w, http.StatusBadRequest, "location_id required")
		return
	}
	if periodStart == "" || periodEnd == "" {
		writeErr(w, http.StatusBadRequest, "period_start and period_end required (YYYY-MM-DD)")
		return
	}
	if _, err := time.Parse("2006-01-02", periodStart); err != nil {
		writeErr(w, http.StatusBadRequest, "period_start must be YYYY-MM-DD")
		return
	}
	if _, err := time.Parse("2006-01-02", periodEnd); err != nil {
		writeErr(w, http.StatusBadRequest, "period_end must be YYYY-MM-DD")
		return
	}
	if format != "" && format != "csv" {
		writeErr(w, http.StatusBadRequest, "format must be 'csv' or omitted")
		return
	}

	rows, err := h.store.ExportPayroll(r.Context(), locationID, periodStart, periodEnd)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}

	period := fmt.Sprintf("%s_to_%s", periodStart, periodEnd)
	if err := writePayrollCSV(w, period, rows); err != nil {
		// Headers are already sent; log only.
		_ = err
	}
}
