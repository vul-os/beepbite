package staffauth

// pin_verify_test.go — unit tests for the PIN-verify logic.
//
// These tests use a pvTestService — a thin reimplementation of Verify that
// substitutes an in-memory stubStore in place of a real *Store and a
// noopPool in place of a real pgxpool.Pool. No real database is needed.
//
// What is tested here:
//   - Wrong PIN → ErrInvalidCredential, failed_login_attempts incremented
//   - Correct PIN → actor token returned, 15-min expiry, capabilities decoded
//   - Locked account → ErrStaffLocked (no bcrypt call, no increment)
//   - Inactive staff → ErrStaffInactive
//   - No PIN set → ErrInvalidCredential
//   - After 5 wrong PINs lockout is enforced (correct PIN on attempt 6 is blocked)
//   - Capabilities are filtered (false-valued keys excluded)
//   - Token is parseable by auth.ParseActorToken with audience "actor-overlay"
//   - Response staff.id, staff.role, staff.display_name populated correctly

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	"github.com/beepbite/backend/internal/auth"
	"golang.org/x/crypto/bcrypt"
)

const testSecret = "test-jwt-secret-32-chars-minimum!"

// ---------------------------------------------------------------------------
// Stub infrastructure
// ---------------------------------------------------------------------------

// userState mirrors the database state the stub manages.
type userState struct {
	user            *StaffUser
	failedAttempts  int
	lockedUntilTime *time.Time
}

// stubPVStore is an in-memory stand-in for the store methods called by Verify.
type stubPVStore struct {
	state          *userState
	incrementCount int
	clearCount     int
}

func (s *stubPVStore) GetByUsername(_ context.Context, locationID, username string) (*StaffUser, error) {
	if s.state.user == nil {
		return nil, ErrStaffNotFound
	}
	u := s.state.user
	if u.LocationID != locationID {
		return nil, ErrStaffNotFound
	}
	uname := ""
	if u.Username != nil {
		uname = *u.Username
	}
	if uname != username {
		return nil, ErrStaffNotFound
	}
	// Return a copy with the current locked state.
	copy := *u
	copy.LockedUntil = s.state.lockedUntilTime
	return &copy, nil
}

func (s *stubPVStore) IncrementFailedAttempts(_ context.Context, _ string) error {
	s.incrementCount++
	s.state.failedAttempts++
	if s.state.failedAttempts >= lockoutThreshold {
		t := time.Now().UTC().Add(lockoutDuration)
		s.state.lockedUntilTime = &t
	}
	return nil
}

func (s *stubPVStore) ClearFailedAttempts(_ context.Context, _ string) error {
	s.clearCount++
	s.state.failedAttempts = 0
	s.state.lockedUntilTime = nil
	return nil
}

// pvTestService mirrors PinVerifyService.Verify but uses stubPVStore.
type pvTestService struct {
	store  *stubPVStore
	secret []byte
}

func newPVTest(user *StaffUser) *pvTestService {
	// Initialise lockedUntilTime from the user struct so makeUser(..., &future)
	// propagates through to the stub's GetByUsername return path.
	state := &userState{user: user, lockedUntilTime: user.LockedUntil}
	return &pvTestService{
		store:  &stubPVStore{state: state},
		secret: []byte(testSecret),
	}
}

func (s *pvTestService) verify(ctx context.Context, memberID string, memberCaps []byte, req PinVerifyRequest) (*PinVerifyResponse, error) {
	if req.LocationID == "" || req.Username == "" || req.PIN == "" {
		return nil, ErrInvalidCredential
	}

	user, err := s.store.GetByUsername(ctx, req.LocationID, req.Username)
	if err != nil {
		return nil, ErrInvalidCredential
	}

	if !user.IsActive {
		return nil, ErrStaffInactive
	}

	if user.LockedUntil != nil && time.Now().UTC().Before(*user.LockedUntil) {
		return nil, ErrStaffLocked
	}

	if user.PinHash == nil {
		return nil, ErrInvalidCredential
	}

	if err := bcrypt.CompareHashAndPassword([]byte(*user.PinHash), []byte(req.PIN)); err != nil {
		_ = s.store.IncrementFailedAttempts(ctx, user.ID)
		return nil, ErrInvalidCredential
	}

	if err := s.store.ClearFailedAttempts(ctx, user.ID); err != nil {
		return nil, err
	}

	caps := decodeCaps(memberCaps)

	tok, exp, err := auth.IssueActorToken(memberID, user.ID, req.LocationID, caps, s.secret, actorOverlayTTL)
	if err != nil {
		return nil, err
	}

	return &PinVerifyResponse{
		ActorToken: tok,
		ExpiresAt:  exp,
		Staff: staffPVDTO{
			ID:          user.ID,
			DisplayName: user.FirstName + " " + user.LastName,
			Role:        user.Role,
		},
		Capabilities: caps,
	}, nil
}

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

func mustHashPIN(t *testing.T, pin string) string {
	t.Helper()
	h, err := bcrypt.GenerateFromPassword([]byte(pin), bcrypt.MinCost)
	if err != nil {
		t.Fatalf("bcrypt hash: %v", err)
	}
	return string(h)
}

func strPtr(s string) *string { return &s }

func makeUser(active bool, pinHash *string, lockedUntil *time.Time) *StaffUser {
	return &StaffUser{
		ID:          "staff-id-001",
		LocationID:  "loc-id-001",
		Username:    strPtr("cashier1"),
		FirstName:   "Cash",
		LastName:    "Ier",
		Role:        "cashier",
		IsActive:    active,
		PinHash:     pinHash,
		LockedUntil: lockedUntil,
	}
}

func capsJSON(m map[string]bool) []byte {
	b, _ := json.Marshal(m)
	return b
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

func TestPinVerify_WrongPIN_Returns401(t *testing.T) {
	pinHash := mustHashPIN(t, "1234")
	svc := newPVTest(makeUser(true, &pinHash, nil))

	req := PinVerifyRequest{Username: "cashier1", PIN: "9999", LocationID: "loc-id-001"}
	_, err := svc.verify(context.Background(), "member-001", nil, req)
	if err != ErrInvalidCredential {
		t.Errorf("expected ErrInvalidCredential, got %v", err)
	}
}

func TestPinVerify_WrongPIN_IncrementsFailedAttempts(t *testing.T) {
	pinHash := mustHashPIN(t, "1234")
	svc := newPVTest(makeUser(true, &pinHash, nil))

	req := PinVerifyRequest{Username: "cashier1", PIN: "0000", LocationID: "loc-id-001"}
	_, _ = svc.verify(context.Background(), "member-001", nil, req)

	if svc.store.incrementCount != 1 {
		t.Errorf("expected 1 increment, got %d", svc.store.incrementCount)
	}
}

func TestPinVerify_CorrectPIN_ReturnsToken(t *testing.T) {
	pinHash := mustHashPIN(t, "5678")
	svc := newPVTest(makeUser(true, &pinHash, nil))

	req := PinVerifyRequest{Username: "cashier1", PIN: "5678", LocationID: "loc-id-001"}
	resp, err := svc.verify(context.Background(), "member-001", nil, req)
	if err != nil {
		t.Fatalf("expected success, got %v", err)
	}
	if resp.ActorToken == "" {
		t.Error("expected non-empty actor token")
	}
}

func TestPinVerify_CorrectPIN_TokenExpiry15Min(t *testing.T) {
	pinHash := mustHashPIN(t, "1111")
	svc := newPVTest(makeUser(true, &pinHash, nil))

	req := PinVerifyRequest{Username: "cashier1", PIN: "1111", LocationID: "loc-id-001"}
	resp, err := svc.verify(context.Background(), "member-001", nil, req)
	if err != nil {
		t.Fatalf("expected success, got %v", err)
	}

	wantExp := time.Now().Add(15 * time.Minute)
	delta := wantExp.Sub(resp.ExpiresAt)
	if delta < 0 {
		delta = -delta
	}
	if delta > 5*time.Second {
		t.Errorf("ExpiresAt not near 15 min: got %v, want ~%v", resp.ExpiresAt, wantExp)
	}
}

func TestPinVerify_CorrectPIN_ClearsFailedAttempts(t *testing.T) {
	pinHash := mustHashPIN(t, "2222")
	svc := newPVTest(makeUser(true, &pinHash, nil))

	req := PinVerifyRequest{Username: "cashier1", PIN: "2222", LocationID: "loc-id-001"}
	_, err := svc.verify(context.Background(), "member-001", nil, req)
	if err != nil {
		t.Fatalf("expected success, got %v", err)
	}
	if svc.store.clearCount != 1 {
		t.Errorf("expected 1 ClearFailedAttempts call, got %d", svc.store.clearCount)
	}
}

func TestPinVerify_LockedAccount_ErrStaffLocked(t *testing.T) {
	pinHash := mustHashPIN(t, "3333")
	future := time.Now().UTC().Add(10 * time.Minute)
	svc := newPVTest(makeUser(true, &pinHash, &future))

	req := PinVerifyRequest{Username: "cashier1", PIN: "3333", LocationID: "loc-id-001"}
	_, err := svc.verify(context.Background(), "member-001", nil, req)
	if err != ErrStaffLocked {
		t.Errorf("expected ErrStaffLocked, got %v", err)
	}
	// No bcrypt call should happen (no increment).
	if svc.store.incrementCount != 0 {
		t.Error("should not increment attempts for a locked account")
	}
}

func TestPinVerify_InactiveStaff_ErrStaffInactive(t *testing.T) {
	pinHash := mustHashPIN(t, "4444")
	svc := newPVTest(makeUser(false, &pinHash, nil))

	req := PinVerifyRequest{Username: "cashier1", PIN: "4444", LocationID: "loc-id-001"}
	_, err := svc.verify(context.Background(), "member-001", nil, req)
	if err != ErrStaffInactive {
		t.Errorf("expected ErrStaffInactive, got %v", err)
	}
}

func TestPinVerify_NoPINSet_ErrInvalidCredential(t *testing.T) {
	svc := newPVTest(makeUser(true, nil, nil))

	req := PinVerifyRequest{Username: "cashier1", PIN: "1234", LocationID: "loc-id-001"}
	_, err := svc.verify(context.Background(), "member-001", nil, req)
	if err != ErrInvalidCredential {
		t.Errorf("expected ErrInvalidCredential, got %v", err)
	}
}

func TestPinVerify_Lockout_After5Fails(t *testing.T) {
	pinHash := mustHashPIN(t, "correct")
	svc := newPVTest(makeUser(true, &pinHash, nil))

	wrongReq := PinVerifyRequest{Username: "cashier1", PIN: "wrong", LocationID: "loc-id-001"}
	ctx := context.Background()

	// Four wrong PINs — not yet locked.
	for i := 0; i < 4; i++ {
		_, err := svc.verify(ctx, "member-001", nil, wrongReq)
		if err != ErrInvalidCredential {
			t.Fatalf("attempt %d: expected ErrInvalidCredential, got %v", i+1, err)
		}
	}
	if svc.store.state.lockedUntilTime != nil {
		t.Fatal("should not be locked after 4 failed attempts")
	}

	// Fifth wrong PIN — triggers lockout via IncrementFailedAttempts.
	_, err := svc.verify(ctx, "member-001", nil, wrongReq)
	if err != ErrInvalidCredential {
		t.Fatalf("5th attempt: expected ErrInvalidCredential, got %v", err)
	}
	if svc.store.state.lockedUntilTime == nil {
		t.Fatal("should be locked after 5 failed attempts")
	}

	// Sixth attempt with the correct PIN — still rejected because locked.
	correctReq := PinVerifyRequest{Username: "cashier1", PIN: "correct", LocationID: "loc-id-001"}
	_, err = svc.verify(ctx, "member-001", nil, correctReq)
	if err != ErrStaffLocked {
		t.Errorf("6th attempt with correct PIN: expected ErrStaffLocked, got %v", err)
	}
}

func TestPinVerify_CapabilitiesInToken(t *testing.T) {
	pinHash := mustHashPIN(t, "5555")
	svc := newPVTest(makeUser(true, &pinHash, nil))

	caps := capsJSON(map[string]bool{"can_pos": true, "can_void": true, "can_comp": false})
	req := PinVerifyRequest{Username: "cashier1", PIN: "5555", LocationID: "loc-id-001"}
	resp, err := svc.verify(context.Background(), "member-001", caps, req)
	if err != nil {
		t.Fatalf("expected success, got %v", err)
	}

	capSet := make(map[string]bool)
	for _, c := range resp.Capabilities {
		capSet[c] = true
	}
	if !capSet["can_pos"] {
		t.Error("expected can_pos in capabilities")
	}
	if !capSet["can_void"] {
		t.Error("expected can_void in capabilities")
	}
	if capSet["can_comp"] {
		t.Error("can_comp=false should not appear in capabilities")
	}
}

func TestPinVerify_TokenParseable_AudienceActorOverlay(t *testing.T) {
	pinHash := mustHashPIN(t, "6666")
	svc := newPVTest(makeUser(true, &pinHash, nil))

	req := PinVerifyRequest{Username: "cashier1", PIN: "6666", LocationID: "loc-id-001"}
	resp, err := svc.verify(context.Background(), "member-001", nil, req)
	if err != nil {
		t.Fatalf("expected success, got %v", err)
	}

	// auth.ParseActorToken must accept the token (correct audience + secret).
	claims, err := auth.ParseActorToken(resp.ActorToken, []byte(testSecret))
	if err != nil {
		t.Fatalf("ParseActorToken failed: %v", err)
	}
	if claims.StaffID != "staff-id-001" {
		t.Errorf("StaffID: got %q, want staff-id-001", claims.StaffID)
	}
	if claims.MemberID != "member-001" {
		t.Errorf("MemberID: got %q, want member-001", claims.MemberID)
	}
	if claims.LocationID != "loc-id-001" {
		t.Errorf("LocationID: got %q, want loc-id-001", claims.LocationID)
	}
}

func TestPinVerify_StaffResponseFields(t *testing.T) {
	pinHash := mustHashPIN(t, "7777")
	svc := newPVTest(makeUser(true, &pinHash, nil))

	req := PinVerifyRequest{Username: "cashier1", PIN: "7777", LocationID: "loc-id-001"}
	resp, err := svc.verify(context.Background(), "member-001", nil, req)
	if err != nil {
		t.Fatalf("expected success, got %v", err)
	}
	if resp.Staff.ID != "staff-id-001" {
		t.Errorf("staff.id: got %q, want staff-id-001", resp.Staff.ID)
	}
	if resp.Staff.Role != "cashier" {
		t.Errorf("staff.role: got %q, want cashier", resp.Staff.Role)
	}
	if resp.Staff.DisplayName == "" {
		t.Error("staff.display_name should not be empty")
	}
}

func TestPinVerify_WrongSecret_TokenNotParseable(t *testing.T) {
	pinHash := mustHashPIN(t, "8888")
	svc := newPVTest(makeUser(true, &pinHash, nil))

	req := PinVerifyRequest{Username: "cashier1", PIN: "8888", LocationID: "loc-id-001"}
	resp, err := svc.verify(context.Background(), "member-001", nil, req)
	if err != nil {
		t.Fatalf("expected success, got %v", err)
	}

	// Token signed with testSecret should not verify with a different secret.
	_, err = auth.ParseActorToken(resp.ActorToken, []byte("wrong-secret-entirely-different"))
	if err == nil {
		t.Error("expected error with wrong secret, got nil")
	}
}
