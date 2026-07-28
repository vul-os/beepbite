#!/usr/bin/env bash
# verify-sync-rls.sh — prove the sync tables' security properties against a real
# Postgres, as a non-superuser tenant role.
#
# migrations/002_sync.sql makes three claims in its comments. Comments are not
# evidence, and the properties below are exactly the kind that look fine in code
# review and are wrong in the database:
#
#   1. sync_ops is APPEND-ONLY for tenants. Not "the handlers never update it" —
#      the database refuses. An operation log that can be edited is not a log.
#   2. A tenant cannot read another organisation's operations, even by primary
#      key. RLS, not a WHERE clause the caller is trusted to remember.
#   3. A tenant cannot write an operation into another organisation.
#
# Same shape as verify-fold.sh: stand up a throwaway container, apply the real
# migrations, assert, tear down. Exit 0 only if every assertion holds.
#
# Usage:  ./scripts/verify-sync-rls.sh
# Needs:  docker

set -euo pipefail

CONTAINER="${SYNC_RLS_CONTAINER:-beepbite-sync-rls}"
PORT="${SYNC_RLS_PORT:-55445}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MIGRATIONS="$REPO_ROOT/backend/migrations"

ORG_A='11111111-1111-1111-1111-111111111111'
ORG_B='22222222-2222-2222-2222-222222222222'
OP_A='aaaaaaaa-0000-0000-0000-000000000001'
OP_B='bbbbbbbb-0000-0000-0000-000000000002'

cleanup() { docker rm -f "$CONTAINER" >/dev/null 2>&1 || true; }
trap cleanup EXIT

fail() { echo "FAIL: $*" >&2; exit 1; }
psql_() { docker exec -i "$CONTAINER" psql -U postgres -d bb "$@"; }
# Query as the unprivileged tenant role with org A's context set, the way
# db.Scoped sets it per transaction.
as_tenant() {
  psql_ -tAc "SET ROLE bb_tenant;
              SELECT set_config('app.current_org_id','$ORG_A',false);
              SELECT set_config('app.is_service_role','false',false);
              $1" | tail -1
}

echo "==> starting throwaway postgres on :$PORT"
cleanup
docker run -d --name "$CONTAINER" \
  -e POSTGRES_PASSWORD=pw -e POSTGRES_DB=bb \
  -p "$PORT:5432" postgres:16-alpine >/dev/null

# pg_isready is not a safe readiness signal for this image — it reports the
# transient bootstrap server as ready before the real one has restarted. Poll a
# real query instead. (Same trap verify-fold.sh documents.)
for _ in $(seq 1 60); do
  if psql_ -c 'select 1' >/dev/null 2>&1; then break; fi
  sleep 1
done
psql_ -c 'select 1' >/dev/null 2>&1 || fail "postgres never became queryable"

echo "==> applying migrations"
for f in "$MIGRATIONS"/*.sql; do
  docker cp "$f" "$CONTAINER:/tmp/$(basename "$f")" >/dev/null
  psql_ -q -v ON_ERROR_STOP=1 -f "/tmp/$(basename "$f")" >/dev/null \
    || fail "migration $(basename "$f") did not apply"
done

echo "==> seeding two organisations and one operation each"
psql_ -q -v ON_ERROR_STOP=1 <<SQL >/dev/null
DROP ROLE IF EXISTS bb_tenant;
CREATE ROLE bb_tenant LOGIN PASSWORD 'pw';
GRANT USAGE ON SCHEMA public TO bb_tenant;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO bb_tenant;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO bb_tenant;

INSERT INTO organizations (id, name) VALUES ('$ORG_A','Org A'), ('$ORG_B','Org B');
INSERT INTO sync_ops (id, organization_id, entity, key, field, kind, value, ts_wall, ts_counter, ts_node)
VALUES ('$OP_A','$ORG_A','menu_items','k1','name',1,'\x61',100,0,'nodeA'),
       ('$OP_B','$ORG_B','menu_items','k9','name',1,'\x62',100,0,'nodeB');
SQL

echo "==> asserting"

[ "$(as_tenant "SELECT count(*) FROM sync_ops;")" = "1" ] \
  || fail "tenant sees more than its own organisation's operations"
echo "  ok  sees only its own organisation"

[ "$(as_tenant "SELECT count(*) FROM sync_ops WHERE id='$OP_B';")" = "0" ] \
  || fail "tenant read another organisation's operation by primary key"
echo "  ok  cannot read another organisation's operation by id"

[ "$(as_tenant "WITH u AS (UPDATE sync_ops SET value='\\xff' WHERE id='$OP_A' RETURNING 1) SELECT count(*) FROM u;")" = "0" ] \
  || fail "tenant UPDATEd an operation — sync_ops is not append-only"
echo "  ok  UPDATE affects no rows (append-only)"

[ "$(as_tenant "WITH d AS (DELETE FROM sync_ops WHERE id='$OP_A' RETURNING 1) SELECT count(*) FROM d;")" = "0" ] \
  || fail "tenant DELETEd an operation — sync_ops is not append-only"
echo "  ok  DELETE affects no rows (append-only)"

[ "$(as_tenant "SELECT encode(value,'escape') FROM sync_ops WHERE id='$OP_A';")" = "a" ] \
  || fail "operation value changed despite the update being refused"
echo "  ok  value survived both attempts unchanged"

if as_tenant "INSERT INTO sync_ops (id, organization_id, entity, key, field, kind, value, ts_wall, ts_counter, ts_node)
              VALUES ('cccccccc-0000-0000-0000-000000000003','$ORG_B','x','k','f',1,'\\x63',1,0,'nodeA');" >/dev/null 2>&1; then
  fail "tenant inserted an operation into another organisation"
fi
echo "  ok  cross-organisation INSERT refused by policy"

[ "$(psql_ -tAc "SELECT count(*) FROM pg_class WHERE relname IN ('sync_ops','sync_peers','sync_nonces') AND relrowsecurity;")" = "3" ] \
  || fail "row-level security is not enabled on all three sync tables"
echo "  ok  row-level security enabled on all three tables"

echo
echo "PASS — sync_ops is append-only and organisation-isolated under RLS."
