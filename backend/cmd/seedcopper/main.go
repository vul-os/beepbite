// Command seedcopper builds a realistic, fully-populated demo tenant — "The
// Copper Table", a full-service Cape Town restaurant — on the local beepbite DB,
// and (with --clean) removes e2e burner users + stale junk orgs first.
//
//	go run ./cmd/seedcopper --env=local --clean
//
// Dashboard logins (all password Demo1234!):
//
//	demo@beepbite.app       owner   (primary)
//	coowner@example.com      owner   (your account — password reset to Demo1234!)
//	manager@coppertable.test  manager
//	chef@coppertable.test     kitchen
//	cashier@coppertable.test  pos
//	waiter@coppertable.test   staff
//	driver@coppertable.test   driver
//
// It is idempotent: re-running reuses the org/location and skips already-seeded
// sections. All writes run under service_role scope to bypass FORCE RLS.
package main

import (
	"context"
	"flag"
	"fmt"
	"log"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"golang.org/x/crypto/bcrypt"

	"github.com/beepbite/backend/internal/config"
)

const (
	orgName  = "The Copper Table"
	locSlug  = "the-copper-table--sea-point"
	demoPass = "Demo1234!"
)

// fullOwnerCaps is the canonical capability set for an owner. Passing it
// explicitly (rather than relying on the trigger) guarantees bank/settings pages
// work.
const fullOwnerCaps = `{"can_pos":true,"can_kitchen":true,"can_void":true,"can_comp":true,"can_settle":true,"can_view_reports":true,"can_drive":true,"can_manage_staff":true,"can_manage_menu":true,"can_manage_settings":true,"can_manage_bank":true}`

// employeeLogin describes a dashboard (email/password) login to provision as an
// organization member.
type employeeLogin struct {
	email    string
	name     string
	username string
	role     string // organization_members.role
	dept     string
	title    string
}

var employeeLogins = []employeeLogin{
	{"manager@coppertable.test", "Nomsa Dlamini", "nomsa_dlamini", "manager", "Front of House", "General Manager"},
	{"chef@coppertable.test", "Marco Ferreira", "marco_ferreira", "kitchen", "Kitchen", "Head Chef"},
	{"cashier@coppertable.test", "Aisha Patel", "aisha_patel", "pos", "Front of House", "Cashier"},
	{"waiter@coppertable.test", "Lunga Mbeki", "lunga_mbeki", "staff", "Front of House", "Waiter"},
	{"driver@coppertable.test", "Pieter Botha", "pieter_botha", "driver", "Delivery", "Driver"},
}

func main() {
	envFlag := flag.String("env", "", "environment: local (default)")
	clean := flag.Bool("clean", false, "delete test_* burner users + junk orgs before seeding")
	flag.Parse()

	cfg, err := config.Load(*envFlag)
	if err != nil {
		log.Fatalf("config: %v", err)
	}
	ctx := context.Background()
	poolCfg, err := pgxpool.ParseConfig(cfg.DatabaseURL)
	if err != nil {
		log.Fatalf("parse db config: %v", err)
	}
	// Run every connection as service_role at session level so that direct
	// (non-transactional) idempotency reads also bypass FORCE RLS. db.Scoped
	// still SET LOCALs its own scope inside each write transaction.
	poolCfg.AfterConnect = func(ctx context.Context, conn *pgx.Conn) error {
		_, err := conn.Exec(ctx, `SELECT set_config('app.is_service_role','true',false)`)
		return err
	}
	pool, err := pgxpool.NewWithConfig(ctx, poolCfg)
	if err != nil {
		log.Fatalf("connect db: %v", err)
	}
	defer pool.Close()

	s := &seeder{pool: pool, ctx: ctx}

	if *clean {
		if err := s.cleanup(); err != nil {
			log.Fatalf("cleanup: %v", err)
		}
	}

	if err := s.ensurePaymentMethods(); err != nil {
		log.Fatalf("payment methods: %v", err)
	}

	c := &Ctx{
		Now:        time.Now().UTC(),
		Categories: map[string]string{},
		Items:      map[string]string{},
		ItemPrice:  map[string]int64{},
		Stations:   map[string]string{},
		Sections:   map[string]string{},
	}
	if err := s.bootstrap(c); err != nil {
		log.Fatalf("bootstrap: %v", err)
	}
	log.Printf("org %q (%s)  location %s (%s)", c.OrgName, c.OrgID, c.LocID, c.LocSlug)

	// Section order respects data dependencies:
	//   menu -> floor -> foh(customers) -> staff -> orders(+cash) -> commerce -> inventory
	type step struct {
		name string
		fn   func(*seeder, *Ctx) error
	}
	steps := []step{
		{"menu + KDS", seedMenu},
		{"floor plan", seedFloor},
		{"customers/reservations/waitlist/reviews", seedFOH},
		{"staff roster + shifts", seedStaff},
		{"orders history + cash drawer", seedOrders},
		{"live service (active orders + KDS tickets)", seedLive},
		{"gift cards/house accounts/invoices/promos/loyalty", seedCommerce},
		{"suppliers/inventory/POs + delivery/tips/bank", seedInventory},
	}
	for _, st := range steps {
		log.Printf("-> %s", st.name)
		if err := st.fn(s, c); err != nil {
			log.Fatalf("%s: %v", st.name, err)
		}
	}

	fmt.Println()
	fmt.Println("=== The Copper Table — seed complete ===")
	fmt.Printf("Org:        %s (%s)\n", c.OrgName, c.OrgID)
	fmt.Printf("Location:   %s  slug=%s\n", c.LocID, c.LocSlug)
	fmt.Printf("Categories: %d   Items: %d   Stations: %d\n", len(c.Categories), len(c.Items), len(c.Stations))
	fmt.Printf("Tables:     %d   Customers: %d   Staff: %d\n", len(c.Tables), len(c.Customers), len(c.Staff))
	fmt.Println()
	fmt.Println("Dashboard logins (password Demo1234!):")
	fmt.Println("  demo@beepbite.app        owner")
	fmt.Println("  coowner@example.com       owner (your account)")
	for _, e := range employeeLogins {
		fmt.Printf("  %-24s %s\n", e.email, e.role)
	}
}

// ---------------------------------------------------------------------------
// cleanup: remove e2e burner users + stale junk orgs
// ---------------------------------------------------------------------------

func (s *seeder) cleanup() error {
	return s.tx(func(tx pgx.Tx) error {
		// Delete every org EXCEPT the one we are about to (re)build. Deleting an
		// organization cascades to all its child data (members, location, menu,
		// orders, customers, ...).
		ct, err := tx.Exec(s.ctx, `DELETE FROM organizations WHERE name <> $1`, orgName)
		if err != nil {
			return fmt.Errorf("delete junk orgs: %w", err)
		}
		log.Printf("cleanup: deleted %d org(s)", ct.RowsAffected())

		// Delete e2e burner auth users (cascades to profiles + tokens). Preserve
		// demo@beepbite.app and coowner@example.com.
		ct, err = tx.Exec(s.ctx, `DELETE FROM auth_users WHERE email LIKE 'test\_%@example.test'`)
		if err != nil {
			return fmt.Errorf("delete burner users: %w", err)
		}
		log.Printf("cleanup: deleted %d burner user(s)", ct.RowsAffected())
		return nil
	})
}

// ---------------------------------------------------------------------------
// bootstrap: org, location, payment methods, owners + employee logins
// ---------------------------------------------------------------------------

func (s *seeder) bootstrap(c *Ctx) error {
	return s.tx(func(tx pgx.Tx) error {
		// Org (idempotent on name).
		err := tx.QueryRow(s.ctx, `SELECT id FROM organizations WHERE name=$1`, orgName).Scan(&c.OrgID)
		if err == pgx.ErrNoRows {
			if err := tx.QueryRow(s.ctx,
				`INSERT INTO organizations (name, default_currency_code) VALUES ($1,'ZAR') RETURNING id`,
				orgName).Scan(&c.OrgID); err != nil {
				return fmt.Errorf("insert org: %w", err)
			}
		} else if err != nil {
			return err
		}
		c.OrgName = orgName

		// Location (idempotent on slug).
		err = tx.QueryRow(s.ctx, `SELECT id FROM locations WHERE slug=$1`, locSlug).Scan(&c.LocID)
		if err == pgx.ErrNoRows {
			if err := tx.QueryRow(s.ctx, `
				INSERT INTO locations (
					organization_id, name, slug, description,
					city, country, address, whatsapp_number,
					latitude, longitude,
					currency_code, estimated_prep_time, avg_prep_minutes,
					delivery_fee, free_delivery_threshold, max_delivery_distance_km,
					offers_delivery, offers_collection, accepts_delivery, accepts_pickup,
					on_delivery_payment_methods, is_marketplace_visible, is_active,
					auto_gratuity_enabled, auto_gratuity_percent, auto_gratuity_min_party
				) VALUES (
					$1,'The Copper Table — Sea Point',$2,
					'Contemporary South African bistro on the Sea Point promenade — seasonal plates, craft cocktails & a copper-topped bar.',
					'Cape Town','ZA','122 Beach Road, Sea Point, Cape Town, 8005','+27214391200',
					-33.9138, 18.3843,
					'ZAR', 25, 20,
					35.00, 350.00, 12.0,
					true, true, true, true,
					ARRAY['cash','card_on_delivery'], true, true,
					true, 15.00, 8
				) RETURNING id
			`, c.OrgID, locSlug).Scan(&c.LocID); err != nil {
				return fmt.Errorf("insert location: %w", err)
			}
		} else if err != nil {
			return err
		}
		c.LocSlug = locSlug

		// Owners: demo@beepbite.app (primary) + coowner@example.com (co-owner).
		demoID, err := s.upsertLogin(tx, "demo@beepbite.app", "Demo Owner", "demo_owner", "Management", "Owner")
		if err != nil {
			return fmt.Errorf("owner demo: %w", err)
		}
		c.OwnerProfileID = demoID
		if err := s.upsertMember(tx, c.OrgID, demoID, "owner", fullOwnerCaps); err != nil {
			return fmt.Errorf("member demo: %w", err)
		}

		// bitebeep may already exist (your real account) — reset password so it is
		// known, ensure a profile, and grant owner membership.
		yourID, err := s.upsertLogin(tx, "coowner@example.com", "Beep Bite", "beep_bite", "Management", "Owner")
		if err != nil {
			return fmt.Errorf("owner bitebeep: %w", err)
		}
		c.YourProfileID = yourID
		if err := s.upsertMember(tx, c.OrgID, yourID, "owner", fullOwnerCaps); err != nil {
			return fmt.Errorf("member bitebeep: %w", err)
		}

		// Employee dashboard logins.
		for _, e := range employeeLogins {
			pid, err := s.upsertLogin(tx, e.email, e.name, e.username, e.dept, e.title)
			if err != nil {
				return fmt.Errorf("login %s: %w", e.email, err)
			}
			if err := s.upsertMember(tx, c.OrgID, pid, e.role, "{}"); err != nil {
				return fmt.Errorf("member %s: %w", e.email, err)
			}
		}
		return nil
	})
}

// upsertLogin creates-or-updates an auth_user + profile, returning the profile id.
// The password is reset to Demo1234! so every login is known.
func (s *seeder) upsertLogin(tx pgx.Tx, email, fullName, username, dept, title string) (string, error) {
	hashBytes, err := bcrypt.GenerateFromPassword([]byte(demoPass), bcrypt.DefaultCost)
	if err != nil {
		return "", err
	}
	hash := string(hashBytes)

	var id string
	err = tx.QueryRow(s.ctx, `SELECT id FROM auth_users WHERE email=$1`, email).Scan(&id)
	if err == pgx.ErrNoRows {
		if err := tx.QueryRow(s.ctx,
			`INSERT INTO auth_users (email, password_hash, email_verified) VALUES ($1,$2,true) RETURNING id`,
			email, hash).Scan(&id); err != nil {
			return "", err
		}
	} else if err != nil {
		return "", err
	} else {
		if _, err := tx.Exec(s.ctx, `UPDATE auth_users SET password_hash=$2, email_verified=true WHERE id=$1`, id, hash); err != nil {
			return "", err
		}
	}

	if _, err := tx.Exec(s.ctx, `
		INSERT INTO profiles (id, full_name, email, username, department, title)
		VALUES ($1,$2,$3,$4,$5,$6)
		ON CONFLICT (id) DO UPDATE SET
			full_name=EXCLUDED.full_name, email=EXCLUDED.email,
			username=COALESCE(profiles.username, EXCLUDED.username),
			department=EXCLUDED.department, title=EXCLUDED.title
	`, id, fullName, email, username, dept, title); err != nil {
		return "", err
	}
	return id, nil
}

func (s *seeder) upsertMember(tx pgx.Tx, orgID, profileID, role, caps string) error {
	_, err := tx.Exec(s.ctx, `
		INSERT INTO organization_members (organization_id, profile_id, role, capabilities)
		VALUES ($1,$2,$3,$4::jsonb)
		ON CONFLICT (organization_id, profile_id) DO UPDATE SET role=EXCLUDED.role, capabilities=EXCLUDED.capabilities
	`, orgID, profileID, role, caps)
	return err
}

// ensurePaymentMethods makes sure the offline payment methods used by the seed
// exist (idempotent).
func (s *seeder) ensurePaymentMethods() error {
	return s.tx(func(tx pgx.Tx) error {
		methods := []struct{ code, name, kind string }{
			{"cash", "Cash", "offline"},
			{"card_in_person", "Card in person", "offline"},
			{"card_on_delivery", "Card on delivery", "offline"},
			{"cash_on_delivery", "Cash on delivery", "offline"},
			{"eft", "EFT", "offline"},
		}
		for _, m := range methods {
			if _, err := tx.Exec(s.ctx, `
				INSERT INTO payment_methods (code, name, kind, requires_reference, supports_tips, is_active)
				VALUES ($1,$2,$3,false,true,true) ON CONFLICT (code) DO NOTHING
			`, m.code, m.name, m.kind); err != nil {
				return err
			}
		}
		return nil
	})
}
