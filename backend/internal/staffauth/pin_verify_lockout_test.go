package staffauth

// pin_verify_lockout_test.go — the two properties this file used to only
// describe.
//
// It previously held two tests that began with an unconditional t.Skip and a
// long prose argument. Both are gone, and both are replaced by an assertion:
//
//   - The audit-coverage "test" listed the six branches of Verify and said each
//     one was "verified by code reading of pin_verify.go". That is not a gate;
//     it is a comment that costs a test binary to run. It is now
//     TestVerifyWritesExactlyOneAuditRowPerBranch, which drives the real Verify
//     down all six and asserts the action each one records. It could not be
//     written before because the tests exercised a reimplementation of Verify
//     rather than Verify — see pin_verify_test.go's pvTestService.
//
//   - The lockout "test" reasoned about PostgreSQL row-level locking from the
//     SQL text. That reasoning is correct and it is also unfalsifiable by
//     anything in this package: the claim is about what the DATABASE does when
//     ten transactions hit one row, so only a database can answer it. It is now
//     TestIntegrationIncrementFailedAttemptsIsAtomic, which runs the real
//     UPDATE from ten goroutines against a real Postgres.
//
// The parallel-attack analysis the old file carried is worth keeping and is
// reproduced above the integration test, where it now sits next to the thing
// that checks it.

import (
	"context"
	"errors"
	"fmt"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/beepbite/backend/cmd/tests/testenv"
	"github.com/beepbite/backend/internal/db"
)

// ---------------------------------------------------------------------------
// Audit coverage — every branch of Verify, against the real Verify
// ---------------------------------------------------------------------------

// TestVerifyWritesExactlyOneAuditRowPerBranch pins the endpoint's audit
// contract: every outcome, success or failure, leaves exactly one audit_log
// row, and the action names the outcome.
//
// "Exactly one" matters in both directions. A branch that writes none is a PIN
// attempt that happened and cannot be reconstructed afterwards — which is the
// whole reason the endpoint audits at all. A branch that writes two makes the
// count of failures in the audit trail disagree with the count in the staff
// row, and an operator reading the trail has no way to tell which is right.
func TestVerifyWritesExactlyOneAuditRowPerBranch(t *testing.T) {
	const (
		failed = "staff.pin_overlay_failed"
		ok     = "staff.pin_overlay_verify"
	)
	pinHash := mustHashPIN(t, "1234")
	future := time.Now().UTC().Add(time.Hour)

	cases := []struct {
		branch     string
		svc        func() *pvTestService
		req        PinVerifyRequest
		wantErr    error
		wantAction string
		wantStaff  bool // is the audit row attributed to a staff id?
	}{
		{
			branch:     "username not found",
			svc:        func() *pvTestService { return newPVTest(makeUser(true, &pinHash, nil)) },
			req:        PinVerifyRequest{Username: "nobody", PIN: "1234", LocationID: "loc-id-001"},
			wantErr:    ErrInvalidCredential,
			wantAction: failed,
			// Deliberately unattributed: naming a staff id here would confirm
			// which usernames exist, which is the leak the branch avoids.
			wantStaff: false,
		},
		{
			branch:     "staff inactive",
			svc:        func() *pvTestService { return newPVTest(makeUser(false, &pinHash, nil)) },
			req:        PinVerifyRequest{Username: "cashier1", PIN: "1234", LocationID: "loc-id-001"},
			wantErr:    ErrStaffInactive,
			wantAction: failed,
			wantStaff:  true,
		},
		{
			branch:     "account locked",
			svc:        func() *pvTestService { return newPVTest(makeUser(true, &pinHash, &future)) },
			req:        PinVerifyRequest{Username: "cashier1", PIN: "1234", LocationID: "loc-id-001"},
			wantErr:    ErrStaffLocked,
			wantAction: failed,
			wantStaff:  true,
		},
		{
			branch:     "pin_hash nil",
			svc:        func() *pvTestService { return newPVTest(makeUser(true, nil, nil)) },
			req:        PinVerifyRequest{Username: "cashier1", PIN: "1234", LocationID: "loc-id-001"},
			wantErr:    ErrInvalidCredential,
			wantAction: failed,
			wantStaff:  true,
		},
		{
			branch:     "wrong PIN",
			svc:        func() *pvTestService { return newPVTest(makeUser(true, &pinHash, nil)) },
			req:        PinVerifyRequest{Username: "cashier1", PIN: "9999", LocationID: "loc-id-001"},
			wantErr:    ErrInvalidCredential,
			wantAction: failed,
			wantStaff:  true,
		},
		{
			branch:     "correct PIN (success path)",
			svc:        func() *pvTestService { return newPVTest(makeUser(true, &pinHash, nil)) },
			req:        PinVerifyRequest{Username: "cashier1", PIN: "1234", LocationID: "loc-id-001"},
			wantErr:    nil,
			wantAction: ok,
			wantStaff:  true,
		},
	}

	for _, tc := range cases {
		t.Run(tc.branch, func(t *testing.T) {
			svc := tc.svc()
			_, err := svc.verify(context.Background(), "member-001", nil, tc.req)
			if tc.wantErr == nil && err != nil {
				t.Fatalf("Verify: %v", err)
			}
			if tc.wantErr != nil && !errors.Is(err, tc.wantErr) {
				t.Fatalf("Verify = %v, want %v", err, tc.wantErr)
			}
			if len(svc.audits) != 1 {
				t.Fatalf("branch %q wrote %d audit rows, want exactly 1: %+v",
					tc.branch, len(svc.audits), svc.audits)
			}
			got := svc.audits[0]
			if got.action != tc.wantAction {
				t.Errorf("branch %q recorded action %q, want %q", tc.branch, got.action, tc.wantAction)
			}
			if got.locationID != tc.req.LocationID {
				t.Errorf("branch %q recorded location %q, want %q", tc.branch, got.locationID, tc.req.LocationID)
			}
			if tc.wantStaff && got.staffID == "" {
				t.Errorf("branch %q recorded no staff id", tc.branch)
			}
			if !tc.wantStaff && got.staffID != "" {
				t.Errorf("branch %q recorded staff id %q — an unknown username must not be "+
					"attributed, or the audit trail confirms which usernames exist", tc.branch, got.staffID)
			}
		})
	}

	// The early return for a malformed request is the one path that writes
	// nothing, and that is correct: there is no location to attribute a row to
	// and nothing was attempted against any account.
	svc := newPVTest(makeUser(true, &pinHash, nil))
	_, err := svc.verify(context.Background(), "member-001", nil, PinVerifyRequest{})
	if !errors.Is(err, ErrInvalidCredential) {
		t.Fatalf("empty request = %v, want ErrInvalidCredential", err)
	}
	if len(svc.audits) != 0 {
		t.Fatalf("an empty request wrote %d audit rows, want 0: %+v", len(svc.audits), svc.audits)
	}
}

// ---------------------------------------------------------------------------
// Lockout atomicity — against a real database
// ---------------------------------------------------------------------------

// TestIntegrationIncrementFailedAttemptsIsAtomic drives the real UPDATE from
// ten goroutines at once.
//
// The claim being checked is about PostgreSQL, not about Go. store.go's
// increment is a single statement:
//
//	UPDATE staff
//	SET failed_login_attempts = failed_login_attempts + 1,
//	    locked_until = CASE WHEN failed_login_attempts + 1 >= 5
//	                        THEN now() + '15 minutes' ELSE locked_until END,
//	    updated_at = now()
//	WHERE id = $1
//
// Each execution takes a row-level write lock, so ten concurrent attempts
// serialize rather than interleave: the counter lands on exactly 10, and the
// CASE arms exactly once — at attempt 5 — and is never cleared by attempts 6
// through 10, because the ELSE preserves whatever locked_until already held.
//
// The service-layer check in Verify reads locked_until BEFORE calling this, so
// attempts that read the row before attempt 5 commits can slip past the guard.
// That TOCTOU is real and is deliberately not what this test asserts: its
// consequence is a few extra increments and no extra lock clears, and bcrypt
// dominates the latency of a real request anyway. What must never happen is a
// lost increment or a cleared lock — which is exactly what a read-modify-write
// in Go, instead of this single UPDATE, would produce.
func TestIntegrationIncrementFailedAttemptsIsAtomic(t *testing.T) {
	ctx := context.Background()
	// Fails rather than skips when there is no database. The previous version
	// skipped "loudly", but `go test` hides skip reasons without -v and CI
	// dashboards fold skips in with passes, so the run that verified nothing was
	// indistinguishable from the run that verified atomicity.
	pool := testenv.RequirePostgres(t, ctx)

	staffID := seedStaffRow(t, pool)
	store := NewStore(pool)

	const attempts = 10
	var wg sync.WaitGroup
	errs := make([]error, attempts)
	start := make(chan struct{})
	for i := range attempts {
		wg.Add(1)
		go func() {
			defer wg.Done()
			<-start // release them together, so the UPDATEs genuinely contend
			errs[i] = store.IncrementFailedAttempts(ctx, staffID)
		}()
	}
	close(start)
	wg.Wait()

	for i, err := range errs {
		if err != nil {
			t.Fatalf("increment %d: %v", i, err)
		}
	}

	failed, lockedUntil := readStaffLockState(t, pool, staffID)
	if failed != attempts {
		t.Fatalf("failed_login_attempts = %d after %d concurrent increments, want %d — "+
			"a lost update means the lockout threshold can be walked past", failed, attempts, attempts)
	}
	if lockedUntil == nil {
		t.Fatalf("locked_until is NULL after %d failures against a threshold of %d — "+
			"the account never locked", attempts, lockoutThreshold)
	}
	if !lockedUntil.After(time.Now().UTC()) {
		t.Fatalf("locked_until is %s, already in the past", lockedUntil)
	}

	// Below the threshold nothing locks. Without this the assertions above
	// would pass for an implementation that locks on every single failure.
	other := seedStaffRow(t, pool)
	for range lockoutThreshold - 1 {
		if err := store.IncrementFailedAttempts(ctx, other); err != nil {
			t.Fatalf("increment: %v", err)
		}
	}
	failed, lockedUntil = readStaffLockState(t, pool, other)
	if failed != lockoutThreshold-1 || lockedUntil != nil {
		t.Fatalf("after %d failures: attempts=%d locked_until=%v, want %d and NULL",
			lockoutThreshold-1, failed, lockedUntil, lockoutThreshold-1)
	}
}

// readStaffLockState reads the two columns the lockout is made of.
func readStaffLockState(t *testing.T, pool *pgxpool.Pool, staffID string) (int, *time.Time) {
	t.Helper()
	ctx := context.Background()
	var failed int
	var lockedUntil *time.Time
	err := db.Scoped(ctx, pool, db.ServiceRoleScope(), func(tx pgx.Tx) error {
		return tx.QueryRow(ctx,
			`SELECT failed_login_attempts, locked_until FROM staff WHERE id = $1`, staffID,
		).Scan(&failed, &lockedUntil)
	})
	if err != nil {
		t.Fatalf("reading the staff row: %v", err)
	}
	return failed, lockedUntil
}

// seedStaffRow inserts an organization, a location and one staff row, and
// returns the staff id. Everything cascades from the organization on cleanup.
func seedStaffRow(t *testing.T, pool *pgxpool.Pool) string {
	t.Helper()
	ctx := context.Background()
	unique := time.Now().UnixNano()

	var orgID, locID, staffID string
	err := db.Scoped(ctx, pool, db.ServiceRoleScope(), func(tx pgx.Tx) error {
		if err := tx.QueryRow(ctx,
			`INSERT INTO organizations (name) VALUES ($1) RETURNING id`,
			fmt.Sprintf("Lockout Test Org %d", unique),
		).Scan(&orgID); err != nil {
			return err
		}
		if err := tx.QueryRow(ctx,
			`INSERT INTO locations (organization_id, name) VALUES ($1, 'Lockout Test Location') RETURNING id`,
			orgID,
		).Scan(&locID); err != nil {
			return err
		}
		return tx.QueryRow(ctx, `
INSERT INTO staff (location_id, first_name, last_name, role, username)
VALUES ($1, 'Cash', 'Ier', 'cashier', $2)
RETURNING id`,
			locID, fmt.Sprintf("cashier-%d", unique),
		).Scan(&staffID)
	})
	if err != nil {
		t.Fatalf("seeding staff: %v", err)
	}

	t.Cleanup(func() {
		bg := context.Background()
		_ = db.Scoped(bg, pool, db.ServiceRoleScope(), func(tx pgx.Tx) error {
			_, err := tx.Exec(bg, `DELETE FROM organizations WHERE id = $1`, orgID)
			return err
		})
	})
	return staffID
}
