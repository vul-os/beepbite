// Package reviews — DB-backed integration tests for Store.
//
// Run:
//
//	cd backend && go test ./internal/handlers/reviews/ -run Integration -v
//
// The tests create a fresh ephemeral Postgres database via testenv.StartPostgres,
// seed isolated fixtures with ServiceRoleScope (bypassing RLS), and exercise every
// Store method against the real schema.
//
// # Store bug fixed
//
// SubmitReview previously checked: `SELECT … FROM orders WHERE id=$1 AND customer_id=$2`
// where $2 is customerProfileID (the caller's auth_users/profiles UUID).
// But orders.customer_id is a FK to customers(id), which is a *different* UUID
// from the profile UUID; the customer's profile UUID lives at customers.profile_id.
// The query therefore never matched in production when orders are created via the
// POS handler (which stores the customers-table row ID as customer_id).
//
// The fix joins through the customers table:
//
//	JOIN customers c ON c.id = o.customer_id WHERE c.profile_id = $customerProfileID
//
// The fixtures now use realistic data: customers rows have their own generated id
// while profile_id points at the profiles row. Orders use customers.id as customer_id.
package reviews

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

// fixtureOrg seeds: auth_user → profile (auto via handle_new_user trigger)
// → organization → org_member.
// Returns (orgID, ownerProfileID).
func fixtureOrg(t *testing.T, ctx context.Context, suffix string) (orgID, ownerProfileID string) {
	t.Helper()
	email := fmt.Sprintf("reviews-test-%s-%d@test.invalid", suffix, time.Now().UnixNano())

	err := db.Scoped(ctx, testPool, db.ServiceRoleScope(), func(tx pgx.Tx) error {
		// The handle_new_user trigger fires on INSERT INTO auth_users and
		// automatically creates a profiles row — do NOT insert profiles manually.
		if err := tx.QueryRow(ctx,
			`INSERT INTO auth_users (email, password_hash, email_verified)
			 VALUES ($1, 'dummy-hash', true) RETURNING id`,
			email,
		).Scan(&ownerProfileID); err != nil {
			return fmt.Errorf("insert auth_user: %w", err)
		}

		if err := tx.QueryRow(ctx,
			`INSERT INTO organizations (name) VALUES ($1) RETURNING id`,
			"Reviews Test Org "+suffix,
		).Scan(&orgID); err != nil {
			return fmt.Errorf("insert organization: %w", err)
		}

		if _, err := tx.Exec(ctx,
			`INSERT INTO organization_members (organization_id, profile_id, role, capabilities)
			 VALUES ($1, $2, 'owner', '{"can_pos":true}'::jsonb)`,
			orgID, ownerProfileID,
		); err != nil {
			return fmt.Errorf("insert org_member: %w", err)
		}

		return nil
	})
	if err != nil {
		t.Fatalf("fixtureOrg(%s): %v", suffix, err)
	}
	return orgID, ownerProfileID
}

// fixtureLocation creates a location for the org with the given slug.
// is_marketplace_visible and is_active are true so ListPublicReviews finds it.
func fixtureLocation(t *testing.T, ctx context.Context, orgID, slug string) string {
	t.Helper()
	var locID string
	// A Lisbon location, not a Johannesburg one. The `regions` lookup this
	// replaces referenced a table that exists only in migrations/legacy, and a
	// missing relation raises an error that is not pgx.ErrNoRows — so the
	// fallback never fired and every test in this file failed at setup. Locale
	// now lives on the location (migration 056).
	//
	// EUR with a 23% TAX-INCLUSIVE posture also gives the marketplace tests a
	// fixture whose prices already contain tax, which is the convention the
	// order handlers used to ignore.
	err := db.Scoped(ctx, testPool, db.ServiceRoleScope(), func(tx pgx.Tx) error {
		if err := tx.QueryRow(ctx,
			`INSERT INTO locations
			   (organization_id, name, slug, city, country, currency_code,
			    timezone, locale, tax_rate, tax_inclusive, tax_label,
			    phone_country_code, is_marketplace_visible, is_active)
			 VALUES ($1, $2, $3, 'Lisbon', 'PT', 'EUR',
			         'Europe/Lisbon', 'pt-PT', 23.00, true, 'IVA',
			         '351', true, true)
			 RETURNING id`,
			orgID, "Test Location "+slug, slug,
		).Scan(&locID); err != nil {
			return fmt.Errorf("insert location: %w", err)
		}
		return nil
	})
	if err != nil {
		t.Fatalf("fixtureLocation(slug=%s): %v", slug, err)
	}
	return locID
}

// fixtureCustomer creates: auth_user → profile (trigger) → customer row.
//
// Returns (profileID, customerID) where:
//   - profileID  is the profiles.id (= auth_users.id via trigger) — the JWT identity
//   - customerID is the customers.id  (auto-generated by the DB) — what orders.customer_id stores
//
// The two UUIDs are deliberately distinct so the tests exercise the real production
// path: SubmitReview must resolve profile→customer via `customers.profile_id = $profileID`.
func fixtureCustomer(t *testing.T, ctx context.Context, orgID, suffix string) (profileID, customerID string) {
	t.Helper()
	email := fmt.Sprintf("cust-%s-%d@test.invalid", suffix, time.Now().UnixNano())
	phone := fmt.Sprintf("+2760%07d", rand.Intn(9999999))

	err := db.Scoped(ctx, testPool, db.ServiceRoleScope(), func(tx pgx.Tx) error {
		// auth_user — the handle_new_user trigger auto-creates a profiles row
		// with id = auth_users.id.
		if err := tx.QueryRow(ctx,
			`INSERT INTO auth_users (email, password_hash, email_verified)
			 VALUES ($1, 'dummy-hash', true) RETURNING id`,
			email,
		).Scan(&profileID); err != nil {
			return fmt.Errorf("insert customer auth_user: %w", err)
		}

		// customers row with its OWN generated id; profile_id links back to the profile.
		// This is the realistic production shape: customers.id ≠ profiles.id.
		if err := tx.QueryRow(ctx,
			`INSERT INTO customers (organization_id, profile_id, whatsapp_number, first_name)
			 VALUES ($1, $2, $3, $4) RETURNING id`,
			orgID, profileID, phone, "Customer "+suffix,
		).Scan(&customerID); err != nil {
			return fmt.Errorf("insert customer: %w", err)
		}
		return nil
	})
	if err != nil {
		t.Fatalf("fixtureCustomer(%s): %v", suffix, err)
	}
	return profileID, customerID
}

// fixtureOrder creates an order with orders.customer_id = customerID.
// customerID must be the customers.id (the second return value of fixtureCustomer),
// NOT the profile UUID — matching the real production FK relationship.
func fixtureOrder(t *testing.T, ctx context.Context, orgID, locID, customerID, status string) string {
	t.Helper()
	var orderID string
	orderNum := fmt.Sprintf("TST-%d", time.Now().UnixNano())

	err := db.Scoped(ctx, testPool, db.ServiceRoleScope(), func(tx pgx.Tx) error {
		if err := tx.QueryRow(ctx, `
			INSERT INTO orders
			  (location_id, organization_id, customer_id, order_number, status)
			VALUES ($1, $2, $3, $4, $5::order_status)
			RETURNING id`,
			locID, orgID, customerID, orderNum, status,
		).Scan(&orderID); err != nil {
			return fmt.Errorf("insert order: %w", err)
		}
		return nil
	})
	if err != nil {
		t.Fatalf("fixtureOrder(status=%s): %v", status, err)
	}
	return orderID
}

// cleanupOrg deletes the org (cascades all child rows) and the owner's auth_user.
func cleanupOrg(ctx context.Context, orgID, ownerProfileID string) {
	_ = db.Scoped(ctx, testPool, db.ServiceRoleScope(), func(tx pgx.Tx) error {
		_, _ = tx.Exec(ctx, `DELETE FROM organizations WHERE id = $1`, orgID)
		_, _ = tx.Exec(ctx, `DELETE FROM auth_users WHERE id = $1`, ownerProfileID)
		return nil
	})
}

func randomSuffix() string {
	const chars = "abcdefghijklmnopqrstuvwxyz0123456789"
	b := make([]byte, 8)
	for i := range b {
		b[i] = chars[rand.Intn(len(chars))]
	}
	return string(b)
}

// ---------------------------------------------------------------------------
// TestIntegrationSubmitReview
// ---------------------------------------------------------------------------

func TestIntegrationSubmitReview(t *testing.T) {
	ctx := context.Background()
	sfx := randomSuffix()

	orgID, ownerID := fixtureOrg(t, ctx, sfx)
	defer cleanupOrg(ctx, orgID, ownerID)

	slug := "review-submit-" + sfx
	locID := fixtureLocation(t, ctx, orgID, slug)

	// profileID is the JWT identity (profiles.id); customerID is the customers.id
	// used as orders.customer_id. They are different UUIDs — realistic production shape.
	profileID, customerID := fixtureCustomer(t, ctx, orgID, sfx)

	store := NewStore(testPool)

	// ------------------------------------------------------------------
	// 1a. Happy path: delivered order → review inserted correctly.
	// ------------------------------------------------------------------
	deliveredOrderID := fixtureOrder(t, ctx, orgID, locID, customerID, "delivered")
	text := "Great food!"
	row, err := store.SubmitReview(ctx, profileID, deliveredOrderID, 4, &text, nil)
	if err != nil {
		t.Fatalf("SubmitReview on delivered order: %v", err)
	}

	if row.ID == "" {
		t.Error("SubmitReview: returned row has empty ID")
	}
	if row.LocationID != locID {
		t.Errorf("SubmitReview: LocationID = %q, want %q", row.LocationID, locID)
	}
	if row.OrderID != deliveredOrderID {
		t.Errorf("SubmitReview: OrderID = %q, want %q", row.OrderID, deliveredOrderID)
	}
	if row.Stars != 4 {
		t.Errorf("SubmitReview: Stars = %d, want 4", row.Stars)
	}
	if row.ReviewText == nil || *row.ReviewText != text {
		t.Errorf("SubmitReview: ReviewText = %v, want %q", row.ReviewText, text)
	}
	if !row.VerifiedPurchase {
		t.Error("SubmitReview: VerifiedPurchase should be true")
	}

	// Verify organization_id and status='visible' in DB.
	var orgInDB, statusInDB string
	err = db.Scoped(ctx, testPool, db.ServiceRoleScope(), func(tx pgx.Tx) error {
		return tx.QueryRow(ctx,
			`SELECT organization_id, status FROM marketplace_reviews WHERE id = $1`,
			row.ID,
		).Scan(&orgInDB, &statusInDB)
	})
	if err != nil {
		t.Fatalf("verify review in DB: %v", err)
	}
	if orgInDB != orgID {
		t.Errorf("DB organization_id = %q, want %q", orgInDB, orgID)
	}
	if statusInDB != "visible" {
		t.Errorf("DB status = %q, want \"visible\"", statusInDB)
	}

	// ------------------------------------------------------------------
	// 1b. Duplicate review on same order → ErrDuplicateReview.
	// ------------------------------------------------------------------
	_, err = store.SubmitReview(ctx, profileID, deliveredOrderID, 3, nil, nil)
	if !errors.Is(err, ErrDuplicateReview) {
		t.Errorf("duplicate SubmitReview: want ErrDuplicateReview, got %v", err)
	}

	// ------------------------------------------------------------------
	// 1c. Completed order → also accepted.
	// ------------------------------------------------------------------
	completedOrderID := fixtureOrder(t, ctx, orgID, locID, customerID, "completed")
	row2, err := store.SubmitReview(ctx, profileID, completedOrderID, 5, nil, nil)
	if err != nil {
		t.Fatalf("SubmitReview on completed order: %v", err)
	}
	if row2.Stars != 5 {
		t.Errorf("completed order review: Stars = %d, want 5", row2.Stars)
	}

	// ------------------------------------------------------------------
	// 1d. Non-delivered / non-completed order → ErrOrderNotEligible.
	// ------------------------------------------------------------------
	for _, badStatus := range []string{"pending", "confirmed", "cancelled"} {
		badOrderID := fixtureOrder(t, ctx, orgID, locID, customerID, badStatus)
		_, err = store.SubmitReview(ctx, profileID, badOrderID, 3, nil, nil)
		if !errors.Is(err, ErrOrderNotEligible) {
			t.Errorf("SubmitReview status=%s: want ErrOrderNotEligible, got %v", badStatus, err)
		}
	}

	// ------------------------------------------------------------------
	// 1e. Order owned by a different customer → ErrOrderNotEligible.
	// ------------------------------------------------------------------
	// otherProfileID is the JWT identity of the other customer; otherCustomerID
	// is what goes into orders.customer_id. Submitting with profileID (the first
	// customer's profile) against an order owned by otherCustomerID must fail.
	_, otherCustomerID := fixtureCustomer(t, ctx, orgID, randomSuffix())
	wrongOwnerOrderID := fixtureOrder(t, ctx, orgID, locID, otherCustomerID, "delivered")
	_, err = store.SubmitReview(ctx, profileID, wrongOwnerOrderID, 5, nil, nil)
	if !errors.Is(err, ErrOrderNotEligible) {
		t.Errorf("SubmitReview wrong owner: want ErrOrderNotEligible, got %v", err)
	}
}

// ---------------------------------------------------------------------------
// TestIntegrationListPublicReviews
// ---------------------------------------------------------------------------

func TestIntegrationListPublicReviews(t *testing.T) {
	ctx := context.Background()
	sfx := randomSuffix()

	orgID, ownerID := fixtureOrg(t, ctx, sfx)
	defer cleanupOrg(ctx, orgID, ownerID)

	slug := "review-list-" + sfx
	locID := fixtureLocation(t, ctx, orgID, slug)
	profileID, customerID := fixtureCustomer(t, ctx, orgID, sfx)

	store := NewStore(testPool)

	// ------------------------------------------------------------------
	// 2a. Empty list before any review.
	// ------------------------------------------------------------------
	reviews, err := store.ListPublicReviews(ctx, slug, 20)
	if err != nil {
		t.Fatalf("ListPublicReviews (empty): %v", err)
	}
	if len(reviews) != 0 {
		t.Errorf("expected 0 reviews before seeding, got %d", len(reviews))
	}

	// ------------------------------------------------------------------
	// 2b. Visible review is returned.
	// ------------------------------------------------------------------
	orderID := fixtureOrder(t, ctx, orgID, locID, customerID, "delivered")
	msg := "Fantastic!"
	_, err = store.SubmitReview(ctx, profileID, orderID, 5, &msg, nil)
	if err != nil {
		t.Fatalf("SubmitReview for list test: %v", err)
	}

	reviews, err = store.ListPublicReviews(ctx, slug, 20)
	if err != nil {
		t.Fatalf("ListPublicReviews (after submit): %v", err)
	}
	if len(reviews) != 1 {
		t.Fatalf("expected 1 visible review, got %d", len(reviews))
	}
	if reviews[0].Stars != 5 {
		t.Errorf("review Stars = %d, want 5", reviews[0].Stars)
	}

	// ------------------------------------------------------------------
	// 2c. Pending / hidden reviews are NOT returned by MarketplaceScope.
	// ------------------------------------------------------------------
	orderID2 := fixtureOrder(t, ctx, orgID, locID, customerID, "delivered")
	orderID3 := fixtureOrder(t, ctx, orgID, locID, customerID, "delivered")

	err = db.Scoped(ctx, testPool, db.ServiceRoleScope(), func(tx pgx.Tx) error {
		for _, row := range []struct{ oid, status string }{
			{orderID2, "pending"},
			{orderID3, "hidden"},
		} {
			if _, err := tx.Exec(ctx, `
				INSERT INTO marketplace_reviews
				  (order_id, customer_profile_id, location_id, organization_id,
				   stars, review_text, text, photos, verified_purchase, status)
				SELECT $1, $2, $3, l.organization_id, 3, 'hidden review', 'hidden review',
				       '{}', true, $4
				FROM locations l WHERE l.id = $3`,
				row.oid, profileID, locID, row.status,
			); err != nil {
				return fmt.Errorf("insert %s review: %w", row.status, err)
			}
		}
		return nil
	})
	if err != nil {
		t.Fatalf("seed pending/hidden reviews: %v", err)
	}

	reviews, err = store.ListPublicReviews(ctx, slug, 20)
	if err != nil {
		t.Fatalf("ListPublicReviews (with pending/hidden): %v", err)
	}
	if len(reviews) != 1 {
		t.Errorf("expected 1 visible review (pending/hidden excluded), got %d", len(reviews))
	}

	// ------------------------------------------------------------------
	// 2d. Unknown slug → ErrNotFound.
	// ------------------------------------------------------------------
	_, err = store.ListPublicReviews(ctx, "no-such-slug-"+sfx, 20)
	if !errors.Is(err, ErrNotFound) {
		t.Errorf("unknown slug: want ErrNotFound, got %v", err)
	}
}

// ---------------------------------------------------------------------------
// TestIntegrationSetOwnerReply
// ---------------------------------------------------------------------------

func TestIntegrationSetOwnerReply(t *testing.T) {
	ctx := context.Background()
	sfxA := randomSuffix()
	sfxB := randomSuffix()

	// Org A owns the review.
	orgAID, ownerAID := fixtureOrg(t, ctx, sfxA)
	defer cleanupOrg(ctx, orgAID, ownerAID)

	slugA := "reply-test-a-" + sfxA
	locAID := fixtureLocation(t, ctx, orgAID, slugA)
	profileAID, customerAID := fixtureCustomer(t, ctx, orgAID, sfxA)

	// Org B is the cross-tenant attacker.
	orgBID, ownerBID := fixtureOrg(t, ctx, sfxB)
	defer cleanupOrg(ctx, orgBID, ownerBID)

	slugB := "reply-test-b-" + sfxB
	locBID := fixtureLocation(t, ctx, orgBID, slugB)

	store := NewStore(testPool)

	// Submit a review under Org A.
	orderID := fixtureOrder(t, ctx, orgAID, locAID, customerAID, "delivered")
	review, err := store.SubmitReview(ctx, profileAID, orderID, 4, nil, nil)
	if err != nil {
		t.Fatalf("SubmitReview for reply test: %v", err)
	}
	reviewID := review.ID

	// ------------------------------------------------------------------
	// 3a. Owner of the correct location can reply.
	// ------------------------------------------------------------------
	replyText := "Thank you for your feedback!"
	updated, err := store.SetOwnerReply(ctx, reviewID, replyText, []string{locAID})
	if err != nil {
		t.Fatalf("SetOwnerReply (correct org): %v", err)
	}
	if updated.OwnerReply == nil || *updated.OwnerReply != replyText {
		t.Errorf("SetOwnerReply: OwnerReply = %v, want %q", updated.OwnerReply, replyText)
	}
	if updated.OwnerRepliedAt == nil {
		t.Error("SetOwnerReply: OwnerRepliedAt is nil")
	}

	// ------------------------------------------------------------------
	// 3b. Different org's location → ErrNotOwner (cross-tenant guard).
	// ------------------------------------------------------------------
	_, err = store.SetOwnerReply(ctx, reviewID, "I own this!", []string{locBID})
	if !errors.Is(err, ErrNotOwner) {
		t.Errorf("SetOwnerReply wrong org: want ErrNotOwner, got %v", err)
	}

	// ------------------------------------------------------------------
	// 3c. Empty allowedLocationIDs → ErrNotOwner.
	// ------------------------------------------------------------------
	_, err = store.SetOwnerReply(ctx, reviewID, "sneaky", []string{})
	if !errors.Is(err, ErrNotOwner) {
		t.Errorf("SetOwnerReply empty locs: want ErrNotOwner, got %v", err)
	}

	// ------------------------------------------------------------------
	// 3d. Non-existent review ID → ErrNotFound.
	// ------------------------------------------------------------------
	_, err = store.SetOwnerReply(ctx, "00000000-0000-0000-0000-000000000000", "hello", []string{locAID})
	if !errors.Is(err, ErrNotFound) {
		t.Errorf("SetOwnerReply non-existent: want ErrNotFound, got %v", err)
	}

	_ = slugB // used indirectly via locBID above
}

// ---------------------------------------------------------------------------
// TestIntegrationAggregate
// ---------------------------------------------------------------------------

func TestIntegrationAggregate(t *testing.T) {
	ctx := context.Background()
	sfx := randomSuffix()

	orgID, ownerID := fixtureOrg(t, ctx, sfx)
	defer cleanupOrg(ctx, orgID, ownerID)

	slug := "review-agg-" + sfx
	locID := fixtureLocation(t, ctx, orgID, slug)
	profileID, customerID := fixtureCustomer(t, ctx, orgID, sfx)

	store := NewStore(testPool)

	// Confirm starting aggregate state.
	var countBefore int
	var avgBefore float64
	err := db.Scoped(ctx, testPool, db.ServiceRoleScope(), func(tx pgx.Tx) error {
		return tx.QueryRow(ctx,
			`SELECT avg_rating, rating_count FROM locations WHERE id = $1`, locID,
		).Scan(&avgBefore, &countBefore)
	})
	if err != nil {
		t.Fatalf("read location aggregates before: %v", err)
	}
	if countBefore != 0 {
		t.Errorf("rating_count before = %d, want 0", countBefore)
	}

	// Submit two reviews (stars 4 + 2 → avg 3.00, count 2).
	orderID1 := fixtureOrder(t, ctx, orgID, locID, customerID, "delivered")
	if _, err = store.SubmitReview(ctx, profileID, orderID1, 4, nil, nil); err != nil {
		t.Fatalf("SubmitReview 1: %v", err)
	}

	// Second customer, second review.
	profile2ID, customer2ID := fixtureCustomer(t, ctx, orgID, randomSuffix())
	orderID2 := fixtureOrder(t, ctx, orgID, locID, customer2ID, "completed")
	if _, err = store.SubmitReview(ctx, profile2ID, orderID2, 2, nil, nil); err != nil {
		t.Fatalf("SubmitReview 2: %v", err)
	}

	// Read the materialised aggregate columns.
	var countAfter int
	var avgAfter float64
	err = db.Scoped(ctx, testPool, db.ServiceRoleScope(), func(tx pgx.Tx) error {
		return tx.QueryRow(ctx,
			`SELECT avg_rating, rating_count FROM locations WHERE id = $1`, locID,
		).Scan(&avgAfter, &countAfter)
	})
	if err != nil {
		t.Fatalf("read location aggregates after: %v", err)
	}

	if countAfter != 2 {
		t.Errorf("rating_count = %d, want 2", countAfter)
	}
	const wantAvg = 3.0
	if avgAfter < wantAvg-0.01 || avgAfter > wantAvg+0.01 {
		t.Errorf("avg_rating = %.4f, want %.4f", avgAfter, wantAvg)
	}
}
