-- ======================
-- STAFF AUTHENTICATION
-- Day-to-day POS users log in with username+password (not email).
-- Owners/managers still sign in with email via auth_users + organization_members.
-- Staff credentials live on the staff row itself; refresh tokens in a parallel
-- table so the session plumbing stays clean.
-- ======================

-- Credentials on staff. Username is scoped per-location so "john" can exist
-- at two branches without collision. Hash is bcrypt, matching auth_users.
ALTER TABLE staff
    ADD COLUMN IF NOT EXISTS username text,
    ADD COLUMN IF NOT EXISTS password_hash text,
    ADD COLUMN IF NOT EXISTS last_login_at timestamptz,
    ADD COLUMN IF NOT EXISTS password_set_at timestamptz,
    ADD COLUMN IF NOT EXISTS must_change_password boolean NOT NULL DEFAULT false;

-- Case-insensitive unique per location. NULL usernames are allowed (legacy
-- staff rows without login — e.g. kitchen staff managed externally).
CREATE UNIQUE INDEX idx_staff_username_per_location
    ON staff (location_id, lower(username))
    WHERE username IS NOT NULL;

-- Refresh tokens for staff sessions. Mirrors refresh_tokens (auth_users)
-- so token rotation / revocation logic is familiar.
CREATE TABLE staff_refresh_tokens (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    staff_id uuid NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
    token_hash text NOT NULL UNIQUE,
    issued_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL,
    expires_at timestamptz NOT NULL,
    revoked_at timestamptz,
    replaced_by uuid REFERENCES staff_refresh_tokens(id) ON DELETE SET NULL,
    user_agent text,
    ip inet
);

CREATE INDEX idx_staff_refresh_tokens_staff ON staff_refresh_tokens (staff_id);
CREATE INDEX idx_staff_refresh_tokens_expires ON staff_refresh_tokens (expires_at);

-- Password reset tokens (manager resets a staff pin/password; token is
-- delivered via whatever channel the manager chooses — email, sms, in-person).
CREATE TABLE staff_password_reset_tokens (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    staff_id uuid NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
    token_hash text NOT NULL UNIQUE,
    issued_by uuid REFERENCES staff(id) ON DELETE SET NULL,
    expires_at timestamptz NOT NULL,
    consumed_at timestamptz,
    created_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE INDEX idx_staff_password_reset_tokens_staff ON staff_password_reset_tokens (staff_id);

-- Short-lived PIN for fast register sign-in (optional — many POS systems
-- let a cashier tap a 4-6 digit PIN to clock in/punch an order). Stored as
-- bcrypt hash like the password. NULL = PIN login disabled for that staff.
ALTER TABLE staff
    ADD COLUMN IF NOT EXISTS pin_hash text;

-- Rate-limit / lockout tracking. Populated by the Go handler on failed
-- attempts; cleared on success. locked_until prevents retries until now().
ALTER TABLE staff
    ADD COLUMN IF NOT EXISTS failed_login_attempts integer NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS locked_until timestamptz;
