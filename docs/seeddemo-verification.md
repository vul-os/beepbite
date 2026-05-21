# SeeedDemo Verification — Handler Bug Report

**Date:** 2026-05-20  
**Branch:** beepnew  
**Verified by:** V3 verification agent

---

## Handler / Fixture Bug: `db.Tx` undefined in `cmd/tests/fixtures/seed.go`

**File:** `backend/cmd/tests/fixtures/seed.go`

**Symptom:** `go build ./...` fails with:

```
cmd/tests/fixtures/seed.go:85:48: undefined: db.Tx
cmd/tests/fixtures/seed.go:119:47: undefined: db.Tx
... (10+ occurrences)
cmd/tests/fixtures/seed.go:54:37: cannot use func(tx interface{...}) error as func(tx pgx.Tx) error
```

**Root cause:** `seed.go` references `db.Tx` which does not exist in the `internal/db` package (the package uses `pgx.Tx` directly). The callback type passed to `db.Scoped` also uses an inline interface rather than `pgx.Tx`.

**Impact:** Backend build fails (❌) — all packages that import `cmd/tests/fixtures` cannot compile. The running server is unaffected (it does not import this package), but `go build ./...` and `go vet ./...` will always fail until this is fixed.

**Fix needed (in `cmd/tests/fixtures/seed.go`):**
- Replace all `db.Tx` references with `pgx.Tx`  
- Add import `"github.com/jackc/pgx/v5"` if not already present  
- Fix callback signature in `db.Scoped` call at line 54 to use `func(tx pgx.Tx) error`

---

## Pre-existing trigger: `trg_location_default_kitchen_station`

**Not a handler bug** — handled in seeddemo script (see seeddemo fix below).

When a new location is inserted, migration `legacy/20240101000046_kds_default_station_autoroute.sql` fires a trigger that auto-creates a "Kitchen" prep station. The seeddemo now detects and removes this stub before creating the Grill + Bar demo stations.
