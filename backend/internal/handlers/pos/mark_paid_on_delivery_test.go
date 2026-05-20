package pos_test

// Unit tests for the mark-paid-on-delivery HTTP surface.
//
// These tests do NOT require a live database. They use httptest + an in-process
// chi router wired with a stub OrgScope that controls capability injection.
//
// For integration coverage (DB round-trip) see store_kds_test.go pattern.

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/go-chi/chi/v5"

	"github.com/beepbite/backend/internal/auth"
	"github.com/beepbite/backend/internal/handlers/pos"
)

// buildMarkPaidRouter creates a chi router with the pos handler mounted, and
// injects the given OrgScope into the context (simulating RequireOrgScope).
// A Recoverer middleware is added so nil-pool panics become 500s in unit tests.
func buildMarkPaidRouter(scope auth.OrgScope) http.Handler {
	h := pos.NewHandler(nil) // nil pool — requests will not reach DB in unit tests
	r := chi.NewRouter()
	r.Use(func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			defer func() {
				if rec := recover(); rec != nil {
					w.WriteHeader(http.StatusInternalServerError)
					_, _ = w.Write([]byte(`{"error":"internal"}`))
				}
			}()
			ctx := auth.ContextWithOrgScope(r.Context(), scope)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	})
	h.Mount(r)
	return r
}

func TestMarkPaidOnDelivery_MissingCapability_Returns403(t *testing.T) {
	// Scope with no capabilities → should get 403.
	scope := auth.OrgScope{
		UserID: "user-1",
		Memberships: []auth.Membership{
			{OrgID: "org-1", Role: "member", Capabilities: []byte(`{}`)},
		},
	}
	router := buildMarkPaidRouter(scope)

	body := bytes.NewBufferString(`{"method":"cash","amount_received_cents":1000}`)
	req := httptest.NewRequest(http.MethodPost, "/orders/order-1/mark-paid-on-delivery", body)
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()

	router.ServeHTTP(rr, req)

	if rr.Code != http.StatusForbidden {
		t.Errorf("expected 403 Forbidden, got %d — body: %s", rr.Code, rr.Body.String())
	}

	var resp map[string]string
	_ = json.Unmarshal(rr.Body.Bytes(), &resp)
	if resp["error"] == "" {
		t.Error("expected non-empty error field in response body")
	}
}

func TestMarkPaidOnDelivery_WithCapability_ProceedsToOrderLookup(t *testing.T) {
	// Scope with can_settle → capability check passes; the nil pool causes a
	// 500 (panic recovered to 500). The key assertion is: NOT 403.
	scope := auth.OrgScope{
		UserID: "user-1",
		Memberships: []auth.Membership{
			{OrgID: "org-1", Role: "member", Capabilities: []byte(`{"can_settle":true}`)},
		},
	}
	router := buildMarkPaidRouter(scope)

	body := bytes.NewBufferString(`{"method":"cash","amount_received_cents":1000}`)
	req := httptest.NewRequest(http.MethodPost, "/orders/order-1/mark-paid-on-delivery", body)
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()

	router.ServeHTTP(rr, req)

	// Nil pool → 500 (panic recovered), but must NOT be 403.
	if rr.Code == http.StatusForbidden {
		t.Errorf("got 403 even though can_settle is present — body: %s", rr.Body.String())
	}
	// Must be 500 (nil pool panic recovered) not 403.
	if rr.Code != http.StatusInternalServerError {
		t.Errorf("expected 500 from nil pool, got %d — body: %s", rr.Code, rr.Body.String())
	}
}

func TestMarkPaidOnDelivery_InvalidMethod_Returns400(t *testing.T) {
	scope := auth.OrgScope{
		UserID: "user-1",
		Memberships: []auth.Membership{
			{OrgID: "org-1", Role: "member", Capabilities: []byte(`{"can_settle":true}`)},
		},
	}
	router := buildMarkPaidRouter(scope)

	body := bytes.NewBufferString(`{"method":"bitcoin","amount_received_cents":1000}`)
	req := httptest.NewRequest(http.MethodPost, "/orders/order-1/mark-paid-on-delivery", body)
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()

	router.ServeHTTP(rr, req)

	if rr.Code != http.StatusBadRequest {
		t.Errorf("expected 400 for invalid method, got %d", rr.Code)
	}
}

func TestMarkPaidOnDelivery_ZeroAmount_Returns400(t *testing.T) {
	scope := auth.OrgScope{
		UserID: "user-1",
		Memberships: []auth.Membership{
			{OrgID: "org-1", Role: "member", Capabilities: []byte(`{"can_settle":true}`)},
		},
	}
	router := buildMarkPaidRouter(scope)

	body := bytes.NewBufferString(`{"method":"cash","amount_received_cents":0}`)
	req := httptest.NewRequest(http.MethodPost, "/orders/order-1/mark-paid-on-delivery", body)
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()

	router.ServeHTTP(rr, req)

	if rr.Code != http.StatusBadRequest {
		t.Errorf("expected 400 for zero amount, got %d", rr.Code)
	}
}

// TestHasCapability_Logic ensures the helper correctly detects a capability.
func TestHasCapability_Logic(t *testing.T) {
	ctx := context.Background()

	// Inject a scope with can_settle into context.
	scope := auth.OrgScope{
		Memberships: []auth.Membership{
			{OrgID: "org-1", Capabilities: []byte(`{"can_settle":true}`)},
		},
	}
	ctx = auth.ContextWithOrgScope(ctx, scope)

	caps := auth.Capabilities(ctx)
	found := false
	for _, c := range caps {
		if c == "can_settle" {
			found = true
			break
		}
	}
	if !found {
		t.Errorf("expected can_settle in capabilities, got: %v", caps)
	}

	// Scope without can_settle.
	scope2 := auth.OrgScope{
		Memberships: []auth.Membership{
			{OrgID: "org-1", Capabilities: []byte(`{"can_pos":true}`)},
		},
	}
	ctx2 := auth.ContextWithOrgScope(context.Background(), scope2)
	caps2 := auth.Capabilities(ctx2)
	for _, c := range caps2 {
		if c == "can_settle" {
			t.Error("can_settle must not be present when not in capabilities JSON")
		}
	}
}
