-- =============================================================================
-- MIGRATION 003 — STAFF AND PIN AUTHENTICATION
-- =============================================================================
-- Sources: legacy 2 (staff, staff_time_entries, staff_shifts,
--           staff_attendance_summary), legacy 21 (staff_auth), legacy 29 (staff_pay_rates).
--
-- Tables created (7):
--   staff, staff_time_entries, staff_shifts, staff_attendance_summary,
--   staff_refresh_tokens, staff_password_reset_tokens, staff_pay_rates
--
-- Key changes vs legacy:
--   staff.email          — column retained but UNIQUE NOT NULL dropped.
--                          Column is now nullable with no uniqueness constraint.
--   staff.member_id      — [NEW] FK to organization_members(id) (nullable).
--                          Allows linking a staff row to a member portal account.
--   staff.display_name   — [NEW] single display name field (replaces
--                          first_name + last_name for screen display; both are
--                          still present).
--   staff.pin_hash       — added from legacy 21 (consolidated here).
--   staff.username       — added from legacy 21; unique per-location index.
--   staff.password_set_at / must_change_password — added from legacy 21.
--   staff.failed_login_attempts / locked_until — consolidated from legacy 21.
--
-- CRITICAL NOTE (Wave 6 handler cleanup):
--   backend/internal/staffauth/store.go and related handlers query staff by
--   email (e.g. "SELECT ... FROM staff WHERE email = $1"). After this
--   migration drops the UNIQUE NOT NULL constraint, those queries remain
--   functionally safe but will no longer benefit from the unique index.
--   They MUST be updated in Wave 6 (T6.x) to look up by username or member_id
--   instead. An index on staff.email is retained for query performance.
--
-- RLS approach for staff tables:
--   staff has a location_id FK. Locations table is defined in migration 008.
--   RLS policies scope rows by checking:
--     staff.location_id IN (
--       SELECT id FROM locations WHERE organization_id = current_org_id()
--     )
--   This uses a deferred join pattern (documented in plan §4.1) because
--   the locations table does not exist yet at migration 003 run time, but
--   the policy bodies are stored as SQL text and resolved at query time.
--   This is safe in Postgres: policy USING clauses are late-bound.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. staff
-- ---------------------------------------------------------------------------
-- Consolidated from legacy 2 + 21.

CREATE TABLE staff (
    id                     uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
    location_id            uuid        NOT NULL,
    -- NOTE: locations FK added by migration 008 via ALTER TABLE ... ADD CONSTRAINT.
    -- The forward reference is intentional: migration 008 owns the locations
    -- table and adds back-FKs for all tables that reference it.

    -- Member portal link [NEW — plan §003]
    member_id              uuid        REFERENCES organization_members(id) ON DELETE SET NULL,

    employee_id            text        UNIQUE,       -- optional HR code
    first_name             text        NOT NULL,
    last_name              text        NOT NULL,
    display_name           text,                     -- [NEW] computed or overridden display name
    email                  text,                     -- was UNIQUE NOT NULL in legacy 2; now nullable (Wave 6 note above)
    phone                  text,
    role                   text        NOT NULL
        CHECK (role IN ('owner', 'manager', 'cashier', 'kitchen', 'admin')),

    -- Status
    is_active              boolean     NOT NULL DEFAULT true,

    -- Login tracking (from legacy 2 + 21)
    last_login_at          timestamptz,
    failed_login_attempts  integer     NOT NULL DEFAULT 0,
    locked_until           timestamptz,

    -- Password / PIN (consolidated from legacy 21)
    password_hash          text,                     -- bcrypt; nullable (PIN-only staff)
    password_set_at        timestamptz,
    must_change_password   boolean     NOT NULL DEFAULT false,
    pin_hash               text,                     -- bcrypt; NULL = PIN login disabled

    -- Username for POS login — unique per location (NULL = no username login).
    username               text,

    -- Employment details
    hire_date              date,
    notes                  text,

    created_at             timestamptz NOT NULL DEFAULT timezone('utc', now()),
    updated_at             timestamptz NOT NULL DEFAULT timezone('utc', now()),

    -- Unique password hash per location (carried from legacy 2; still meaningful
    -- for bcrypt collision prevention at a location level).
    UNIQUE (location_id, password_hash)
);

-- Index on email for backward-compat query performance (handlers still look up
-- by email; unique index removed per plan, regular index retained).
CREATE INDEX idx_staff_email        ON staff (email) WHERE email IS NOT NULL;
CREATE INDEX idx_staff_location     ON staff (location_id);
CREATE INDEX idx_staff_member       ON staff (member_id) WHERE member_id IS NOT NULL;

-- Case-insensitive unique username per location (from legacy 21).
CREATE UNIQUE INDEX idx_staff_username_per_location
    ON staff (location_id, lower(username))
    WHERE username IS NOT NULL;

REVOKE ALL ON staff FROM PUBLIC;

CREATE TRIGGER trg_staff_updated_at
    BEFORE UPDATE ON staff
    FOR EACH ROW EXECUTE FUNCTION set_updated_at_now();

-- RLS: location-scoped (via locations -> organization_id).
ALTER TABLE staff ENABLE ROW LEVEL SECURITY;
ALTER TABLE staff FORCE ROW LEVEL SECURITY;

-- POLICY staff_select ON staff deferred to 007 (locations must exist first; Postgres 18 DDL-time check)

-- POLICY staff_insert ON staff deferred to 007 (locations must exist first; Postgres 18 DDL-time check)

-- POLICY staff_update ON staff deferred to 007 (locations must exist first; Postgres 18 DDL-time check)

CREATE POLICY staff_delete ON staff FOR DELETE
    USING (is_service_role());

-- ---------------------------------------------------------------------------
-- 2. staff_time_entries
-- ---------------------------------------------------------------------------
-- Source: legacy 2. Append-only attendance clock events; no updated_at.

CREATE TABLE staff_time_entries (
    id          uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
    staff_id    uuid        NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
    location_id uuid        NOT NULL,
    -- NOTE: locations FK added by migration 008.
    entry_type  text        NOT NULL
        CHECK (entry_type IN ('clock_in', 'clock_out', 'break_start', 'break_end')),
    timestamp   timestamptz NOT NULL DEFAULT timezone('utc', now()),
    notes       text,
    created_at  timestamptz NOT NULL DEFAULT timezone('utc', now())
);

CREATE INDEX idx_staff_time_entries_staff    ON staff_time_entries (staff_id);
CREATE INDEX idx_staff_time_entries_location ON staff_time_entries (location_id);
CREATE INDEX idx_staff_time_entries_ts       ON staff_time_entries (timestamp);

REVOKE ALL ON staff_time_entries FROM PUBLIC;

-- RLS: location-scoped via staff.location_id.
ALTER TABLE staff_time_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE staff_time_entries FORCE ROW LEVEL SECURITY;

-- POLICY staff_time_entries_select ON staff_time_entries deferred to 007 (locations must exist first; Postgres 18 DDL-time check)

-- POLICY staff_time_entries_insert ON staff_time_entries deferred to 007 (locations must exist first; Postgres 18 DDL-time check)

-- Append-only: no UPDATE. DELETE is service_role only.
CREATE POLICY staff_time_entries_update ON staff_time_entries FOR UPDATE
    USING (false);

CREATE POLICY staff_time_entries_delete ON staff_time_entries FOR DELETE
    USING (is_service_role());

-- ---------------------------------------------------------------------------
-- 3. staff_shifts
-- ---------------------------------------------------------------------------
-- Source: legacy 2. Scheduled shifts with actual times recorded.

CREATE TABLE staff_shifts (
    id                      uuid           DEFAULT gen_random_uuid() PRIMARY KEY,
    staff_id                uuid           NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
    location_id             uuid           NOT NULL,
    -- NOTE: locations FK added by migration 008.
    shift_date              date           NOT NULL,
    scheduled_start         time           NOT NULL,
    scheduled_end           time           NOT NULL,
    actual_start            time,
    actual_end              time,
    total_hours             decimal(4, 2),
    break_duration_minutes  integer        NOT NULL DEFAULT 0,
    status                  text           NOT NULL DEFAULT 'scheduled'
        CHECK (status IN ('scheduled', 'completed', 'no_show', 'partial')),
    notes                   text,
    created_at              timestamptz    NOT NULL DEFAULT timezone('utc', now()),
    updated_at              timestamptz    NOT NULL DEFAULT timezone('utc', now()),
    UNIQUE (staff_id, shift_date)
);

CREATE INDEX idx_staff_shifts_location ON staff_shifts (location_id);
CREATE INDEX idx_staff_shifts_date     ON staff_shifts (shift_date);

REVOKE ALL ON staff_shifts FROM PUBLIC;

CREATE TRIGGER trg_staff_shifts_updated_at
    BEFORE UPDATE ON staff_shifts
    FOR EACH ROW EXECUTE FUNCTION set_updated_at_now();

-- RLS: location-scoped.
ALTER TABLE staff_shifts ENABLE ROW LEVEL SECURITY;
ALTER TABLE staff_shifts FORCE ROW LEVEL SECURITY;

-- POLICY staff_shifts_select ON staff_shifts deferred to 007 (locations must exist first; Postgres 18 DDL-time check)

-- POLICY staff_shifts_insert ON staff_shifts deferred to 007 (locations must exist first; Postgres 18 DDL-time check)

-- POLICY staff_shifts_update ON staff_shifts deferred to 007 (locations must exist first; Postgres 18 DDL-time check)

CREATE POLICY staff_shifts_delete ON staff_shifts FOR DELETE
    USING (is_service_role());

-- ---------------------------------------------------------------------------
-- 4. staff_attendance_summary
-- ---------------------------------------------------------------------------
-- Source: legacy 2. One row per staff member per work date.

CREATE TABLE staff_attendance_summary (
    id                uuid           DEFAULT gen_random_uuid() PRIMARY KEY,
    staff_id          uuid           NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
    location_id       uuid           NOT NULL,
    -- NOTE: locations FK added by migration 008.
    work_date         date           NOT NULL,
    clock_in_time     timestamptz,
    clock_out_time    timestamptz,
    total_hours       decimal(4, 2)  NOT NULL DEFAULT 0,
    break_minutes     integer        NOT NULL DEFAULT 0,
    overtime_hours    decimal(4, 2)  NOT NULL DEFAULT 0,
    is_present        boolean        NOT NULL DEFAULT false,
    is_late           boolean        NOT NULL DEFAULT false,
    minutes_late      integer        NOT NULL DEFAULT 0,
    created_at        timestamptz    NOT NULL DEFAULT timezone('utc', now()),
    updated_at        timestamptz    NOT NULL DEFAULT timezone('utc', now()),
    UNIQUE (staff_id, work_date)
);

CREATE INDEX idx_staff_attendance_location ON staff_attendance_summary (location_id);
CREATE INDEX idx_staff_attendance_date     ON staff_attendance_summary (work_date);

REVOKE ALL ON staff_attendance_summary FROM PUBLIC;

CREATE TRIGGER trg_staff_attendance_summary_updated_at
    BEFORE UPDATE ON staff_attendance_summary
    FOR EACH ROW EXECUTE FUNCTION set_updated_at_now();

-- RLS: location-scoped.
ALTER TABLE staff_attendance_summary ENABLE ROW LEVEL SECURITY;
ALTER TABLE staff_attendance_summary FORCE ROW LEVEL SECURITY;

-- POLICY staff_attendance_summary_select ON staff_attendance_summary deferred to 007 (locations must exist first; Postgres 18 DDL-time check)

-- POLICY staff_attendance_summary_insert ON staff_attendance_summary deferred to 007 (locations must exist first; Postgres 18 DDL-time check)

-- POLICY staff_attendance_summary_update ON staff_attendance_summary deferred to 007 (locations must exist first; Postgres 18 DDL-time check)

CREATE POLICY staff_attendance_summary_delete ON staff_attendance_summary FOR DELETE
    USING (is_service_role());

-- ---------------------------------------------------------------------------
-- 5. staff_refresh_tokens
-- ---------------------------------------------------------------------------
-- Source: legacy 21. Mirrors refresh_tokens (auth_users) for staff sessions.

CREATE TABLE staff_refresh_tokens (
    id          uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
    staff_id    uuid        NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
    token_hash  text        NOT NULL UNIQUE,  -- sha256 of raw token
    issued_at   timestamptz NOT NULL DEFAULT timezone('utc', now()),
    expires_at  timestamptz NOT NULL,
    revoked_at  timestamptz,
    replaced_by uuid        REFERENCES staff_refresh_tokens(id) ON DELETE SET NULL,
    user_agent  text,
    ip          inet
);

CREATE INDEX idx_staff_refresh_tokens_staff   ON staff_refresh_tokens (staff_id);
CREATE INDEX idx_staff_refresh_tokens_expires ON staff_refresh_tokens (expires_at);

REVOKE ALL ON staff_refresh_tokens FROM PUBLIC;

-- RLS: scoped by resolving staff -> location -> org.
ALTER TABLE staff_refresh_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE staff_refresh_tokens FORCE ROW LEVEL SECURITY;

-- POLICY staff_refresh_tokens_select ON staff_refresh_tokens deferred to 007 (locations must exist first; Postgres 18 DDL-time check)

-- POLICY staff_refresh_tokens_insert ON staff_refresh_tokens deferred to 007 (locations must exist first; Postgres 18 DDL-time check)

-- POLICY staff_refresh_tokens_update ON staff_refresh_tokens deferred to 007 (locations must exist first; Postgres 18 DDL-time check)

-- POLICY staff_refresh_tokens_delete ON staff_refresh_tokens deferred to 007 (locations must exist first; Postgres 18 DDL-time check)

-- ---------------------------------------------------------------------------
-- 6. staff_password_reset_tokens
-- ---------------------------------------------------------------------------
-- Source: legacy 21. Manager resets a staff PIN/password.

CREATE TABLE staff_password_reset_tokens (
    id          uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
    staff_id    uuid        NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
    token_hash  text        NOT NULL UNIQUE,
    issued_by   uuid        REFERENCES staff(id) ON DELETE SET NULL,  -- issuing manager
    expires_at  timestamptz NOT NULL,
    consumed_at timestamptz,
    created_at  timestamptz NOT NULL DEFAULT timezone('utc', now())
);

CREATE INDEX idx_staff_pw_reset_tokens_staff ON staff_password_reset_tokens (staff_id);

REVOKE ALL ON staff_password_reset_tokens FROM PUBLIC;

-- RLS: scoped by resolving staff -> location -> org.
ALTER TABLE staff_password_reset_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE staff_password_reset_tokens FORCE ROW LEVEL SECURITY;

-- POLICY staff_password_reset_tokens_select ON staff_password_reset_tokens deferred to 007 (locations must exist first; Postgres 18 DDL-time check)

-- POLICY staff_password_reset_tokens_insert ON staff_password_reset_tokens deferred to 007 (locations must exist first; Postgres 18 DDL-time check)

-- Append-only for regular callers; service can update (e.g. mark consumed_at).
-- POLICY staff_password_reset_tokens_update ON staff_password_reset_tokens deferred to 007 (locations must exist first; Postgres 18 DDL-time check)

CREATE POLICY staff_password_reset_tokens_delete ON staff_password_reset_tokens FOR DELETE
    USING (is_service_role());

-- ---------------------------------------------------------------------------
-- 7. staff_pay_rates
-- ---------------------------------------------------------------------------
-- Source: legacy 29 (effective-dated rate rows).
-- Only one "current" row (effective_until IS NULL) per (staff_id, rate_type).

CREATE TABLE staff_pay_rates (
    id                               uuid           DEFAULT gen_random_uuid() PRIMARY KEY,
    staff_id                         uuid           NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
    rate_type                        text           NOT NULL
        CHECK (rate_type IN ('hourly', 'salary_monthly', 'salary_annual', 'commission', 'per_shift')),
    -- All amounts in cents for consistency with payments.
    amount_cents                     bigint         NOT NULL CHECK (amount_cents >= 0),
    currency                         text           NOT NULL DEFAULT 'ZAR',

    -- Commission-specific (only meaningful when rate_type='commission').
    commission_percentage            decimal(6, 3)
        CHECK (commission_percentage IS NULL OR commission_percentage >= 0),
    commission_basis                 text
        CHECK (commission_basis IN ('sales', 'orders', 'tips') OR commission_basis IS NULL),

    -- Overtime multipliers
    overtime_multiplier              decimal(4, 2)  NOT NULL DEFAULT 1.5
        CHECK (overtime_multiplier >= 1),
    overtime_threshold_hours_per_week decimal(5, 2) DEFAULT 45,  -- SA BCEA default

    effective_from                   date           NOT NULL,
    effective_until                  date,          -- NULL = currently active

    notes                            text,
    created_by                       uuid           REFERENCES profiles(id) ON DELETE SET NULL,
    created_at                       timestamptz    NOT NULL DEFAULT timezone('utc', now()),
    updated_at                       timestamptz    NOT NULL DEFAULT timezone('utc', now()),

    CHECK (effective_until IS NULL OR effective_until >= effective_from)
);

CREATE INDEX idx_staff_pay_rates_staff     ON staff_pay_rates (staff_id);
CREATE INDEX idx_staff_pay_rates_effective ON staff_pay_rates (staff_id, effective_from DESC);

-- Only one currently-active rate per (staff, rate_type).
CREATE UNIQUE INDEX one_current_rate_per_staff_and_type
    ON staff_pay_rates (staff_id, rate_type)
    WHERE effective_until IS NULL;

REVOKE ALL ON staff_pay_rates FROM PUBLIC;

CREATE TRIGGER trg_staff_pay_rates_updated_at
    BEFORE UPDATE ON staff_pay_rates
    FOR EACH ROW EXECUTE FUNCTION set_updated_at_now();

-- RLS: scoped by resolving staff -> location -> org.
ALTER TABLE staff_pay_rates ENABLE ROW LEVEL SECURITY;
ALTER TABLE staff_pay_rates FORCE ROW LEVEL SECURITY;

-- POLICY staff_pay_rates_select ON staff_pay_rates deferred to 007 (locations must exist first; Postgres 18 DDL-time check)

-- POLICY staff_pay_rates_insert ON staff_pay_rates deferred to 007 (locations must exist first; Postgres 18 DDL-time check)

-- POLICY staff_pay_rates_update ON staff_pay_rates deferred to 007 (locations must exist first; Postgres 18 DDL-time check)

CREATE POLICY staff_pay_rates_delete ON staff_pay_rates FOR DELETE
    USING (is_service_role());

-- ---------------------------------------------------------------------------
-- DONE
-- ---------------------------------------------------------------------------
-- Migration 003 complete. Tables (7):
--   staff                        — location-scoped RLS via locations.organization_id
--   staff_time_entries           — location-scoped RLS; append-only (no UPDATE)
--   staff_shifts                 — location-scoped RLS
--   staff_attendance_summary     — location-scoped RLS
--   staff_refresh_tokens         — scoped via staff -> location -> org
--   staff_password_reset_tokens  — scoped via staff -> location -> org
--   staff_pay_rates              — scoped via staff -> location -> org
--
-- Policies summary:
--   All staff tables use the deferred-join pattern:
--     staff.location_id IN (SELECT id FROM locations WHERE organization_id = current_org_id())
--     OR is_service_role()
--   Threat addressed: one tenant's manager reading or editing another tenant's
--   staff roster, schedule, pay rates, or session tokens.
--
--   staff_time_entries UPDATE policy returns false (append-only).
--   Threat: retroactive attendance falsification.
--
--   All DELETE policies are is_service_role() only.
--   Threat: unauthorized record deletion bypassing audit; soft-delete patterns
--   (is_active=false) preferred for staff rows.
--
-- Forward-FK note:
--   staff.location_id, staff_time_entries.location_id, staff_shifts.location_id,
--   staff_attendance_summary.location_id do NOT have FK constraints yet.
--   Migration 008 (which creates the locations table) will add:
--     ALTER TABLE staff ADD CONSTRAINT staff_location_id_fkey
--       FOREIGN KEY (location_id) REFERENCES locations(id) ON DELETE CASCADE;
--   and similarly for the other tables. This avoids a circular dependency
--   between migrations 003 and 008.
--
-- Wave 6 handler cleanup required:
--   backend/internal/staffauth/store.go — queries by staff.email.
--   After this migration removes the UNIQUE NOT NULL constraint, email lookups
--   still work (non-unique index retained) but callers must be aware that
--   multiple staff rows may share the same email if email is reused across
--   locations. The preferred lookup in Wave 6 is by (location_id, username)
--   or by member_id for portal-linked staff.
