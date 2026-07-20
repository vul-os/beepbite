// Command bootstrapdemo creates (idempotently) a demo owner login + org +
// location so the dashboard has a real tenant to seed and sign into.
//
//	go run ./cmd/bootstrapdemo --env=local
//
// Login: demo@beepbite.app / Demo1234!  (owner, full capabilities)
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
)

func main() {
	envFlag := flag.String("env", "", "environment: local (default)")
	email := flag.String("email", "demo@beepbite.app", "owner email")
	pass := flag.String("pass", "Demo1234!", "owner password")
	orgName := flag.String("org", "BeepBite Demo Diner", "organization name")
	flag.Parse()

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
			if err := tx.QueryRow(ctx, `INSERT INTO organizations (name) VALUES ($1) RETURNING id`, *orgName).Scan(&orgID); err != nil {
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
			if err := tx.QueryRow(ctx,
				`INSERT INTO locations (organization_id, name, slug, city, country, currency_code)
				 VALUES ($1,'Main',$2,'Johannesburg','ZA','ZAR') RETURNING id`,
				orgID, slug).Scan(&locID); err != nil {
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

	fmt.Printf("OK\nowner=%s\norg=%s\nlocation=%s\nlogin: %s / %s\n", ownerID, orgID, locID, *email, *pass)
}
