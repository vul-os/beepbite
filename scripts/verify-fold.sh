#!/usr/bin/env bash
#
# verify-fold.sh — prove backend/migrations/001_baseline.sql is schema-identical
# to the 55-file migration chain it replaced.
#
# The baseline's own header claims it "reproduces, byte-for-byte, the schema
# those 55 migrations produced (verified with a pg_dump --schema-only diff on
# postgres:16)". This script *is* that check, made reproducible: it applies the
# pre-fold chain to one throwaway postgres:16 container and the folded baseline
# to another, dumps both schemas with the container's own pg16 dumper, and
# diffs them. Exit 0 iff the two schemas are identical.
#
# The pre-fold chain is gone from HEAD (that was the point of the fold), so it
# is recovered from git history at PREFOLD_REF. Both the old 001 and the folded
# baseline create the two RLS roles themselves (guarded), so no external role
# prologue is needed. legacy/ is intentionally skipped — cmd/migrate skips it
# too (it is pre-consolidation archive, never applied).
#
# Requires: docker, git. Takes ~30s. Leaves nothing behind.
set -uo pipefail

# Parent of the fold commit (c737e0f "fold 55 migrations into one clean
# baseline") — the last revision that still had the 55-file chain.
PREFOLD_REF="${PREFOLD_REF:-c737e0f^}"

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BASELINE="$REPO/backend/migrations/001_baseline.sql"
WORK="$(mktemp -d)"
ORIG_C=pg_verify_fold_orig
FOLD_C=pg_verify_fold_fold

cleanup() { docker rm -f "$ORIG_C" "$FOLD_C" >/dev/null 2>&1; rm -rf "$WORK"; }
trap cleanup EXIT

echo "== recovering pre-fold chain from $PREFOLD_REF =="
git -C "$REPO" archive "$PREFOLD_REF" backend/migrations | tar -x -C "$WORK"
NUMBERED=$(ls "$WORK"/backend/migrations/[0-9][0-9][0-9]_*.sql | sort)
echo "   $(echo "$NUMBERED" | wc -l | tr -d ' ') numbered files (legacy/ skipped)"

echo "== starting two postgres:16 containers =="
docker rm -f "$ORIG_C" "$FOLD_C" >/dev/null 2>&1
docker run -d --name "$ORIG_C" -e POSTGRES_PASSWORD=pw -e POSTGRES_DB=bb postgres:16 >/dev/null
docker run -d --name "$FOLD_C" -e POSTGRES_PASSWORD=pw -e POSTGRES_DB=bb postgres:16 >/dev/null
for c in "$ORIG_C" "$FOLD_C"; do
  # pg_isready is NOT a safe readiness signal here: the postgres:16 image starts
  # a transient bootstrap server to run its init (which is what CREATEs
  # POSTGRES_DB=bb) and then restarts; pg_isready reports that bootstrap server
  # as "ready" while bb does not yet exist, so an apply can race in and fail with
  # `FATAL: database "bb" does not exist`. A real query against bb is the only
  # honest signal — it keeps failing until the init restart has created bb.
  ready=""
  for _ in $(seq 1 60); do
    if docker exec "$c" psql -U postgres -d bb -tAqc 'select 1' >/dev/null 2>&1; then
      ready=1; break
    fi
    sleep 1
  done
  [ -n "$ready" ] || { echo "FAILED: $c never became ready (bb not queryable)"; exit 2; }
done

apply() { docker exec -i "$1" psql -v ON_ERROR_STOP=1 -q -U postgres -d bb >/dev/null; }

echo "== applying pre-fold chain to $ORIG_C =="
for f in $NUMBERED; do
  apply "$ORIG_C" < "$f" || { echo "FAILED applying $(basename "$f")"; exit 3; }
done

echo "== applying folded baseline to $FOLD_C =="
apply "$FOLD_C" < "$BASELINE" || { echo "FAILED applying 001_baseline.sql"; exit 4; }

echo "== dumping + normalizing both schemas =="
# Drop the pg_dump banner and the \restrict/\unrestrict lines: pg16 stamps those
# with a fresh random nonce per dump, so they differ every run and are not schema.
norm() { grep -vE '^(-- (Dumped|PostgreSQL database dump)|\\(un)?restrict )'; }
docker exec "$ORIG_C" pg_dump -U postgres -d bb --schema-only --no-owner --no-privileges | norm > "$WORK/orig.sql"
docker exec "$FOLD_C" pg_dump -U postgres -d bb --schema-only --no-owner --no-privileges | norm > "$WORK/fold.sql"

ot=$(docker exec "$ORIG_C" psql -tAq -U postgres -d bb -c "select count(*) from information_schema.tables where table_schema='public' and table_type='BASE TABLE'")
ft=$(docker exec "$FOLD_C" psql -tAq -U postgres -d bb -c "select count(*) from information_schema.tables where table_schema='public' and table_type='BASE TABLE'")
echo "   tables: pre-fold=$ot  folded=$ft"

if diff -u "$WORK/orig.sql" "$WORK/fold.sql" > "$WORK/schema.diff"; then
  echo ""
  echo "✅ IDENTICAL — the folded baseline reproduces the pre-fold schema byte-for-byte ($ft tables)."
  exit 0
else
  echo ""
  echo "❌ DIFFERENCES ($(wc -l < "$WORK/schema.diff") lines):"
  head -80 "$WORK/schema.diff"
  exit 1
fi
