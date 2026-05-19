#!/usr/bin/env bash
# Seed a "Main Floor" section + a sensible mix of tables for a location.
#
# Why this exists: the POS workspace's "Eat-in" flow needs tables to show.
# A brand-new location has none, so the picker comes up empty.
#
# Usage:
#   scripts/seed-tables.sh <location_id>
#
# Or with a custom layout:
#   scripts/seed-tables.sh <location_id> "T1:2,T2:2,T3:3,Bar1:1"
#
# All inserts are idempotent: running this twice changes nothing.
# Reads DATABASE_URL from .env (or env).

set -euo pipefail

LOC="${1:-}"
LAYOUT="${2:-T1:2,T2:2,T3:2,T4:3,T5:3,T6:4,T7:4}"

if [[ -z "$LOC" ]]; then
  echo "usage: $0 <location_id> [layout]" >&2
  echo "  layout default: T1:2,T2:2,T3:2,T4:3,T5:3,T6:4,T7:4" >&2
  exit 2
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

if [[ -z "${DATABASE_URL:-}" ]] && [[ -f "$REPO_ROOT/.env" ]]; then
  # shellcheck disable=SC1091
  set -a; . "$REPO_ROOT/.env"; set +a
fi

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "DATABASE_URL not set and no .env found" >&2
  exit 1
fi

# Build the VALUES list from the layout string.
values=""
IFS=',' read -ra entries <<< "$LAYOUT"
for e in "${entries[@]}"; do
  label="${e%:*}"
  cap="${e#*:}"
  values+="('${label}', ${cap}),"
done
values="${values%,}"  # strip trailing comma

psql "$DATABASE_URL" <<SQL
\\set loc '''$LOC'''

\\echo '--- Section ---'
INSERT INTO sections (id, location_id, name, sort_order)
SELECT gen_random_uuid(), :loc, 'Main Floor', 0
WHERE NOT EXISTS (SELECT 1 FROM sections WHERE location_id = :loc AND name = 'Main Floor');

\\echo '--- Tables ---'
WITH s AS (SELECT id FROM sections WHERE location_id = :loc AND name = 'Main Floor' LIMIT 1)
INSERT INTO "tables" (id, location_id, section_id, label, capacity, status, is_active)
SELECT gen_random_uuid(), :loc, s.id, t.label, t.capacity, 'available', true
FROM s, (VALUES $values) AS t(label, capacity)
ON CONFLICT (location_id, label) DO NOTHING;

\\echo '--- Final layout ---'
SELECT t.label, t.capacity, t.status, s.name AS section
FROM "tables" t LEFT JOIN sections s ON s.id = t.section_id
WHERE t.location_id = :loc
ORDER BY t.capacity, t.label;
SQL
