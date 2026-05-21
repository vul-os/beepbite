package userprefs

// DB-backed integration tests for the userprefs Store.
//
// Run:
//
//	cd /home/exo/Documents/beepbite-mono/backend
//	go test ./internal/handlers/userprefs/ -run Integration -v
//
// Tests are skipped automatically when no Postgres backend is available
// (Docker absent and DATABASE_URL/TEST_DATABASE_URL unset) via
// testenv.ErrSkip → os.Exit(0).
//
// Covered behaviours:
//  1. Get on a profile with no prefs row → ErrNotFound.
//  2. Upsert then Get round-trip; second partial Upsert preserves existing
//     columns via COALESCE (the key "no-clobber" invariant).
//  3. RLS owner-only: profile-B's scope cannot read profile-A's prefs row.

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
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// ---------------------------------------------------------------------------
// Package-level state — set once in TestMain, shared across Integration* tests
// ---------------------------------------------------------------------------

var integrationPool *pgxpool.Pool

func TestMain(m *testing.M) {
	ctx := context.Background()
	pool, cleanup, err := testenv.StartPostgres(ctx)
	if errors.Is(err, testenv.ErrSkip) {
		fmt.Println("skipping integration tests: no postgres available:", err)
		os.Exit(0)
	}
	if err != nil {
		log.Fatal("testenv.StartPostgres:", err)
	}
	defer cleanup()
	integrationPool = pool
	os.Exit(m.Run())
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// strPtr is a convenience helper for creating *string literals.
func strPtr(s string) *string { return &s }

// seedProfile inserts an auth_users row via service-role and returns the
// resulting profile UUID. The on_auth_user_created trigger (migration 002)
// automatically creates the corresponding profiles row, so we must NOT
// insert it explicitly.
// Cleanup deletes the auth_users row on t.Cleanup; the CASCADE removes the
// profiles row and any user_preferences rows.
func seedProfile(t *testing.T, ctx context.Context, pool *pgxpool.Pool, label string) string {
	t.Helper()
	email := fmt.Sprintf("userprefs-%s-%d@test.invalid", label, time.Now().UnixNano())

	var profileID string
	err := db.Scoped(ctx, pool, db.ServiceRoleScope(), func(tx pgx.Tx) error {
		// The on_auth_user_created trigger auto-creates a profiles row.
		return tx.QueryRow(ctx,
			`INSERT INTO auth_users (email, password_hash, email_verified)
			 VALUES ($1, 'x', true) RETURNING id`,
			email,
		).Scan(&profileID)
	})
	if err != nil {
		t.Fatalf("seedProfile %q: insert auth_user: %v", label, err)
	}

	// Cleanup: deleting auth_users cascades to profiles → user_preferences.
	t.Cleanup(func() {
		bg := context.Background()
		_ = db.Scoped(bg, pool, db.ServiceRoleScope(), func(tx pgx.Tx) error {
			_, err := tx.Exec(bg, `DELETE FROM auth_users WHERE id = $1`, profileID)
			return err
		})
	})

	return profileID
}

// ---------------------------------------------------------------------------
// 1. Get on a profile with no prefs row → ErrNotFound
// ---------------------------------------------------------------------------

func TestIntegration_Get_NoRow_ReturnsErrNotFound(t *testing.T) {
	ctx := context.Background()
	profileID := seedProfile(t, ctx, integrationPool, "no-row")

	store := NewStore(integrationPool)
	_, err := store.Get(ctx, profileID)
	if !errors.Is(err, ErrNotFound) {
		t.Fatalf("Get with no prefs row: want ErrNotFound, got %v", err)
	}
}

// ---------------------------------------------------------------------------
// 2. Upsert → Get round-trip + partial update (COALESCE no-clobber)
// ---------------------------------------------------------------------------

func TestIntegration_Upsert_PartialUpdate_NoCoalesce(t *testing.T) {
	ctx := context.Background()
	profileID := seedProfile(t, ctx, integrationPool, "upsert")

	store := NewStore(integrationPool)

	// --- 2a. First Upsert: set only last_view_pos ---
	prefs, err := store.Upsert(ctx, profileID, UpdateReq{
		LastViewPOS: strPtr("full"),
	})
	if err != nil {
		t.Fatalf("Upsert (first): %v", err)
	}
	if prefs.ProfileID != profileID {
		t.Errorf("ProfileID: want %q got %q", profileID, prefs.ProfileID)
	}
	if prefs.LastViewPOS == nil || *prefs.LastViewPOS != "full" {
		t.Errorf("LastViewPOS after first upsert: want %q got %v", "full", prefs.LastViewPOS)
	}
	if prefs.LastViewKDS != nil {
		t.Errorf("LastViewKDS after first upsert: want nil got %v", prefs.LastViewKDS)
	}

	// --- 2b. Get confirms the row is visible ---
	got, err := store.Get(ctx, profileID)
	if err != nil {
		t.Fatalf("Get after first Upsert: %v", err)
	}
	if got.LastViewPOS == nil || *got.LastViewPOS != "full" {
		t.Errorf("Get LastViewPOS: want %q got %v", "full", got.LastViewPOS)
	}
	if got.LastViewKDS != nil {
		t.Errorf("Get LastViewKDS: want nil got %v", got.LastViewKDS)
	}

	// --- 2c. Second Upsert: set only last_view_kds; last_view_pos must be preserved ---
	prefs2, err := store.Upsert(ctx, profileID, UpdateReq{
		LastViewKDS: strPtr("expo"),
	})
	if err != nil {
		t.Fatalf("Upsert (partial): %v", err)
	}
	// Key invariant: COALESCE must keep last_view_pos="full" untouched.
	if prefs2.LastViewPOS == nil || *prefs2.LastViewPOS != "full" {
		t.Errorf("COALESCE failed: LastViewPOS after partial upsert: want %q got %v", "full", prefs2.LastViewPOS)
	}
	if prefs2.LastViewKDS == nil || *prefs2.LastViewKDS != "expo" {
		t.Errorf("LastViewKDS after partial upsert: want %q got %v", "expo", prefs2.LastViewKDS)
	}

	// --- 2d. Final Get confirms both columns are set ---
	final, err := store.Get(ctx, profileID)
	if err != nil {
		t.Fatalf("Get after partial Upsert: %v", err)
	}
	if final.LastViewPOS == nil || *final.LastViewPOS != "full" {
		t.Errorf("final Get LastViewPOS: want %q got %v", "full", final.LastViewPOS)
	}
	if final.LastViewKDS == nil || *final.LastViewKDS != "expo" {
		t.Errorf("final Get LastViewKDS: want %q got %v", "expo", final.LastViewKDS)
	}
}

// ---------------------------------------------------------------------------
// 3. RLS owner-only: profile-B's scope cannot read profile-A's prefs row
// ---------------------------------------------------------------------------

func TestIntegration_RLS_CrossUser_ReturnsErrNotFound(t *testing.T) {
	ctx := context.Background()
	profileA := seedProfile(t, ctx, integrationPool, "rls-owner-a")
	profileB := seedProfile(t, ctx, integrationPool, "rls-reader-b")

	store := NewStore(integrationPool)

	// Seed a prefs row for profile-A.
	if _, err := store.Upsert(ctx, profileA, UpdateReq{LastViewPOS: strPtr("quick")}); err != nil {
		t.Fatalf("Upsert (profile-A): %v", err)
	}

	// Confirm profile-A can read their own row.
	if _, err := store.Get(ctx, profileA); err != nil {
		t.Fatalf("Get (profile-A self): %v", err)
	}

	// Profile-B tries to read profile-A's prefs via the Store.
	// Store.Get sets Scope{UserID: profileID} from the argument, so passing
	// profileA as the argument means the user-scoped transaction sets
	// app.current_user_id = profileA, which would allow the read. Instead,
	// to test RLS isolation we call Get with profileA's ID but force the
	// session to identify as profileB — simulating a caller who supplies
	// a foreign profileID.
	//
	// We do this by running the raw SELECT directly under profileB's scope.
	// This is the exact RLS predicate that matters: can profile-B's session
	// see profile-A's row?
	var count int
	err := db.Scoped(ctx, integrationPool, db.Scope{UserID: profileB}, func(tx pgx.Tx) error {
		return tx.QueryRow(ctx,
			`SELECT count(*) FROM user_preferences WHERE profile_id = $1`,
			profileA,
		).Scan(&count)
	})
	if err != nil {
		t.Fatalf("RLS isolation query: %v", err)
	}
	if count != 0 {
		t.Errorf("RLS violation: profile-B can see profile-A's prefs row (count=%d)", count)
	}
}
