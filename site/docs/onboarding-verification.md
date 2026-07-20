# Onboarding Smoke-Test Verification

_Date: 2026-05-20_

## Summary

Steps 1–6 of the onboarding flow (signup → org → member → profile → invites) pass
cleanly. Steps 7–8 (location create / read) fail due to a **new RLS bug** in
`RequireOrgScope` middleware. This is documented below; no migrations or handlers were
modified (verification only).

---

## Live curl results (all 8 steps)

| Step | Endpoint | Status | Notes |
|------|----------|--------|-------|
| 1 | POST /auth/signup | **201** | access_token + user.id returned |
| 2 | POST /data/organizations | **201** | `created_by` = user.id ✓ |
| 3 | GET /data/organizations | **200** | org row visible to creator ✓ |
| 4 | POST /data/organization_members | **201** | `can_void/can_comp/can_settle/can_view_reports` all true ✓ |
| 5 | GET /data/profiles?id=eq.&lt;uid&gt;&single=true | **200** | profile returned ✓ |
| 6 | POST /rpc/check_invites | **200** | returns `[]` for fresh user ✓ |
| 7 | POST /data/locations | **400** | RLS violation — see bug below |
| 8 | GET /data/locations | **200** | returns `[]` (should return the location) — same root cause |

---

## NEW BUG: `RequireOrgScope` cannot see `organization_members` rows

### Bug ID
`BUG-ORGSCOPE-MEMBERSHIP-RLS`

### Root cause

`RequireOrgScope` queries memberships via `poolQuerier.queryMemberships`:

```go
// internal/auth/orgscope.go
rows, err := p.pool.Query(ctx,
    `SELECT organization_id, role, capabilities
       FROM organization_members
      WHERE profile_id = $1`,
    userID,
)
```

This `pool.Query` call runs on a raw connection **without any `app.*` session
variables set**. The `organization_members` table has `FORCE ROW LEVEL SECURITY`
enabled. The `organization_members_select` policy is:

```sql
USING (
    is_service_role()
    OR profile_id = current_user_id()
    OR organization_id = current_org_id()
)
```

Because `app.current_user_id` is **not set** on the raw pool connection,
`current_user_id()` returns `NULL`. `is_service_role()` is also false. The policy
evaluates to `false` for every row → **0 rows returned**.

`RequireOrgScope` then falls through to the "no memberships" branch, which sets
`db.Scope.OrgID = ""` (empty). Downstream handlers call `db.Scoped(...)` which
writes `set_config('app.current_org_id', '', true)`. `current_org_id()` returns
`NULL` inside the request transaction.

### Impact

1. **POST /data/locations** — `locations_insert` WITH CHECK:
   `organization_id = current_org_id()`. With `current_org_id() = NULL` this is
   always false → HTTP 400 "new row violates row-level security policy".

2. **GET /data/locations** — `locations_select_member` USING:
   `organization_id = current_org_id()`. Always false → returns `[]` even when
   locations exist for the user's org.

3. **Any other table** whose SELECT/INSERT/UPDATE policy relies solely on
   `current_org_id()` (e.g. `orders`, `categories`, `items`, `kds_stations`) is
   similarly broken for users whose only membership was inserted after the JWT was
   issued without a prior token refresh that would have triggered a cold lookup.

### Minimum reproducer

```bash
# After POST /data/organization_members succeeds (step 4), query without session vars:
psql "postgres://beepbite:beepbite@localhost:5432/beepbite?sslmode=disable" \
  -c "SELECT organization_id FROM organization_members WHERE profile_id = '<user_id>';"
# → 0 rows (RLS blocks it)

# With session vars (what the DB actually needs):
psql "postgres://beepbite:beepbite@localhost:5432/beepbite?sslmode=disable" \
  -c "SELECT set_config('app.current_user_id','<user_id>',false); SELECT organization_id FROM organization_members WHERE profile_id = '<user_id>';"
# → 1 row (correct)
```

### Suggested fix (NOT implemented here — verification only)

`poolQuerier.queryMemberships` must set `app.current_user_id` before the query,
either by opening a scoped transaction or by using a `db.ServiceRoleScope()` (since
this is a trusted internal lookup on behalf of the middleware, not a user query):

```go
// Option A: service-role scoped tx inside the middleware
err = db.Scoped(ctx, p.pool, db.ServiceRoleScope(), func(tx pgx.Tx) error {
    rows, err = tx.Query(ctx, `SELECT ...`, userID)
    ...
})

// Option B: set app.current_user_id before querying so the existing RLS policy passes
_, _ = conn.Exec(ctx, `SELECT set_config('app.current_user_id', $1, false)`, userID)
rows, err = conn.Query(ctx, `SELECT ...`, userID)
```

Option A is simpler and consistent with how handlers call `db.Scoped`.

---

## Suite file

`backend/cmd/tests/suite_onboarding.go` — wired as `--onboarding` flag in `main.go`.
Steps 7 and 8 are marked as known-failing checks with the bug reference above.
