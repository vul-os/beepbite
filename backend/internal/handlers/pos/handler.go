// Package pos exposes the POS order-creation REST surface.
// Mount under an already-authenticated chi.Router group at /pos.
package pos

import (
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/beepbite/backend/internal/auth"
)

// Handler wires together the Store and HTTP routing.
type Handler struct {
	store *Store
}

// NewHandler constructs a Handler backed by pool.
func NewHandler(pool *pgxpool.Pool) *Handler {
	return &Handler{store: NewStore(pool)}
}

// Mount registers all POS routes under the provided router.
func (h *Handler) Mount(r chi.Router) {
	r.Route("/pos", func(r chi.Router) {
		r.Post("/orders", h.createOrder)
		r.Post("/orders/{order_id}/charge", h.charge)
	})
	// Mark-paid-on-delivery lives at /orders/:id/mark-paid-on-delivery so that
	// it is accessible without the /pos prefix (shared with marketplace orders).
	r.Post("/orders/{order_id}/mark-paid-on-delivery", h.markPaidOnDelivery)
}

// ---------------------------------------------------------------------------
// Request / response types
// ---------------------------------------------------------------------------

type createOrderReq struct {
	LocationID        string           `json:"location_id"`
	OrderType         string           `json:"order_type"`
	TableNumber       string           `json:"table_number"`
	TableSessionID    string           `json:"table_session_id"`
	RegisterSessionID string           `json:"register_session_id"`
	CustomerID        string           `json:"customer_id"`
	Items             []OrderLineInput `json:"items"`
	// OnDeliveryMethod is required when the order is a delivery and no active
	// online payment credential exists for the location.
	// Accepted values: "cash" | "card_machine".
	OnDeliveryMethod string `json:"on_delivery_method"`
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

// POST /pos/orders
func (h *Handler) createOrder(w http.ResponseWriter, r *http.Request) {
	var req createOrderReq
	if err := decodeJSON(r, &req); err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}

	// Validate required fields.
	if req.LocationID == "" {
		writeErr(w, http.StatusBadRequest, "location_id is required")
		return
	}
	if len(req.Items) == 0 {
		writeErr(w, http.StatusBadRequest, "items must not be empty")
		return
	}
	for i, line := range req.Items {
		if line.ItemID == "" {
			writeErr(w, http.StatusBadRequest, "items["+itoa(i)+"]: item_id is required")
			return
		}
		if line.Quantity <= 0 {
			writeErr(w, http.StatusBadRequest, "items["+itoa(i)+"]: quantity must be > 0")
			return
		}
	}

	// Org-scope check: verify the caller has access to the requested location.
	scope := auth.OrgScopeFrom(r.Context())
	if !scope.AllowsLocation(req.LocationID) {
		writeErr(w, http.StatusNotFound, "location not found")
		return
	}

	// Org-scope check: if a table_session_id is supplied, verify it belongs to a
	// location in the caller's scope (prevents cross-tenant session hijacking).
	if req.TableSessionID != "" {
		sessLocID, err := h.store.GetTableSessionLocationID(r.Context(), req.TableSessionID)
		switch {
		case errors.Is(err, ErrOrderNotFound):
			writeErr(w, http.StatusNotFound, "table_session not found")
			return
		case err != nil:
			writeErr(w, http.StatusInternalServerError, err.Error())
			return
		}
		if !scope.AllowsLocation(sessLocID) {
			writeErr(w, http.StatusNotFound, "table_session not found")
			return
		}
	}

	// Map request order_type to DB constraint values.
	dbOrderType, ok := mapOrderType(req.OrderType)
	if !ok {
		writeErr(w, http.StatusBadRequest, "order_type must be one of: dine_in, takeaway, delivery")
		return
	}

	result, err := h.store.CreateOrder(
		r.Context(),
		req.LocationID,
		dbOrderType,
		req.TableNumber,
		req.TableSessionID,
		req.RegisterSessionID,
		req.CustomerID,
		req.Items,
		req.OnDeliveryMethod,
	)
	switch {
	case errors.Is(err, ErrLocationNotFound):
		writeErr(w, http.StatusNotFound, "location not found")
		return
	case errors.Is(err, ErrItemNotFound):
		writeErr(w, http.StatusBadRequest, "one or more item_ids are invalid")
		return
	case errors.Is(err, ErrBadVariation):
		writeErr(w, http.StatusBadRequest, "one or more variation_option_ids are invalid")
		return
	case errors.Is(err, ErrNoPaymentMethodAvailable):
		writeErr(w, http.StatusUnprocessableEntity, "no payment method available — store cannot accept orders right now")
		return
	case err != nil:
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}

	writeJSON(w, http.StatusCreated, result)
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// mapOrderType maps the public API order_type to the DB CHECK constraint value.
// Returns ("", false) if the value is not recognised.
func mapOrderType(t string) (string, bool) {
	switch t {
	case "dine_in":
		return "dine_in", true
	case "takeaway", "pickup":
		return "pickup", true
	case "delivery":
		return "delivery", true
	default:
		return "", false
	}
}

// itoa is a zero-dependency int-to-string for error messages.
func itoa(n int) string {
	const digits = "0123456789"
	if n == 0 {
		return "0"
	}
	var buf [20]byte
	pos := len(buf)
	for n > 0 {
		pos--
		buf[pos] = digits[n%10]
		n /= 10
	}
	return string(buf[pos:])
}
