package twofa

// DB-backed integration tests for Store.
//
// Relies on cmd/tests/testenv to spin up an ephemeral, fully-migrated Postgres
// (migration 044 adds auth_users.totp_secret_ciphertext, totp_enabled, and the
// user_backup_codes table).
//
// All rows are seeded via db.ServiceRoleScope() to bypass FORCE RLS.
// Each test creates its own unique auth_users + profiles pair so tests are
// fully isolated and can run in parallel.

import (
	"context"
	"errors"
	"fmt"
	"log"
	"os"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/beepbite/backend/cmd/tests/testenv"
	"github.com/beepbite/backend/internal/db"
	"github.com/beepbite/backend/internal/secretbox"
)

// ---------------------------------------------------------------------------
// Package-level pool (shared across all tests in this package).
// ---------------------------------------------------------------------------

var testPool *pgxpool.Pool

func TestMain(m *testing.M) {
	ctx := context.Background()
	pool, cleanup, err := testenv.StartPostgres(ctx)
	if errors.Is(err, testenv.ErrSkip) {
		fmt.Println("skipping integration tests: no postgres backend available:", err)
		os.Exit(0)
	}
	if err != nil {
		log.Fatal("testenv.StartPostgres:", err)
	}
	defer cleanup()
	testPool = pool
	os.Exit(m.Run())
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// testBox builds a secretbox.Box from a fixed 32-byte test key.
func testBox(t *testing.T) *secretbox.Box {
	t.Helper()
	// 32 ASCII chars — satisfies the raw-32-byte branch of decodeKey.
	box, err := secretbox.New("test-key-must-be-exactly-32bytes")
	if err != nil {
		t.Fatalf("secretbox.New: %v", err)
	}
	return box
}

// seedUser inserts a unique auth_users row using ServiceRoleScope so FORCE RLS
// does not block the insert. It returns the new user's UUID string.
//
// The handle_new_user AFTER INSERT trigger on auth_users automatically inserts
// the companion profiles row, so we do NOT insert profiles manually here.
func seedUser(t *testing.T, ctx context.Context, pool *pgxpool.Pool) string {
	t.Helper()
	var userID string
	// Use a random suffix to guarantee email uniqueness across parallel tests
	// and repeated runs against the same scratch DB.
	email := fmt.Sprintf("twofa-test-%d-%p@example.com", os.Getpid(), t)
	err := db.Scoped(ctx, pool, db.ServiceRoleScope(), func(tx pgx.Tx) error {
		// Insert into auth_users; let Postgres generate the UUID.
		// The AFTER INSERT trigger handle_new_user() automatically creates the
		// companion profiles row (which user_backup_codes references via FK).
		if err := tx.QueryRow(ctx,
			`INSERT INTO auth_users (email, email_verified)
			 VALUES ($1, true)
			 RETURNING id`,
			email,
		).Scan(&userID); err != nil {
			return fmt.Errorf("insert auth_users: %w", err)
		}
		return nil
	})
	if err != nil {
		t.Fatalf("seedUser: %v", err)
	}
	return userID
}

// newStore returns a Store wired to testPool with a fixed test secretbox key.
func newStore(t *testing.T) *Store {
	t.Helper()
	return NewStore(testPool, testBox(t))
}

// ---------------------------------------------------------------------------
// Test 1: StorePendingSecret / LoadPendingSecret round-trip
// ---------------------------------------------------------------------------

func TestIntegration_StorePendingSecret_RoundTrip(t *testing.T) {
	ctx := context.Background()
	s := newStore(t)
	userID := seedUser(t, ctx, testPool)

	const plainSecret = "JBSWY3DPEHPK3PXP" // example base32 TOTP secret

	// Store it.
	if err := s.StorePendingSecret(ctx, userID, plainSecret); err != nil {
		t.Fatalf("StorePendingSecret: %v", err)
	}

	// Verify that the DB column holds ciphertext (not the plaintext).
	var storedCT string
	err := db.Scoped(ctx, testPool, db.ServiceRoleScope(), func(tx pgx.Tx) error {
		return tx.QueryRow(ctx,
			`SELECT totp_secret_ciphertext FROM auth_users WHERE id = $1`,
			userID,
		).Scan(&storedCT)
	})
	if err != nil {
		t.Fatalf("read totp_secret_ciphertext: %v", err)
	}
	if storedCT == plainSecret {
		t.Errorf("DB stored plaintext instead of ciphertext: %q", storedCT)
	}
	if storedCT == "" {
		t.Error("DB totp_secret_ciphertext is empty after StorePendingSecret")
	}

	// Load it back — must decrypt to the original plaintext.
	got, err := s.LoadPendingSecret(ctx, userID)
	if err != nil {
		t.Fatalf("LoadPendingSecret: %v", err)
	}
	if got != plainSecret {
		t.Errorf("LoadPendingSecret = %q; want %q", got, plainSecret)
	}
}

// LoadPendingSecret on a user with no stored secret must return ErrTOTPNotEnrolled.
func TestIntegration_LoadPendingSecret_NotEnrolled(t *testing.T) {
	ctx := context.Background()
	s := newStore(t)
	userID := seedUser(t, ctx, testPool)

	_, err := s.LoadPendingSecret(ctx, userID)
	if !errors.Is(err, ErrTOTPNotEnrolled) {
		t.Errorf("expected ErrTOTPNotEnrolled, got %v", err)
	}
}

// LoadPendingSecret on a non-existent user must return ErrUserNotFound.
func TestIntegration_LoadPendingSecret_UserNotFound(t *testing.T) {
	ctx := context.Background()
	s := newStore(t)
	const nonExistentID = "00000000-0000-0000-0000-000000000000"

	_, err := s.LoadPendingSecret(ctx, nonExistentID)
	if !errors.Is(err, ErrUserNotFound) {
		t.Errorf("expected ErrUserNotFound, got %v", err)
	}
}

// ---------------------------------------------------------------------------
// Test 2: EnableTOTP + GetStatus
// ---------------------------------------------------------------------------

func TestIntegration_EnableTOTP_SetsEnabledAndBackupCodes(t *testing.T) {
	ctx := context.Background()
	s := newStore(t)
	userID := seedUser(t, ctx, testPool)

	// First store a pending secret (EnableTOTP does not require one, but
	// callers in production always do this first).
	if err := s.StorePendingSecret(ctx, userID, "SECRETVALUE12345"); err != nil {
		t.Fatalf("StorePendingSecret: %v", err)
	}

	codes, err := s.EnableTOTP(ctx, userID)
	if err != nil {
		t.Fatalf("EnableTOTP: %v", err)
	}
	if len(codes) == 0 {
		t.Fatal("EnableTOTP returned zero backup codes")
	}

	// GetStatus must reflect enabled=true and backup_codes_remaining == len(codes).
	st, err := s.GetStatus(ctx, userID)
	if err != nil {
		t.Fatalf("GetStatus: %v", err)
	}
	if !st.Enabled {
		t.Error("GetStatus.Enabled = false; want true after EnableTOTP")
	}
	if st.BackupCount != len(codes) {
		t.Errorf("GetStatus.BackupCount = %d; want %d", st.BackupCount, len(codes))
	}
}

// EnableTOTP on a non-existent user must return ErrUserNotFound.
func TestIntegration_EnableTOTP_UserNotFound(t *testing.T) {
	ctx := context.Background()
	s := newStore(t)
	const nonExistentID = "00000000-0000-0000-0000-000000000001"

	_, err := s.EnableTOTP(ctx, nonExistentID)
	if !errors.Is(err, ErrUserNotFound) {
		t.Errorf("expected ErrUserNotFound, got %v", err)
	}
}

// ---------------------------------------------------------------------------
// Test 3: RedeemBackupCode — valid once, reuse fails, unknown fails
// ---------------------------------------------------------------------------

func TestIntegration_RedeemBackupCode(t *testing.T) {
	ctx := context.Background()
	s := newStore(t)
	userID := seedUser(t, ctx, testPool)

	// Enable TOTP so we have backup codes to work with.
	if err := s.StorePendingSecret(ctx, userID, "SECRETVALUE67890"); err != nil {
		t.Fatalf("StorePendingSecret: %v", err)
	}
	codes, err := s.EnableTOTP(ctx, userID)
	if err != nil {
		t.Fatalf("EnableTOTP: %v", err)
	}
	if len(codes) == 0 {
		t.Fatal("need at least one backup code")
	}

	target := codes[0]

	// First redemption: must succeed.
	if err := s.RedeemBackupCode(ctx, userID, target); err != nil {
		t.Fatalf("RedeemBackupCode (first use): %v", err)
	}

	// Second redemption of the SAME code: must fail with ErrBackupCodeBad.
	if err := s.RedeemBackupCode(ctx, userID, target); !errors.Is(err, ErrBackupCodeBad) {
		t.Errorf("RedeemBackupCode (second use): expected ErrBackupCodeBad, got %v", err)
	}

	// Unknown code: must fail with ErrBackupCodeBad.
	if err := s.RedeemBackupCode(ctx, userID, "NOTACODE"); !errors.Is(err, ErrBackupCodeBad) {
		t.Errorf("RedeemBackupCode (unknown): expected ErrBackupCodeBad, got %v", err)
	}

	// Verify that backup_codes_remaining decreased by 1.
	st, err := s.GetStatus(ctx, userID)
	if err != nil {
		t.Fatalf("GetStatus after redemption: %v", err)
	}
	want := len(codes) - 1
	if st.BackupCount != want {
		t.Errorf("GetStatus.BackupCount = %d; want %d after redeeming one code", st.BackupCount, want)
	}
}

// ---------------------------------------------------------------------------
// Test 4: DisableTOTP
// ---------------------------------------------------------------------------

func TestIntegration_DisableTOTP(t *testing.T) {
	ctx := context.Background()
	s := newStore(t)
	userID := seedUser(t, ctx, testPool)

	// Enable TOTP first.
	if err := s.StorePendingSecret(ctx, userID, "SECRETVALUEXYZAB"); err != nil {
		t.Fatalf("StorePendingSecret: %v", err)
	}
	if _, err := s.EnableTOTP(ctx, userID); err != nil {
		t.Fatalf("EnableTOTP: %v", err)
	}
	st, _ := s.GetStatus(ctx, userID)
	if !st.Enabled {
		t.Fatal("expected TOTP enabled before DisableTOTP test")
	}

	// Disable it.
	if err := s.DisableTOTP(ctx, userID); err != nil {
		t.Fatalf("DisableTOTP: %v", err)
	}

	// GetStatus must reflect enabled=false.
	st2, err := s.GetStatus(ctx, userID)
	if err != nil {
		t.Fatalf("GetStatus after disable: %v", err)
	}
	if st2.Enabled {
		t.Error("GetStatus.Enabled = true; want false after DisableTOTP")
	}
	// Enrolled must also be false (ciphertext cleared).
	if st2.Enrolled {
		t.Error("GetStatus.Enrolled = true; want false after DisableTOTP")
	}
	// Backup codes must be gone.
	if st2.BackupCount != 0 {
		t.Errorf("GetStatus.BackupCount = %d; want 0 after DisableTOTP", st2.BackupCount)
	}

	// LoadPendingSecret must now return ErrTOTPNotEnrolled (ciphertext is NULL).
	_, err = s.LoadPendingSecret(ctx, userID)
	if !errors.Is(err, ErrTOTPNotEnrolled) {
		t.Errorf("expected ErrTOTPNotEnrolled after DisableTOTP, got %v", err)
	}
}

// DisableTOTP on a non-existent user must return ErrUserNotFound.
func TestIntegration_DisableTOTP_UserNotFound(t *testing.T) {
	ctx := context.Background()
	s := newStore(t)
	const nonExistentID = "00000000-0000-0000-0000-000000000002"

	err := s.DisableTOTP(ctx, nonExistentID)
	if !errors.Is(err, ErrUserNotFound) {
		t.Errorf("expected ErrUserNotFound, got %v", err)
	}
}
