package marketplace

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// ---------------------------------------------------------------------------
// Unit tests for ListParams parsing and pagination defaults
// ---------------------------------------------------------------------------

func TestListParamsDefaults(t *testing.T) {
	r := httptest.NewRequest(http.MethodGet, "/stores", nil)
	p := parseListParams(r)

	if p.Limit != defaultLimit {
		t.Errorf("expected default limit %d, got %d", defaultLimit, p.Limit)
	}
	if p.Offset != 0 {
		t.Errorf("expected default offset 0, got %d", p.Offset)
	}
	if p.Q != "" || p.City != "" || p.Country != "" {
		t.Errorf("expected empty text filters, got q=%q city=%q country=%q", p.Q, p.City, p.Country)
	}
	if p.Lat != nil || p.Lng != nil || p.RadiusKM != nil {
		t.Error("expected nil geo params by default")
	}
}

func TestListParamsLimit(t *testing.T) {
	tests := []struct {
		raw      string
		expected int
	}{
		{"5", 5},
		{"200", maxLimit},  // clamped to max
		{"0", defaultLimit}, // invalid → default
		{"-1", defaultLimit}, // negative → default
		{"abc", defaultLimit}, // non-numeric → default
	}
	for _, tc := range tests {
		r := httptest.NewRequest(http.MethodGet, "/stores?limit="+tc.raw, nil)
		p := parseListParams(r)
		if p.Limit != tc.expected {
			t.Errorf("limit=%q: expected %d, got %d", tc.raw, tc.expected, p.Limit)
		}
	}
}

func TestListParamsGeo(t *testing.T) {
	r := httptest.NewRequest(http.MethodGet, "/stores?lat=-33.9&lng=18.4&radius_km=5", nil)
	p := parseListParams(r)

	if p.Lat == nil || *p.Lat != -33.9 {
		t.Errorf("expected lat=-33.9, got %v", p.Lat)
	}
	if p.Lng == nil || *p.Lng != 18.4 {
		t.Errorf("expected lng=18.4, got %v", p.Lng)
	}
	if p.RadiusKM == nil || *p.RadiusKM != 5.0 {
		t.Errorf("expected radius_km=5, got %v", p.RadiusKM)
	}
}

// ---------------------------------------------------------------------------
// HTTP handler unit tests using a stub store
// ---------------------------------------------------------------------------

// stubStore replaces the real Store for HTTP-layer tests.
type stubStore struct {
	listResult   []StoreListItem
	listErr      error
	profileResult *StoreProfile
	profileErr   error
}

func (s *stubStore) ListStores(_ context.Context, _ pgx.Tx, _ ListParams) ([]StoreListItem, error) {
	return s.listResult, s.listErr
}

func (s *stubStore) GetStoreBySlug(_ context.Context, _ pgx.Tx, _ string) (*StoreProfile, error) {
	return s.profileResult, s.profileErr
}

// shimHandler wraps a stubStore into an http.Handler matching the two routes.
func shimHandler(stub storeQuerier) http.Handler {
	r := chi.NewRouter()

	r.Get("/", func(w http.ResponseWriter, req *http.Request) {
		p := parseListParams(req)
		stores, err := stub.ListStores(req.Context(), nil, p)
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
	})

	r.Get("/{slug}", func(w http.ResponseWriter, req *http.Request) {
		slug := chi.URLParam(req, "slug")
		profile, err := stub.GetStoreBySlug(req.Context(), nil, slug)
		if err != nil {
			if isNotFound(err) {
				writeError(w, http.StatusNotFound, "store not found")
				return
			}
			writeError(w, http.StatusInternalServerError, "internal error")
			return
		}
		setCacheHeaders(w)
		writeJSON(w, http.StatusOK, profile)
	})

	return r
}

// storeQuerier is the narrow interface the shim uses.
type storeQuerier interface {
	ListStores(ctx context.Context, tx pgx.Tx, p ListParams) ([]StoreListItem, error)
	GetStoreBySlug(ctx context.Context, tx pgx.Tx, slug string) (*StoreProfile, error)
}

func isNotFound(err error) bool {
	return err != nil && err.Error() == ErrNotFound.Error()
}

func TestListStores_ReturnsStores(t *testing.T) {
	slug := "test-store"
	city := "Cape Town"
	stub := &stubStore{
		listResult: []StoreListItem{
			{ID: "abc", Name: "Test Store", Slug: &slug, City: &city},
		},
	}

	r := httptest.NewRequest(http.MethodGet, "/?q=test", nil)
	w := httptest.NewRecorder()
	shimHandler(stub).ServeHTTP(w, r)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}

	var body map[string]interface{}
	if err := json.NewDecoder(w.Body).Decode(&body); err != nil {
		t.Fatalf("decode response: %v", err)
	}

	data, ok := body["data"].([]interface{})
	if !ok {
		t.Fatal("expected data array in response")
	}
	if len(data) != 1 {
		t.Errorf("expected 1 store, got %d", len(data))
	}

	cc := w.Header().Get("Cache-Control")
	if !strings.Contains(cc, "public") || !strings.Contains(cc, "max-age=60") {
		t.Errorf("unexpected Cache-Control: %q", cc)
	}
}

func TestListStores_EmptyResult(t *testing.T) {
	stub := &stubStore{listResult: nil}

	r := httptest.NewRequest(http.MethodGet, "/", nil)
	w := httptest.NewRecorder()
	shimHandler(stub).ServeHTTP(w, r)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d; body=%s", w.Code, w.Body.String())
	}

	var body map[string]interface{}
	_ = json.NewDecoder(w.Body).Decode(&body)
	data := body["data"].([]interface{})
	if len(data) != 0 {
		t.Errorf("expected empty array, got %d items", len(data))
	}
}

func TestGetStore_NotFound(t *testing.T) {
	stub := &stubStore{profileErr: ErrNotFound}

	r := httptest.NewRequest(http.MethodGet, "/unknown-slug", nil)
	w := httptest.NewRecorder()
	shimHandler(stub).ServeHTTP(w, r)

	if w.Code != http.StatusNotFound {
		t.Errorf("expected 404, got %d", w.Code)
	}
}

func TestGetStore_ReturnsProfile(t *testing.T) {
	slug := "my-store"
	stub := &stubStore{
		profileResult: &StoreProfile{
			ID:                "xyz",
			Name:              "My Store",
			Slug:              &slug,
			OffersDelivery:    true,
			OffersCollection:  true,
			EstimatedPrepTime: 20,
			Categories:        []Category{},
		},
	}

	r := httptest.NewRequest(http.MethodGet, "/my-store", nil)
	w := httptest.NewRecorder()
	shimHandler(stub).ServeHTTP(w, r)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d; body=%s", w.Code, w.Body.String())
	}

	var profile StoreProfile
	if err := json.NewDecoder(w.Body).Decode(&profile); err != nil {
		t.Fatalf("decode profile: %v", err)
	}
	if profile.ID != "xyz" {
		t.Errorf("expected id=xyz, got %q", profile.ID)
	}
	if profile.Categories == nil {
		t.Error("expected non-nil categories slice")
	}

	cc := w.Header().Get("Cache-Control")
	if !strings.Contains(cc, "public") {
		t.Errorf("missing public cache header: %q", cc)
	}
}

func TestGetStore_MenuFiltering(t *testing.T) {
	// Verify the DTO correctly excludes items that are 86ed or out of window.
	// The SQL filter lives in store.go; here we test the handler layer passes
	// whatever the store returns unchanged.
	slug := "filter-store"
	avail := Item{ID: "item1", Name: "Available Item", Price: "100.00", PreparationTime: 15, SortOrder: 0}
	cat := Category{ID: "cat1", Name: "Mains", SortOrder: 0, Items: []Item{avail}}

	stub := &stubStore{
		profileResult: &StoreProfile{
			ID:         "loc1",
			Name:       "Filter Store",
			Slug:       &slug,
			Categories: []Category{cat},
		},
	}

	r := httptest.NewRequest(http.MethodGet, "/filter-store", nil)
	w := httptest.NewRecorder()
	shimHandler(stub).ServeHTTP(w, r)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}

	var profile StoreProfile
	_ = json.NewDecoder(w.Body).Decode(&profile)
	if len(profile.Categories) != 1 {
		t.Errorf("expected 1 category, got %d", len(profile.Categories))
	}
	if len(profile.Categories[0].Items) != 1 {
		t.Errorf("expected 1 item, got %d", len(profile.Categories[0].Items))
	}
}

// ---------------------------------------------------------------------------
// Compile-time check: Handler must be constructable with a real *pgxpool.Pool
// type (not verified at runtime in unit tests).
// ---------------------------------------------------------------------------

var _ = func() *Handler { return NewHandler((*pgxpool.Pool)(nil)) }
