package whatsapplink_test

// DB-backed integration tests for Store.
//
// Run:
//
//	cd backend && go test ./internal/handlers/whatsapplink/ -run Integration -v
//
// The tests start an ephemeral Postgres via testenv.StartPostgres (Docker
// testcontainers → local scratch DB → ErrSkip). Each test seeds a fresh
// auth_users + profiles row (via the SECURITY DEFINER handle_new_user trigger)
// under ServiceRoleScope, plus unique phone numbers, to avoid any cross-test
// interference.

import (
	"context"
	"errors"
	"fmt"
	"log"
	"os"
	"testing"
	"time"

	"github.com/beepbite/backend/cmd/tests/testenv"
	"github.com/beepbite/backend/internal/db"
	"github.com/beepbite/backend/internal/handlers/whatsapplink"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// ---------------------------------------------------------------------------
// Package-level pool (shared across all Integration* tests).
// ---------------------------------------------------------------------------

var testPool *pgxpool.Pool

func TestMain(m *testing.M) {
	ctx := context.Background()
	pool, cleanup, err := testenv.StartPostgres(ctx)
	if errors.Is(err, testenv.ErrSkip) {
		fmt.Println("skipping integration tests:", err)
		os.Exit(0)
	}
	if err != nil {
		log.Fatal(err)
	}
	defer cleanup()
	testPool = pool
	os.Exit(m.Run())
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// seedProfile inserts an auth_users row (the SECURITY DEFINER trigger
// handle_new_user auto-creates the matching profiles row) and returns the
// profile UUID that should be used as the profileID in store calls.
func seedProfile(t *testing.T, ctx context.Context, pool *pgxpool.Pool, emailTag string) string {
	t.Helper()
	email := fmt.Sprintf("whatsapplink-test-%s-%d@example.com", emailTag, time.Now().UnixNano())
	var userID string
	err := db.Scoped(ctx, pool, db.ServiceRoleScope(), func(tx pgx.Tx) error {
		return tx.QueryRow(ctx, `
			INSERT INTO auth_users (email, password_hash, email_verified)
			VALUES ($1, 'x', true)
			RETURNING id
		`, email).Scan(&userID)
	})
	if err != nil {
		t.Fatalf("seedProfile: insert auth_users: %v", err)
	}
	// Confirm the trigger auto-created the profile row.
	var profileID string
	err = db.Scoped(ctx, pool, db.ServiceRoleScope(), func(tx pgx.Tx) error {
		return tx.QueryRow(ctx, `SELECT id FROM profiles WHERE id = $1`, userID).Scan(&profileID)
	})
	if err != nil {
		t.Fatalf("seedProfile: profile not auto-created by trigger: %v", err)
	}
	t.Cleanup(func() {
		// Deleting auth_users cascades to profiles → whatsapp_account_links.
		_ = db.Scoped(context.Background(), pool, db.ServiceRoleScope(), func(tx pgx.Tx) error {
			_, err := tx.Exec(context.Background(), `DELETE FROM auth_users WHERE id = $1`, userID)
			return err
		})
	})
	return profileID
}

// uniquePhone returns a synthetic E.164 phone number that is unique per call.
func uniquePhone(tag string) string {
	return fmt.Sprintf("+2760%07d", time.Now().UnixNano()%10_000_000) + tag[:1]
}

// forceExpireToken back-dates a token's expires_at so it looks expired.
func forceExpireToken(t *testing.T, ctx context.Context, pool *pgxpool.Pool, token string) {
	t.Helper()
	err := db.Scoped(ctx, pool, db.ServiceRoleScope(), func(tx pgx.Tx) error {
		_, err := tx.Exec(ctx, `
			UPDATE whatsapp_link_tokens SET expires_at = now() - interval '1 hour'
			WHERE token = $1
		`, token)
		return err
	})
	if err != nil {
		t.Fatalf("forceExpireToken: %v", err)
	}
}

// ---------------------------------------------------------------------------
// Test 1 — IssueLinkToken + GetPendingPhone round-trip
// ---------------------------------------------------------------------------

func TestIntegration_IssueLinkToken_RoundTrip(t *testing.T) {
	ctx := context.Background()
	store := whatsapplink.NewStore(testPool)

	phone := fmt.Sprintf("+2761%010d", time.Now().UnixNano()%10_000_000_000)

	lt, err := store.IssueLinkToken(ctx, phone)
	if err != nil {
		t.Fatalf("IssueLinkToken: %v", err)
	}
	if lt.Token == "" {
		t.Fatal("IssueLinkToken returned empty token")
	}
	if lt.PhoneE164 != phone {
		t.Errorf("IssueLinkToken phone mismatch: got %q want %q", lt.PhoneE164, phone)
	}
	if lt.ExpiresAt.Before(time.Now()) {
		t.Errorf("IssueLinkToken ExpiresAt is in the past: %v", lt.ExpiresAt)
	}

	got, err := store.GetPendingPhone(ctx, lt.Token)
	if err != nil {
		t.Fatalf("GetPendingPhone: %v", err)
	}
	if got.PhoneE164 != phone {
		t.Errorf("GetPendingPhone phone mismatch: got %q want %q", got.PhoneE164, phone)
	}
	t.Logf("PASS: token=%s phone=%s expires=%v", lt.Token, got.PhoneE164, got.ExpiresAt)
}

// ---------------------------------------------------------------------------
// Test 2 — BindPhone consumes the token (single-use)
// ---------------------------------------------------------------------------

func TestIntegration_BindPhone_TokenConsumed(t *testing.T) {
	ctx := context.Background()
	store := whatsapplink.NewStore(testPool)
	profileID := seedProfile(t, ctx, testPool, "bindconsumed")

	phone := fmt.Sprintf("+2762%010d", time.Now().UnixNano()%10_000_000_000)

	lt, err := store.IssueLinkToken(ctx, phone)
	if err != nil {
		t.Fatalf("IssueLinkToken: %v", err)
	}

	// First bind must succeed.
	link, err := store.BindPhone(ctx, lt.Token, profileID)
	if err != nil {
		t.Fatalf("BindPhone (first): %v", err)
	}
	if link.PhoneE164 != phone {
		t.Errorf("BindPhone phone mismatch: got %q want %q", link.PhoneE164, phone)
	}

	// GetPendingPhone must now return ErrTokenConsumed.
	_, err = store.GetPendingPhone(ctx, lt.Token)
	if !errors.Is(err, whatsapplink.ErrTokenConsumed) {
		t.Errorf("GetPendingPhone after bind: expected ErrTokenConsumed, got %v", err)
	}

	// BindPhone again must also return ErrTokenConsumed.
	_, err = store.BindPhone(ctx, lt.Token, profileID)
	if !errors.Is(err, whatsapplink.ErrTokenConsumed) {
		t.Errorf("BindPhone (second): expected ErrTokenConsumed, got %v", err)
	}
	t.Logf("PASS: token is single-use; second call returns ErrTokenConsumed")
}

// ---------------------------------------------------------------------------
// Test 3 — Expired token → ErrTokenExpired
// ---------------------------------------------------------------------------

func TestIntegration_GetPendingPhone_Expired(t *testing.T) {
	ctx := context.Background()
	store := whatsapplink.NewStore(testPool)

	phone := fmt.Sprintf("+2763%010d", time.Now().UnixNano()%10_000_000_000)

	lt, err := store.IssueLinkToken(ctx, phone)
	if err != nil {
		t.Fatalf("IssueLinkToken: %v", err)
	}

	// Manually back-date the token so it is already expired.
	forceExpireToken(t, ctx, testPool, lt.Token)

	_, err = store.GetPendingPhone(ctx, lt.Token)
	if !errors.Is(err, whatsapplink.ErrTokenExpired) {
		t.Errorf("GetPendingPhone expired token: expected ErrTokenExpired, got %v", err)
	}
	t.Logf("PASS: expired token returns ErrTokenExpired")
}

// ---------------------------------------------------------------------------
// Test 4 — 3-number cap: 4th bind → ErrAtCap
// ---------------------------------------------------------------------------

func TestIntegration_BindPhone_AtCap(t *testing.T) {
	ctx := context.Background()
	store := whatsapplink.NewStore(testPool)
	profileID := seedProfile(t, ctx, testPool, "atcap")

	nano := time.Now().UnixNano()
	phones := []string{
		fmt.Sprintf("+2764%010d", nano%10_000_000_000),
		fmt.Sprintf("+2765%010d", (nano+1)%10_000_000_000),
		fmt.Sprintf("+2766%010d", (nano+2)%10_000_000_000),
		fmt.Sprintf("+2767%010d", (nano+3)%10_000_000_000),
	}

	// Bind first 3 — all must succeed.
	for i, ph := range phones[:3] {
		lt, err := store.IssueLinkToken(ctx, ph)
		if err != nil {
			t.Fatalf("IssueLinkToken[%d]: %v", i, err)
		}
		_, err = store.BindPhone(ctx, lt.Token, profileID)
		if err != nil {
			t.Fatalf("BindPhone[%d]: %v", i, err)
		}
	}

	// 4th bind must fail with ErrAtCap.
	lt, err := store.IssueLinkToken(ctx, phones[3])
	if err != nil {
		t.Fatalf("IssueLinkToken[3]: %v", err)
	}
	_, err = store.BindPhone(ctx, lt.Token, profileID)
	if !errors.Is(err, whatsapplink.ErrAtCap) {
		t.Errorf("4th BindPhone: expected ErrAtCap, got %v", err)
	}
	t.Logf("PASS: 4th bind returns ErrAtCap")
}

// ---------------------------------------------------------------------------
// Test 5 — Duplicate phone across profiles → ErrDuplicatePhone
// ---------------------------------------------------------------------------

func TestIntegration_BindPhone_DuplicatePhone(t *testing.T) {
	ctx := context.Background()
	store := whatsapplink.NewStore(testPool)

	profileA := seedProfile(t, ctx, testPool, "dupA")
	profileB := seedProfile(t, ctx, testPool, "dupB")

	phone := fmt.Sprintf("+2768%010d", time.Now().UnixNano()%10_000_000_000)

	// Bind to profile A — must succeed.
	ltA, err := store.IssueLinkToken(ctx, phone)
	if err != nil {
		t.Fatalf("IssueLinkToken A: %v", err)
	}
	_, err = store.BindPhone(ctx, ltA.Token, profileA)
	if err != nil {
		t.Fatalf("BindPhone A: %v", err)
	}

	// Issue a second token for the same phone (same E.164 number).
	ltB, err := store.IssueLinkToken(ctx, phone)
	if err != nil {
		t.Fatalf("IssueLinkToken B: %v", err)
	}

	// Binding the same phone to profile B must return ErrDuplicatePhone.
	_, err = store.BindPhone(ctx, ltB.Token, profileB)
	if !errors.Is(err, whatsapplink.ErrDuplicatePhone) {
		t.Errorf("duplicate phone bind: expected ErrDuplicatePhone, got %v", err)
	}
	t.Logf("PASS: same phone bound to second profile returns ErrDuplicatePhone")
}

// ---------------------------------------------------------------------------
// Test 6 — ListLinks returns the profile's bound numbers under user scope
// ---------------------------------------------------------------------------

func TestIntegration_ListLinks(t *testing.T) {
	ctx := context.Background()
	store := whatsapplink.NewStore(testPool)
	profileID := seedProfile(t, ctx, testPool, "listlinks")

	nano := time.Now().UnixNano()
	wantPhones := []string{
		fmt.Sprintf("+2769%010d", nano%10_000_000_000),
		fmt.Sprintf("+2770%010d", (nano+1)%10_000_000_000),
	}

	// Bind two phones to the profile.
	for i, ph := range wantPhones {
		lt, err := store.IssueLinkToken(ctx, ph)
		if err != nil {
			t.Fatalf("IssueLinkToken[%d]: %v", i, err)
		}
		_, err = store.BindPhone(ctx, lt.Token, profileID)
		if err != nil {
			t.Fatalf("BindPhone[%d]: %v", i, err)
		}
	}

	links, err := store.ListLinks(ctx, profileID)
	if err != nil {
		t.Fatalf("ListLinks: %v", err)
	}
	if len(links) != len(wantPhones) {
		t.Fatalf("ListLinks: got %d links, want %d", len(links), len(wantPhones))
	}

	// Build a set of returned phones for easy lookup.
	got := make(map[string]bool, len(links))
	for _, l := range links {
		if l.ProfileID != profileID {
			t.Errorf("ListLinks: link.ProfileID=%q != profileID=%q", l.ProfileID, profileID)
		}
		got[l.PhoneE164] = true
	}
	for _, ph := range wantPhones {
		if !got[ph] {
			t.Errorf("ListLinks: phone %q not found in returned links", ph)
		}
	}
	t.Logf("PASS: ListLinks returned %d links for profile %s", len(links), profileID)
}
