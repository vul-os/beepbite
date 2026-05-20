package auth

// Unit tests for ActorOverlay middleware (T9.3).
//
// These tests verify:
//   - Valid X-Actor-Token: ActorIDFromContext returns staff_id; ActorCapabilities
//     returns overlay capabilities; db.Scope.ActorID is populated.
//   - Missing header: pass-through; ActorIDFromContext returns ""; ActorCapabilities
//     falls back to member capabilities.
//   - Invalid / expired token: pass-through; no 401; member identity preserved.
//   - actor_token query param fallback: same as header path.
//   - HasCapability helper: true when present, false when absent.
//   - IssueActorToken / ParseActorToken round-trip.

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/beepbite/backend/internal/db"
	"github.com/golang-jwt/jwt/v5"
)

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const testActorSecret = "test-actor-secret-32-bytes-padded"

// issueTestActorToken issues a real actor-overlay JWT for tests.
func issueTestActorToken(t *testing.T, staffID, memberID string, caps []string, ttl time.Duration) string {
	t.Helper()
	tok, _, err := IssueActorToken(memberID, staffID, "loc-test-001", caps, []byte(testActorSecret), ttl)
	if err != nil {
		t.Fatalf("IssueActorToken: %v", err)
	}
	return tok
}

// seedMemberCaps injects an OrgScope with a single membership carrying the
// given capability keys into ctx, simulating what RequireOrgScope would do.
func seedMemberCaps(ctx context.Context, t *testing.T, caps map[string]bool) context.Context {
	t.Helper()
	return ContextWithOrgScope(ctx, OrgScope{
		UserID: "member-001",
		Memberships: []Membership{
			{OrgID: "org-001", Role: "staff", Capabilities: mustCapJSON(t, caps)},
		},
	})
}

// runActorMiddleware drives a request through ActorOverlay and returns the
// recorder and the context seen by the inner handler.
func runActorMiddleware(t *testing.T, req *http.Request) (*httptest.ResponseRecorder, context.Context) {
	t.Helper()
	var capturedCtx context.Context
	inner := http.HandlerFunc(func(_ http.ResponseWriter, r *http.Request) {
		capturedCtx = r.Context()
	})
	mw := ActorOverlay([]byte(testActorSecret))(inner)
	rr := httptest.NewRecorder()
	mw.ServeHTTP(rr, req)
	return rr, capturedCtx
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

// TestActorOverlay_ValidHeader verifies that a well-formed X-Actor-Token
// populates ActorIDFromContext and replaces the capabilities in db.Scope.
func TestActorOverlay_ValidHeader(t *testing.T) {
	const staffID = "staff-aaa-0001"
	const memberID = "member-aaa-0001"
	overlayCaps := []string{"can_void", "can_pos"}

	tok := issueTestActorToken(t, staffID, memberID, overlayCaps, time.Hour)

	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.Header.Set("X-Actor-Token", tok)
	// Pre-seed a db.Scope (simulating RequireOrgScope having run).
	ctx := db.ContextWithScope(req.Context(), db.Scope{UserID: memberID, OrgID: "org-001"})
	req = req.WithContext(ctx)

	rr, capturedCtx := runActorMiddleware(t, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rr.Code)
	}
	if capturedCtx == nil {
		t.Fatal("inner handler not reached")
	}

	// ActorID must be the staff_id from the token.
	if got := ActorIDFromContext(capturedCtx); got != staffID {
		t.Errorf("ActorIDFromContext = %q, want %q", got, staffID)
	}

	// ActorCapabilities must be the overlay's caps, not the member's.
	caps := ActorCapabilities(capturedCtx)
	capSet := make(map[string]struct{}, len(caps))
	for _, c := range caps {
		capSet[c] = struct{}{}
	}
	for _, want := range overlayCaps {
		if _, ok := capSet[want]; !ok {
			t.Errorf("ActorCapabilities missing %q; got %v", want, caps)
		}
	}

	// db.Scope.ActorID must also be set.
	scope := db.ScopeFromContext(capturedCtx)
	if scope.ActorID != staffID {
		t.Errorf("db.Scope.ActorID = %q, want %q", scope.ActorID, staffID)
	}
}

// TestActorOverlay_MissingHeader verifies pass-through: no 401, member
// capabilities returned, ActorIDFromContext is empty.
func TestActorOverlay_MissingHeader(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	memberCaps := map[string]bool{"can_pos": true}
	ctx := seedMemberCaps(req.Context(), t, memberCaps)
	ctx = db.ContextWithScope(ctx, db.Scope{UserID: "member-001", OrgID: "org-001"})
	req = req.WithContext(ctx)

	rr, capturedCtx := runActorMiddleware(t, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rr.Code)
	}
	if capturedCtx == nil {
		t.Fatal("inner handler not reached")
	}

	// No actor overlay → empty string.
	if got := ActorIDFromContext(capturedCtx); got != "" {
		t.Errorf("ActorIDFromContext = %q, want empty string", got)
	}

	// ActorCapabilities must fall back to member caps.
	caps := ActorCapabilities(capturedCtx)
	capSet := make(map[string]struct{}, len(caps))
	for _, c := range caps {
		capSet[c] = struct{}{}
	}
	if _, ok := capSet["can_pos"]; !ok {
		t.Errorf("ActorCapabilities missing can_pos (fallback member caps); got %v", caps)
	}
}

// TestActorOverlay_InvalidToken verifies that a malformed token does NOT
// return 401 — the request passes through unchanged.
func TestActorOverlay_InvalidToken(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.Header.Set("X-Actor-Token", "this.is.not.a.valid.jwt")
	ctx := db.ContextWithScope(req.Context(), db.Scope{UserID: "member-001"})
	req = req.WithContext(ctx)

	rr, capturedCtx := runActorMiddleware(t, req)

	// Must NOT be 401 — the middleware is silent on failure.
	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200 (pass-through), got %d: %s", rr.Code, rr.Body.String())
	}
	if capturedCtx == nil {
		t.Fatal("inner handler not reached")
	}

	// No overlay installed.
	if got := ActorIDFromContext(capturedCtx); got != "" {
		t.Errorf("ActorIDFromContext = %q, want empty string", got)
	}
}

// TestActorOverlay_ExpiredToken verifies that an expired actor token is treated
// as absent — pass-through, no 401.
func TestActorOverlay_ExpiredToken(t *testing.T) {
	const staffID = "staff-expired-001"
	// Issue a token that expired 1 minute ago.
	tok := issueTestActorToken(t, staffID, "member-001", []string{"can_pos"}, -time.Minute)

	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.Header.Set("X-Actor-Token", tok)
	ctx := db.ContextWithScope(req.Context(), db.Scope{UserID: "member-001"})
	req = req.WithContext(ctx)

	rr, capturedCtx := runActorMiddleware(t, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200 (pass-through on expired), got %d: %s", rr.Code, rr.Body.String())
	}
	if capturedCtx == nil {
		t.Fatal("inner handler not reached")
	}

	// Expired → no overlay.
	if got := ActorIDFromContext(capturedCtx); got != "" {
		t.Errorf("ActorIDFromContext = %q, want empty string for expired token", got)
	}
}

// TestActorOverlay_QueryParam verifies the actor_token query parameter fallback.
func TestActorOverlay_QueryParam(t *testing.T) {
	const staffID = "staff-qp-001"
	tok := issueTestActorToken(t, staffID, "member-001", []string{"can_void"}, time.Hour)

	req := httptest.NewRequest(http.MethodGet, "/?actor_token="+tok, nil)
	ctx := db.ContextWithScope(req.Context(), db.Scope{UserID: "member-001"})
	req = req.WithContext(ctx)

	_, capturedCtx := runActorMiddleware(t, req)

	if got := ActorIDFromContext(capturedCtx); got != staffID {
		t.Errorf("ActorIDFromContext via query param = %q, want %q", got, staffID)
	}
}

// TestActorOverlay_HeaderTakesPrecedence verifies that X-Actor-Token header
// wins over the actor_token query param when both are present.
func TestActorOverlay_HeaderTakesPrecedence(t *testing.T) {
	const staffHeader = "staff-hdr-001"
	const staffQuery = "staff-qp-002"

	headerTok := issueTestActorToken(t, staffHeader, "member-001", []string{"can_pos"}, time.Hour)
	queryTok := issueTestActorToken(t, staffQuery, "member-001", []string{"can_pos"}, time.Hour)

	req := httptest.NewRequest(http.MethodGet, "/?actor_token="+queryTok, nil)
	req.Header.Set("X-Actor-Token", headerTok)
	ctx := db.ContextWithScope(req.Context(), db.Scope{UserID: "member-001"})
	req = req.WithContext(ctx)

	_, capturedCtx := runActorMiddleware(t, req)

	// Header should take precedence — staffHeader wins.
	if got := ActorIDFromContext(capturedCtx); got != staffHeader {
		t.Errorf("ActorIDFromContext = %q, want header staff %q", got, staffHeader)
	}
}

// TestHasCapability verifies the HasCapability helper with and without overlay.
func TestHasCapability(t *testing.T) {
	const staffID = "staff-hc-001"
	tok := issueTestActorToken(t, staffID, "member-001", []string{"can_void"}, time.Hour)

	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.Header.Set("X-Actor-Token", tok)
	ctx := db.ContextWithScope(req.Context(), db.Scope{UserID: "member-001"})
	req = req.WithContext(ctx)

	_, capturedCtx := runActorMiddleware(t, req)

	if !HasCapability(capturedCtx, "can_void") {
		t.Error("HasCapability(can_void) = false, want true")
	}
	if HasCapability(capturedCtx, "can_pos") {
		t.Error("HasCapability(can_pos) = true, want false (not in overlay)")
	}
}

// TestParseActorToken_RoundTrip verifies that IssueActorToken / ParseActorToken
// are inverses.
func TestParseActorToken_RoundTrip(t *testing.T) {
	secret := []byte("round-trip-secret-32b-padded-xxx")
	caps := []string{"can_void", "can_pos", "can_view_reports"}
	tok, _, err := IssueActorToken("member-rt", "staff-rt", "loc-rt", caps, secret, time.Hour)
	if err != nil {
		t.Fatalf("IssueActorToken: %v", err)
	}

	claims, err := ParseActorToken(tok, secret)
	if err != nil {
		t.Fatalf("ParseActorToken: %v", err)
	}

	if claims.StaffID != "staff-rt" {
		t.Errorf("StaffID = %q, want staff-rt", claims.StaffID)
	}
	if claims.MemberID != "member-rt" {
		t.Errorf("MemberID = %q, want member-rt", claims.MemberID)
	}
	if claims.LocationID != "loc-rt" {
		t.Errorf("LocationID = %q, want loc-rt", claims.LocationID)
	}
	if len(claims.Capabilities) != len(caps) {
		t.Fatalf("Capabilities len %d, want %d", len(claims.Capabilities), len(caps))
	}
	for i, c := range caps {
		if claims.Capabilities[i] != c {
			t.Errorf("Capabilities[%d] = %q, want %q", i, claims.Capabilities[i], c)
		}
	}
}

// TestParseActorToken_WrongAudience verifies that a staff-audience JWT is
// rejected by ParseActorToken (audience mismatch).
func TestParseActorToken_WrongAudience(t *testing.T) {
	// Issue a staff-style token (audience "staff", not "actor-overlay").
	// We use jwt directly rather than staffauth to avoid circular import.
	secret := []byte(testActorSecret)
	// A raw JWT with audience "staff" signed with the same secret.
	claims := &ActorClaims{}
	claims.StaffID = "staff-aud-001"
	claims.RegisteredClaims.Audience = []string{"staff"}
	claims.RegisteredClaims.ExpiresAt = jwt.NewNumericDate(time.Now().Add(time.Hour))
	tok := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	s, err := tok.SignedString(secret)
	if err != nil {
		t.Fatalf("sign: %v", err)
	}

	if _, err := ParseActorToken(s, secret); err == nil {
		t.Error("ParseActorToken with audience 'staff' should have returned an error")
	}
}

// TestCapabilitiesSliceToJSON verifies the JSON encoding helper.
func TestCapabilitiesSliceToJSON(t *testing.T) {
	tests := []struct {
		caps []string
		want string
	}{
		{nil, "{}"},
		{[]string{}, "{}"},
		{[]string{"can_pos"}, `{"can_pos":true}`},
		{[]string{"can_pos", "can_void"}, `{"can_pos":true,"can_void":true}`},
	}
	for _, tt := range tests {
		got := string(capabilitiesSliceToJSON(tt.caps))
		if got != tt.want {
			t.Errorf("capabilitiesSliceToJSON(%v) = %q, want %q", tt.caps, got, tt.want)
		}
	}
}
