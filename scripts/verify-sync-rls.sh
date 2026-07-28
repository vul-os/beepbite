#!/usr/bin/env bash
# verify-sync-rls.sh — prove the sync tables' security properties against a real
# Postgres, as a non-superuser tenant role.
#
# migrations/002_sync.sql makes three claims in its comments, and
# migrations/004_sync_ops_content_address.sql re-makes them after DROPping and
# re-CREATEing sync_ops. Comments are not evidence, and a table that came back
# from a DROP without its policies would be an open one — every query a single
# tenant runs looks identical either way. The properties below are exactly the
# kind that look fine in code review and are wrong in the database:
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

# Op ids are §4.1 content addresses now, not uuids: 33 bytes, the §18.1.5 v0
# form, which begins 0x1e. These two are synthetic — this script proves RLS, not
# the algebra, and the engine's own addressing is proved by the conformance
# vectors — but they are the right SHAPE, so the octet_length(id) = 33 CHECK is
# exercised rather than worked around. A uuid would simply fail to cast, which
# is a weaker thing to have tested.
OP_A='\x1eaa00000000000000000000000000000000000000000000000000000000000001'
OP_B='\x1ebb00000000000000000000000000000000000000000000000000000000000002'
COSE_A='\xd28443a10127a0'
COSE_B='\xd28443a10127a1'

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
-- kind 3 is the substrate's lww-set. Under migration 002 this column held
-- internal/oplog's own numbering, where 1 meant Set; 1 now means set-add, so a
-- query carried over from that schema would silently select the other kind.
INSERT INTO sync_ops (id, organization_id, cose, entity, key, field, kind, value, ts_wall, ts_counter, ts_node)
VALUES ('$OP_A','$ORG_A','$COSE_A','menu_items','k1','name',3,'\x61',100,0,'nodeA'),
       ('$OP_B','$ORG_B','$COSE_B','menu_items','k9','name',3,'\x62',100,0,'nodeB');
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

if as_tenant "INSERT INTO sync_ops (id, organization_id, cose, entity, key, field, kind, value, ts_wall, ts_counter, ts_node)
              VALUES ('\\x1ecc00000000000000000000000000000000000000000000000000000000000003','$ORG_B','\\xd28443a10127a2','x','k','f',3,'\\x63',1,0,'nodeA');" >/dev/null 2>&1; then
  fail "tenant inserted an operation into another organisation"
fi
echo "  ok  cross-organisation INSERT refused by policy"

# The schema must refuse a kind BeepBite does not model. Migration 004's CHECK
# is (1, 3); 2 was oplog.KindAdd under migration 002 and is set-remove in the
# substrate, which this product never mints. A row carrying one did not come
# from here, and storing it would put an op in the log under an algebra nothing
# reads it back with.
if psql_ -q -v ON_ERROR_STOP=1 -c "INSERT INTO sync_ops (id, organization_id, cose, entity, key, field, kind, value, ts_wall, ts_counter, ts_node)
     VALUES ('\\x1edd00000000000000000000000000000000000000000000000000000000000004','$ORG_A','\\xd28443a10127a3','x','k','',2,'\\x64',1,0,'nodeA');" >/dev/null 2>&1; then
  fail "an op kind BeepBite does not model was accepted (the kind CHECK is gone)"
fi
echo "  ok  an unmodelled op kind is refused by the CHECK constraint"

# And an id that is not a 33-byte content address. A uuid is exactly what this
# column used to hold, which is the point: the shape moved, and the database
# should say so rather than store a name where an address belongs.
if psql_ -q -v ON_ERROR_STOP=1 -c "INSERT INTO sync_ops (id, organization_id, cose, entity, key, field, kind, value, ts_wall, ts_counter, ts_node)
     VALUES ('\\xaaaaaaaa','$ORG_A','\\xd28443a10127a4','x','k','f',3,'\\x65',1,0,'nodeA');" >/dev/null 2>&1; then
  fail "a 4-byte op id was accepted — sync_ops.id is not a content address"
fi
echo "  ok  an id that is not a 33-byte content address is refused"

[ "$(psql_ -tAc "SELECT count(*) FROM pg_class WHERE relname IN ('sync_ops','sync_peers','sync_nonces') AND relrowsecurity;")" = "3" ] \
  || fail "row-level security is not enabled on all three sync tables"
echo "  ok  row-level security enabled on all three tables"

echo
echo "PASS — sync_ops is append-only and organisation-isolated under RLS."
