package apiauth

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

// fakeStore satisfies keyLookup and never finds a key, so every resolve fails —
// exactly the rejection path whose 401 body we care about here.
type fakeStore struct{}

func (fakeStore) GetByPrefix(context.Context, string) ([]apiKeyRow, error) { return nil, nil }
func (fakeStore) StampLastUsed(context.Context, string)                    {}

func assertJSONUnauthorized(t *testing.T, rr *httptest.ResponseRecorder) {
	t.Helper()
	if rr.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401", rr.Code)
	}
	if ct := rr.Header().Get("Content-Type"); ct != "application/json" {
		t.Errorf("Content-Type = %q, want application/json", ct)
	}
	var body map[string]string
	if err := json.Unmarshal(rr.Body.Bytes(), &body); err != nil {
		t.Fatalf("401 body is not JSON (%v): %q", err, rr.Body.String())
	}
	if body["error"] != "unauthorized" {
		t.Errorf(`401 body = %v, want {"error":"unauthorized"}`, body)
	}
}

// The API-key 401 must carry the same {"error": "..."} JSON body every other
// error path in this API returns — not http.Error's plain text.
func TestRequireAPIKey_Returns401JSON(t *testing.T) {
	mw := requireAPIKeyWith(fakeStore{})
	h := mw(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
		t.Fatal("next handler must not run for a rejected key")
	}))

	// No Authorization header at all.
	rr := httptest.NewRecorder()
	h.ServeHTTP(rr, httptest.NewRequest(http.MethodGet, "/api/v1/data/orders", nil))
	assertJSONUnauthorized(t, rr)

	// A bb_ key that resolves to nothing.
	rr = httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/data/orders", nil)
	req.Header.Set("Authorization", "Bearer bb_live_doesnotexist")
	h.ServeHTTP(rr, req)
	assertJSONUnauthorized(t, rr)
}

// OptionalAPIKey passes non-bb_ requests through to JWT auth, but a present-but-
// unresolvable bb_ key is still rejected — and with the same JSON 401.
func TestOptionalAPIKey_PassThroughVsReject(t *testing.T) {
	mw := optionalAPIKeyWith(fakeStore{})

	passed := false
	h := mw(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		passed = true
		w.WriteHeader(http.StatusOK)
	}))
	rr := httptest.NewRecorder()
	h.ServeHTTP(rr, httptest.NewRequest(http.MethodGet, "/api/v1/data/orders", nil))
	if !passed || rr.Code != http.StatusOK {
		t.Fatalf("no-key request should pass through (passed=%v code=%d)", passed, rr.Code)
	}

	h2 := mw(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
		t.Fatal("next must not run for an unresolvable bb_ key")
	}))
	rr = httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/data/orders", nil)
	req.Header.Set("Authorization", "Bearer bb_live_doesnotexist")
	h2.ServeHTTP(rr, req)
	assertJSONUnauthorized(t, rr)
}
