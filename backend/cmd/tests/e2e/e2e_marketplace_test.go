package e2e

// e2e_marketplace_test.go — T14.4: marketplace store directory + menu snapshot
//
// Seeds two marketplace-visible locations in the same city plus one private
// (is_marketplace_visible=false) location, then exercises:
//
//   - GET /stores?city=... returns both public stores.
//   - GET /stores?q=<name-substring> filters to the matching store.
//   - GET /stores/:slug returns store profile + available non-86ed menu items.
//   - GET /stores/:unknown-slug returns 404.
//   - The private location does NOT appear in any search result.

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/beepbite/backend/internal/handlers/marketplace"
	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// ---------------------------------------------------------------------------
// Seed helpers (marketplace-specific columns not in the shared helper)
// ---------------------------------------------------------------------------

// seedMarketplaceLocation inserts a marketplace-visible location and returns its UUID.
// slug must be globally unique; city is used for the city-filter test.
func seedMarketplaceLocation(t *testing.T, pool *pgxpool.Pool, orgID, name, slug, city string) string {
	t.Helper()
	var id string
	svcQueryRow(t, pool, &id, `
		INSERT INTO locations (
		    organization_id, name, slug, city,
		    is_marketplace_visible, is_active,
		    on_delivery_payment_methods,
		    offers_collection
		)
		VALUES ($1, $2, $3, $4, true, true, ARRAY['cash']::text[], true)
		RETURNING id`,
		orgID, name, slug, city)
	return id
}

// seedPrivateLocation inserts a location that is NOT marketplace-visible.
func seedPrivateLocation(t *testing.T, pool *pgxpool.Pool, orgID, name, slug, city string) string {
	t.Helper()
	var id string
	svcQueryRow(t, pool, &id, `
		INSERT INTO locations (
		    organization_id, name, slug, city,
		    is_marketplace_visible, is_active,
		    on_delivery_payment_methods,
		    offers_collection
		)
		VALUES ($1, $2, $3, $4, false, true, ARRAY['cash']::text[], true)
		RETURNING id`,
		orgID, name, slug, city)
	return id
}

// seedMarketplaceItem inserts an available (not 86ed) menu item.
func seedMarketplaceItem(t *testing.T, pool *pgxpool.Pool, locID, catID, name string, price float64) string {
	t.Helper()
	var id string
	svcQueryRow(t, pool, &id, `
		INSERT INTO items (location_id, category_id, name, price, is_active, is_86ed)
		VALUES ($1, $2, $3, $4, true, false) RETURNING id`,
		locID, catID, name, price)
	return id
}

// seed86edItem inserts a menu item that is 86ed (should not appear in snapshot).
func seed86edItem(t *testing.T, pool *pgxpool.Pool, locID, catID, name string, price float64) string {
	t.Helper()
	var id string
	svcQueryRow(t, pool, &id, `
		INSERT INTO items (location_id, category_id, name, price, is_active, is_86ed)
		VALUES ($1, $2, $3, $4, true, true) RETURNING id`,
		locID, catID, name, price)
	return id
}

// buildMarketplaceRouter wires marketplace.Handler under /stores and returns the
// http.Handler ready for httptest use. pool must be an open test pool.
func buildMarketplaceRouter(pool *pgxpool.Pool) http.Handler {
	h := marketplace.NewHandler(pool)
	r := chi.NewRouter()
	r.Route("/stores", h.Mount)
	return r
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

func TestMarketplace_ListStores_CityFilter(t *testing.T) {
	pool := openPool(t)
	suffix := randStr(6)
	city := "TestCity_" + suffix

	// Two orgs, one location each, same city.
	orgAID := seedOrg(t, pool, "MktA_"+suffix)
	orgBID := seedOrg(t, pool, "MktB_"+suffix)
	locAID := seedMarketplaceLocation(t, pool, orgAID, "Alpha Diner "+suffix, "alpha-diner-"+suffix, city)
	locBID := seedMarketplaceLocation(t, pool, orgBID, "Beta Bistro "+suffix, "beta-bistro-"+suffix, city)

	// Private location — must NOT appear.
	orgPID := seedOrg(t, pool, "MktPriv_"+suffix)
	_ = seedPrivateLocation(t, pool, orgPID, "Private Eats "+suffix, "private-eats-"+suffix, city)

	// Suppress "declared but not used" for location IDs (we assert via HTTP).
	_ = locAID
	_ = locBID

	router := buildMarketplaceRouter(pool)

	req := httptest.NewRequest(http.MethodGet, fmt.Sprintf("/stores?city=%s", city), nil)
	rr := httptest.NewRecorder()
	router.ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("GET /stores?city=...: expected 200, got %d — body: %s", rr.Code, rr.Body.String())
	}

	var body struct {
		Data []marketplace.StoreListItem `json:"data"`
	}
	if err := json.NewDecoder(rr.Body).Decode(&body); err != nil {
		t.Fatalf("decode response: %v", err)
	}

	// Both public locations must appear.
	foundAlpha, foundBeta, foundPrivate := false, false, false
	for _, s := range body.Data {
		switch s.Name {
		case "Alpha Diner " + suffix:
			foundAlpha = true
		case "Beta Bistro " + suffix:
			foundBeta = true
		case "Private Eats " + suffix:
			foundPrivate = true
		}
	}
	if !foundAlpha {
		t.Errorf("city filter: Alpha Diner not found in results; got %+v", body.Data)
	}
	if !foundBeta {
		t.Errorf("city filter: Beta Bistro not found in results; got %+v", body.Data)
	}
	if foundPrivate {
		t.Errorf("SECURITY: private location appeared in marketplace city filter")
	}
}

func TestMarketplace_ListStores_NameFilter(t *testing.T) {
	pool := openPool(t)
	suffix := randStr(6)
	city := "FilterCity_" + suffix

	orgID := seedOrg(t, pool, "MktFilter_"+suffix)
	_ = seedMarketplaceLocation(t, pool, orgID, "Unique Grill "+suffix, "unique-grill-"+suffix, city)
	_ = seedMarketplaceLocation(t, pool, orgID, "Other Place "+suffix, "other-place-"+suffix, city)

	router := buildMarketplaceRouter(pool)

	// Filter by a substring that only "Unique Grill" contains.
	req := httptest.NewRequest(http.MethodGet, "/stores?q=Unique+Grill+"+suffix, nil)
	rr := httptest.NewRecorder()
	router.ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("GET /stores?q=...: expected 200, got %d — body: %s", rr.Code, rr.Body.String())
	}

	var body struct {
		Data []marketplace.StoreListItem `json:"data"`
	}
	if err := json.NewDecoder(rr.Body).Decode(&body); err != nil {
		t.Fatalf("decode response: %v", err)
	}

	if len(body.Data) < 1 {
		t.Fatalf("name filter: expected at least 1 result, got 0")
	}
	for _, s := range body.Data {
		if s.Name == "Other Place "+suffix {
			t.Errorf("name filter: 'Other Place' should not appear when q='Unique Grill %s'", suffix)
		}
	}
	found := false
	for _, s := range body.Data {
		if s.Name == "Unique Grill "+suffix {
			found = true
		}
	}
	if !found {
		t.Errorf("name filter: 'Unique Grill %s' not found; got %+v", suffix, body.Data)
	}
}

func TestMarketplace_GetStore_MenuSnapshot(t *testing.T) {
	pool := openPool(t)
	ctx := context.Background()
	_ = ctx
	suffix := randStr(6)

	orgID := seedOrg(t, pool, "MktMenu_"+suffix)
	slug := "menu-store-" + suffix
	locID := seedMarketplaceLocation(t, pool, orgID, "Menu Store "+suffix, slug, "MenuCity_"+suffix)

	catID := seedCategory(t, pool, locID, "Mains "+suffix)
	itemID := seedMarketplaceItem(t, pool, locID, catID, "Burger "+suffix, 89.00)
	_86edID := seed86edItem(t, pool, locID, catID, "Sold Out Wrap "+suffix, 55.00)
	_ = _86edID

	router := buildMarketplaceRouter(pool)

	req := httptest.NewRequest(http.MethodGet, "/stores/"+slug, nil)
	rr := httptest.NewRecorder()
	router.ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("GET /stores/%s: expected 200, got %d — body: %s", slug, rr.Code, rr.Body.String())
	}

	var profile marketplace.StoreProfile
	if err := json.NewDecoder(rr.Body).Decode(&profile); err != nil {
		t.Fatalf("decode StoreProfile: %v", err)
	}

	if profile.ID == "" {
		t.Error("StoreProfile.ID is empty")
	}
	if profile.Name != "Menu Store "+suffix {
		t.Errorf("StoreProfile.Name: want %q, got %q", "Menu Store "+suffix, profile.Name)
	}

	// Categories must be present.
	if len(profile.Categories) == 0 {
		t.Fatal("StoreProfile.Categories is empty — expected at least one category with items")
	}

	// Burger must appear; 86ed item must not.
	foundBurger := false
	foundSoldOut := false
	for _, cat := range profile.Categories {
		for _, item := range cat.Items {
			if item.ID == itemID {
				foundBurger = true
			}
			if item.Name == "Sold Out Wrap "+suffix {
				foundSoldOut = true
			}
		}
	}
	if !foundBurger {
		t.Errorf("menu snapshot: Burger (%s) not found in categories", itemID)
	}
	if foundSoldOut {
		t.Errorf("menu snapshot: 86ed item 'Sold Out Wrap' must not appear in snapshot")
	}
}

func TestMarketplace_GetStore_UnknownSlug_Returns404(t *testing.T) {
	pool := openPool(t)

	router := buildMarketplaceRouter(pool)

	req := httptest.NewRequest(http.MethodGet, "/stores/does-not-exist-"+randStr(8), nil)
	rr := httptest.NewRecorder()
	router.ServeHTTP(rr, req)

	if rr.Code != http.StatusNotFound {
		t.Errorf("unknown slug: expected 404, got %d — body: %s", rr.Code, rr.Body.String())
	}
}

func TestMarketplace_PrivateStore_NotInResults(t *testing.T) {
	pool := openPool(t)
	suffix := randStr(6)
	city := "SecCity_" + suffix

	// Private org + location.
	orgID := seedOrg(t, pool, "MktSec_"+suffix)
	privateSlug := "secret-store-" + suffix
	_ = seedPrivateLocation(t, pool, orgID, "Secret Store "+suffix, privateSlug, city)

	router := buildMarketplaceRouter(pool)

	// 1. City filter — must return 0 rows for this private store.
	req1 := httptest.NewRequest(http.MethodGet, fmt.Sprintf("/stores?city=%s", city), nil)
	rr1 := httptest.NewRecorder()
	router.ServeHTTP(rr1, req1)
	if rr1.Code != http.StatusOK {
		t.Fatalf("city filter: expected 200, got %d", rr1.Code)
	}
	var body1 struct {
		Data []marketplace.StoreListItem `json:"data"`
	}
	if err := json.NewDecoder(rr1.Body).Decode(&body1); err != nil {
		t.Fatalf("decode: %v", err)
	}
	for _, s := range body1.Data {
		if s.Name == "Secret Store "+suffix {
			t.Errorf("SECURITY: private store appeared in city filter results")
		}
	}

	// 2. Direct slug lookup — must return 404 (not 200).
	req2 := httptest.NewRequest(http.MethodGet, "/stores/"+privateSlug, nil)
	rr2 := httptest.NewRecorder()
	router.ServeHTTP(rr2, req2)
	if rr2.Code != http.StatusNotFound {
		t.Errorf("SECURITY: private store slug returned %d, expected 404", rr2.Code)
	}
}
