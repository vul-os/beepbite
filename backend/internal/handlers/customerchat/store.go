// Package customerchat implements POST /chat — a customer-facing AI assistant
// that lets users search stores, browse menus, manage their cart, and confirm
// orders through an LLM-driven tool loop.
//
// Security: JWT bearer token required (auth.Middleware). DB writes use
// db.ServiceRoleScope so cart_items and orders bypass tenant RLS safely; the
// customer's own ID from the JWT is always used as the WHERE boundary.
package customerchat

import (
	"context"
	"errors"
	"fmt"
	"log"
	"math"
	"time"

	"github.com/beepbite/backend/internal/db"
	"github.com/beepbite/backend/internal/locations"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// ── wire types ────────────────────────────────────────────────────────────────

// StoreResult is a compact store card returned by search_stores.
type StoreResult struct {
	ID      string   `json:"id"`
	Name    string   `json:"name"`
	Slug    *string  `json:"slug,omitempty"`
	Address *string  `json:"address,omitempty"`
	City    *string  `json:"city,omitempty"`
	Country *string  `json:"country,omitempty"`
	Lat     *float64 `json:"lat,omitempty"`
	Lng     *float64 `json:"lng,omitempty"`
}

// MenuCategory is a category with its items returned by get_store_menu.
type MenuCategory struct {
	ID          string     `json:"id"`
	Name        string     `json:"name"`
	Description *string    `json:"description,omitempty"`
	Items       []MenuItem `json:"items"`
}

// MenuItem is a single orderable item.
type MenuItem struct {
	ID          string  `json:"id"`
	Name        string  `json:"name"`
	Description *string `json:"description,omitempty"`
	Price       float64 `json:"price"`
}

// ItemDetail is the rich view returned by get_item_details, including variations.
type ItemDetail struct {
	ID          string          `json:"id"`
	Name        string          `json:"name"`
	Description *string         `json:"description,omitempty"`
	Price       float64         `json:"price"`
	Variations  []ItemVariation `json:"variations,omitempty"`
}

// ItemVariation is one modifier group (e.g. "Size").
type ItemVariation struct {
	ID         string            `json:"id"`
	Name       string            `json:"name"`
	IsRequired bool              `json:"is_required"`
	Options    []VariationOption `json:"options"`
}

// VariationOption is one choice within a variation group (e.g. "Large").
type VariationOption struct {
	ID            string  `json:"id"`
	Name          string  `json:"name"`
	PriceModifier float64 `json:"price_modifier"`
}

// CartLine is one line in the cart view.
type CartLine struct {
	CartItemID string   `json:"cart_item_id"`
	ItemID     string   `json:"item_id"`
	ItemName   string   `json:"item_name"`
	Quantity   int      `json:"quantity"`
	UnitPrice  float64  `json:"unit_price"`
	TotalPrice float64  `json:"total_price"`
	Modifiers  []string `json:"modifiers,omitempty"`
}

// CartView is the full cart returned by view_cart.
type CartView struct {
	LocationID string     `json:"location_id"`
	Lines      []CartLine `json:"lines"`
	Subtotal   float64    `json:"subtotal"`
}

// OrderConfirmation is the result of confirm_order.
type OrderConfirmation struct {
	OrderID     string  `json:"order_id"`
	OrderNumber string  `json:"order_number"`
	TotalAmount float64 `json:"total_amount"`
}

// OrderStatus is the result of track_order.
type OrderStatus struct {
	OrderID     string `json:"order_id"`
	OrderNumber string `json:"order_number"`
	Status      string `json:"status"`
	CreatedAt   string `json:"created_at"`
}

// ── Store ─────────────────────────────────────────────────────────────────────

// Store handles all DB interactions for the customerchat handler.
type Store struct {
	pool *pgxpool.Pool
}

// NewStore constructs a Store.
func NewStore(pool *pgxpool.Pool) *Store { return &Store{pool: pool} }

// ── Tool: search_stores ───────────────────────────────────────────────────────

// SearchStores searches marketplace-visible, active locations by keyword and/or
// coordinates. Runs under MarketplaceScope (public read RLS).
func (s *Store) SearchStores(ctx context.Context, q string, lat, lng *float64, radiusKM float64) ([]StoreResult, error) {
	const sql = `
		SELECT id, name, slug, address, city, country,
		       latitude::float8, longitude::float8
		FROM locations
		WHERE is_active = true
		  AND is_marketplace_visible = true
		  AND (
		      $1 = ''
		      OR name ILIKE '%' || $1 || '%'
		      OR slug ILIKE '%' || $1 || '%'
		  )
		  AND (
		      $2::float8 IS NULL OR $3::float8 IS NULL
		      OR latitude IS NULL OR longitude IS NULL
		      OR (
		          -- Haversine great-circle distance in km (no earthdistance ext).
		          6371 * acos(
		              least(1, greatest(-1,
		                  cos(radians($2::float8)) * cos(radians(latitude::float8))
		                  * cos(radians(longitude::float8) - radians($3::float8))
		                  + sin(radians($2::float8)) * sin(radians(latitude::float8))
		              ))
		          ) <= $4::float8
		      )
		  )
		ORDER BY name
		LIMIT 20`

	var out []StoreResult
	err := db.Scoped(ctx, s.pool, db.MarketplaceScope(), func(tx pgx.Tx) error {
		rows, err := tx.Query(ctx, sql, q, lat, lng, radiusKM)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var r StoreResult
			if err := rows.Scan(&r.ID, &r.Name, &r.Slug, &r.Address, &r.City, &r.Country, &r.Lat, &r.Lng); err != nil {
				return err
			}
			out = append(out, r)
		}
		return rows.Err()
	})
	return out, err
}

// ── Tool: get_store_menu ──────────────────────────────────────────────────────

// GetStoreMenu returns the active menu for a location identified by slug.
// Runs under MarketplaceScope.
func (s *Store) GetStoreMenu(ctx context.Context, slug string) ([]MenuCategory, error) {
	var locID string
	err := db.Scoped(ctx, s.pool, db.MarketplaceScope(), func(tx pgx.Tx) error {
		return tx.QueryRow(ctx,
			`SELECT id FROM locations WHERE slug = $1 AND is_active = true AND is_marketplace_visible = true`,
			slug,
		).Scan(&locID)
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, fmt.Errorf("store not found: %s", slug)
	}
	if err != nil {
		return nil, err
	}
	return s.menuByLocationID(ctx, locID)
}

// menuByLocationID loads categories + items for a location; runs under MarketplaceScope.
func (s *Store) menuByLocationID(ctx context.Context, locationID string) ([]MenuCategory, error) {
	var cats []MenuCategory

	err := db.Scoped(ctx, s.pool, db.MarketplaceScope(), func(tx pgx.Tx) error {
		rows, err := tx.Query(ctx,
			`SELECT id, name, description FROM categories WHERE location_id = $1 AND is_active = true ORDER BY sort_order, name`,
			locationID,
		)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var c MenuCategory
			if err := rows.Scan(&c.ID, &c.Name, &c.Description); err != nil {
				return err
			}
			cats = append(cats, c)
		}
		return rows.Err()
	})
	if err != nil {
		return nil, err
	}

	for i := range cats {
		items, err := s.itemsForCategory(ctx, cats[i].ID)
		if err != nil {
			log.Printf("customerchat: itemsForCategory(%s): %v", cats[i].ID, err)
			continue
		}
		cats[i].Items = items
	}
	return cats, nil
}

func (s *Store) itemsForCategory(ctx context.Context, categoryID string) ([]MenuItem, error) {
	var items []MenuItem
	err := db.Scoped(ctx, s.pool, db.MarketplaceScope(), func(tx pgx.Tx) error {
		rows, err := tx.Query(ctx,
			`SELECT id, name, description, price::float8
			 FROM items
			 WHERE category_id = $1 AND is_active = true AND is_86ed = false
			 ORDER BY sort_order, name`,
			categoryID,
		)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var it MenuItem
			if err := rows.Scan(&it.ID, &it.Name, &it.Description, &it.Price); err != nil {
				return err
			}
			items = append(items, it)
		}
		return rows.Err()
	})
	return items, err
}

// ── Tool: get_item_details ────────────────────────────────────────────────────

// GetItemDetails returns the full item detail including modifier groups.
// Runs under MarketplaceScope (both items and modifier_groups have marketplace policies).
func (s *Store) GetItemDetails(ctx context.Context, itemID string) (*ItemDetail, error) {
	var det ItemDetail
	err := db.Scoped(ctx, s.pool, db.MarketplaceScope(), func(tx pgx.Tx) error {
		err := tx.QueryRow(ctx,
			`SELECT id, name, description, price::float8 FROM items WHERE id = $1 AND is_active = true`,
			itemID,
		).Scan(&det.ID, &det.Name, &det.Description, &det.Price)
		if errors.Is(err, pgx.ErrNoRows) {
			return fmt.Errorf("item not found: %s", itemID)
		}
		return err
	})
	if err != nil {
		return nil, err
	}

	// Load modifier groups under MarketplaceScope (modifier_groups has a marketplace SELECT policy).
	err = db.Scoped(ctx, s.pool, db.MarketplaceScope(), func(tx pgx.Tx) error {
		rows, err := tx.Query(ctx,
			`SELECT id, name, is_required FROM modifier_groups WHERE item_id = $1 ORDER BY sort_order, name`,
			det.ID,
		)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var v ItemVariation
			if err := rows.Scan(&v.ID, &v.Name, &v.IsRequired); err != nil {
				return err
			}
			det.Variations = append(det.Variations, v)
		}
		return rows.Err()
	})
	if err != nil {
		return nil, err
	}

	for i := range det.Variations {
		opts, err := s.modifierOptions(ctx, det.Variations[i].ID)
		if err != nil {
			log.Printf("customerchat: modifierOptions(%s): %v", det.Variations[i].ID, err)
			continue
		}
		det.Variations[i].Options = opts
	}
	return &det, nil
}

// modifierOptions loads the active modifiers for a modifier_group under MarketplaceScope.
// price_delta_cents (bigint) is converted to a float64 price modifier in currency units.
func (s *Store) modifierOptions(ctx context.Context, groupID string) ([]VariationOption, error) {
	var opts []VariationOption
	err := db.Scoped(ctx, s.pool, db.MarketplaceScope(), func(tx pgx.Tx) error {
		rows, err := tx.Query(ctx,
			`SELECT id, name, price_delta_cents::float8 / 100.0
			 FROM modifiers
			 WHERE modifier_group_id = $1 AND is_active = true
			 ORDER BY sort_order, name`,
			groupID,
		)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var o VariationOption
			if err := rows.Scan(&o.ID, &o.Name, &o.PriceModifier); err != nil {
				return err
			}
			opts = append(opts, o)
		}
		return rows.Err()
	})
	return opts, err
}

// ── Tool: add_to_cart ─────────────────────────────────────────────────────────

// AddToCart inserts a cart_items row for the authenticated customer.
// customerID is the customers.id (UUID). modifierIDs is a list of selected modifier UUIDs
// (from the modifiers table); each modifier carries its own group and price delta.
func (s *Store) AddToCart(ctx context.Context, customerID, itemID string, qty int, modifierIDs []string) error {
	// Resolve item base price and location_id.
	var price float64
	var locationID string
	err := db.Scoped(ctx, s.pool, db.ServiceRoleScope(), func(tx pgx.Tx) error {
		return tx.QueryRow(ctx,
			`SELECT price::float8, location_id::text FROM items WHERE id = $1 AND is_active = true`,
			itemID,
		).Scan(&price, &locationID)
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return fmt.Errorf("item not found: %s", itemID)
	}
	if err != nil {
		return err
	}

	// Resolve modifier group and price delta for each selected modifier.
	type modifierRow struct {
		groupID    string
		modifierID string
		priceDelta float64 // in currency units (cents/100)
	}
	var resolvedMods []modifierRow
	for _, modID := range modifierIDs {
		var groupID string
		var deltaCents int64
		lookupErr := db.Scoped(ctx, s.pool, db.ServiceRoleScope(), func(tx pgx.Tx) error {
			return tx.QueryRow(ctx,
				`SELECT modifier_group_id::text, price_delta_cents FROM modifiers WHERE id = $1 AND is_active = true`,
				modID,
			).Scan(&groupID, &deltaCents)
		})
		if lookupErr != nil {
			log.Printf("customerchat: AddToCart: modifier lookup %s: %v", modID, lookupErr)
			continue
		}
		resolvedMods = append(resolvedMods, modifierRow{
			groupID:    groupID,
			modifierID: modID,
			priceDelta: float64(deltaCents) / 100.0,
		})
	}

	// Compute unit price including modifier deltas, then total.
	unitPrice := price
	for _, m := range resolvedMods {
		unitPrice += m.priceDelta
	}
	totalPrice := unitPrice * float64(qty)

	var cartItemID string
	err = db.Scoped(ctx, s.pool, db.ServiceRoleScope(), func(tx pgx.Tx) error {
		if err := tx.QueryRow(ctx, `
			INSERT INTO cart_items (customer_id, location_id, item_id, quantity, unit_price, total_price)
			VALUES ($1, $2, $3, $4, $5, $6)
			RETURNING id`,
			customerID, locationID, itemID, qty, unitPrice, totalPrice,
		).Scan(&cartItemID); err != nil {
			return err
		}
		// Insert one cart_item_variations row per selected modifier.
		// variation_id stores the modifier_group_id; option_id stores the modifier_id.
		// price_modifier stores the per-unit price delta in currency units.
		for _, m := range resolvedMods {
			if _, err := tx.Exec(ctx, `
				INSERT INTO cart_item_variations (cart_item_id, variation_id, option_id, price_modifier)
				VALUES ($1, $2, $3, $4)`,
				cartItemID, m.groupID, m.modifierID, m.priceDelta,
			); err != nil {
				return err
			}
		}
		return nil
	})
	return err
}

// ── Tool: view_cart ───────────────────────────────────────────────────────────

// ViewCart returns the current cart contents for the customer, grouped by location.
func (s *Store) ViewCart(ctx context.Context, customerID string) (*CartView, error) {
	var lines []CartLine
	var locationID string
	var subtotal float64

	err := db.Scoped(ctx, s.pool, db.ServiceRoleScope(), func(tx pgx.Tx) error {
		rows, err := tx.Query(ctx, `
			SELECT ci.id, ci.item_id, i.name, ci.quantity,
			       ci.unit_price::float8, ci.total_price::float8,
			       ci.location_id::text
			FROM cart_items ci
			JOIN items i ON i.id = ci.item_id
			WHERE ci.customer_id = $1
			ORDER BY ci.created_at`,
			customerID,
		)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var l CartLine
			if err := rows.Scan(&l.CartItemID, &l.ItemID, &l.ItemName, &l.Quantity,
				&l.UnitPrice, &l.TotalPrice, &locationID); err != nil {
				return err
			}
			subtotal += l.TotalPrice
			lines = append(lines, l)
		}
		return rows.Err()
	})
	if err != nil {
		return nil, err
	}

	// Load modifier labels per cart item.
	// option_id in cart_item_variations stores the modifiers.id.
	for idx := range lines {
		err := db.Scoped(ctx, s.pool, db.ServiceRoleScope(), func(tx pgx.Tx) error {
			rows, err := tx.Query(ctx, `
				SELECT m.name
				FROM cart_item_variations civ
				JOIN modifiers m ON m.id = civ.option_id
				WHERE civ.cart_item_id = $1`,
				lines[idx].CartItemID,
			)
			if err != nil {
				return err
			}
			defer rows.Close()
			for rows.Next() {
				var name string
				if err := rows.Scan(&name); err != nil {
					return err
				}
				lines[idx].Modifiers = append(lines[idx].Modifiers, name)
			}
			return rows.Err()
		})
		if err != nil {
			log.Printf("customerchat: ViewCart modifiers for %s: %v", lines[idx].CartItemID, err)
		}
	}

	return &CartView{
		LocationID: locationID,
		Lines:      lines,
		Subtotal:   math.Round(subtotal*100) / 100,
	}, nil
}

// ── Tool: confirm_order ───────────────────────────────────────────────────────

// ConfirmOrder creates an order from the customer's cart and clears it.
// Uses ServiceRoleScope for all writes; the customer's own ID is the boundary.
func (s *Store) ConfirmOrder(ctx context.Context, customerID string) (*OrderConfirmation, error) {
	// 1. Read cart to discover location and build order items.
	cart, err := s.ViewCart(ctx, customerID)
	if err != nil {
		return nil, fmt.Errorf("confirm_order: read cart: %w", err)
	}
	if len(cart.Lines) == 0 {
		return nil, fmt.Errorf("cart is empty")
	}

	// 2. Resolve organisation from location.
	var orgID string
	err = db.Scoped(ctx, s.pool, db.ServiceRoleScope(), func(tx pgx.Tx) error {
		return tx.QueryRow(ctx,
			`SELECT organization_id::text FROM locations WHERE id = $1`,
			cart.LocationID,
		).Scan(&orgID)
	})
	if err != nil {
		return nil, fmt.Errorf("confirm_order: resolve org: %w", err)
	}

	// 3. Resolve currency.
	cur, curErr := locations.CurrencyFor(ctx, s.pool, cart.LocationID)
	if curErr != nil {
		log.Printf("customerchat: ConfirmOrder: CurrencyFor(%s): %v — defaulting ZAR", cart.LocationID, curErr)
		cur = locations.Currency{Code: "ZAR", Symbol: "R", Decimals: 2}
	}

	orderNumber := fmt.Sprintf("CH%08d", time.Now().UnixMilli()%100000000)
	subtotalCents := int64(math.Round(cart.Subtotal * 100))

	var orderID string
	err = db.Scoped(ctx, s.pool, db.ServiceRoleScope(), func(tx pgx.Tx) error {
		if err := tx.QueryRow(ctx, `
			INSERT INTO orders (
			    organization_id, location_id, customer_id, order_number,
			    order_type, fulfillment_type, status,
			    subtotal_cents, delivery_fee_cents, tax_cents, total_cents, tax_rate,
			    currency_code, estimated_prep_time
			)
			VALUES ($1, $2, $3, $4, 'pickup', 'collection', 'pending',
			        $5, 0, 0, $5, 0, $6, 30)
			RETURNING id::text`,
			orgID, cart.LocationID, customerID, orderNumber,
			subtotalCents, cur.Code,
		).Scan(&orderID); err != nil {
			return fmt.Errorf("insert order: %w", err)
		}

		for _, line := range cart.Lines {
			unitCents := int64(math.Round(line.UnitPrice * 100))
			totalCents := int64(math.Round(line.TotalPrice * 100))
			if _, err := tx.Exec(ctx, `
				INSERT INTO order_items (order_id, item_id, quantity, unit_price_cents, total_price_cents)
				VALUES ($1, $2, $3, $4, $5)`,
				orderID, line.ItemID, line.Quantity, unitCents, totalCents,
			); err != nil {
				return fmt.Errorf("insert order_item %s: %w", line.ItemID, err)
			}
		}
		// Clear cart within the same transaction.
		if _, err := tx.Exec(ctx,
			`DELETE FROM cart_items WHERE customer_id = $1`,
			customerID,
		); err != nil {
			return fmt.Errorf("clear cart: %w", err)
		}
		return nil
	})
	if err != nil {
		return nil, err
	}

	return &OrderConfirmation{
		OrderID:     orderID,
		OrderNumber: orderNumber,
		TotalAmount: cart.Subtotal,
	}, nil
}

// ── Tool: track_order ─────────────────────────────────────────────────────────

// TrackOrder returns the current status of an order identified by tracking token.
// Replicates the tracking store's token-resolution logic read-only.
func (s *Store) TrackOrder(ctx context.Context, token string) (*OrderStatus, error) {
	var out OrderStatus
	err := db.Scoped(ctx, s.pool, db.ServiceRoleScope(), func(tx pgx.Tx) error {
		return tx.QueryRow(ctx, `
			SELECT o.id::text, o.order_number, o.status::text, o.created_at::text
			FROM order_tracking_tokens ott
			JOIN orders o ON o.id = ott.order_id
			WHERE ott.token = $1
			  AND ott.revoked_at IS NULL
			  AND ott.expires_at > now()`,
			token,
		).Scan(&out.OrderID, &out.OrderNumber, &out.Status, &out.CreatedAt)
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, fmt.Errorf("tracking token not found or expired")
	}
	return &out, err
}

// ── LLM usage metering ────────────────────────────────────────────────────────

// RecordLLMUsage inserts a row into llm_messages under ServiceRoleScope
// (the table's INSERT policy requires is_service_role()). orgID may be empty
// (uses a placeholder org) — callers should pass the customer's org when known.
func (s *Store) RecordLLMUsage(ctx context.Context, orgID, convID, provider, model string, tokensIn, tokensOut int) {
	if orgID == "" {
		// llm_messages has a NOT NULL FK on organization_id; skip metering when unknown.
		return
	}
	err := db.Scoped(ctx, s.pool, db.ServiceRoleScope(), func(tx pgx.Tx) error {
		_, err := tx.Exec(ctx, `
			INSERT INTO llm_messages (organization_id, conversation_id, provider, model, tokens_in, tokens_out, cost_cents)
			VALUES ($1, $2, $3, $4, $5, $6, 0)`,
			orgID, convID, provider, model, tokensIn, tokensOut,
		)
		return err
	})
	if err != nil {
		log.Printf("customerchat: RecordLLMUsage: %v", err)
	}
}

// ── Customer resolution ───────────────────────────────────────────────────────

// CustomerByProfileID returns the customers.id (not profile_id) for the given
// auth_users.id (JWT sub). Returns ("", nil) when no customer row exists yet
// for this profile.
func (s *Store) CustomerByProfileID(ctx context.Context, profileID string) (customerID, orgID string, err error) {
	err = db.Scoped(ctx, s.pool, db.ServiceRoleScope(), func(tx pgx.Tx) error {
		return tx.QueryRow(ctx,
			`SELECT id::text, organization_id::text FROM customers WHERE profile_id = $1 LIMIT 1`,
			profileID,
		).Scan(&customerID, &orgID)
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return "", "", nil
	}
	return customerID, orgID, err
}
