package auth

// Unit tests for RequireOrgScope middleware.
//
// These tests use a stub orgMembershipQuerier — no database required.
// They exercise:
//   - Valid JWT with org-A membership → scope lists only org-A locations.
//   - Missing membership → 403 (not 401; identity was confirmed by auth.Middleware).
//   - Multiple memberships (org-A + org-B) → all locations for both orgs in scope.
//   - OrgScopeFrom, ScopeAllowsLocation, ScopeAllowsOrg, Capabilities helpers.

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"sort"
	"testing"
	"time"

	"github.com/beepbite/backend/internal/db"
	"github.com/golang-jwt/jwt/v5"
)

// ---------------------------------------------------------------------------
// Stub querier
// ---------------------------------------------------------------------------

// stubQuerier implements orgMembershipQuerier for testing. It returns a
// pre-configured set of memberships and locations without touching a database.
type stubQuerier struct {
	// memberships maps userID → []Membership
	memberships map[string][]Membership
	// locations maps orgID → []locationID
	locations map[string][]string
}

func (s *stubQuerier) queryMemberships(_ context.Context, userID string) ([]Membership, error) {
	return s.memberships[userID], nil
}

func (s *stubQuerier) queryLocationIDs(_ context.Context, orgIDs []string) ([]string, error) {
	var out []string
	for _, orgID := range orgIDs {
		out = append(out, s.locations[orgID]...)
	}
	return out, nil
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// issueTestToken signs a JWT with a fixed secret for the given userID.
func issueTestToken(t *testing.T, userID string) string {
	t.Helper()
	now := time.Now().UTC()
	claims := Claims{
		UserID: userID,
		Email:  userID + "@test.invalid",
		RegisteredClaims: jwt.RegisteredClaims{
			Subject:   userID,
			IssuedAt:  jwt.NewNumericDate(now),
			ExpiresAt: jwt.NewNumericDate(now.Add(time.Hour)),
		},
	}
	tok := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	s, err := tok.SignedString([]byte("test-secret"))
	if err != nil {
		t.Fatalf("sign test token: %v", err)
	}
	return s
}

// ctxWithClaims injects Claims directly into a context, simulating what
// auth.Middleware would have done before RequireOrgScope runs.
func ctxWithClaims(ctx context.Context, userID string) context.Context {
	return context.WithValue(ctx, claimsKey, &Claims{UserID: userID, Email: userID + "@test.invalid"})
}

// runMiddleware drives a request through the middleware under test and returns
// the recorded response plus the context seen by the inner handler.
func runMiddleware(t *testing.T, q orgMembershipQuerier, userID string) (*httptest.ResponseRecorder, context.Context) {
	t.Helper()
	var capturedCtx context.Context
	inner := http.HandlerFunc(func(_ http.ResponseWriter, r *http.Request) {
		capturedCtx = r.Context()
	})

	mw := requireOrgScopeWith(q)(inner)
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req = req.WithContext(ctxWithClaims(req.Context(), userID))
	rr := httptest.NewRecorder()
	mw.ServeHTTP(rr, req)
	return rr, capturedCtx
}

// mustCapJSON encodes capabilities as JSON for a Membership.
func mustCapJSON(t *testing.T, caps map[string]bool) []byte {
	t.Helper()
	b, err := json.Marshal(caps)
	if err != nil {
		t.Fatalf("marshal capabilities: %v", err)
	}
	return b
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

// TestRequireOrgScope_ValidMembership verifies that a user with a single
// org-A membership receives an OrgScope listing only org-A locations.
func TestRequireOrgScope_ValidMembership(t *testing.T) {
	const userID = "user-aaa"
	const orgA = "org-aaaaaaaa-0001"
	const locA1 = "loc-aaaaaaaa-0001"
	const locA2 = "loc-aaaaaaaa-0002"

	q := &stubQuerier{
		memberships: map[string][]Membership{
			userID: {
				{OrgID: orgA, Role: "manager", Capabilities: mustCapJSON(t, map[string]bool{"can_pos": true, "can_void": true})},
			},
		},
		locations: map[string][]string{
			orgA: {locA1, locA2},
		},
	}

	rr, capturedCtx := runMiddleware(t, q, userID)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rr.Code, rr.Body.String())
	}
	if capturedCtx == nil {
		t.Fatal("inner handler was not reached")
	}

	// OrgScope must be present.
	scope := OrgScopeFrom(capturedCtx)
	if scope.UserID != userID {
		t.Errorf("scope.UserID = %q, want %q", scope.UserID, userID)
	}
	if len(scope.Memberships) != 1 {
		t.Fatalf("expected 1 membership, got %d", len(scope.Memberships))
	}
	if scope.Memberships[0].OrgID != orgA {
		t.Errorf("membership.OrgID = %q, want %q", scope.Memberships[0].OrgID, orgA)
	}

	// Location IDs must be exactly the org-A set.
	gotLocs := append([]string{}, scope.LocationIDs...)
	sort.Strings(gotLocs)
	wantLocs := []string{locA1, locA2}
	sort.Strings(wantLocs)
	if len(gotLocs) != len(wantLocs) {
		t.Fatalf("LocationIDs %v, want %v", gotLocs, wantLocs)
	}
	for i := range gotLocs {
		if gotLocs[i] != wantLocs[i] {
			t.Errorf("LocationIDs[%d] = %q, want %q", i, gotLocs[i], wantLocs[i])
		}
	}

	// AllowsLocation must return true for org-A locations.
	if !scope.AllowsLocation(locA1) {
		t.Errorf("AllowsLocation(%q) = false, want true", locA1)
	}
	if !scope.AllowsLocation(locA2) {
		t.Errorf("AllowsLocation(%q) = false, want true", locA2)
	}
	// … and false for an unrelated location.
	if scope.AllowsLocation("loc-foreign-0000") {
		t.Error("AllowsLocation(foreign) = true, want false")
	}

	// Standalone helpers.
	scopePtr := &scope
	if !ScopeAllowsLocation(scopePtr, locA1) {
		t.Errorf("ScopeAllowsLocation(locA1) = false, want true")
	}
	if !ScopeAllowsOrg(scopePtr, orgA) {
		t.Errorf("ScopeAllowsOrg(orgA) = false, want true")
	}
	if ScopeAllowsOrg(scopePtr, "org-foreign") {
		t.Error("ScopeAllowsOrg(foreign) = true, want false")
	}

	// db.Scope must be injected with correct UserID and OrgID.
	dbScope := db.ScopeFromContext(capturedCtx)
	if dbScope.UserID != userID {
		t.Errorf("db.Scope.UserID = %q, want %q", dbScope.UserID, userID)
	}
	if dbScope.OrgID != orgA {
		t.Errorf("db.Scope.OrgID = %q, want %q", dbScope.OrgID, orgA)
	}

	// Capabilities must include can_pos and can_void.
	caps := Capabilities(capturedCtx)
	capSet := make(map[string]struct{}, len(caps))
	for _, c := range caps {
		capSet[c] = struct{}{}
	}
	for _, want := range []string{"can_pos", "can_void"} {
		if _, ok := capSet[want]; !ok {
			t.Errorf("Capabilities missing %q; got %v", want, caps)
		}
	}
}

// TestRequireOrgScope_NoMembership verifies that an authenticated user with no
// org membership receives 403 (not 401).
func TestRequireOrgScope_NoMembership(t *testing.T) {
	const userID = "user-orphan"

	q := &stubQuerier{
		memberships: map[string][]Membership{}, // no rows for this user
		locations:   map[string][]string{},
	}

	rr, _ := runMiddleware(t, q, userID)

	if rr.Code != http.StatusForbidden {
		t.Errorf("expected 403, got %d: %s", rr.Code, rr.Body.String())
	}
}

// TestRequireOrgScope_NoClaims verifies that 401 is returned when auth
// middleware has not injected Claims (simulates misconfigured chain).
func TestRequireOrgScope_NoClaims(t *testing.T) {
	q := &stubQuerier{}

	inner := http.HandlerFunc(func(_ http.ResponseWriter, _ *http.Request) {})
	mw := requireOrgScopeWith(q)(inner)

	// No claims in context — bare request.
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	rr := httptest.NewRecorder()
	mw.ServeHTTP(rr, req)

	if rr.Code != http.StatusUnauthorized {
		t.Errorf("expected 401, got %d", rr.Code)
	}
}

// TestRequireOrgScope_MultipleMemberships verifies that a user belonging to
// org-A and org-B sees locations from both orgs in scope.
func TestRequireOrgScope_MultipleMemberships(t *testing.T) {
	const userID = "user-multi"
	const orgA = "org-aaaaaaaa-multi"
	const orgB = "org-bbbbbbbb-multi"
	const locA = "loc-aaaaaaaa-multi"
	const locB1 = "loc-bbbbbbbb-0001"
	const locB2 = "loc-bbbbbbbb-0002"

	q := &stubQuerier{
		memberships: map[string][]Membership{
			userID: {
				{OrgID: orgA, Role: "owner", Capabilities: mustCapJSON(t, map[string]bool{"can_pos": true})},
				{OrgID: orgB, Role: "manager", Capabilities: mustCapJSON(t, map[string]bool{"can_view_reports": true})},
			},
		},
		locations: map[string][]string{
			orgA: {locA},
			orgB: {locB1, locB2},
		},
	}

	rr, capturedCtx := runMiddleware(t, q, userID)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rr.Code, rr.Body.String())
	}

	scope := OrgScopeFrom(capturedCtx)
	if len(scope.Memberships) != 2 {
		t.Fatalf("expected 2 memberships, got %d", len(scope.Memberships))
	}

	// All three locations must appear.
	gotLocs := append([]string{}, scope.LocationIDs...)
	sort.Strings(gotLocs)
	wantLocs := []string{locA, locB1, locB2}
	sort.Strings(wantLocs)
	if len(gotLocs) != len(wantLocs) {
		t.Fatalf("LocationIDs %v, want %v", gotLocs, wantLocs)
	}
	for i := range gotLocs {
		if gotLocs[i] != wantLocs[i] {
			t.Errorf("LocationIDs[%d] = %q, want %q", i, gotLocs[i], wantLocs[i])
		}
	}

	// Both orgs must be allowed.
	scopePtr := &scope
	if !ScopeAllowsOrg(scopePtr, orgA) {
		t.Error("ScopeAllowsOrg(orgA) = false, want true")
	}
	if !ScopeAllowsOrg(scopePtr, orgB) {
		t.Error("ScopeAllowsOrg(orgB) = false, want true")
	}

	// Capabilities from both memberships must be merged.
	caps := Capabilities(capturedCtx)
	capSet := make(map[string]struct{}, len(caps))
	for _, c := range caps {
		capSet[c] = struct{}{}
	}
	for _, want := range []string{"can_pos", "can_view_reports"} {
		if _, ok := capSet[want]; !ok {
			t.Errorf("Capabilities missing %q; got %v", want, caps)
		}
	}
}

// TestScopeAllowsLocation_NilScope verifies nil-safety of the standalone helper.
func TestScopeAllowsLocation_NilScope(t *testing.T) {
	if ScopeAllowsLocation(nil, "any-id") {
		t.Error("ScopeAllowsLocation(nil, ...) should return false")
	}
}

// TestScopeAllowsOrg_NilScope verifies nil-safety of the standalone helper.
func TestScopeAllowsOrg_NilScope(t *testing.T) {
	if ScopeAllowsOrg(nil, "any-org") {
		t.Error("ScopeAllowsOrg(nil, ...) should return false")
	}
}

// TestCapabilities_Empty verifies Capabilities returns nil for an empty scope.
func TestCapabilities_Empty(t *testing.T) {
	if caps := Capabilities(context.Background()); caps != nil {
		t.Errorf("Capabilities(emptyCtx) = %v, want nil", caps)
	}
}
