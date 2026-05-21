// Package legal — DB-backed integration tests for Store.
//
// Run:
//
//	cd backend && go test ./internal/handlers/legal/ -run Integration -v
//
// The tests spin up an ephemeral Postgres via testenv.StartPostgres, seed
// isolated fixtures with ServiceRoleScope (bypassing RLS), and exercise every
// Store method against the real schema (migrations applied up to 045_legal_acceptances).
//
// # Known store bug (documented here, NOT fixed in this file)
//
// GetCurrentDocument uses `effective_at <= timezone('utc', now())` in its query.
// `timezone('utc', now())` returns a `timestamp without time zone` (the UTC wall-
// clock digits stripped of timezone info). When PostgreSQL compares a
// `timestamptz` column with a `timestamp`, it converts the timestamp to
// `timestamptz` using the *session timezone*, NOT UTC. On a server running in
// SAST (+0200) the threshold is effectively `now_utc - 2h`, causing documents
// with effective_at within the last 2 hours to appear "in the future" to the
// query. The correct expression is `effective_at <= now()` (both sides
// `timestamptz`). Tests below seed older documents (>= 6 h old) so they pass
// despite the bug; the sub-2h case is documented separately.
package legal

import (
	"context"
	"errors"
	"fmt"
	"math/rand"
	"os"
	"testing"
	"time"

	"github.com/beepbite/backend/cmd/tests/testenv"
	"github.com/beepbite/backend/internal/db"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// ---------------------------------------------------------------------------
// Package-level pool — shared across all Integration* tests.
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
		fmt.Fprintf(os.Stderr, "testenv.StartPostgres: %v\n", err)
		os.Exit(1)
	}
	defer cleanup()
	testPool = pool
	os.Exit(m.Run())
}

// ---------------------------------------------------------------------------
// Fixture helpers — all inserts use ServiceRoleScope to bypass RLS.
// ---------------------------------------------------------------------------

// randomSuffix returns a short random string to keep test entities unique.
func randomSuffix() string {
	const chars = "abcdefghijklmnopqrstuvwxyz0123456789"
	b := make([]byte, 8)
	for i := range b {
		b[i] = chars[rand.Intn(len(chars))]
	}
	return string(b)
}

// fixtureProfile seeds an auth_users row (which the handle_new_user trigger
// may use to auto-create a profiles row) and also inserts profiles directly to
// guarantee isolation even when the trigger fires first (ON CONFLICT DO NOTHING).
// Returns the profile UUID (= auth_users.id).
func fixtureProfile(t *testing.T, ctx context.Context, suffix string) string {
	t.Helper()
	email := fmt.Sprintf("legal-test-%s-%d@test.invalid", suffix, time.Now().UnixNano())
	var profileID string

	err := db.Scoped(ctx, testPool, db.ServiceRoleScope(), func(tx pgx.Tx) error {
		// Insert auth_user — the on_auth_user_created trigger may auto-create
		// a profiles row, so we use ON CONFLICT DO NOTHING on the profiles insert.
		if err := tx.QueryRow(ctx,
			`INSERT INTO auth_users (email, password_hash, email_verified)
			 VALUES ($1, 'dummy-hash', true) RETURNING id`,
			email,
		).Scan(&profileID); err != nil {
			return fmt.Errorf("insert auth_user: %w", err)
		}

		// Explicit profiles insert; ON CONFLICT because the trigger may have
		// already created it.
		if _, err := tx.Exec(ctx,
			`INSERT INTO profiles (id, full_name, email)
			 VALUES ($1, $2, $3)
			 ON CONFLICT (id) DO NOTHING`,
			profileID, "Legal Test User "+suffix, email,
		); err != nil {
			return fmt.Errorf("insert profile: %w", err)
		}
		return nil
	})
	if err != nil {
		t.Fatalf("fixtureProfile(%s): %v", suffix, err)
	}
	return profileID
}

// fixtureLegalDocument seeds a legal_documents row via ServiceRoleScope
// (RLS: service-role write only). Returns the document UUID.
func fixtureLegalDocument(
	t *testing.T,
	ctx context.Context,
	kind, version, bodyMD string,
	effectiveAt time.Time,
) string {
	t.Helper()
	var docID string

	err := db.Scoped(ctx, testPool, db.ServiceRoleScope(), func(tx pgx.Tx) error {
		return tx.QueryRow(ctx,
			`INSERT INTO legal_documents (kind, version, body_md, effective_at)
			 VALUES ($1, $2, $3, $4)
			 RETURNING id`,
			kind, version, bodyMD, effectiveAt,
		).Scan(&docID)
	})
	if err != nil {
		t.Fatalf("fixtureLegalDocument(kind=%s version=%s): %v", kind, version, err)
	}
	return docID
}

// countAcceptances returns how many legal_acceptances rows exist for the given
// (profileID, documentID) pair, using ServiceRoleScope to bypass RLS.
func countAcceptances(t *testing.T, ctx context.Context, profileID, documentID string) int {
	t.Helper()
	var n int
	err := db.Scoped(ctx, testPool, db.ServiceRoleScope(), func(tx pgx.Tx) error {
		return tx.QueryRow(ctx,
			`SELECT count(*) FROM legal_acceptances
			 WHERE profile_id = $1 AND document_id = $2`,
			profileID, documentID,
		).Scan(&n)
	})
	if err != nil {
		t.Fatalf("countAcceptances: %v", err)
	}
	return n
}

// ---------------------------------------------------------------------------
// TestIntegrationGetCurrentDocument
// ---------------------------------------------------------------------------
//
// Verifies that:
//
//  1. When two versions of the same kind exist, GetCurrentDocument returns
//     the one with the LATEST effective_at that is <= now().
//  2. A document with effective_at in the future is NOT returned.
//  3. An unknown kind returns ErrDocumentNotFound (→ HTTP 404).
//
// NOTE on effective_at thresholds: see the package-level bug note. To avoid
// hitting the ±2 h skew introduced by the `timezone('utc', now())` comparison,
// all "past" documents are seeded ≥ 6 h old and all "future" documents ≥ 48 h
// ahead. This makes the tests pass on any server within UTC±12.
func TestIntegrationGetCurrentDocument(t *testing.T) {
	ctx := context.Background()
	sfx := randomSuffix()
	store := NewStore(testPool)

	now := time.Now().UTC()

	// Seed two "terms" documents both well in the past (>= 6 h) so the
	// timezone-skew bug in the store query does not hide them.
	olderAt := now.Add(-48 * time.Hour)
	newerAt := now.Add(-6 * time.Hour) // still clearly past, even with ±2 h skew

	olderVersion := "v1.0-" + sfx
	newerVersion := "v2.0-" + sfx

	_ = fixtureLegalDocument(t, ctx, "terms", olderVersion, "# Old Terms\nContent v1.", olderAt)
	newerID := fixtureLegalDocument(t, ctx, "terms", newerVersion, "# New Terms\nContent v2.", newerAt)

	// ------------------------------------------------------------------
	// 1a. GetCurrentDocument("terms") must return the newer version.
	// ------------------------------------------------------------------
	doc, err := store.GetCurrentDocument(ctx, "terms")
	if err != nil {
		t.Fatalf("GetCurrentDocument(terms): unexpected error: %v", err)
	}
	if doc.ID != newerID {
		t.Errorf("GetCurrentDocument(terms): got ID=%q, want ID=%q (newer version)", doc.ID, newerID)
	}
	if doc.Version != newerVersion {
		t.Errorf("GetCurrentDocument(terms): got Version=%q, want %q", doc.Version, newerVersion)
	}
	if doc.Kind != "terms" {
		t.Errorf("GetCurrentDocument(terms): got Kind=%q, want \"terms\"", doc.Kind)
	}
	if doc.BodyMD == "" {
		t.Error("GetCurrentDocument(terms): BodyMD is empty")
	}
	if doc.EffectiveAt.IsZero() {
		t.Error("GetCurrentDocument(terms): EffectiveAt is zero")
	}

	// ------------------------------------------------------------------
	// 1b. A future effective_at document must NOT be returned.
	// Seed it 48 h ahead so even with the +2h timezone skew in the store
	// query, it still falls "in the future" from the DB's perspective.
	// ------------------------------------------------------------------
	futureVersion := "v99.0-" + sfx
	futureAt := now.Add(48 * time.Hour)
	_ = fixtureLegalDocument(t, ctx, "terms", futureVersion, "# Future Terms", futureAt)

	doc2, err := store.GetCurrentDocument(ctx, "terms")
	if err != nil {
		t.Fatalf("GetCurrentDocument after future seed: %v", err)
	}
	if doc2.ID != newerID {
		t.Errorf("GetCurrentDocument with future doc: got ID=%q, want ID=%q (future doc must be excluded)", doc2.ID, newerID)
	}

	// ------------------------------------------------------------------
	// 1c. Unknown kind → ErrDocumentNotFound.
	// ------------------------------------------------------------------
	_, err = store.GetCurrentDocument(ctx, "unknown-kind-"+sfx)
	if !errors.Is(err, ErrDocumentNotFound) {
		t.Errorf("GetCurrentDocument(unknown): want ErrDocumentNotFound, got %v", err)
	}
}

// ---------------------------------------------------------------------------
// TestIntegrationGetCurrentDocument_BugTimezoneSkew
// ---------------------------------------------------------------------------
//
// Documents the known timezone-skew bug in GetCurrentDocument.
// The store query uses `effective_at <= timezone('utc', now())` which compares
// a timestamptz with a timestamp-no-tz. PostgreSQL interprets the no-tz value
// in the session timezone (e.g. SAST +0200), shifting the effective threshold
// by the server's UTC offset. On SAST this means documents effective within
// the past 2 hours appear "future" and are excluded.
//
// This test seeds a document 90 minutes ago (should be visible) and asserts
// the CORRECT behavior. On a non-UTC server it will FAIL — that failure is the
// bug signal. On a UTC server it passes because the skew is 0.
func TestIntegrationGetCurrentDocument_BugTimezoneSkew(t *testing.T) {
	ctx := context.Background()
	sfx := randomSuffix()
	store := NewStore(testPool)

	now := time.Now().UTC()

	// A document that became effective 90 minutes ago should always be visible.
	recentAt := now.Add(-90 * time.Minute)
	recentVersion := "recent-" + sfx
	recentID := fixtureLegalDocument(t, ctx, "privacy", recentVersion, "# Recent Privacy", recentAt)

	// The store now uses `effective_at <= now()` (both sides timestamptz), so a
	// document effective 90 minutes ago must always be returned regardless of the
	// server's session timezone.
	doc, err := store.GetCurrentDocument(ctx, "privacy")
	if err != nil {
		t.Fatalf("GetCurrentDocument(privacy): %v", err)
	}
	if doc.ID != recentID {
		t.Errorf("GetCurrentDocument(privacy): got ID=%q, want recentID=%q", doc.ID, recentID)
	}
}

// ---------------------------------------------------------------------------
// TestIntegrationRecordAcceptance
// ---------------------------------------------------------------------------
//
// Verifies that:
//
//  1. RecordAcceptance inserts a row and returns correct fields (ip, document_id).
//  2. A second call for the same (profile, document) is idempotent: returns
//     ErrAlreadyAccepted and leaves exactly one row in the table.
//  3. The stored row carries the expected ip and links to the correct document.
func TestIntegrationRecordAcceptance(t *testing.T) {
	ctx := context.Background()
	sfx := randomSuffix()
	store := NewStore(testPool)

	// Seed a profile and a legal document far enough in the past to avoid
	// the timezone-skew bug in GetCurrentDocument (not relevant here, but
	// consistent with other tests).
	profileID := fixtureProfile(t, ctx, sfx)
	docID := fixtureLegalDocument(t, ctx,
		"privacy",
		"pp-v1-"+sfx,
		"# Privacy Policy",
		time.Now().UTC().Add(-24*time.Hour),
	)

	// Use a user-scoped Scope (the authentic path through the handler).
	// The RLS INSERT policy: profile_id = current_user_id() OR is_service_role().
	userScope := db.Scope{UserID: profileID}
	const clientIP = "192.0.2.42"

	// ------------------------------------------------------------------
	// 2a. First acceptance: expect a valid Acceptance record back.
	// ------------------------------------------------------------------
	acc, err := store.RecordAcceptance(ctx, userScope, profileID, docID, clientIP)
	if err != nil {
		t.Fatalf("RecordAcceptance (first): unexpected error: %v", err)
	}
	if acc == nil {
		t.Fatal("RecordAcceptance (first): returned nil Acceptance")
	}
	if acc.ID == "" {
		t.Error("RecordAcceptance (first): Acceptance.ID is empty")
	}
	if acc.ProfileID != profileID {
		t.Errorf("RecordAcceptance (first): ProfileID = %q, want %q", acc.ProfileID, profileID)
	}
	if acc.DocumentID != docID {
		t.Errorf("RecordAcceptance (first): DocumentID = %q, want %q", acc.DocumentID, docID)
	}
	if acc.AcceptedAt.IsZero() {
		t.Error("RecordAcceptance (first): AcceptedAt is zero")
	}

	// ------------------------------------------------------------------
	// 2b. Verify the stored row carries the correct IP in the database.
	// ------------------------------------------------------------------
	var storedIP *string
	err = db.Scoped(ctx, testPool, db.ServiceRoleScope(), func(tx pgx.Tx) error {
		return tx.QueryRow(ctx,
			`SELECT ip FROM legal_acceptances WHERE id = $1`, acc.ID,
		).Scan(&storedIP)
	})
	if err != nil {
		t.Fatalf("verify stored IP: %v", err)
	}
	if storedIP == nil || *storedIP != clientIP {
		got := "<nil>"
		if storedIP != nil {
			got = *storedIP
		}
		t.Errorf("stored IP = %q, want %q", got, clientIP)
	}

	// ------------------------------------------------------------------
	// 2c. Second acceptance of the same (profile, document) → ErrAlreadyAccepted.
	// ------------------------------------------------------------------
	_, err = store.RecordAcceptance(ctx, userScope, profileID, docID, clientIP)
	if !errors.Is(err, ErrAlreadyAccepted) {
		t.Errorf("RecordAcceptance (second): want ErrAlreadyAccepted, got %v", err)
	}

	// ------------------------------------------------------------------
	// 2d. Idempotency: exactly ONE row must exist in legal_acceptances.
	// ------------------------------------------------------------------
	n := countAcceptances(t, ctx, profileID, docID)
	if n != 1 {
		t.Errorf("idempotency: want 1 legal_acceptances row, got %d", n)
	}
}

// ---------------------------------------------------------------------------
// TestIntegrationRecordAcceptance_MultipleProfiles
// ---------------------------------------------------------------------------
//
// Confirms that two different profiles can each accept the same document
// independently (no cross-profile conflict).
func TestIntegrationRecordAcceptance_MultipleProfiles(t *testing.T) {
	ctx := context.Background()
	sfx := randomSuffix()
	store := NewStore(testPool)

	docID := fixtureLegalDocument(t, ctx,
		"terms",
		"terms-multi-"+sfx,
		"# Terms Multi Profile",
		time.Now().UTC().Add(-24*time.Hour),
	)

	profileA := fixtureProfile(t, ctx, "a-"+sfx)
	profileB := fixtureProfile(t, ctx, "b-"+sfx)

	scopeA := db.Scope{UserID: profileA}
	scopeB := db.Scope{UserID: profileB}

	accA, err := store.RecordAcceptance(ctx, scopeA, profileA, docID, "10.0.0.1")
	if err != nil {
		t.Fatalf("RecordAcceptance profileA: %v", err)
	}
	accB, err := store.RecordAcceptance(ctx, scopeB, profileB, docID, "10.0.0.2")
	if err != nil {
		t.Fatalf("RecordAcceptance profileB: %v", err)
	}

	if accA.ID == accB.ID {
		t.Error("two different profiles got the same acceptance ID — unexpected")
	}

	// Each profile should have exactly one row.
	if n := countAcceptances(t, ctx, profileA, docID); n != 1 {
		t.Errorf("profileA: want 1 acceptance row, got %d", n)
	}
	if n := countAcceptances(t, ctx, profileB, docID); n != 1 {
		t.Errorf("profileB: want 1 acceptance row, got %d", n)
	}
}

// ---------------------------------------------------------------------------
// TestIntegrationRecordAcceptance_NullIP
// ---------------------------------------------------------------------------
//
// Verifies that an empty ip string is stored as NULL (not an empty string),
// matching the store's nil-coercion logic (`if ip != "" { ipArg = ip }`).
func TestIntegrationRecordAcceptance_NullIP(t *testing.T) {
	ctx := context.Background()
	sfx := randomSuffix()
	store := NewStore(testPool)

	profileID := fixtureProfile(t, ctx, sfx)
	docID := fixtureLegalDocument(t, ctx,
		"privacy",
		"pp-nullip-"+sfx,
		"# Privacy NullIP",
		time.Now().UTC().Add(-24*time.Hour),
	)

	userScope := db.Scope{UserID: profileID}

	acc, err := store.RecordAcceptance(ctx, userScope, profileID, docID, "" /* empty → NULL */)
	if err != nil {
		t.Fatalf("RecordAcceptance (null ip): %v", err)
	}

	// Verify the row carries NULL for ip in the database.
	var storedIP *string
	err = db.Scoped(ctx, testPool, db.ServiceRoleScope(), func(tx pgx.Tx) error {
		return tx.QueryRow(ctx,
			`SELECT ip FROM legal_acceptances WHERE id = $1`, acc.ID,
		).Scan(&storedIP)
	})
	if err != nil {
		t.Fatalf("verify null IP in DB: %v", err)
	}
	if storedIP != nil {
		t.Errorf("expected NULL ip in DB, got %q", *storedIP)
	}
}
