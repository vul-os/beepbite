// Package marketplace provides public (no-auth) endpoints for the store
// directory. All routes are unauthenticated; DB access uses the
// marketplace_role Postgres session variable (db.MarketplaceScope()) so
// Postgres RLS restricts every row to is_marketplace_visible=true locations.
//
// Mount under the top-level router (outside any auth middleware group):
//
//	r.Route("/stores", marketplaceH.Mount)
//
// Routes:
//
//	GET /stores           — paginated store list; supports ?q=, ?city=,
//	                        ?country=, ?lat=&lng=&radius_km=, ?limit=, ?offset=
//	GET /stores/{slug}    — store profile + available menu snapshot
//
// Both endpoints return Cache-Control: public, max-age=60.
package marketplace

import (
	"context"
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"strconv"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/beepbite/backend/internal/db"
	"github.com/beepbite/backend/internal/payments"
)

const (
	defaultLimit = 20
	maxLimit     = 100
)

// Handler serves the public marketplace endpoints.
type Handler struct {
	store         *Store
	checkoutStore *CheckoutStore
	pool          *pgxpool.Pool
}

// NewHandler constructs a Handler.
func NewHandler(pool *pgxpool.Pool) *Handler {
	return &Handler{
		store:         NewStore(pool),
		checkoutStore: newCheckoutStore(pool),
		pool:          pool,
	}
}

// WithOnlinePayments wires an online payment gateway into the marketplace
// checkout and its return-URL settlement endpoint. Call it only when
// payments.NewOnlineGatewayProvider() actually returned a non-nil provider
// (see cmd/server/main.go) — an unconfigured deployment must never call this,
// so CreateCheckoutOrder's on-delivery-only behaviour stays exactly as it was
// before this feature existed.
//
// apiPublicURL is this backend's own externally-reachable base URL (e.g.
// "https://api.myshop.example"), used to build the gateway return URL — see
// CheckoutStore.buildReturnURL. returnSecret signs/verifies that URL's token
// (in practice cfg.JWTSecret; see payments.SignReturnToken's doc comment for
// why reusing it is fine here).
//
// The payment_methods row for gatewayCode is seeded HERE, because this is the
// moment a deployment declares which code it will use. checkout.go used to say
// this happened "once at startup"; it did not happen anywhere at all. Nothing
// called payments.EnsureOnlineTenderSeeded, so order_payments' foreign key to
// payment_methods(code) had no row to point at and every online checkout ended
// in a constraint violation and a 500 — the whole gateway path was unreachable
// in practice.
//
// If the seed fails the gateway is deliberately NOT enabled: an unseeded code
// means every order would 500 at the final insert, after the customer has
// already been charged by the provider. Falling back to the on-delivery flow is
// worse than working online payments and far better than that.
func (h *Handler) WithOnlinePayments(gateway payments.PaymentProvider, gatewayCode, returnSecret, apiPublicURL string) *Handler {
	if gateway != nil {
		if err := h.seedOnlineTender(gatewayCode); err != nil {
			log.Printf("marketplace: online payments NOT enabled: could not seed the %q "+
				"payment method: %v", gatewayCode, err)
			return h
		}
	}
	h.checkoutStore.gateway = gateway
	h.checkoutStore.gatewayCode = gatewayCode
	h.checkoutStore.returnSecret = returnSecret
	h.checkoutStore.apiPublicURL = apiPublicURL
	h.store.onlineAvailable = gateway != nil
	return h
}

// seedOnlineTender upserts the payment_methods row the online tender needs.
// It runs as the service role: payment_methods is global reference data, not
// tenant-scoped, and this is startup wiring rather than a request.
func (h *Handler) seedOnlineTender(gatewayCode string) error {
	if gatewayCode == "" {
		return errors.New("gateway code is empty")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	return db.Scoped(ctx, h.pool, db.ServiceRoleScope(), func(tx pgx.Tx) error {
		return payments.EnsureOnlineTenderSeeded(ctx, tx, gatewayCode, gatewayCode)
	})
}

// Mount registers the public routes on r.
// r is expected to be the /stores sub-router.
func (h *Handler) Mount(r chi.Router) {
	r.Get("/", h.listStores)
	r.Get("/{slug}", h.getStore)
	r.Post("/{slug}/orders", h.createCheckoutOrder)
	// Gateway return URL (verify-on-return settlement — see payreturn.go).
	// Mounted unconditionally: with no gateway configured, checkout never
	// mints a link to it, and the handler itself fails closed with a
	// "payments unavailable" page if it is ever hit anyway.
	r.Get("/{slug}/orders/{order_id}/pay/return", h.payReturn)
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

// parseListParams reads query-string parameters from r and returns a
// ListParams with safe defaults. Exported so tests can call it directly.
func parseListParams(r *http.Request) ListParams {
	p := ListParams{
		Q:       r.URL.Query().Get("q"),
		City:    r.URL.Query().Get("city"),
		Country: r.URL.Query().Get("country"),
		Limit:   defaultLimit,
		Offset:  0,
	}

	if v := r.URL.Query().Get("limit"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			if n > maxLimit {
				n = maxLimit
			}
			p.Limit = n
		}
	}
	if v := r.URL.Query().Get("offset"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n >= 0 {
			p.Offset = n
		}
	}

	if latStr := r.URL.Query().Get("lat"); latStr != "" {
		if lat, err := strconv.ParseFloat(latStr, 64); err == nil {
			p.Lat = &lat
		}
	}
	if lngStr := r.URL.Query().Get("lng"); lngStr != "" {
		if lng, err := strconv.ParseFloat(lngStr, 64); err == nil {
			p.Lng = &lng
		}
	}
	if radStr := r.URL.Query().Get("radius_km"); radStr != "" {
		if rad, err := strconv.ParseFloat(radStr, 64); err == nil && rad > 0 {
			p.RadiusKM = &rad
		}
	}

	return p
}

// listStores handles GET /stores
func (h *Handler) listStores(w http.ResponseWriter, r *http.Request) {
	p := parseListParams(r)

	var stores []StoreListItem
	err := db.Scoped(r.Context(), h.pool, db.MarketplaceScope(), func(tx pgx.Tx) error {
		var queryErr error
		stores, queryErr = h.store.ListStores(r.Context(), tx, p)
		return queryErr
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}
	if stores == nil {
		stores = []StoreListItem{}
	}

	setCacheHeaders(w)
	writeJSON(w, http.StatusOK, map[string]interface{}{
		"data":   stores,
		"limit":  p.Limit,
		"offset": p.Offset,
	})
}

// getStore handles GET /stores/{slug}
func (h *Handler) getStore(w http.ResponseWriter, r *http.Request) {
	slug := chi.URLParam(r, "slug")
	if slug == "" {
		writeError(w, http.StatusBadRequest, "slug required")
		return
	}

	var profile *StoreProfile
	err := db.Scoped(r.Context(), h.pool, db.MarketplaceScope(), func(tx pgx.Tx) error {
		var queryErr error
		profile, queryErr = h.store.GetStoreBySlug(r.Context(), tx, slug)
		return queryErr
	})
	if err != nil {
		if errors.Is(err, ErrNotFound) {
			writeError(w, http.StatusNotFound, "store not found")
			return
		}
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}

	setCacheHeaders(w)
	writeJSON(w, http.StatusOK, profile)
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

func setCacheHeaders(w http.ResponseWriter) {
	w.Header().Set("Cache-Control", "public, max-age=60")
}

func writeJSON(w http.ResponseWriter, status int, v interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func writeError(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}
