// Command seeddemo populates an organization with realistic demo data so the
// BeepBite dashboard looks alive.
//
// Usage:
//
//	go run ./cmd/seeddemo --email owner@example.com   # resolves org via org membership
//	go run ./cmd/seeddemo --org   <uuid>              # direct org id
//	go run ./cmd/seeddemo --env   dev --email ...     # target a non-local env
//
// All inserts run as service_role to bypass RLS (db.Scoped + db.ServiceRoleScope).
// The command is idempotent: each section is skipped if the org already has data.
package main

import (
	"context"
	"flag"
	"fmt"
	"log"
	"math/rand"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"golang.org/x/crypto/bcrypt"

	"github.com/beepbite/backend/internal/config"
	"github.com/beepbite/backend/internal/db"
)

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

func main() {
	envFlag := flag.String("env", "", "environment: local (default), dev, main")
	emailFlag := flag.String("email", "", "owner email — resolve org via organization_members")
	orgFlag := flag.String("org", "", "organization UUID (alternative to --email)")
	flag.Parse()

	if *emailFlag == "" && *orgFlag == "" {
		log.Fatal("provide --email or --org")
	}

	cfg, err := config.Load(*envFlag)
	if err != nil {
		log.Fatalf("config: %v", err)
	}

	ctx := context.Background()
	pool, err := pgxpool.New(ctx, cfg.DatabaseURL)
	if err != nil {
		log.Fatalf("connect db: %v", err)
	}
	defer pool.Close()

	s := &seeder{pool: pool, ctx: ctx}

	// Ensure baseline reference data (payment_methods) exists.
	if err := s.ensurePaymentMethods(); err != nil {
		log.Fatalf("ensure payment methods: %v", err)
	}

	// Resolve org ID.
	var orgID, orgName string
	if *emailFlag != "" {
		orgID, orgName, err = s.resolveOrgByEmail(*emailFlag)
		if err != nil {
			log.Fatalf("resolve org: %v", err)
		}
	} else {
		orgID = *orgFlag
		orgName, err = s.resolveOrgName(orgID)
		if err != nil {
			log.Fatalf("resolve org name: %v", err)
		}
	}
	log.Printf("seeding org %q (%s)", orgName, orgID)

	sum, err := s.seed(orgID, orgName)
	if err != nil {
		log.Fatalf("seed: %v", err)
	}

	// Print summary.
	fmt.Println()
	fmt.Println("=== BeepBite Demo Seed Summary ===")
	fmt.Printf("Org:            %s (%s)\n", orgName, orgID)
	fmt.Printf("Location:       %s (slug: %s)\n", sum.locationName, sum.locationSlug)
	fmt.Printf("Categories:     %d\n", sum.categories)
	fmt.Printf("Items:          %d\n", sum.items)
	fmt.Printf("Modifier groups:%d\n", sum.modifierGroups)
	fmt.Printf("KDS stations:   %d\n", sum.stations)
	fmt.Printf("Staff:          %d (username: cashier  PIN: 1234)\n", sum.staff)
	fmt.Printf("Customers:      %d\n", sum.customers)
	fmt.Printf("Orders:         %d completed\n", sum.orders)
	fmt.Printf("Cash drawer:    %s\n", sum.drawerNote)
	fmt.Println()
	fmt.Println("POS login: location slug =", sum.locationSlug, "| username = cashier | PIN = 1234")
}

// ---------------------------------------------------------------------------
// seeder
// ---------------------------------------------------------------------------

type seeder struct {
	pool *pgxpool.Pool
	ctx  context.Context
}

type summary struct {
	locationName   string
	locationSlug   string
	categories     int
	items          int
	modifierGroups int
	stations       int
	staff          int
	customers      int
	orders         int
	drawerNote     string
}

func (s *seeder) resolveOrgByEmail(email string) (string, string, error) {
	var orgID, orgName string
	err := db.Scoped(s.ctx, s.pool, db.ServiceRoleScope(), func(tx pgx.Tx) error {
		return tx.QueryRow(s.ctx, `
			SELECT o.id, o.name
			FROM organizations o
			JOIN organization_members om ON om.organization_id = o.id
			JOIN profiles p ON p.id = om.profile_id
			WHERE lower(p.email) = lower($1) AND o.is_active = true
			LIMIT 1
		`, email).Scan(&orgID, &orgName)
	})
	if err != nil {
		return "", "", fmt.Errorf("no active org for email %q: %w", email, err)
	}
	return orgID, orgName, nil
}

func (s *seeder) resolveOrgName(orgID string) (string, error) {
	var name string
	err := db.Scoped(s.ctx, s.pool, db.ServiceRoleScope(), func(tx pgx.Tx) error {
		return tx.QueryRow(s.ctx, `SELECT name FROM organizations WHERE id = $1`, orgID).Scan(&name)
	})
	if err != nil {
		return "", fmt.Errorf("org %q not found: %w", orgID, err)
	}
	return name, nil
}

// seed runs all sections idempotently under service_role.
func (s *seeder) seed(orgID, orgName string) (*summary, error) {
	sum := &summary{}

	// 1. Location
	locID, locName, locSlug, created, err := s.seedLocation(orgID, orgName)
	if err != nil {
		return nil, fmt.Errorf("location: %w", err)
	}
	sum.locationName = locName
	sum.locationSlug = locSlug
	if !created {
		log.Printf("  location already exists (%s), using it", locName)
	}

	// 2. Categories
	catIDs, n, err := s.seedCategories(orgID, locID)
	if err != nil {
		return nil, fmt.Errorf("categories: %w", err)
	}
	sum.categories = n
	log.Printf("  categories: %d (created or existing)", n)

	// 3. Items
	itemMap, n, err := s.seedItems(orgID, locID, catIDs)
	if err != nil {
		return nil, fmt.Errorf("items: %w", err)
	}
	sum.items = n
	log.Printf("  items: %d", n)

	// 4. Modifier groups
	n, err = s.seedModifiers(itemMap)
	if err != nil {
		return nil, fmt.Errorf("modifiers: %w", err)
	}
	sum.modifierGroups = n
	log.Printf("  modifier groups: %d", n)

	// 5. KDS stations
	stationMap, n, err := s.seedStations(locID, catIDs, itemMap)
	if err != nil {
		return nil, fmt.Errorf("stations: %w", err)
	}
	sum.stations = n
	log.Printf("  KDS stations: %d", n)

	// 6. Staff
	n, err = s.seedStaff(locID)
	if err != nil {
		return nil, fmt.Errorf("staff: %w", err)
	}
	sum.staff = n
	log.Printf("  staff: %d", n)

	// 7. Customers
	custIDs, n, err := s.seedCustomers(orgID)
	if err != nil {
		return nil, fmt.Errorf("customers: %w", err)
	}
	sum.customers = n
	log.Printf("  customers: %d", n)

	// 8. Orders
	n, err = s.seedOrders(orgID, locID, custIDs, itemMap, stationMap)
	if err != nil {
		return nil, fmt.Errorf("orders: %w", err)
	}
	sum.orders = n
	log.Printf("  orders: %d", n)

	// 9. Cash drawer
	note, err := s.seedCashDrawer(locID)
	if err != nil {
		return nil, fmt.Errorf("cash drawer: %w", err)
	}
	sum.drawerNote = note
	log.Printf("  cash drawer: %s", note)

	return sum, nil
}

// ---------------------------------------------------------------------------
// 0. Ensure reference data: payment_methods
// ---------------------------------------------------------------------------

func (s *seeder) ensurePaymentMethods() error {
	return db.Scoped(s.ctx, s.pool, db.ServiceRoleScope(), func(tx pgx.Tx) error {
		methods := []struct {
			code, name, kind string
		}{
			{"cash", "Cash", "offline"},
			{"card", "Card Machine", "offline"},
			{"card_on_delivery", "Card on delivery", "offline"},
			{"cash_on_delivery", "Cash on delivery", "offline"},
			{"transfer", "Bank Transfer", "offline"},
			{"voucher", "Voucher", "offline"},
		}
		for _, m := range methods {
			_, err := tx.Exec(s.ctx, `
				INSERT INTO payment_methods (code, name, kind, requires_reference, supports_tips, is_active)
				VALUES ($1, $2, $3, false, true, true)
				ON CONFLICT (code) DO NOTHING
			`, m.code, m.name, m.kind)
			if err != nil {
				return fmt.Errorf("payment method %q: %w", m.code, err)
			}
		}
		return nil
	})
}

// ---------------------------------------------------------------------------
// 1. Location
// ---------------------------------------------------------------------------

func (s *seeder) seedLocation(orgID, orgName string) (id, name, slug string, created bool, err error) {
	// Check existing.
	err = db.Scoped(s.ctx, s.pool, db.ServiceRoleScope(), func(tx pgx.Tx) error {
		return tx.QueryRow(s.ctx, `
			SELECT id, name, COALESCE(slug,'') FROM locations WHERE organization_id = $1 LIMIT 1
		`, orgID).Scan(&id, &name, &slug)
	})
	if err == nil {
		return id, name, slug, false, nil
	}

	// Create one.
	name = orgName + " — Main"
	slug = slugify(name)
	err = db.Scoped(s.ctx, s.pool, db.ServiceRoleScope(), func(tx pgx.Tx) error {
		return tx.QueryRow(s.ctx, `
			INSERT INTO locations (
				organization_id, name, slug,
				city, country, address,
				currency_code,
				is_marketplace_visible,
				offers_collection, offers_delivery,
				on_delivery_payment_methods
			) VALUES (
				$1, $2, $3,
				'Johannesburg', 'ZA', '1 Demo Street, Sandton, 2196',
				'ZAR',
				true,
				true, true,
				ARRAY['cash','card_on_delivery']
			) RETURNING id
		`, orgID, name, slug).Scan(&id)
	})
	if err != nil {
		return "", "", "", false, err
	}
	return id, name, slug, true, nil
}

// ---------------------------------------------------------------------------
// 2. Categories
// ---------------------------------------------------------------------------

type categoryMap map[string]string // name → id

func (s *seeder) seedCategories(orgID, locID string) (categoryMap, int, error) {
	m := categoryMap{}

	// Check existing.
	var count int
	_ = db.Scoped(s.ctx, s.pool, db.ServiceRoleScope(), func(tx pgx.Tx) error {
		return tx.QueryRow(s.ctx,
			`SELECT count(*) FROM categories WHERE location_id = $1`, locID).Scan(&count)
	})
	if count > 0 {
		// Load existing.
		_ = db.Scoped(s.ctx, s.pool, db.ServiceRoleScope(), func(tx pgx.Tx) error {
			rows, err := tx.Query(s.ctx,
				`SELECT id, name FROM categories WHERE location_id = $1`, locID)
			if err != nil {
				return err
			}
			defer rows.Close()
			for rows.Next() {
				var cid, cname string
				if err := rows.Scan(&cid, &cname); err != nil {
					return err
				}
				m[cname] = cid
			}
			return rows.Err()
		})
		return m, count, nil
	}

	cats := []string{"Burgers", "Sides", "Drinks", "Desserts"}
	for i, cat := range cats {
		var cid string
		err := db.Scoped(s.ctx, s.pool, db.ServiceRoleScope(), func(tx pgx.Tx) error {
			return tx.QueryRow(s.ctx, `
				INSERT INTO categories (location_id, organization_id, name, sort_order, is_active)
				VALUES ($1, $2, $3, $4, true)
				ON CONFLICT (location_id, name) DO UPDATE SET sort_order = EXCLUDED.sort_order
				RETURNING id
			`, locID, orgID, cat, i).Scan(&cid)
		})
		if err != nil {
			return nil, 0, fmt.Errorf("category %q: %w", cat, err)
		}
		m[cat] = cid
	}
	return m, len(cats), nil
}

// ---------------------------------------------------------------------------
// 3. Items
// ---------------------------------------------------------------------------

// itemEntry describes a demo menu item.
type itemEntry struct {
	name     string
	cat      string
	price    float64 // in rand (decimal)
	calories int
}

var demoItems = []itemEntry{
	{"Classic Burger", "Burgers", 89.00, 650},
	{"Cheese Burger", "Burgers", 99.00, 720},
	{"Bacon Burger", "Burgers", 119.00, 810},
	{"Chicken Burger", "Burgers", 95.00, 580},
	{"Fries", "Sides", 35.00, 380},
	{"Onion Rings", "Sides", 45.00, 420},
	{"Coke", "Drinks", 25.00, 140},
	{"Sprite", "Drinks", 25.00, 120},
	{"Water", "Drinks", 15.00, 0},
	{"Milkshake", "Drinks", 49.00, 480},
	{"Ice Cream", "Desserts", 35.00, 310},
	{"Brownie", "Desserts", 45.00, 420},
}

type itemMap map[string]string // name → id

func (s *seeder) seedItems(orgID, locID string, cats categoryMap) (itemMap, int, error) {
	m := itemMap{}

	// Check existing.
	var count int
	_ = db.Scoped(s.ctx, s.pool, db.ServiceRoleScope(), func(tx pgx.Tx) error {
		return tx.QueryRow(s.ctx,
			`SELECT count(*) FROM items WHERE location_id = $1`, locID).Scan(&count)
	})
	if count > 0 {
		_ = db.Scoped(s.ctx, s.pool, db.ServiceRoleScope(), func(tx pgx.Tx) error {
			rows, err := tx.Query(s.ctx,
				`SELECT id, name FROM items WHERE location_id = $1`, locID)
			if err != nil {
				return err
			}
			defer rows.Close()
			for rows.Next() {
				var iid, iname string
				if err := rows.Scan(&iid, &iname); err != nil {
					return err
				}
				m[iname] = iid
			}
			return rows.Err()
		})
		return m, count, nil
	}

	for i, it := range demoItems {
		catID, ok := cats[it.cat]
		if !ok {
			return nil, 0, fmt.Errorf("unknown category %q", it.cat)
		}
		var iid string
		err := db.Scoped(s.ctx, s.pool, db.ServiceRoleScope(), func(tx pgx.Tx) error {
			return tx.QueryRow(s.ctx, `
				INSERT INTO items (
					location_id, category_id, name, price,
					is_active, sort_order, calories
				) VALUES ($1, $2, $3, $4, true, $5, $6)
				RETURNING id
			`, locID, catID, it.name, it.price, i, it.calories).Scan(&iid)
		})
		if err != nil {
			return nil, 0, fmt.Errorf("item %q: %w", it.name, err)
		}
		m[it.name] = iid
	}
	return m, len(demoItems), nil
}

// ---------------------------------------------------------------------------
// 4. Modifier groups
// ---------------------------------------------------------------------------

func (s *seeder) seedModifiers(items itemMap) (int, error) {
	burgerNames := []string{"Classic Burger", "Cheese Burger", "Bacon Burger", "Chicken Burger"}

	created := 0
	for _, bName := range burgerNames {
		itemID, ok := items[bName]
		if !ok {
			continue
		}

		// Check existing modifier groups for this item.
		var cnt int
		_ = db.Scoped(s.ctx, s.pool, db.ServiceRoleScope(), func(tx pgx.Tx) error {
			return tx.QueryRow(s.ctx,
				`SELECT count(*) FROM modifier_groups WHERE item_id = $1`, itemID).Scan(&cnt)
		})
		if cnt > 0 {
			continue
		}

		// Add-ons group (min 0, max 5)
		var addonsGroupID string
		err := db.Scoped(s.ctx, s.pool, db.ServiceRoleScope(), func(tx pgx.Tx) error {
			return tx.QueryRow(s.ctx, `
				INSERT INTO modifier_groups (item_id, name, min_select, max_select, is_required, sort_order)
				VALUES ($1, 'Add-ons', 0, 5, false, 0)
				RETURNING id
			`, itemID).Scan(&addonsGroupID)
		})
		if err != nil {
			return 0, fmt.Errorf("modifier group add-ons for %q: %w", bName, err)
		}

		// Add-on options
		addons := []struct {
			name  string
			delta int64
		}{
			{"Extra Cheese", 1500},
			{"Bacon", 2000},
			{"Avo", 2500},
		}
		for j, a := range addons {
			err := db.Scoped(s.ctx, s.pool, db.ServiceRoleScope(), func(tx pgx.Tx) error {
				_, err := tx.Exec(s.ctx, `
					INSERT INTO modifiers (modifier_group_id, name, price_delta_cents, sort_order, is_active)
					VALUES ($1, $2, $3, $4, true)
				`, addonsGroupID, a.name, a.delta, j)
				return err
			})
			if err != nil {
				return 0, fmt.Errorf("modifier %q: %w", a.name, err)
			}
		}
		created++

		// Cook level group (required, min 1 max 1)
		var cookGroupID string
		err = db.Scoped(s.ctx, s.pool, db.ServiceRoleScope(), func(tx pgx.Tx) error {
			return tx.QueryRow(s.ctx, `
				INSERT INTO modifier_groups (item_id, name, min_select, max_select, is_required, sort_order)
				VALUES ($1, 'Cook level', 1, 1, true, 1)
				RETURNING id
			`, itemID).Scan(&cookGroupID)
		})
		if err != nil {
			return 0, fmt.Errorf("modifier group cook level for %q: %w", bName, err)
		}
		for j, opt := range []string{"Medium", "Well Done"} {
			err := db.Scoped(s.ctx, s.pool, db.ServiceRoleScope(), func(tx pgx.Tx) error {
				_, err := tx.Exec(s.ctx, `
					INSERT INTO modifiers (modifier_group_id, name, price_delta_cents, sort_order, is_active, is_default)
					VALUES ($1, $2, 0, $3, true, $4)
				`, cookGroupID, opt, j, j == 0)
				return err
			})
			if err != nil {
				return 0, fmt.Errorf("modifier %q: %w", opt, err)
			}
		}
		created++
	}
	return created, nil
}

// ---------------------------------------------------------------------------
// 5. KDS Stations
// ---------------------------------------------------------------------------

type stationMap map[string]string // name → id

func (s *seeder) seedStations(locID string, cats categoryMap, items itemMap) (stationMap, int, error) {
	sm := stationMap{}

	// Load any existing stations.
	_ = db.Scoped(s.ctx, s.pool, db.ServiceRoleScope(), func(tx pgx.Tx) error {
		rows, err := tx.Query(s.ctx,
			`SELECT id, name FROM kitchen_stations WHERE location_id = $1`, locID)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var sid, sname string
			if err := rows.Scan(&sid, &sname); err != nil {
				return err
			}
			sm[sname] = sid
		}
		return rows.Err()
	})

	// If the only pre-existing station is the auto-created "Kitchen" stub
	// (inserted by the trg_location_default_kitchen_station trigger), delete it
	// so we can replace it with the proper demo stations (Grill + Bar).
	demoStationNames := map[string]bool{"Grill": true, "Bar": true}
	hasDemoStation := false
	for name := range sm {
		if demoStationNames[name] {
			hasDemoStation = true
			break
		}
	}
	if hasDemoStation {
		// Demo stations already exist; nothing to do.
		return sm, len(sm), nil
	}
	if _, hasKitchen := sm["Kitchen"]; hasKitchen && len(sm) == 1 {
		// Auto-stub only — remove it so we can seed the real demo stations.
		_ = db.Scoped(s.ctx, s.pool, db.ServiceRoleScope(), func(tx pgx.Tx) error {
			_, err := tx.Exec(s.ctx,
				`DELETE FROM kitchen_stations WHERE location_id = $1 AND name = 'Kitchen'`, locID)
			return err
		})
		sm = stationMap{}
		log.Printf("  removed auto-created 'Kitchen' stub; creating demo stations")
	} else if len(sm) > 0 {
		// Unknown stations already exist — leave them and return as-is.
		return sm, len(sm), nil
	}

	stations := []struct {
		name       string
		stype      string
		categories []string
	}{
		{"Grill", "prep", []string{"Burgers", "Sides"}},
		{"Bar", "bar", []string{"Drinks"}},
	}

	for i, st := range stations {
		var sid string
		err := db.Scoped(s.ctx, s.pool, db.ServiceRoleScope(), func(tx pgx.Tx) error {
			return tx.QueryRow(s.ctx, `
				INSERT INTO kitchen_stations (location_id, name, station_type, sort_order, is_active)
				VALUES ($1, $2, $3, $4, true)
				ON CONFLICT (location_id, name) DO UPDATE SET station_type = EXCLUDED.station_type
				RETURNING id
			`, locID, st.name, st.stype, i).Scan(&sid)
		})
		if err != nil {
			return nil, 0, fmt.Errorf("station %q: %w", st.name, err)
		}
		sm[st.name] = sid

		// Category routing
		for _, catName := range st.categories {
			catID, ok := cats[catName]
			if !ok {
				continue
			}
			_ = db.Scoped(s.ctx, s.pool, db.ServiceRoleScope(), func(tx pgx.Tx) error {
				_, err := tx.Exec(s.ctx, `
					INSERT INTO category_station_routing (category_id, station_id, is_primary)
					VALUES ($1, $2, true)
					ON CONFLICT (category_id, station_id) DO NOTHING
				`, catID, sid)
				return err
			})

			// Explicit per-item routing for every item in this category. The
			// KDS fanout falls back to category/location routing, but seeding
			// item_station_routing directly makes the demo data match what a
			// real merchant configures and guarantees fanout produces tickets
			// regardless of which routing layer the fanout query consults.
			_ = db.Scoped(s.ctx, s.pool, db.ServiceRoleScope(), func(tx pgx.Tx) error {
				_, err := tx.Exec(s.ctx, `
					INSERT INTO item_station_routing (item_id, station_id, is_primary)
					SELECT i.id, $2, true
					FROM items i
					WHERE i.category_id = $1
					ON CONFLICT (item_id, station_id) DO NOTHING
				`, catID, sid)
				return err
			})
		}
	}
	return sm, len(stations), nil
}

// ---------------------------------------------------------------------------
// 6. Staff
// ---------------------------------------------------------------------------

func (s *seeder) seedStaff(locID string) (int, error) {
	var cnt int
	_ = db.Scoped(s.ctx, s.pool, db.ServiceRoleScope(), func(tx pgx.Tx) error {
		return tx.QueryRow(s.ctx,
			`SELECT count(*) FROM staff WHERE location_id = $1`, locID).Scan(&cnt)
	})
	if cnt > 0 {
		return cnt, nil
	}

	pinHash, err := bcrypt.GenerateFromPassword([]byte("1234"), bcrypt.DefaultCost)
	if err != nil {
		return 0, fmt.Errorf("bcrypt: %w", err)
	}

	err = db.Scoped(s.ctx, s.pool, db.ServiceRoleScope(), func(tx pgx.Tx) error {
		_, err := tx.Exec(s.ctx, `
			INSERT INTO staff (
				location_id, first_name, last_name, display_name,
				role, username, pin_hash, is_active
			) VALUES (
				$1, 'Demo', 'Cashier', 'Demo Cashier',
				'cashier', 'cashier', $2, true
			)
		`, locID, string(pinHash))
		return err
	})
	if err != nil {
		return 0, err
	}
	return 1, nil
}

// ---------------------------------------------------------------------------
// 7. Customers
// ---------------------------------------------------------------------------

var demoCustomers = []struct {
	first, last, whatsapp string
}{
	{"Thabo", "Nkosi", "+27821234567"},
	{"Priya", "Pillay", "+27839876543"},
	{"James", "van der Berg", "+27711112222"},
}

func (s *seeder) seedCustomers(orgID string) ([]string, int, error) {
	var cnt int
	_ = db.Scoped(s.ctx, s.pool, db.ServiceRoleScope(), func(tx pgx.Tx) error {
		return tx.QueryRow(s.ctx,
			`SELECT count(*) FROM customers WHERE organization_id = $1`, orgID).Scan(&cnt)
	})
	if cnt > 0 {
		var ids []string
		_ = db.Scoped(s.ctx, s.pool, db.ServiceRoleScope(), func(tx pgx.Tx) error {
			rows, err := tx.Query(s.ctx,
				`SELECT id FROM customers WHERE organization_id = $1 LIMIT 10`, orgID)
			if err != nil {
				return err
			}
			defer rows.Close()
			for rows.Next() {
				var cid string
				if err := rows.Scan(&cid); err != nil {
					return err
				}
				ids = append(ids, cid)
			}
			return rows.Err()
		})
		return ids, cnt, nil
	}

	var ids []string
	for _, c := range demoCustomers {
		var cid string
		err := db.Scoped(s.ctx, s.pool, db.ServiceRoleScope(), func(tx pgx.Tx) error {
			return tx.QueryRow(s.ctx, `
				INSERT INTO customers (organization_id, whatsapp_number, first_name, last_name)
				VALUES ($1, $2, $3, $4)
				ON CONFLICT (organization_id, whatsapp_number) DO UPDATE
					SET first_name = EXCLUDED.first_name
				RETURNING id
			`, orgID, c.whatsapp, c.first, c.last).Scan(&cid)
		})
		if err != nil {
			return nil, 0, fmt.Errorf("customer %q: %w", c.first, err)
		}
		ids = append(ids, cid)
	}
	return ids, len(demoCustomers), nil
}

// ---------------------------------------------------------------------------
// 8. Orders
// ---------------------------------------------------------------------------

// itemPriceCents maps item name → price in cents (matches demoItems).
var itemPriceCents = map[string]int64{
	"Classic Burger": 8900,
	"Cheese Burger":  9900,
	"Bacon Burger":   11900,
	"Chicken Burger": 9500,
	"Fries":          3500,
	"Onion Rings":    4500,
	"Coke":           2500,
	"Sprite":         2500,
	"Water":          1500,
	"Milkshake":      4900,
	"Ice Cream":      3500,
	"Brownie":        4500,
}

// demoItemNames is the ordered list of item names used by the generator.
var demoItemNames = []string{
	"Classic Burger", "Cheese Burger", "Bacon Burger", "Chicken Burger",
	"Fries", "Onion Rings",
	"Coke", "Sprite", "Water", "Milkshake",
	"Ice Cream", "Brownie",
}

// fulfillmentPairs pairs fulfillment_type with order_type.
var fulfillmentPairs = [][2]string{
	{"dine_in", "dine_in"},
	{"collection", "pickup"},
	{"delivery", "delivery"},
}

// payMethods alternates between cash and card.
var payMethods = []string{"cash", "card_in_person"}

// hourWeights defines relative order probability per hour of day (index = hour 0–23).
// Peaks at lunch (11–14) and dinner (18–21), near-zero overnight.
var hourWeights = [24]int{
	0, 0, 0, 0, 0, 0, // 00–05 closed
	1, 2, 3, // 06–08 early morning trickle
	5, 8, // 09–10 mid-morning
	20, 25, 22, 18, // 11–14 lunch peak
	12, 10, // 15–16 afternoon
	14, 20, 25, 22, // 17–20 dinner peak
	15, 8, 3, // 21–23 wind-down
}

// dayWeights defines relative order probability per weekday (0=Sun … 6=Sat).
// Weekends (Fri=6, Sat=0 in Go: Sun=0, Mon=1…Sat=6) are busiest.
// Go time.Weekday: Sunday=0, Monday=1, …, Saturday=6.
var dayWeights = [7]int{
	18, // Sunday
	10, // Monday
	10, // Tuesday
	12, // Wednesday
	14, // Thursday
	20, // Friday
	22, // Saturday
}

// hourCDF and dayCDF are precomputed cumulative weight tables for fast sampling.
var (
	hourCDF [24]int
	dayCDF  [7]int
)

func init() {
	sum := 0
	for i, w := range hourWeights {
		sum += w
		hourCDF[i] = sum
	}
	sum = 0
	for i, w := range dayWeights {
		sum += w
		dayCDF[i] = sum
	}
}

// pickWeighted returns an index in [0, len(cdf)) sampled proportionally.
func pickWeighted(rng *rand.Rand, cdf []int) int {
	total := cdf[len(cdf)-1]
	r := rng.Intn(total) + 1
	for i, v := range cdf {
		if r <= v {
			return i
		}
	}
	return len(cdf) - 1
}

// seedOrders generates ~1 200 completed orders spread across the last 365 days
// with realistic lunch/dinner peaks and weekend weighting. The order history
// has a mild upward trend so period-over-period dashboard deltas are non-trivial.
//
// Idempotency guard: skip if the org already has ≥ 100 orders (meaning a rich
// history was already seeded). Orgs with the old 5-order stub (cnt < 100) get
// the full rich history on the next run.
func (s *seeder) seedOrders(orgID, locID string, custIDs []string, items itemMap, stations stationMap) (int, error) {
	var cnt int
	_ = db.Scoped(s.ctx, s.pool, db.ServiceRoleScope(), func(tx pgx.Tx) error {
		return tx.QueryRow(s.ctx,
			`SELECT count(*) FROM orders WHERE organization_id = $1`, orgID).Scan(&cnt)
	})
	if cnt >= 100 {
		return cnt, nil
	}

	rng := rand.New(rand.NewSource(42))

	now := time.Now().UTC()
	// Reference point: midnight at the start of "today".
	today := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, time.UTC)

	// Build the list of (day offset → number of orders) for 365 days.
	// Total target: ~1 200 orders. Apply a mild upward trend: the first month
	// gets weight 0.6×base and the last month gets 1.4×base, linearly interpolated.
	const targetOrders = 1200
	const days = 365

	// dayOrderCounts[i] = number of orders to place i days ago (0 = today).
	dayOrderCounts := make([]int, days)
	floatTotal := 0.0
	for i := 0; i < days; i++ {
		// i=0 is today (newest, factor=1.4); i=364 is oldest (factor=0.6).
		trendFactor := 1.4 - 0.8*float64(i)/float64(days-1)
		dayDate := today.AddDate(0, 0, -i)
		dow := int(dayDate.Weekday()) // 0=Sun…6=Sat
		dayW := float64(dayWeights[dow])
		floatTotal += dayW * trendFactor
	}
	scale := float64(targetOrders) / floatTotal

	for i := 0; i < days; i++ {
		dayDate := today.AddDate(0, 0, -i)
		dow := int(dayDate.Weekday())
		trendFactor := 1.4 - 0.8*float64(i)/float64(days-1)
		dayW := float64(dayWeights[dow])
		expected := dayW * trendFactor * scale
		// Stochastic rounding so totals stay close to target.
		base := int(expected)
		if rng.Float64() < expected-float64(base) {
			base++
		}
		dayOrderCounts[i] = base
	}

	// Insert orders in batches of ~50 days at a time (one Scoped tx per batch).
	const batchDays = 50
	created := 0
	orderSeq := cnt // continue numbering after any pre-existing orders

	for batchStart := 0; batchStart < days; batchStart += batchDays {
		batchEnd := batchStart + batchDays
		if batchEnd > days {
			batchEnd = days
		}

		err := db.Scoped(s.ctx, s.pool, db.ServiceRoleScope(), func(tx pgx.Tx) error {
			for dayIdx := batchStart; dayIdx < batchEnd; dayIdx++ {
				nOrders := dayOrderCounts[dayIdx]
				if nOrders == 0 {
					continue
				}
				dayDate := today.AddDate(0, 0, -dayIdx)

				for k := 0; k < nOrders; k++ {
					orderSeq++

					// Pick hour using weighted distribution.
					hour := pickWeighted(rng, hourCDF[:])
					minute := rng.Intn(60)
					orderAt := time.Date(dayDate.Year(), dayDate.Month(), dayDate.Day(),
						hour, minute, rng.Intn(60), 0, time.UTC)

					// Pick fulfillment type.
					fp := fulfillmentPairs[rng.Intn(len(fulfillmentPairs))]
					fulfillmentType := fp[0]
					orderType := fp[1]

					// Pick payment method.
					payCode := payMethods[rng.Intn(len(payMethods))]

					// Pick customer (may be empty).
					custID := ""
					if len(custIDs) > 0 {
						custID = custIDs[rng.Intn(len(custIDs))]
					}

					// Pick 1–4 distinct line items.
					numItems := 1 + rng.Intn(4)
					// Shuffle a copy of demoItemNames and take the first numItems.
					itemIdxs := rng.Perm(len(demoItemNames))
					if numItems > len(demoItemNames) {
						numItems = len(demoItemNames)
					}
					selectedItems := itemIdxs[:numItems]

					// Calculate subtotal (quantities 1–3).
					type lineItem struct {
						name     string
						itemID   string
						qty      int64
						unitCent int64
					}
					var lines []lineItem
					var subtotal int64
					for _, idx := range selectedItems {
						name := demoItemNames[idx]
						itemID, ok := items[name]
						if !ok {
							continue
						}
						qty := int64(1 + rng.Intn(3))
						unitCent := itemPriceCents[name]
						subtotal += unitCent * qty
						lines = append(lines, lineItem{name, itemID, qty, unitCent})
					}
					if len(lines) == 0 {
						continue
					}
					total := subtotal // VAT inclusive (tax_inclusive=true, tax_rate=15%)

					orderNum := fmt.Sprintf("DEMO-%05d", orderSeq)

					// Insert order.
					var orderID string
					var err error
					if custID != "" {
						err = tx.QueryRow(s.ctx, `
							INSERT INTO orders (
								location_id, organization_id, order_number,
								status, fulfillment_type, order_type,
								subtotal_cents, total_cents,
								currency_code, tax_rate, tax_inclusive,
								created_at, updated_at,
								customer_id
							) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
							RETURNING id
						`, locID, orgID, orderNum,
							"completed", fulfillmentType, orderType,
							subtotal, total,
							"ZAR", 15.00, true,
							orderAt, orderAt,
							custID,
						).Scan(&orderID)
					} else {
						err = tx.QueryRow(s.ctx, `
							INSERT INTO orders (
								location_id, organization_id, order_number,
								status, fulfillment_type, order_type,
								subtotal_cents, total_cents,
								currency_code, tax_rate, tax_inclusive,
								created_at, updated_at
							) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
							RETURNING id
						`, locID, orgID, orderNum,
							"completed", fulfillmentType, orderType,
							subtotal, total,
							"ZAR", 15.00, true,
							orderAt, orderAt,
						).Scan(&orderID)
					}
					if err != nil {
						return fmt.Errorf("order %s: %w", orderNum, err)
					}

					// Insert order items.
					for _, line := range lines {
						lineTotal := line.unitCent * line.qty
						_, err := tx.Exec(s.ctx, `
							INSERT INTO order_items (order_id, item_id, quantity, unit_price_cents, total_price_cents)
							VALUES ($1, $2, $3, $4, $5)
						`, orderID, line.itemID, line.qty, line.unitCent, lineTotal)
						if err != nil {
							return fmt.Errorf("order item %q for %s: %w", line.name, orderNum, err)
						}
					}

					// Insert payment.
					_, err = tx.Exec(s.ctx, `
						INSERT INTO order_payments (
							order_id, payment_method_code,
							amount_paid_cents, payment_status, paid_at
						) VALUES ($1, $2, $3, 'completed', $4)
					`, orderID, payCode, total, orderAt)
					if err != nil {
						return fmt.Errorf("order payment for %s: %w", orderNum, err)
					}

					created++
				}
			}
			return nil
		})
		if err != nil {
			return 0, fmt.Errorf("order batch starting day %d: %w", batchStart, err)
		}
		log.Printf("  orders batch days %d–%d: %d inserted so far", batchStart, batchEnd-1, created)
	}

	return created, nil
}

// ---------------------------------------------------------------------------
// 9. Cash drawer
// ---------------------------------------------------------------------------

func (s *seeder) seedCashDrawer(locID string) (string, error) {
	var cnt int
	_ = db.Scoped(s.ctx, s.pool, db.ServiceRoleScope(), func(tx pgx.Tx) error {
		return tx.QueryRow(s.ctx,
			`SELECT count(*) FROM cash_drawers WHERE location_id = $1`, locID).Scan(&cnt)
	})
	if cnt > 0 {
		return "already exists", nil
	}

	var drawerID string
	err := db.Scoped(s.ctx, s.pool, db.ServiceRoleScope(), func(tx pgx.Tx) error {
		return tx.QueryRow(s.ctx, `
			INSERT INTO cash_drawers (location_id, name, is_active)
			VALUES ($1, 'Front Register', true)
			RETURNING id
		`, locID).Scan(&drawerID)
	})
	if err != nil {
		return "", err
	}

	// One closed session.
	err = db.Scoped(s.ctx, s.pool, db.ServiceRoleScope(), func(tx pgx.Tx) error {
		_, err := tx.Exec(s.ctx, `
			INSERT INTO cash_drawer_sessions (
				cash_drawer_id,
				opening_float_cents, declared_closing_cents, expected_closing_cents, over_short_cents,
				status, opened_at, closed_at
			) VALUES (
				$1,
				50000, 185000, 185000, 0,
				'closed',
				now() - interval '12 hours',
				now() - interval '4 hours'
			)
		`, drawerID)
		return err
	})
	if err != nil {
		return "", err
	}
	return "created (Front Register, 1 closed session)", nil
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// slugify converts a display name to a URL-safe slug.
func slugify(s string) string {
	s = strings.ToLower(s)
	var b strings.Builder
	for _, r := range s {
		switch {
		case r >= 'a' && r <= 'z' || r >= '0' && r <= '9':
			b.WriteRune(r)
		case r == ' ' || r == '-' || r == '_' || r == '—':
			b.WriteRune('-')
		}
	}
	// Collapse multiple dashes.
	result := strings.TrimFunc(
		strings.Join(strings.Fields(strings.ReplaceAll(b.String(), "--", "-")), "-"),
		func(r rune) bool { return r == '-' },
	)
	return result
}
