// Package specials exposes the daily-specials REST surface (Wave 32).
//
// Mount under an already-authenticated + org-scoped chi.Router group:
//
//	h := specials.NewHandler(pool)
//	h.Mount(r)  // registers GET /specials and PUT /items/{item_id}/special
//
// GET /specials — list today's specials (any authenticated org member).
// PUT /items/{item_id}/special — toggle an item as a special (owner/manager).
package specials

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/beepbite/backend/internal/auth"
)

// Handler wires HTTP routes to the Store.
type Handler struct {
	store *Store
}

// NewHandler constructs a Handler backed by pool.
func NewHandler(pool *pgxpool.Pool) *Handler {
	return &Handler{store: NewStore(pool)}
}

// Mount registers the specials routes on r.
func (h *Handler) Mount(r chi.Router) {
	// Any authenticated org member may list today's specials (POS, marketplace).
	r.Get("/specials", h.listSpecials)

	// Only owners/managers may toggle an item as a special.
	r.Put("/items/{item_id}/special", h.setSpecial)
}

// --- Handlers ---

// listSpecials handles GET /specials?location_id=<uuid>
//
// Returns items where is_daily_special=true AND (special_date IS NULL OR
// special_date = CURRENT_DATE) for the caller's org. If location_id is
// provided it further narrows results to that location; the scope check is
// done so a caller cannot query a location outside their org (RLS enforces it
// transparently — they simply see zero rows).
func (h *Handler) listSpecials(w http.ResponseWriter, r *http.Request) {
	locationID := r.URL.Query().Get("location_id")

	// Cross-tenant guard: when a location_id is supplied, verify the caller's
	// scope covers it. Returns 404 (not 403) to avoid existence leaks.
	if locationID != "" {
		if !auth.OrgScopeFrom(r.Context()).AllowsLocation(locationID) {
			writeErr(w, http.StatusNotFound, "not found")
			return
		}
	}

	specials, err := h.store.ListTodaysSpecials(r.Context(), locationID)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}

	writeJSON(w, http.StatusOK, specials)
}

// setSpecial handles PUT /items/{item_id}/special
//
// Body: { is_daily_special: bool, special_price_cents?: int64, special_date?: "YYYY-MM-DD" }
//
// Requires owner or manager role. Returns 403 for staff without that role.
// Returns 404 when the item does not exist or is outside the caller's org.
func (h *Handler) setSpecial(w http.ResponseWriter, r *http.Request) {
	if !callerIsOwnerOrManager(r) {
		writeErr(w, http.StatusForbidden, "requires owner or manager role")
		return
	}

	itemID := chi.URLParam(r, "item_id")
	if itemID == "" {
		writeErr(w, http.StatusBadRequest, "item_id required")
		return
	}

	var req SetSpecialReq
	if err := decodeJSON(r, &req); err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}

	if req.SpecialPriceCents != nil && *req.SpecialPriceCents < 0 {
		writeErr(w, http.StatusBadRequest, "special_price_cents must be >= 0")
		return
	}

	locationID, err := h.store.SetSpecial(r.Context(), itemID, req)
	switch {
	case errors.Is(err, ErrItemNotFound):
		writeErr(w, http.StatusNotFound, "not found")
		return
	case err != nil:
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}

	// Cross-tenant guard: verify the updated item's location is in scope.
	if !auth.OrgScopeFrom(r.Context()).AllowsLocation(locationID) {
		writeErr(w, http.StatusNotFound, "not found")
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"item_id":          itemID,
		"is_daily_special": req.IsDailySpecial,
	})
}

// --- Authorization helpers ---

// callerIsOwnerOrManager returns true when the OrgScope in context contains at
// least one membership with role 'owner' or 'manager'.
func callerIsOwnerOrManager(r *http.Request) bool {
	scope := auth.OrgScopeFrom(r.Context())
	for _, m := range scope.Memberships {
		if m.Role == "owner" || m.Role == "manager" {
			return true
		}
	}
	return false
}

// --- I/O helpers ---

func decodeJSON(r *http.Request, v any) error {
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	return dec.Decode(v)
}

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(v)
}

func writeErr(w http.ResponseWriter, code int, msg string) {
	writeJSON(w, code, map[string]string{"error": msg})
}
