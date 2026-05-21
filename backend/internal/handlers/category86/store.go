// Package category86 provides the store for bulk 86 / un-86 operations on
// all items within a category (and its subcategories, recursively).
package category86

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/beepbite/backend/internal/db"
)

// ErrCategoryNotFound is returned when the requested category does not exist
// or is not visible to the caller's org scope.
var ErrCategoryNotFound = errors.New("category not found")

// Store handles DB access for the category-86 feature.
type Store struct {
	pool *pgxpool.Pool
}

// NewStore constructs a Store backed by pool.
func NewStore(pool *pgxpool.Pool) *Store { return &Store{pool: pool} }

// CategoryLocationID returns the location_id for the given category, or
// ErrCategoryNotFound when the category does not exist or is not visible.
// Used by the handler for the org-scope cross-tenant guard.
func (s *Store) CategoryLocationID(ctx context.Context, categoryID string) (string, error) {
	var locID string
	err := db.Scoped(ctx, s.pool, db.ScopeFromContext(ctx), func(tx pgx.Tx) error {
		return tx.QueryRow(ctx,
			`SELECT location_id FROM categories WHERE id = $1`, categoryID,
		).Scan(&locID)
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return "", ErrCategoryNotFound
	}
	return locID, err
}

// EightySixCategory sets is_86ed = true on all items belonging to categoryID
// and any of its subcategories (recursive via WITH RECURSIVE CTE). It also
// writes a single audit_log row under service-role. Returns the count of items
// affected (may be 0 if the category is empty).
func (s *Store) EightySixCategory(ctx context.Context, categoryID, orgID string) (int64, error) {
	return s.setEighty6(ctx, categoryID, orgID, true)
}

// UnEightySixCategory clears is_86ed on all items in categoryID and its
// subcategories. Writes audit_log. Returns the count of items affected.
func (s *Store) UnEightySixCategory(ctx context.Context, categoryID, orgID string) (int64, error) {
	return s.setEighty6(ctx, categoryID, orgID, false)
}

// setEighty6 is the shared implementation for both 86 and un-86. flag=true
// marks items unavailable; flag=false clears the flag.
func (s *Store) setEighty6(ctx context.Context, categoryID, orgID string, flag bool) (int64, error) {
	var affected int64

	err := db.Scoped(ctx, s.pool, db.ScopeFromContext(ctx), func(tx pgx.Tx) error {
		// Recursive CTE: collect categoryID plus ALL descendant category IDs via
		// the parent_id self-reference defined in migration 004. Depth is capped
		// at 20 to guard against pathological data.
		const updateSQL = `
WITH RECURSIVE cat_tree AS (
    -- Anchor: the requested category.
    SELECT id FROM categories WHERE id = $1
    UNION ALL
    -- Recursive: children of already-found categories (depth ≤ 20).
    SELECT c.id
      FROM categories c
      JOIN cat_tree ct ON ct.id = c.parent_id
     WHERE (SELECT COUNT(*) FROM cat_tree) < 20
)
UPDATE items
   SET is_86ed    = $2,
       updated_at = timezone('utc', now())
 WHERE category_id IN (SELECT id FROM cat_tree)
   AND is_86ed   != $2
`
		tag, err := tx.Exec(ctx, updateSQL, categoryID, flag)
		if err != nil {
			return err
		}
		affected = tag.RowsAffected()

		// Determine action label for the audit row.
		action := "category.eighty_six"
		if !flag {
			action = "category.un_eighty_six"
		}

		// Audit insert must run as service_role because migration 013 restricts
		// audit_log INSERT to service_role only.
		return db.WithTxServiceRole(ctx, tx, func() error {
			_, err := tx.Exec(ctx, `
INSERT INTO audit_log
    (organization_id, actor_type, actor_id, action, entity_type, entity_id, after_state)
VALUES (
    $1::uuid,
    'system',
    NULL,
    $2,
    'category',
    $3::uuid,
    jsonb_build_object('items_affected', $4::bigint, 'is_86ed', $5::boolean)
)
`, orgID, action, categoryID, affected, flag)
			return err
		})
	})
	if err != nil {
		return 0, err
	}
	return affected, nil
}
