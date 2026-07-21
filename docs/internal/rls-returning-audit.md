# RLS INSERT...RETURNING Audit

**Date:** 2026-05-20  
**Auditor:** Claude (static analysis + live policy query)  
**Scope:** All tables with `Insert: true` in `backend/internal/handlers/data/allowlist.go`

---

## Bug Pattern

The generic data handler (`backend/internal/handlers/data/handler.go`) always appends
`RETURNING *` to every INSERT. Under Postgres RLS, RETURNING fires the SELECT policy
against the freshly-inserted row. If the row passes the INSERT WITH CHECK but fails the
SELECT USING, Postgres raises:

> ERROR: new row violates row-level security policy for table "X"

The canonical trigger condition: INSERT WITH CHECK is broader than SELECT USING, and the
inserting user's session variables don't satisfy the SELECT predicate at the moment of insert.

**Fixed prototype:** `organizations` (migration 018) — added `created_by uuid DEFAULT
current_user_id()` column and extended SELECT to include `created_by = current_user_id()`.

---

## How `current_org_id()` Is Set

`RequireOrgScope` middleware (in `backend/internal/auth/orgscope.go`) queries
`organization_members` for the authenticated user. On success it injects a `db.Scope`
with `OrgID = memberships[0].OrgID`. On a **fresh signup** (zero memberships) it injects
`db.Scope{UserID: claims.UserID}` — OrgID is empty.

The `runScoped` helper in the data handler calls `db.Scoped` which writes `app.current_org_id`
via `SET LOCAL` for every transaction. An empty OrgID writes `''`, which the `current_org_id()`
SQL function treats as NULL.

**Therefore:** any table whose SELECT policy is `organization_id = current_org_id() OR
is_service_role()` (and no other clause) will block INSERT...RETURNING when current_org_id
is NULL — i.e. whenever the inserting user has no org membership in the current request scope.

---

## Results by Table

### SAFE — SELECT and INSERT use identical predicates (no window for divergence)

These tables all use the same `current_org_id()` predicate for both INSERT and SELECT, so
INSERT...RETURNING cannot succeed unless SELECT would also pass. INSERT is safe **in normal
operation**, but they are **NOT safe for a user whose current_org_id is NULL** (same class as
the organizations bug). Because they are downstream tables (not onboarding tables) a user
normally already has current_org_id set by the time they write to them.

| Table | Policy pattern |
|---|---|
| `allergens` | `organization_id = current_org_id() OR is_service_role()` (both) |
| `bank_accounts` | `organization_id = current_org_id() OR is_service_role()` |
| `categories` | `organization_id = current_org_id() OR is_service_role()` |
| `customers` | `organization_id = current_org_id() OR is_service_role()` |
| `dietary_tags` | `organization_id = current_org_id() OR is_service_role()` |
| `gift_cards` | `organization_id = current_org_id() OR is_service_role()` |
| `house_accounts` | `organization_id = current_org_id() OR is_service_role()` |
| `inventory_items` | `location_id IN (locations WHERE org_id = current_org_id()) OR is_service_role()` |
| `items` | location→org chain |
| `loyalty_config` | `organization_id = current_org_id() OR is_service_role()` |
| `order_items` | `order_id IN (orders WHERE org_id = current_org_id()) OR is_service_role()` |
| `order_payments` | order→location→org chain |
| `orders` | `organization_id = current_org_id() OR is_service_role()` |
| `payout_schedules` | `organization_id = current_org_id() OR is_service_role()` |
| `promotions` | `organization_id = current_org_id() OR is_service_role()` |
| `purchase_orders` | location→org chain |
| `reviews` | order→location→org chain |
| `staff` | location→org chain |
| `staff_pay_rates` | staff→location→org chain |
| `stock_movements` | inventory_item→location→org chain |
| `suppliers` | `organization_id = current_org_id() OR is_service_role()` |
| All other non-onboarding tables | same pattern |

---

### AT-RISK — `locations`

**Status: AT-RISK (not yet confirmed broken, but exhibits the same structural defect as organizations pre-018)**

**Table:** `locations`

**INSERT WITH CHECK:**
```sql
organization_id = current_org_id() OR is_service_role()
```

**SELECT USING:**
```sql
organization_id = current_org_id() OR is_service_role()
-- (second policy: is_marketplace_role() AND is_marketplace_visible = true)
```

**The structural problem:**  
Both predicates are identical, which means the bug can only fire if `current_org_id()` is
NULL at insert time. The `handle_new_organization()` trigger (migration 002, line 852)
inserts a default location automatically via `SECURITY DEFINER` — bypassing RLS entirely —
so that path is safe.

The dangerous path is: **frontend directly calls `POST /data/locations`** (e.g. to add a
second location) where the user's org context is ambiguous. With the multi-org fix from
migration 018, `RequireOrgScope` now uses `memberships[0].OrgID` as the scope OrgID. If the
frontend sends a location insert with `organization_id` matching a different org the user
belongs to (not the first one in `memberships`), the SELECT policy will fail because
`current_org_id()` is set to `memberships[0].OrgID`, not the org_id in the inserted row.

**Scenario triggering this:**
1. User belongs to two orgs: org-A and org-B.
2. RequireOrgScope resolves `memberships[0].OrgID = org-A`.
3. Frontend sends `POST /data/locations {"organization_id": "<org-B-id>", "name": "Branch 2"}`.
4. INSERT WITH CHECK passes: `org-B-id = current_org_id()` is FALSE, but `is_service_role()` is
   FALSE too — wait, this would actually **block the insert**. However the WITH CHECK uses
   `current_org_id()` = org-A, and the row has `organization_id = org-B`, so the check would fail.

**Revised assessment:** For `locations`, because INSERT WITH CHECK and SELECT USING are
identical, the real risk is different: if `current_org_id()` is null (fresh user, zero
memberships), BOTH policies fail and the insert is rejected at the WITH CHECK stage — before
RETURNING is even evaluated. So `locations` does **not** exhibit the INSERT...RETURNING divergence.

However, `locations` has a **different but related issue**: a fresh-signup user who has just
created their org (and whose org membership was auto-created by the trigger in migration 016)
may make their **next** request before RequireOrgScope re-reads the DB. On that next request
the middleware will pick up the membership (it queries on every request) and set
`current_org_id`. So `locations` is **SAFE** for direct inserts provided the org membership
exists (which the migration 016 trigger guarantees synchronously).

**Final verdict: SAFE** — the trigger path is SECURITY DEFINER. The direct path requires
`current_org_id` to be set, and INSERT WITH CHECK = SELECT USING so no divergence.

---

### AT-RISK — `organization_invites`

**Status: AT-RISK**

**INSERT WITH CHECK:**
```sql
organization_id = current_org_id() OR is_service_role()
```

**SELECT USING:**
```sql
organization_id = current_org_id() OR is_service_role()
```

INSERT and SELECT are identical — same safe pattern. **SAFE.**

---

### AT-RISK — `organization_members` (already partially fixed, but a residual case exists)

**Status: AT-RISK (residual — self-onboarding into a second org)**

**INSERT WITH CHECK (migration 016):**
```sql
is_service_role()
OR (
    profile_id = current_user_id()
    AND (
        organization_id = current_org_id()
        OR NOT EXISTS (
            SELECT 1 FROM organization_members existing
            WHERE existing.profile_id = current_user_id()
              AND existing.organization_id = organization_members.organization_id
        )
    )
)
```
The NOT EXISTS clause means: a user can self-insert as a member of an org they're not
already in, provided it's their first membership in that org.

**SELECT USING (migration 016):**
```sql
is_service_role()
OR profile_id = current_user_id()
OR organization_id = current_org_id()
```

**Analysis:**  
After a successful INSERT, RETURNING checks SELECT. The SELECT has:
- `profile_id = current_user_id()` — this is TRUE for a self-insert, because the user
  inserted a row where `profile_id = their own id`.

So: RETURNING will succeed because `profile_id = current_user_id()` catches the just-inserted
row. **SAFE.**

---

### CONFIRMED-BROKEN — `profiles` (onboarding edge case)

**Status: CONFIRMED-BROKEN** (theoretically; the trigger path bypasses it, but direct insert is broken)

**INSERT WITH CHECK:**
```sql
id = current_user_id() OR is_service_role()
```

**SELECT USING:**
```sql
id = current_user_id() OR is_service_role()
```

INSERT and SELECT are identical. The normal path (`handle_new_user()` trigger in migration 002)
runs as SECURITY DEFINER and bypasses RLS entirely — it inserts the profile row fine.

However, the allowlist exposes `profiles` with `Insert: true`. If the frontend ever calls
`POST /data/profiles` directly (e.g., to create a profile row where id = current_user_id()),
the INSERT WITH CHECK passes (id = current_user_id() is TRUE), and RETURNING also passes
(same condition). **SAFE** for the expected use case.

**Verdict: SAFE** — identical predicates, no divergence.

---

### CONFIRMED-BROKEN — `loyalty_config`

**Status: AT-RISK → CONFIRMED-BROKEN**

**INSERT WITH CHECK:**
```sql
organization_id = current_org_id() OR is_service_role()
```

**SELECT USING:**
```sql
organization_id = current_org_id() OR is_service_role()
```

Both predicates are identical. SAFE from the divergence pattern.

**BUT:** `loyalty_config` has `UNIQUE (organization_id)` — one row per org. The typical
onboarding flow inserts a loyalty_config row immediately after org creation, before the
user's next request has had the org_id resolved into the scope. If the frontend POSTs
`/data/loyalty_config` in the same onboarding flow as the org creation (same auth token,
same scope = zero memberships because the trigger hasn't been re-read yet), `current_org_id()`
is NULL and **both INSERT and SELECT fail**.

**Actually:** RequireOrgScope queries `organization_members` on every request. The
`auto_owner_member_on_new_org` trigger (migration 016) fires synchronously during the
org INSERT transaction. By the time the INSERT response returns to the frontend, the
membership row exists. The **next** request will find it. So any subsequent POST to
`/data/loyalty_config` will have `current_org_id()` set correctly.

**Verdict: SAFE** — provided the frontend does not batch org creation and loyalty_config
creation in the same HTTP request.

---

## The One Genuine AT-RISK Table: `driver_location_pings`

**Status: AT-RISK**

**INSERT WITH CHECK:**
```sql
driver_member_id IN (
    SELECT om.id FROM organization_members om
    WHERE om.profile_id = current_user_id()
)
OR is_service_role()
```

**SELECT USING:**
```sql
driver_member_id IN (
    SELECT om.id FROM organization_members om
    WHERE om.profile_id = current_user_id()
)
OR driver_member_id IN (
    SELECT da.driver_member_id
    FROM driver_assignments da
    JOIN orders o ON o.id = da.order_id
    JOIN locations l ON l.id = o.location_id
    WHERE l.organization_id = current_org_id()
      AND da.status = ANY(ARRAY['accepted', 'picked_up'])
)
OR is_service_role()
```

**The divergence:**  
INSERT WITH CHECK only checks `driver_member_id IN (memberships of current_user_id)`.  
SELECT adds a second OR clause via current_org_id.

The relevant INSERT path: a driver pings their own location. Their `driver_member_id` maps
to an `organization_members.id` where `om.profile_id = current_user_id()`.

After INSERT, RETURNING checks SELECT:
- The `driver_member_id IN (om where profile_id = current_user_id())` clause is TRUE.

So RETURNING succeeds via the same user-membership sub-query. **SAFE** for the normal driver
self-insert case.

The second SELECT clause (org-manager view) is broader but is never the cause of RETURNING
failure — RETURNING only needs ONE of the ORs to be true.

**Verdict: SAFE.**

---

## The Real Remaining Bug: `organizations` Policy in Multi-Org Context

**Status: CONFIRMED — partial residual bug**

After migration 018, organizations_select is:
```sql
id = current_org_id()
OR is_service_role()
OR created_by = current_user_id()
OR EXISTS (
    SELECT 1 FROM organization_members
    WHERE organization_id = organizations.id
      AND profile_id = current_user_id()
)
```

And organizations_insert is:
```sql
is_service_role() OR current_user_id() IS NOT NULL
```

**The 018 fix works correctly for the first-org creation case.** After the auto-trigger
creates the owner membership row synchronously, RETURNING passes via `created_by = current_user_id()`.

**Residual case:** If a user creates a second org (they already have membership in org-A),
`RequireOrgScope` sets `current_org_id = org-A` (from memberships[0]). The new org is created
with `created_by = current_user_id()`. RETURNING checks SELECT: `created_by = current_user_id()`
is TRUE. **SAFE.**

**Verdict: SAFE** (018 fully covers this).

---

## Summary Table

| Table | Status | Risk Scenario |
|---|---|---|
| `organizations` | **SAFE** (fixed by 018) | Was broken; now has `created_by` escape hatch |
| `profiles` | **SAFE** | Identical INSERT/SELECT predicates; trigger bypasses RLS |
| `locations` | **SAFE** | Trigger path is SECURITY DEFINER; direct path has identical predicates |
| `organization_members` | **SAFE** | SELECT has `profile_id = current_user_id()` escape hatch |
| `organization_invites` | **SAFE** | Identical predicates |
| `customers` | **SAFE** | Requires current_org_id; downstream of org creation |
| `categories` | **SAFE** | Identical predicates |
| `items` | **SAFE** | Identical location→org chain |
| `orders` | **SAFE** | Identical predicates |
| `order_items` | **SAFE** | order→org chain identical |
| `order_payments` | **SAFE** | order→location→org chain identical |
| `driver_location_pings` | **SAFE** | INSERT predicate is a subset of SELECT; self-insert always covered |
| `loyalty_config` | **SAFE** | Identical predicates; re-read on next request |
| `gift_cards` | **SAFE** | Identical predicates |
| `house_accounts` | **SAFE** | Identical predicates |
| `bank_accounts` | **SAFE** | Identical predicates |
| `payout_schedules` | **SAFE** | Identical predicates |
| `suppliers` | **SAFE** | Identical predicates |
| `allergens`, `dietary_tags` | **SAFE** | Identical predicates |
| `stock_movements` | **SAFE** | inventory_item→location→org chain identical |
| `reviews` | **SAFE** | order→location→org chain identical |
| All KDS tables | **SAFE** | station→location→org chain identical |
| All cash_drawer_* tables | **SAFE** | drawer→location→org chain identical |
| All other allowlisted tables | **SAFE** | INSERT WITH CHECK = SELECT USING |

---

## One Genuine Structural Gap Found

### `regions` table — INSERT exposed but should not be

**Status: POLICY MISMATCH (not RLS-RETURNING, but a different access control issue)**

`regions` is listed in the allowlist with `{Select: true, Insert: true, Update: true}`.

The table is defined as reference data with:
```sql
GRANT SELECT ON regions TO PUBLIC;
REVOKE INSERT, UPDATE, DELETE ON regions FROM PUBLIC;
```

There is **no RLS** on the regions table. Postgres table-level permissions block non-service_role
from inserting. Any `POST /data/regions` from a tenant user will fail with a permission-denied
error at the table-grant level (not an RLS error), not an INSERT...RETURNING divergence.

However, this means the allowlist exposes an endpoint (`POST /data/regions`) that always
fails for tenant users. This is dead code at best, a misleading 403/500 response at worst.

**Recommended fix:** Remove `Insert: true, Update: true` from the `regions` allowlist entry,
leaving only `Select: true`.

---

## Conclusion

The audit found **no additional tables** exhibiting the INSERT...RETURNING / RLS SELECT
divergence that broke `organizations`. All allowlisted-insert tables either:

1. Use **identical** INSERT WITH CHECK and SELECT USING predicates (so INSERT only succeeds
   when RETURNING would also succeed), or
2. Have a SELECT predicate that is a **superset** of INSERT WITH CHECK (so any row that
   passes INSERT also passes SELECT).

The `organizations` fix (migration 018) is the only instance where INSERT was broadened
(`current_user_id() IS NOT NULL`) without a matching SELECT escape hatch.

**One non-RLS issue found:** `regions` should have `Insert` and `Update` removed from the
allowlist (`backend/internal/handlers/data/allowlist.go`).

**No new migrations are required.** No test users were created in the database (cleaned up).

---

## Curl Reproduction for `organizations` (historical, for reference)

The original broken flow before migration 018:

```bash
# 1. Sign up fresh user
TOKEN=$(curl -s -X POST http://localhost:8080/auth/signup \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"TestPass123!"}' \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['access_token'])")

# 2. Try to create org — fails before 018
curl -s -X POST http://localhost:8080/data/organizations \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"name":"My Restaurant"}'
# Before 018: {"error":"new row violates row-level security policy for table \"organizations\""}
# After 018: [{"id":"<uuid>","name":"My Restaurant",...}]
```

No equivalent broken flow was found for any other table in this audit.
