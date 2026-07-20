// Command bootstrapdemo creates (idempotently) a demo owner login + org +
// location so the dashboard has a real tenant to seed and sign into.
//
//	go run ./cmd/bootstrapdemo --env=local
//
// Login: demo@example.com / Demo1234!  (owner, full capabilities)
//
// The country, currency, tax posture, timezone and dial code of the demo tenant
// come from internal/seedlocale (the SEED_* environment variables), not from
// this file. See that package for why the defaults are deliberately fictional.
package main

import (
	"context"
	"flag"
	"fmt"
	"log"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"golang.org/x/crypto/bcrypt"

	"github.com/beepbite/backend/internal/config"
	"github.com/beepbite/backend/internal/db"
	"github.com/beepbite/backend/internal/seedlocale"
)

func main() {
	envFlag := flag.String("env", "", "environment: local (default)")
	// RFC 2606 reserves example.com so it can never be registered — a bootstrap
	// account cannot end up sending mail to, or being confused with, a real
	// address at a domain someone owns.
	email := flag.String("email", "demo@"+seedlocale.EmailDomain, "owner email")
	pass := flag.String("pass", "Demo1234!", "owner password")
	orgName := flag.String("org", "BeepBite Demo Diner", "organization name")
	flag.Parse()

	loc, err := seedlocale.Load()
	if err != nil {
		log.Fatalf("locale: %v", err)
	}
	log.Printf("bootstrap locale: country=%s currency=%s (%d dp) tz=%s tax=%.2f%% inclusive=%t phone=+%s",
		loc.Country, loc.Currency, loc.Decimals, loc.Timezone,
		loc.TaxRatePercent(), loc.TaxInclusive(), loc.PhoneCC)

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

	// Every currency column is a foreign key to currencies, and the default XTS
	// is deliberately not one of the codes the migrations ship — so the row has
	// to exist before anything priced in it is inserted.
	if err := db.Scoped(ctx, pool, db.ServiceRoleScope(), func(tx pgx.Tx) error {
		q, args := loc.EnsureCurrencySQL()
		_, err := tx.Exec(ctx, q, args...)
		return err
	}); err != nil {
		log.Fatalf("ensure currency %s: %v", loc.Currency, err)
	}

	hashBytes, err := bcrypt.GenerateFromPassword([]byte(*pass), bcrypt.DefaultCost)
	if err != nil {
		log.Fatalf("bcrypt: %v", err)
	}
	hash := string(hashBytes)
	fullCaps := `{"can_pos":true,"can_kitchen":true,"can_void":true,"can_comp":true,"can_settle":true,"can_view_reports":true,"can_drive":true,"can_manage_staff":true,"can_manage_menu":true,"can_manage_settings":true}`

	var orgID, ownerID, locID string
	scope := db.ServiceRoleScope()
	err = db.Scoped(ctx, pool, scope, func(tx pgx.Tx) error {
		// Owner auth_user (idempotent on email).
		err := tx.QueryRow(ctx, `SELECT id FROM auth_users WHERE email=$1`, *email).Scan(&ownerID)
		if err == pgx.ErrNoRows {
			if err := tx.QueryRow(ctx,
				`INSERT INTO auth_users (email, password_hash, email_verified) VALUES ($1,$2,true) RETURNING id`,
				*email, hash).Scan(&ownerID); err != nil {
				return fmt.Errorf("insert auth_user: %w", err)
			}
		} else if err != nil {
			return err
		} else {
			// Reset password so it is known.
			if _, err := tx.Exec(ctx, `UPDATE auth_users SET password_hash=$2, email_verified=true WHERE id=$1`, ownerID, hash); err != nil {
				return err
			}
		}

		if _, err := tx.Exec(ctx,
			`INSERT INTO profiles (id, full_name, email) VALUES ($1,$2,$3)
			 ON CONFLICT (id) DO UPDATE SET full_name=EXCLUDED.full_name, email=EXCLUDED.email`,
			ownerID, "Demo Owner", *email); err != nil {
			return fmt.Errorf("upsert profile: %w", err)
		}

		// Org (idempotent on name).
		err = tx.QueryRow(ctx, `SELECT id FROM organizations WHERE name=$1`, *orgName).Scan(&orgID)
		if err == pgx.ErrNoRows {
			// default_currency_code must be passed explicitly: migration 056
			// dropped its 'ZAR' default, so omitting it now leaves the org with
			// no currency at all rather than silently inheriting one country's.
			if err := tx.QueryRow(ctx,
				`INSERT INTO organizations (name, default_currency_code) VALUES ($1,$2) RETURNING id`,
				*orgName, loc.Currency).Scan(&orgID); err != nil {
				return fmt.Errorf("insert org: %w", err)
			}
		} else if err != nil {
			return err
		}

		// Owner membership.
		if _, err := tx.Exec(ctx,
			`INSERT INTO organization_members (organization_id, profile_id, role, capabilities)
			 VALUES ($1,$2,'owner',$3::jsonb)
			 ON CONFLICT (organization_id, profile_id) DO UPDATE SET role='owner', capabilities=EXCLUDED.capabilities`,
			orgID, ownerID, fullCaps); err != nil {
			return fmt.Errorf("upsert member: %w", err)
		}

		// Location (idempotent on slug).
		slug := "beepbite-demo-diner--main"
		err = tx.QueryRow(ctx, `SELECT id FROM locations WHERE slug=$1`, slug).Scan(&locID)
		if err == pgx.ErrNoRows {
			// City is a placeholder rather than a real one: a demo tenant that
			// names an actual city reads as production data in a screenshot.
			// The locale columns are all written explicitly — the schema no
			// longer supplies a country's worth of defaults for them.
			if err := tx.QueryRow(ctx,
				`INSERT INTO locations (
					organization_id, name, slug,
					city, country, currency_code,
					timezone, locale, tax_rate, tax_inclusive, tax_label,
					phone_country_code
				 ) VALUES ($1,'Main',$2,'Demo City',$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
				orgID, slug,
				loc.Country, loc.Currency,
				loc.Timezone, nullIfEmpty(loc.Locale),
				loc.TaxRatePercent(), loc.TaxInclusive(), loc.Tax.EffectiveLabel(),
				loc.PhoneCC).Scan(&locID); err != nil {
				return fmt.Errorf("insert location: %w", err)
			}
		} else if err != nil {
			return err
		}
		return nil
	})
	if err != nil {
		log.Fatalf("bootstrap: %v", err)
	}

	fmt.Printf("OK\nowner=%s\norg=%s\nlocation=%s\nlogin: %s / %s\ncurrency=%s country=%s\n",
		ownerID, orgID, locID, *email, *pass, loc.Currency, loc.Country)
}

// nullIfEmpty maps an unset locale to SQL NULL. locations.locale is nullable
// and NULL means "CLDR root formatting"; writing an empty string instead would
// make the column look configured when it is not.
func nullIfEmpty(s string) any {
	if s == "" {
		return nil
	}
	return s
}
