// Package reviews provides the marketplace review write surface (customer
// submit + owner reply) and the public read surface (list by store slug).
//
// DB column names mirror migration 010_engagement.sql:
//
//	marketplace_reviews(id, order_id, customer_profile_id, location_id,
//	                    stars, review_text, photos, verified_purchase, status,
//	                    owner_reply, owner_replied_at, created_at)
//
// locations.avg_rating and locations.rating_count are added by migration 033.
package reviews

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/beepbite/backend/internal/db"
)

// ---------------------------------------------------------------------------
// Sentinel errors
// ---------------------------------------------------------------------------

var (
	// ErrNotFound is returned when the slug/review does not exist.
	ErrNotFound = errors.New("not found")
	// ErrDuplicateReview is returned when an order already has a review (unique index).
	ErrDuplicateReview = errors.New("review already exists for this order")
	// ErrOrderNotEligible is returned when the order is not delivered/completed
	// or does not belong to the requesting customer.
	ErrOrderNotEligible = errors.New("order not eligible for review")
	// ErrNotOwner is returned when the caller's location set does not include
	// the review's location.
	ErrNotOwner = errors.New("not authorised to reply to this review")
)

// ---------------------------------------------------------------------------
// Wire types
// ---------------------------------------------------------------------------

// PublicReview is the read-only DTO returned on the public list endpoint.
type PublicReview struct {
	ID             string     `json:"id"`
	Stars          int        `json:"stars"`
	ReviewText     *string    `json:"text"`
	Photos         []string   `json:"photos"`
	OwnerReply     *string    `json:"owner_reply"`
	OwnerRepliedAt *time.Time `json:"owner_replied_at"`
	CreatedAt      time.Time  `json:"created_at"`
}

// ReviewRow is the full DB row used internally after insert.
type ReviewRow struct {
	ID                string     `json:"id"`
	LocationID        string     `json:"location_id"`
	OrderID           string     `json:"order_id"`
	CustomerProfileID *string    `json:"customer_profile_id"`
	Stars             int        `json:"stars"`
	ReviewText        *string    `json:"text"`
	Photos            []string   `json:"photos"`
	VerifiedPurchase  bool       `json:"verified_purchase"`
	OwnerReply        *string    `json:"owner_reply"`
	OwnerRepliedAt    *time.Time `json:"owner_replied_at"`
	CreatedAt         time.Time  `json:"created_at"`
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

// Store handles all DB access for the reviews package.
type Store struct {
	pool *pgxpool.Pool
}

// NewStore constructs a Store.
func NewStore(pool *pgxpool.Pool) *Store { return &Store{pool: pool} }

// ---------------------------------------------------------------------------
// Public read
// ---------------------------------------------------------------------------

// ListPublicReviews returns visible reviews for the location identified by
// slug. The query runs under MarketplaceScope so RLS restricts to
// status='visible' rows only.
func (s *Store) ListPublicReviews(ctx context.Context, slug string, limit int) ([]PublicReview, error) {
	var out []PublicReview

	err := db.Scoped(ctx, s.pool, db.MarketplaceScope(), func(tx pgx.Tx) error {
		// Resolve slug → location_id (marketplace-visible locations only).
		var locationID string
		err := tx.QueryRow(ctx,
			`SELECT id FROM locations
			 WHERE slug = $1
			   AND is_marketplace_visible = true
			   AND is_active = true`,
			slug,
		).Scan(&locationID)
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrNotFound
		}
		if err != nil {
			return err
		}

		rows, err := tx.Query(ctx, `
			SELECT id, stars, review_text, photos, owner_reply, owner_replied_at, created_at
			FROM marketplace_reviews
			WHERE location_id = $1
			ORDER BY created_at DESC
			LIMIT $2
		`, locationID, limit)
		if err != nil {
			return err
		}
		defer rows.Close()

		for rows.Next() {
			var r PublicReview
			if err := rows.Scan(
				&r.ID, &r.Stars, &r.ReviewText, &r.Photos,
				&r.OwnerReply, &r.OwnerRepliedAt, &r.CreatedAt,
			); err != nil {
				return err
			}
			if r.Photos == nil {
				r.Photos = []string{}
			}
			out = append(out, r)
		}
		return rows.Err()
	})
	if err != nil {
		return nil, err
	}
	if out == nil {
		out = []PublicReview{}
	}
	return out, nil
}

// ---------------------------------------------------------------------------
// Customer submit
// ---------------------------------------------------------------------------

// SubmitReview inserts a new marketplace review for an order. It:
//  1. Verifies the order belongs to customerProfileID and has status
//     'delivered' or 'completed'.
//  2. Resolves the order's location_id for the insert and the aggregate
//     refresh.
//  3. Inserts the review row (unique index on order_id → 409 on dup).
//  4. Refreshes locations.avg_rating and locations.rating_count.
//
// Runs under ServiceRoleScope so the INSERT can pass the RLS WITH CHECK
// even though customers don't carry an org-scoped session variable.
func (s *Store) SubmitReview(
	ctx context.Context,
	customerProfileID string,
	orderID string,
	stars int,
	reviewText *string,
	photos []string,
) (*ReviewRow, error) {
	var out ReviewRow

	err := db.Scoped(ctx, s.pool, db.ServiceRoleScope(), func(tx pgx.Tx) error {
		// 1. Validate order ownership and status.
		// orders.customer_id is a FK to customers(id), which is distinct from the
		// caller's profile UUID. The link is customers.profile_id = profileID.
		// We therefore JOIN through the customers table to match the order via
		// the caller's profile identity.
		var locationID string
		var orderStatus string
		err := tx.QueryRow(ctx, `
			SELECT o.location_id, o.status
			FROM orders o
			JOIN customers c ON c.id = o.customer_id
			WHERE o.id = $1
			  AND c.profile_id = $2
		`, orderID, customerProfileID).Scan(&locationID, &orderStatus)
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrOrderNotEligible
		}
		if err != nil {
			return err
		}
		if orderStatus != "delivered" && orderStatus != "completed" {
			return ErrOrderNotEligible
		}

		// 2. Normalise photos.
		if photos == nil {
			photos = []string{}
		}

		// 3. Insert the review.
		// Uses INSERT … SELECT to pull organization_id from locations so we
		// never violate the NOT NULL constraint added by migration 033.
		// status='visible' is set explicitly because there is no moderation
		// path and the public-read RLS only exposes status='visible' rows.
		// Both review_text (legacy) and text (canonical, migration 033) are
		// written to avoid the canonical column staying NULL forever.
		err = tx.QueryRow(ctx, `
			INSERT INTO marketplace_reviews
				(order_id, customer_profile_id, location_id, organization_id,
				 stars, review_text, text, photos, verified_purchase, status)
			SELECT $1, $2, $3, l.organization_id,
			       $4, $5, $5, $6, true, 'visible'
			FROM locations l
			WHERE l.id = $3
			RETURNING id, location_id, order_id, customer_profile_id,
			          stars, review_text, photos, verified_purchase,
			          owner_reply, owner_replied_at, created_at
		`, orderID, customerProfileID, locationID, stars, reviewText, photos,
		).Scan(
			&out.ID, &out.LocationID, &out.OrderID, &out.CustomerProfileID,
			&out.Stars, &out.ReviewText, &out.Photos, &out.VerifiedPurchase,
			&out.OwnerReply, &out.OwnerRepliedAt, &out.CreatedAt,
		)
		if err != nil {
			var pgErr *pgconn.PgError
			if errors.As(err, &pgErr) && pgErr.Code == "23505" {
				return ErrDuplicateReview
			}
			return err
		}

		// 4. Refresh aggregate columns on locations (added by migration 033).
		_, err = tx.Exec(ctx, `
			UPDATE locations
			SET avg_rating   = (
				SELECT ROUND(AVG(stars)::numeric, 2)
				FROM marketplace_reviews
				WHERE location_id = $1
				  AND status = 'visible'
			),
			    rating_count = (
				SELECT COUNT(*)
				FROM marketplace_reviews
				WHERE location_id = $1
				  AND status = 'visible'
			)
			WHERE id = $1
		`, locationID)
		return err
	})
	if err != nil {
		return nil, err
	}
	return &out, nil
}

// ---------------------------------------------------------------------------
// Owner reply
// ---------------------------------------------------------------------------

// SetOwnerReply sets owner_reply and owner_replied_at on a review that
// belongs to one of the caller's locations. The caller must pass
// allowedLocationIDs (from auth.OrgScopeFrom) so we can enforce cross-tenant
// isolation without a separate round-trip.
//
// Runs under ServiceRoleScope because the UPDATE RLS policy checks
// current_org_id(), which is only set for member JWTs — and the caller
// might be an owner whose org scope is already resolved at the handler level
// for cross-tenant checks. Using service-role here avoids a second
// db.Scoped call while the handler itself guards scope via allowedLocationIDs.
func (s *Store) SetOwnerReply(
	ctx context.Context,
	reviewID string,
	reply string,
	allowedLocationIDs []string,
) (*ReviewRow, error) {
	var out ReviewRow

	err := db.Scoped(ctx, s.pool, db.ServiceRoleScope(), func(tx pgx.Tx) error {
		// Fetch the review's location so we can apply the tenant guard.
		var locID string
		err := tx.QueryRow(ctx,
			`SELECT location_id FROM marketplace_reviews WHERE id = $1`,
			reviewID,
		).Scan(&locID)
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrNotFound
		}
		if err != nil {
			return err
		}

		// Cross-tenant guard: verify the review's location is in the caller's set.
		allowed := false
		for _, id := range allowedLocationIDs {
			if id == locID {
				allowed = true
				break
			}
		}
		if !allowed {
			return ErrNotOwner
		}

		// Apply the reply.
		err = tx.QueryRow(ctx, `
			UPDATE marketplace_reviews
			SET owner_reply      = $2,
			    owner_replied_at = now(),
			    updated_at       = now()
			WHERE id = $1
			RETURNING id, location_id, order_id, customer_profile_id,
			          stars, review_text, photos, verified_purchase,
			          owner_reply, owner_replied_at, created_at
		`, reviewID, reply,
		).Scan(
			&out.ID, &out.LocationID, &out.OrderID, &out.CustomerProfileID,
			&out.Stars, &out.ReviewText, &out.Photos, &out.VerifiedPurchase,
			&out.OwnerReply, &out.OwnerRepliedAt, &out.CreatedAt,
		)
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrNotFound
		}
		return err
	})
	if err != nil {
		return nil, err
	}
	return &out, nil
}
