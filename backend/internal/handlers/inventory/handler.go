// Package inventory exposes procurement and stock management REST endpoints
// on top of migration-20 tables.  Mount under an authenticated chi.Router
// group at /inventory.
package inventory

import (
	"errors"
	"net/http"
	"strconv"

	"github.com/beepbite/backend/internal/auth"
	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Handler is the HTTP layer for inventory / procurement.
type Handler struct {
	store *Store
}

// NewHandler wires the store and returns a ready-to-mount handler.
func NewHandler(pool *pgxpool.Pool) *Handler {
	return &Handler{store: NewStore(pool)}
}

// Mount registers all inventory routes on r.
func (h *Handler) Mount(r chi.Router) {
	r.Route("/inventory", func(r chi.Router) {
		// Read-only endpoints — requires can_view_inventory.
		r.With(auth.RequireCapability("can_view_inventory")).Get("/auto-po-suggestions", h.autoPOSuggestions)

		// Write endpoints — requires can_manage_inventory.
		r.With(auth.RequireCapability("can_manage_inventory")).Post("/goods-receipts/{grn_id}/receive", h.receiveGRN)
		r.With(auth.RequireCapability("can_manage_inventory")).Post("/supplier-invoices/{invoice_id}/match", h.matchInvoice)
		r.With(auth.RequireCapability("can_manage_inventory")).Post("/purchase-orders", h.createPO)
		r.With(auth.RequireCapability("can_manage_inventory")).Post("/purchase-orders/{po_id}/submit", h.submitPO)
	})
}

// ---------------------------------------------------------------------------
// POST /inventory/goods-receipts/{grn_id}/receive
// ---------------------------------------------------------------------------

func (h *Handler) receiveGRN(w http.ResponseWriter, r *http.Request) {
	grnID := chi.URLParam(r, "grn_id")
	if grnID == "" {
		writeErr(w, http.StatusBadRequest, "grn_id required")
		return
	}

	n, err := h.store.ReceiveGRN(r.Context(), grnID)
	switch {
	case errors.Is(err, ErrNotFound):
		writeErr(w, http.StatusNotFound, "GRN not found")
	case errors.Is(err, ErrAlreadyReceived):
		writeErr(w, http.StatusConflict, "GRN has already been received")
	case err != nil:
		writeErr(w, http.StatusInternalServerError, err.Error())
	default:
		writeJSON(w, http.StatusOK, map[string]any{
			"grn_id":          grnID,
			"lines_processed": n,
			"status":          "received",
		})
	}
}

// ---------------------------------------------------------------------------
// POST /inventory/supplier-invoices/{invoice_id}/match
// ---------------------------------------------------------------------------

type matchReq struct {
	TolerancePct *float64 `json:"tolerance_pct"` // optional; defaults to 0.02
}

func (h *Handler) matchInvoice(w http.ResponseWriter, r *http.Request) {
	invoiceID := chi.URLParam(r, "invoice_id")
	if invoiceID == "" {
		writeErr(w, http.StatusBadRequest, "invoice_id required")
		return
	}

	var req matchReq
	// Body is optional; ignore decode error if body is empty.
	_ = decodeJSON(r, &req)

	tol := DefaultTolerancePct
	if req.TolerancePct != nil {
		tol = *req.TolerancePct
	}

	data, err := h.store.LoadInvoiceForMatch(r.Context(), invoiceID)
	switch {
	case errors.Is(err, ErrNotFound):
		writeErr(w, http.StatusNotFound, "supplier invoice not found")
		return
	case err != nil:
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}

	result := RunMatch(data, tol)

	if err := h.store.SetInvoiceMatchStatus(r.Context(), invoiceID, result.MatchStatus); err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}

	code := http.StatusOK
	if result.MatchStatus != "matched" {
		code = http.StatusUnprocessableEntity
	}
	writeJSON(w, code, result)
}

// ---------------------------------------------------------------------------
// GET /inventory/auto-po-suggestions?location_id=
// ---------------------------------------------------------------------------

// POSuggestion is a draft purchase_orders payload for one supplier covering
// all low-stock items from that supplier at this location.
type POSuggestion struct {
	LocationID          string        `json:"location_id"`
	SupplierID          string        `json:"supplier_id"`
	SupplierName        string        `json:"supplier_name"`
	Status              string        `json:"status"`
	Lines               []POLineInput `json:"lines"`
	EstimatedTotalCents int64         `json:"estimated_total_cents"`
}

func (h *Handler) autoPOSuggestions(w http.ResponseWriter, r *http.Request) {
	locationID := r.URL.Query().Get("location_id")
	if locationID == "" {
		writeErr(w, http.StatusBadRequest, "location_id query parameter required")
		return
	}

	items, err := h.store.GetLowStockItems(r.Context(), locationID)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}

	// Group low-stock items by supplier to produce one draft PO per supplier.
	type supplierKey struct {
		supplierID   string
		supplierName string
	}
	grouped := make(map[supplierKey][]LowStockItem)
	for _, item := range items {
		key := supplierKey{item.PreferredSupplierID, item.SupplierName}
		grouped[key] = append(grouped[key], item)
	}

	suggestions := make([]POSuggestion, 0, len(grouped))
	for key, groupItems := range grouped {
		var lines []POLineInput
		var estimatedTotal int64
		for _, item := range groupItems {
			var unitPriceCents int64
			if item.LastPriceCents != nil {
				unitPriceCents = *item.LastPriceCents
			}
			unit := item.Unit
			if item.PackUnit != nil {
				unit = *item.PackUnit
			}
			line := POLineInput{
				InventoryItemID:       item.InventoryItemID,
				OrderedQuantity:       item.SuggestedOrderQty,
				OrderedUnit:           unit,
				OrderedUnitPriceCents: unitPriceCents,
			}
			lines = append(lines, line)
			estimatedTotal += int64(item.SuggestedOrderQty * float64(unitPriceCents))
		}

		suggestions = append(suggestions, POSuggestion{
			LocationID:          locationID,
			SupplierID:          key.supplierID,
			SupplierName:        key.supplierName,
			Status:              "draft",
			Lines:               lines,
			EstimatedTotalCents: estimatedTotal,
		})
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"location_id": locationID,
		"suggestions": suggestions,
	})
}

// ---------------------------------------------------------------------------
// POST /inventory/purchase-orders
// ---------------------------------------------------------------------------

func (h *Handler) createPO(w http.ResponseWriter, r *http.Request) {
	var req CreatePOInput
	if err := decodeJSON(r, &req); err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	if req.LocationID == "" {
		writeErr(w, http.StatusBadRequest, "location_id required")
		return
	}
	if req.PONumber == "" {
		writeErr(w, http.StatusBadRequest, "po_number required")
		return
	}
	if len(req.Lines) == 0 {
		writeErr(w, http.StatusBadRequest, "at least one line item required")
		return
	}
	for i, l := range req.Lines {
		if l.InventoryItemID == "" {
			writeErr(w, http.StatusBadRequest, "line "+strconv.Itoa(i)+": inventory_item_id required")
			return
		}
		if l.OrderedQuantity <= 0 {
			writeErr(w, http.StatusBadRequest, "line "+strconv.Itoa(i)+": ordered_quantity must be > 0")
			return
		}
		if l.OrderedUnit == "" {
			writeErr(w, http.StatusBadRequest, "line "+strconv.Itoa(i)+": ordered_unit required")
			return
		}
	}

	po, err := h.store.CreatePO(r.Context(), req)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, po)
}

// ---------------------------------------------------------------------------
// POST /inventory/purchase-orders/{po_id}/submit
// ---------------------------------------------------------------------------

type submitPOReq struct {
	ActorLabel string `json:"actor_label"` // optional human-readable actor for audit log
}

func (h *Handler) submitPO(w http.ResponseWriter, r *http.Request) {
	poID := chi.URLParam(r, "po_id")
	if poID == "" {
		writeErr(w, http.StatusBadRequest, "po_id required")
		return
	}

	var req submitPOReq
	_ = decodeJSON(r, &req) // body is optional

	po, err := h.store.SubmitPO(r.Context(), poID, req.ActorLabel)
	switch {
	case errors.Is(err, ErrNotFound):
		writeErr(w, http.StatusNotFound, "purchase order not found")
	case errors.Is(err, ErrInvalidTransition):
		writeErr(w, http.StatusConflict, "purchase order is not in draft status")
	case err != nil:
		writeErr(w, http.StatusInternalServerError, err.Error())
	default:
		writeJSON(w, http.StatusOK, po)
	}
}
