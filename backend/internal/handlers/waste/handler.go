// Package waste exposes REST endpoints for recording and querying waste
// movements and prep batches. Mount under an authenticated chi.Router group.
package waste

import (
	"errors"
	"net/http"

	"github.com/beepbite/backend/internal/auth"
	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Handler wires HTTP routes to Store methods.
type Handler struct {
	store *Store
}

// NewHandler constructs a Handler backed by the given connection pool.
func NewHandler(pool *pgxpool.Pool) *Handler {
	return &Handler{store: NewStore(pool)}
}

// Mount registers all waste + prep-batch routes on r.
//
//	POST   /waste                  → can_manage_inventory
//	GET    /waste                  → can_view_inventory
//	GET    /waste/report           → can_view_inventory
//	POST   /prep-batches           → can_manage_inventory
//	GET    /prep-batches           → can_view_inventory
func (h *Handler) Mount(r chi.Router) {
	r.Route("/waste", func(r chi.Router) {
		r.With(auth.RequireCapability("can_manage_inventory")).Post("/", h.recordWaste)
		r.With(auth.RequireCapability("can_view_inventory")).Get("/", h.listWaste)
		r.With(auth.RequireCapability("can_view_inventory")).Get("/report", h.wasteReport)
	})
	r.Route("/prep-batches", func(r chi.Router) {
		r.With(auth.RequireCapability("can_manage_inventory")).Post("/", h.recordPrepBatch)
		r.With(auth.RequireCapability("can_view_inventory")).Get("/", h.listPrepBatches)
	})
}

// ---------------------------------------------------------------------------
// Request / Response types
// ---------------------------------------------------------------------------

type recordWasteReq struct {
	InventoryItemID    string  `json:"inventory_item_id"`
	Quantity           float64 `json:"quantity"`
	Unit               string  `json:"unit"`
	WasteReason        string  `json:"waste_reason"`
	PerformedByStaffID string  `json:"performed_by_staff_id"`
	Notes              string  `json:"notes"`
}

type prepBatchInputReq struct {
	InventoryItemID  string  `json:"inventory_item_id"`
	QuantityConsumed float64 `json:"quantity_consumed"`
	Unit             string  `json:"unit"`
}

type recordPrepBatchReq struct {
	OrganizationID          string              `json:"organization_id"`
	LocationID              string              `json:"location_id"`
	ProducedInventoryItemID string              `json:"produced_inventory_item_id"`
	ProducedQuantity        float64             `json:"produced_quantity"`
	ProducedUnit            string              `json:"produced_unit"`
	RecipeYieldPct          *float64            `json:"recipe_yield_pct"`
	Inputs                  []prepBatchInputReq `json:"inputs"`
	PreparedByStaffID       string              `json:"prepared_by_staff_id"`
	Notes                   string              `json:"notes"`
}

// ---------------------------------------------------------------------------
// Allowed waste reason values (mirrors migration CHECK constraint)
// ---------------------------------------------------------------------------

var allowedWasteReasons = map[string]struct{}{
	"spoilage":      {},
	"spillage":      {},
	"theft":         {},
	"staff_meal":    {},
	"prep_loss":     {},
	"expired":       {},
	"contamination": {},
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

func (h *Handler) recordWaste(w http.ResponseWriter, r *http.Request) {
	var req recordWasteReq
	if err := decodeJSON(r, &req); err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	if req.InventoryItemID == "" {
		writeErr(w, http.StatusBadRequest, "inventory_item_id is required")
		return
	}
	if req.Quantity <= 0 {
		writeErr(w, http.StatusBadRequest, "quantity must be > 0")
		return
	}
	if req.Unit == "" {
		writeErr(w, http.StatusBadRequest, "unit is required")
		return
	}
	if req.WasteReason != "" {
		if _, ok := allowedWasteReasons[req.WasteReason]; !ok {
			writeErr(w, http.StatusBadRequest, "invalid waste_reason")
			return
		}
	}

	m, err := h.store.RecordWaste(
		r.Context(),
		req.InventoryItemID,
		req.Quantity,
		req.Unit,
		req.WasteReason,
		req.PerformedByStaffID,
		req.Notes,
	)
	switch {
	case errors.Is(err, ErrNotFound):
		writeErr(w, http.StatusNotFound, "inventory item not found")
		return
	case err != nil:
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, m)
}

func (h *Handler) listWaste(w http.ResponseWriter, r *http.Request) {
	locationID := r.URL.Query().Get("location_id")
	if locationID == "" {
		writeErr(w, http.StatusBadRequest, "location_id is required")
		return
	}
	since := r.URL.Query().Get("since")
	until := r.URL.Query().Get("until")

	movements, err := h.store.ListWaste(r.Context(), locationID, since, until)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, movements)
}

func (h *Handler) wasteReport(w http.ResponseWriter, r *http.Request) {
	locationID := r.URL.Query().Get("location_id")
	if locationID == "" {
		writeErr(w, http.StatusBadRequest, "location_id is required")
		return
	}
	since := r.URL.Query().Get("since")
	until := r.URL.Query().Get("until")

	rows, err := h.store.WasteReport(r.Context(), locationID, since, until)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, rows)
}

func (h *Handler) recordPrepBatch(w http.ResponseWriter, r *http.Request) {
	var req recordPrepBatchReq
	if err := decodeJSON(r, &req); err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	if req.OrganizationID == "" {
		writeErr(w, http.StatusBadRequest, "organization_id is required")
		return
	}
	if req.LocationID == "" {
		writeErr(w, http.StatusBadRequest, "location_id is required")
		return
	}
	if req.ProducedInventoryItemID == "" {
		writeErr(w, http.StatusBadRequest, "produced_inventory_item_id is required")
		return
	}
	if req.ProducedQuantity <= 0 {
		writeErr(w, http.StatusBadRequest, "produced_quantity must be > 0")
		return
	}
	if req.ProducedUnit == "" {
		writeErr(w, http.StatusBadRequest, "produced_unit is required")
		return
	}
	if req.RecipeYieldPct != nil && (*req.RecipeYieldPct <= 0 || *req.RecipeYieldPct > 100) {
		writeErr(w, http.StatusBadRequest, "recipe_yield_pct must be between 0 and 100 exclusive")
		return
	}
	if len(req.Inputs) == 0 {
		writeErr(w, http.StatusBadRequest, "at least one input is required")
		return
	}
	for i, inp := range req.Inputs {
		if inp.InventoryItemID == "" {
			writeErr(w, http.StatusBadRequest, "inputs["+itoa(i)+"].inventory_item_id is required")
			return
		}
		if inp.QuantityConsumed <= 0 {
			writeErr(w, http.StatusBadRequest, "inputs["+itoa(i)+"].quantity_consumed must be > 0")
			return
		}
		if inp.Unit == "" {
			writeErr(w, http.StatusBadRequest, "inputs["+itoa(i)+"].unit is required")
			return
		}
	}

	// Convert request inputs to store type.
	storeInputs := make([]PrepBatchInput, len(req.Inputs))
	for i, inp := range req.Inputs {
		storeInputs[i] = PrepBatchInput{
			InventoryItemID:  inp.InventoryItemID,
			QuantityConsumed: inp.QuantityConsumed,
			Unit:             inp.Unit,
		}
	}

	batch, err := h.store.RecordPrepBatch(
		r.Context(),
		req.OrganizationID,
		req.LocationID,
		req.ProducedInventoryItemID,
		req.ProducedQuantity,
		req.ProducedUnit,
		req.RecipeYieldPct,
		storeInputs,
		req.PreparedByStaffID,
		req.Notes,
	)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, batch)
}

func (h *Handler) listPrepBatches(w http.ResponseWriter, r *http.Request) {
	locationID := r.URL.Query().Get("location_id")
	if locationID == "" {
		writeErr(w, http.StatusBadRequest, "location_id is required")
		return
	}
	since := r.URL.Query().Get("since")

	batches, err := h.store.ListPrepBatches(r.Context(), locationID, since)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, batches)
}
