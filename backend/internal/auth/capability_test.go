package auth

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

// buildCtxWithCaps injects an OrgScope containing a single membership whose
// capabilities JSON encodes the provided map. This simulates what
// RequireOrgScope would inject after a real DB lookup.
func buildCtxWithCaps(t *testing.T, caps map[string]bool) context.Context {
	t.Helper()
	b, err := json.Marshal(caps)
	if err != nil {
		t.Fatalf("marshal caps: %v", err)
	}
	scope := OrgScope{
		UserID: "user-test",
		Memberships: []Membership{
			{OrgID: "org-test", Role: "staff", Capabilities: b},
		},
	}
	return ContextWithOrgScope(context.Background(), scope)
}

// TestRequireCapability_Allowed verifies that a request with the required
// capability is passed through to the next handler with status 200.
func TestRequireCapability_Allowed(t *testing.T) {
	ctx := buildCtxWithCaps(t, map[string]bool{"can_void": true, "can_pos": true})

	reached := false
	inner := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		reached = true
		w.WriteHeader(http.StatusOK)
	})

	mw := RequireCapability("can_void")(inner)
	req := httptest.NewRequest(http.MethodPost, "/", nil).WithContext(ctx)
	rr := httptest.NewRecorder()
	mw.ServeHTTP(rr, req)

	if !reached {
		t.Fatal("inner handler was not reached")
	}
	if rr.Code != http.StatusOK {
		t.Errorf("expected 200, got %d", rr.Code)
	}
}

// TestRequireCapability_Denied verifies that a request missing the required
// capability receives 403 with the canonical error envelope.
func TestRequireCapability_Denied(t *testing.T) {
	// Member has can_pos but NOT can_void.
	ctx := buildCtxWithCaps(t, map[string]bool{"can_pos": true})

	reached := false
	inner := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		reached = true
	})

	mw := RequireCapability("can_void")(inner)
	req := httptest.NewRequest(http.MethodPost, "/", nil).WithContext(ctx)
	rr := httptest.NewRecorder()
	mw.ServeHTTP(rr, req)

	if reached {
		t.Fatal("inner handler must not be reached when capability is missing")
	}
	if rr.Code != http.StatusForbidden {
		t.Errorf("expected 403, got %d", rr.Code)
	}

	var body map[string]string
	if err := json.NewDecoder(rr.Body).Decode(&body); err != nil {
		t.Fatalf("decode body: %v", err)
	}
	if body["error"] != "missing_capability" {
		t.Errorf("body.error = %q, want %q", body["error"], "missing_capability")
	}
	if body["capability"] != "can_void" {
		t.Errorf("body.capability = %q, want %q", body["capability"], "can_void")
	}
}

// TestRequireCapability_NoScope verifies that a request with no OrgScope in
// context (e.g. misconfigured middleware chain) is denied with 403 and the
// correct capability name in the body.
func TestRequireCapability_NoScope(t *testing.T) {
	inner := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	})

	mw := RequireCapability("can_refund")(inner)
	req := httptest.NewRequest(http.MethodPost, "/", nil) // bare context — no OrgScope
	rr := httptest.NewRecorder()
	mw.ServeHTTP(rr, req)

	if rr.Code != http.StatusForbidden {
		t.Errorf("expected 403, got %d", rr.Code)
	}

	var body map[string]string
	if err := json.NewDecoder(rr.Body).Decode(&body); err != nil {
		t.Fatalf("decode body: %v", err)
	}
	if body["capability"] != "can_refund" {
		t.Errorf("body.capability = %q, want %q", body["capability"], "can_refund")
	}
}

// TestHasCapability_OrgScopeFallback verifies HasCapability against plain
// OrgScope capabilities (no actor-overlay present). HasCapability is defined
// in actor_middleware.go; this test exercises the member-fallback path.
func TestHasCapability_OrgScopeFallback(t *testing.T) {
	ctx := buildCtxWithCaps(t, map[string]bool{"can_comp": true})

	if !HasCapability(ctx, "can_comp") {
		t.Error("HasCapability(can_comp) = false, want true")
	}
	if HasCapability(ctx, "can_void") {
		t.Error("HasCapability(can_void) = true, want false")
	}
	if HasCapability(context.Background(), "can_comp") {
		t.Error("HasCapability on empty ctx = true, want false")
	}
}

// ---------------------------------------------------------------------------
// Elevation path tests
// ---------------------------------------------------------------------------

// stubChecker is a test-only ElevationChecker that accepts or rejects based on
// a pre-set error. On success it returns a fixed grantedBy ID.
type stubChecker struct {
	err       error
	grantedBy string
}

func (s *stubChecker) CheckElevation(_ context.Context, _, _, _, _ string) (string, error) {
	if s.err != nil {
		return "", s.err
	}
	return s.grantedBy, nil
}

// TestRequireCapabilityWithElevation_Allowed verifies that a cashier without
// can_void + a valid elevation token is let through and the ElevationContext is
// injected.
func TestRequireCapabilityWithElevation_Allowed(t *testing.T) {
	// Cashier has can_pos but NOT can_void.
	ctx := buildCtxWithCaps(t, map[string]bool{"can_pos": true})

	checker := &stubChecker{grantedBy: "mgr-staff-id"}

	var gotCtx context.Context
	inner := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotCtx = r.Context()
		w.WriteHeader(http.StatusOK)
	})

	mw := RequireCapabilityWithElevation("can_void", "void", "order_id", checker)(inner)
	req := httptest.NewRequest(http.MethodPost, "/orders/order-123/void", nil).WithContext(ctx)
	req.Header.Set("X-Elevation-Token", "some.valid.token")
	rr := httptest.NewRecorder()
	mw.ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Errorf("expected 200, got %d", rr.Code)
	}
	ec, ok := ElevationFromContext(gotCtx)
	if !ok {
		t.Fatal("ElevationFromContext returned false — ElevationContext not injected")
	}
	if ec.ElevatedBy != "mgr-staff-id" {
		t.Errorf("ElevatedBy: got %q, want %q", ec.ElevatedBy, "mgr-staff-id")
	}
	if ec.GrantedCapability != "can_void" {
		t.Errorf("GrantedCapability: got %q, want %q", ec.GrantedCapability, "can_void")
	}
}

// TestRequireCapabilityWithElevation_Replay verifies that a replayed (already-used)
// elevation token returns 403 elevation_used.
func TestRequireCapabilityWithElevation_Replay(t *testing.T) {
	ctx := buildCtxWithCaps(t, map[string]bool{"can_pos": true})

	checker := &stubChecker{err: ErrElevationUsed}

	reached := false
	inner := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		reached = true
	})

	mw := RequireCapabilityWithElevation("can_void", "void", "order_id", checker)(inner)
	req := httptest.NewRequest(http.MethodPost, "/", nil).WithContext(ctx)
	req.Header.Set("X-Elevation-Token", "replayed.token")
	rr := httptest.NewRecorder()
	mw.ServeHTTP(rr, req)

	if reached {
		t.Fatal("inner handler must not be reached on token replay")
	}
	if rr.Code != http.StatusForbidden {
		t.Errorf("expected 403, got %d", rr.Code)
	}
	var body map[string]string
	if err := json.NewDecoder(rr.Body).Decode(&body); err != nil {
		t.Fatalf("decode body: %v", err)
	}
	if body["error"] != "elevation_used" {
		t.Errorf("body.error = %q, want %q", body["error"], "elevation_used")
	}
}

// TestRequireCapabilityWithElevation_Mismatch verifies that a token for a
// different action/target returns 403 elevation_mismatch.
func TestRequireCapabilityWithElevation_Mismatch(t *testing.T) {
	ctx := buildCtxWithCaps(t, map[string]bool{"can_pos": true})

	checker := &stubChecker{err: ErrElevationMismatch}

	inner := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	})

	mw := RequireCapabilityWithElevation("can_void", "void", "order_id", checker)(inner)
	req := httptest.NewRequest(http.MethodPost, "/", nil).WithContext(ctx)
	req.Header.Set("X-Elevation-Token", "mismatched.token")
	rr := httptest.NewRecorder()
	mw.ServeHTTP(rr, req)

	if rr.Code != http.StatusForbidden {
		t.Errorf("expected 403, got %d", rr.Code)
	}
	var body map[string]string
	if err := json.NewDecoder(rr.Body).Decode(&body); err != nil {
		t.Fatalf("decode body: %v", err)
	}
	if body["error"] != "elevation_mismatch" {
		t.Errorf("body.error = %q, want %q", body["error"], "elevation_mismatch")
	}
}

// TestRequireCapabilityWithElevation_NoToken verifies that a cashier without
// can_void and no elevation token still receives 403 missing_capability.
func TestRequireCapabilityWithElevation_NoToken(t *testing.T) {
	ctx := buildCtxWithCaps(t, map[string]bool{"can_pos": true})

	checker := &stubChecker{grantedBy: "should-not-reach"}

	inner := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	})

	mw := RequireCapabilityWithElevation("can_void", "void", "order_id", checker)(inner)
	req := httptest.NewRequest(http.MethodPost, "/", nil).WithContext(ctx)
	// No X-Elevation-Token header.
	rr := httptest.NewRecorder()
	mw.ServeHTTP(rr, req)

	if rr.Code != http.StatusForbidden {
		t.Errorf("expected 403, got %d", rr.Code)
	}
	var body map[string]string
	if err := json.NewDecoder(rr.Body).Decode(&body); err != nil {
		t.Fatalf("decode body: %v", err)
	}
	if body["error"] != "missing_capability" {
		t.Errorf("body.error = %q, want %q", body["error"], "missing_capability")
	}
}
