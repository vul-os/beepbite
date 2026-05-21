# Data-Layer Regression Report — Wave 11 + Onboarding RLS Fixes

**Date:** 2026-05-20  
**Verifier:** V4 regression agent  
**Backend:** localhost:8080 (go run, binary from /tmp/go-build4044602702 compiled ~10:11)

---

## 1. Allowlisted-but-nonexistent Tables (Wave-6 Cleanup Debt)

Cross-referencing `allowlist.go` against `\dt` + `\dv` in Postgres revealed **15 entries** that map to nothing in the schema:

| Table | Status |
|---|---|
| `item_variations` | Does not exist (consolidated) |
| `item_variation_options` | Does not exist (consolidated) |
| `delivery_drivers` | Does not exist (superseded by driver_assignments) |
| `driver_locations` | Does not exist (replaced by driver_location_pings) |
| `order_details` | Does not exist (consolidated into orders) |
| `order_financial_details` | Does not exist (consolidated) |
| `order_item_variations` | Does not exist (consolidated) |
| `driver_ratings` | Does not exist |
| `driver_earnings` | Does not exist |
| `notifications` | Does not exist |
| `bots` | Does not exist (whatsapp_routing/whatsapp_accounts instead) |
| `chats` | Does not exist |
| `messages` | Does not exist |
| `recipe_breakdown` | View does not exist (views: only recipe_cost_runs table exists) |
| `recipe_summary` | View does not exist |

**Impact:** Any frontend call to these table names returns `{"error":"insert not allowed"}` (POST) or `{"error":"table not exposed"}` (GET). These are the Wave-6 cleanup items — safe to remove from allTables.

---

## 2. Wave-11 New Allowlist Entries — CRUD Verification

Test user: `v4-1779264878@example.com`, org `291ed7a0`, location `15794aad`, item `354009f2`.

**Note:** The token issued at signup does not carry org scope (membership didn't exist at signup time). A fresh `/auth/signin` token after membership creation resolves `current_org_id()` correctly via the `RequireOrgScope` middleware.

### modifier_groups
| Op | HTTP | Result |
|---|---|---|
| POST (INSERT) | 201 | Row returned with id `d5c8b449` |
| GET (SELECT) | 200 | Row visible scoped to item_id |
| DELETE | 204 | Confirmed 204 No Content |

### modifiers
| Op | HTTP | Result |
|---|---|---|
| POST (INSERT) | 201 | Row returned with id `4fa1cbec`, price_delta_cents=50 |
| GET (SELECT) | 200 | Row visible scoped to modifier_group_id |
| DELETE | 204 | Confirmed 204 No Content |

### courses
| Op | HTTP | Result |
|---|---|---|
| POST (INSERT) | 201 | Row returned with id `1868ee3c` |
| GET (SELECT) | 200 | Row visible scoped to location_id |
| DELETE | 204 | Confirmed 204 No Content |

**All three tables pass full INSERT+SELECT+DELETE end-to-end via the generic data layer with RLS enforced.**

---

## 3. Capability Resolution

After owner membership creation (via `POST /data/organization_members` with role=owner), the `trg_default_member_capabilities` trigger fires and populates all 14 capability keys.

Verified via `GET /data/organization_members`:

```json
{
  "can_void": true,
  "can_comp": true,
  "can_refund": true,
  "can_settle": true,
  "can_pos": true,
  "can_kitchen": true,
  "can_manage_menu": true,
  "can_manage_inventory": true,
  "can_manage_bank": true,
  "can_manage_payroll": true,
  "can_manage_promotions": true,
  "can_view_reports": true,
  "can_view_inventory": true,
  "can_drive": false
}
```

Capability-gated endpoint: `GET /data/daily_sales_summary` returned 200 (empty, correct — no sales data for test org). No capability-rejection occurred, confirming `can_view_reports=true` is threading through `RequireOrgScope`.

---

## 4. regions Read-Only Check

| Op | HTTP | Result |
|---|---|---|
| GET | 200 | 5 rows returned (ZA, NG, KE, GH, US) |
| POST | 404 | `{"error":"insert not allowed"}` |
| PATCH | 404 | `{"error":"update not allowed"}` |

Confirmed: regions is read-only via the data layer. Allowlist entry `{Select: true}` is correctly enforced.

---

## 5. Bugs / Issues Found

### BUG-V4-01: `recipe_breakdown` and `recipe_summary` allowlisted as views but do not exist
Neither view exists in the current schema. Any frontend query to these will return `{"error":"table not exposed"}`. **Report to backend owner** — either create the views or remove from allowlist.

### BUG-V4-02: RLS on modifier_groups/modifiers/courses blocks INSERT when using signup token
If the frontend attempts to insert into these tables using the token obtained at signup (before the user has created org + membership), the insert fails with `42501 row-level security violation`. This is **expected behaviour** — the middleware injects empty OrgScope for users with no memberships, and current_org_id() returns NULL. A fresh token after membership creation works correctly.

### OBSERVATION: allowlist.go was modified at 09:41 but server binary compiled at 10:11
The server binary is compiled on-demand by `go run`. Earlier in this session the binary (09:34 cached) predated allowlist.go changes and returned "table not exposed" for modifier_groups. The current binary is correct. **Recommend**: ensure CI builds/tests run against freshly compiled binaries.

---

## 6. Cleanup

All test records deleted:
- `DELETE FROM auth_users WHERE email LIKE '%@example.com'` — removed 5 users
- Cascading FK deletions removed associated orgs, locations, memberships, categories, items

---

## Summary

- **15 ghost allowlist entries** found (Wave-6 cleanup debt — no new regressions introduced).
- **modifier_groups, modifiers, courses** all work correctly end-to-end (INSERT→SELECT→DELETE, RLS passes, RETURNING works).
- **Capability resolution** correct: owner membership triggers default capabilities including `can_void=true`.
- **regions** is correctly read-only (POST/PATCH return 404 "not allowed").
- No new regressions detected from Wave 11 or onboarding RLS fixes.
