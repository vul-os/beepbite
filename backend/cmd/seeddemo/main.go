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
			{"card_in_person", "Card in person", "offline"},
			{"card_on_delivery", "Card on delivery", "offline"},
			{"cash_on_delivery", "Cash on delivery", "offline"},
			{"eft", "EFT", "offline"},
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
	regionID := ""
	err2 := db.Scoped(s.ctx, s.pool, db.ServiceRoleScope(), func(tx pgx.Tx) error {
		return tx.QueryRow(s.ctx, `SELECT id FROM regions WHERE code='ZA' LIMIT 1`).Scan(&regionID)
	})
	if err2 != nil {
		return "", "", "", false, fmt.Errorf("region ZA not found: %w", err2)
	}

	name = orgName + " — Main"
	slug = slugify(name)
	err = db.Scoped(s.ctx, s.pool, db.ServiceRoleScope(), func(tx pgx.Tx) error {
		return tx.QueryRow(s.ctx, `
			INSERT INTO locations (
				organization_id, region_id, name, slug,
				city, country, address,
				currency_code,
				is_marketplace_visible,
				offers_collection, offers_delivery,
				on_delivery_payment_methods
			) VALUES (
				$1, $2, $3, $4,
				'Johannesburg', 'ZA', '1 Demo Street, Sandton, 2196',
				'ZAR',
				true,
				true, true,
				ARRAY['cash','card_on_delivery']
			) RETURNING id
		`, orgID, regionID, name, slug).Scan(&id)
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

	// Check existing.
	var cnt int
	_ = db.Scoped(s.ctx, s.pool, db.ServiceRoleScope(), func(tx pgx.Tx) error {
		return tx.QueryRow(s.ctx,
			`SELECT count(*) FROM kitchen_stations WHERE location_id = $1`, locID).Scan(&cnt)
	})
	if cnt > 0 {
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
		return sm, cnt, nil
	}

	stations := []struct {
		name        string
		stype       string
		categories  []string
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

type orderSpec struct {
	fulfillment string // dine_in | collection | delivery
	orderType   string // dine_in | pickup | delivery
	daysAgo     int
	itemNames   []string
	payMethod   string // cash | card
}

var demoOrders = []orderSpec{
	{"dine_in", "dine_in", 0, []string{"Classic Burger", "Fries", "Coke"}, "cash"},
	{"collection", "pickup", 1, []string{"Cheese Burger", "Onion Rings", "Milkshake"}, "card"},
	{"delivery", "delivery", 2, []string{"Bacon Burger", "Fries", "Water"}, "cash"},
	{"dine_in", "dine_in", 3, []string{"Chicken Burger", "Sprite", "Ice Cream"}, "card"},
	{"collection", "pickup", 4, []string{"Classic Burger", "Brownie", "Coke"}, "cash"},
}

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

func (s *seeder) seedOrders(orgID, locID string, custIDs []string, items itemMap, stations stationMap) (int, error) {
	var cnt int
	_ = db.Scoped(s.ctx, s.pool, db.ServiceRoleScope(), func(tx pgx.Tx) error {
		return tx.QueryRow(s.ctx,
			`SELECT count(*) FROM orders WHERE organization_id = $1`, orgID).Scan(&cnt)
	})
	if cnt > 0 {
		return cnt, nil
	}

	rng := rand.New(rand.NewSource(42))
	created := 0

	for i, spec := range demoOrders {
		custID := ""
		if len(custIDs) > 0 {
			custID = custIDs[i%len(custIDs)]
		}
		orderAt := time.Now().UTC().AddDate(0, 0, -spec.daysAgo).
			Add(-time.Duration(rng.Intn(8)) * time.Hour)

		// Calculate totals.
		var subtotal int64
		for _, name := range spec.itemNames {
			subtotal += itemPriceCents[name]
		}
		total := subtotal // VAT inclusive

		orderNum := fmt.Sprintf("DEMO-%03d", i+1)

		var orderID string
		err := db.Scoped(s.ctx, s.pool, db.ServiceRoleScope(), func(tx pgx.Tx) error {
			q := `
				INSERT INTO orders (
					location_id, organization_id, order_number,
					status, fulfillment_type, order_type,
					subtotal_cents, total_cents,
					currency_code, tax_rate, tax_inclusive,
					created_at, updated_at
				`
			args := []any{
				locID, orgID, orderNum,
				"completed", spec.fulfillment, spec.orderType,
				subtotal, total,
				"ZAR", 15.00, true,
				orderAt, orderAt,
			}
			if custID != "" {
				q += `, customer_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING id`
				args = append(args, custID)
			} else {
				q += `) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id`
			}
			return tx.QueryRow(s.ctx, q, args...).Scan(&orderID)
		})
		if err != nil {
			return 0, fmt.Errorf("order %d: %w", i, err)
		}

		// Insert order items.
		for j, name := range spec.itemNames {
			itemID, ok := items[name]
			if !ok {
				continue
			}
			price := itemPriceCents[name]
			err := db.Scoped(s.ctx, s.pool, db.ServiceRoleScope(), func(tx pgx.Tx) error {
				_, err := tx.Exec(s.ctx, `
					INSERT INTO order_items (order_id, item_id, quantity, unit_price_cents, total_price_cents)
					VALUES ($1, $2, 1, $3, $4)
				`, orderID, itemID, price, price)
				return err
			})
			if err != nil {
				return 0, fmt.Errorf("order item %q order %d: %w", name, j, err)
			}
		}

		// Insert payment.
		payCode := "cash"
		if spec.payMethod == "card" {
			payCode = "card_in_person"
		}
		err = db.Scoped(s.ctx, s.pool, db.ServiceRoleScope(), func(tx pgx.Tx) error {
			_, err := tx.Exec(s.ctx, `
				INSERT INTO order_payments (
					order_id, payment_method_code,
					amount_paid_cents, payment_status, paid_at
				) VALUES ($1, $2, $3, 'completed', $4)
			`, orderID, payCode, total, orderAt)
			return err
		})
		if err != nil {
			return 0, fmt.Errorf("order payment %d: %w", i, err)
		}

		created++
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
