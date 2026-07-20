package main

import (
	"context"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/beepbite/backend/internal/db"
)

// seeder holds the DB pool + context. All writes run under service_role scope so
// they bypass FORCE RLS (via s.tx).
type seeder struct {
	pool *pgxpool.Pool
	ctx  context.Context
}

// tx runs fn inside a single service-role scoped transaction.
func (s *seeder) tx(fn func(pgx.Tx) error) error {
	return db.Scoped(s.ctx, s.pool, db.ServiceRoleScope(), fn)
}

// CustomerRef is a lightweight handle to a seeded customer, shared across sections.
type CustomerRef struct {
	ID    string
	Name  string // "First Last"
	First string
	Last  string
	Phone string
	Email string
}

// StaffRef is a lightweight handle to a seeded POS staff member.
type StaffRef struct {
	ID   string
	Name string
	Role string
}

// TableRef is a lightweight handle to a seeded floor table.
type TableRef struct {
	ID      string
	Label   string
	Section string
}

// Ctx carries IDs produced by earlier sections and consumed by later ones.
// main.go creates it after bootstrap; each seed section reads what it needs and
// populates the fields it owns (documented per-field below).
type Ctx struct {
	// Populated by bootstrap (main.go) — read-only for sections.
	OrgID          string
	OrgName        string
	LocID          string
	LocSlug        string
	OwnerProfileID string    // demo@beepbite.app profile id (the primary owner)
	YourProfileID  string    // coowner@example.com profile id (co-owner)
	Now            time.Time // wall clock reference (UTC)

	// Populated by seedMenu.
	Categories map[string]string // category name -> id
	Items      map[string]string // item name -> id
	ItemPrice  map[string]int64  // item name -> price in cents
	Stations   map[string]string // KDS station name -> id

	// Populated by seedFloor.
	Sections map[string]string // section name -> id
	Tables   []TableRef

	// Populated by seedFOH.
	Customers []CustomerRef

	// Populated by seedStaff.
	Staff []StaffRef
}

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
	result := strings.TrimFunc(
		strings.Join(strings.Fields(strings.ReplaceAll(b.String(), "--", "-")), "-"),
		func(r rune) bool { return r == '-' },
	)
	return result
}
