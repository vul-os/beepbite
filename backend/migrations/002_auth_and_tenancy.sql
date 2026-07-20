-- =============================================================================
-- MIGRATION 002 — AUTH AND TENANCY
-- =============================================================================
-- Sources: legacy 1, 2 (auth/org/profile parts), 13, 14, 38, 43.
--
-- Tables created (10):
--   auth_users, refresh_tokens, password_reset_tokens, profiles,
--   organizations, organization_members, organization_invites,
--   currencies, whatsapp_accounts [NEW], whatsapp_link_tokens [NEW]
--
-- New columns vs legacy:
--   auth_users.is_platform_admin        (Now-16)
--   organizations.default_currency_code (legacy 38)
--   organization_members.capabilities jsonb  (ROADMAP Now-16 / plan §002)
--   organization_members.role CHECK extended: adds 'kitchen','pos','driver'
--   organization_invites.role CHECK extended to match organization_members
--   profiles.whatsapp_count int (maintained by trigger; max-3 via CHECK)
--
-- DEVIATION NOTE (staff.email):
--   Legacy 2 created staff.email UNIQUE NOT NULL. That column is intentionally
--   retained in migration 003 but the UNIQUE NOT NULL constraint is dropped
--   per the plan (§003 critical note). Handlers in backend/internal/staffauth/
--   still reference staff.email; they must be updated in Wave 6 (T6.x).
--
-- DEVIATION NOTE (functions from legacy 13/14/43):
--   check_invites(), respond_invitation(), send_invitation(),
--   cancel_invitation(), list_organization_invitations(),
--   handle_new_user(), handle_new_organization() are INCLUDED here because
--   they directly depend on the tables in this migration and have no other
--   natural home. handle_new_organization() references locations (migration
--   008); the function is a no-op when a location already exists.
--   so it is safe before seed data exists. The trigger fires after this
--   migration runs and quietly no-ops until seed is present.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- GRANTS / REVOKE baseline for this migration's tables
-- ---------------------------------------------------------------------------
-- Migration 001 set ALTER DEFAULT PRIVILEGES ... GRANT ALL ON TABLES TO service_role,
-- so tables created here automatically get service_role grants.
-- We explicitly REVOKE ALL FROM PUBLIC on each table after creation.

-- ---------------------------------------------------------------------------
-- 1. auth_users
-- ---------------------------------------------------------------------------
-- Source: legacy 1, extended with is_platform_admin (Now-16).

CREATE TABLE auth_users (
    id                  uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
    email               text        NOT NULL UNIQUE,
    password_hash       text,                              -- null for OAuth-only accounts
    email_verified      boolean     NOT NULL DEFAULT false,
    raw_user_meta_data  jsonb       NOT NULL DEFAULT '{}',
    last_sign_in_at     timestamptz,
    is_platform_admin   boolean     NOT NULL DEFAULT false, -- [NEW] Now-16: platform super-admin flag
    created_at          timestamptz NOT NULL DEFAULT timezone('utc', now()),
    updated_at          timestamptz NOT NULL DEFAULT timezone('utc', now())
);

-- Case-insensitive email index (fast login lookup).
CREATE INDEX idx_auth_users_email ON auth_users (lower(email));

REVOKE ALL ON auth_users FROM PUBLIC;

-- updated_at trigger
CREATE TRIGGER trg_auth_users_updated_at
    BEFORE UPDATE ON auth_users
    FOR EACH ROW EXECUTE FUNCTION set_updated_at_now();

-- RLS
ALTER TABLE auth_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE auth_users FORCE ROW LEVEL SECURITY;

-- Each user sees only their own row; service bypasses.
CREATE POLICY auth_users_select ON auth_users FOR SELECT
    USING (id = current_user_id() OR is_service_role());

CREATE POLICY auth_users_insert ON auth_users FOR INSERT
    WITH CHECK (id = current_user_id() OR is_service_role());

CREATE POLICY auth_users_update ON auth_users FOR UPDATE
    USING (id = current_user_id() OR is_service_role())
    WITH CHECK (id = current_user_id() OR is_service_role());

-- Deletes are service-only (soft-delete via is_active on downstream tables).
CREATE POLICY auth_users_delete ON auth_users FOR DELETE
    USING (is_service_role());

-- ---------------------------------------------------------------------------
-- 2. refresh_tokens
-- ---------------------------------------------------------------------------
-- Source: legacy 1.

CREATE TABLE refresh_tokens (
    id          uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id     uuid        NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
    token_hash  text        NOT NULL UNIQUE,  -- sha256 of raw token
    issued_at   timestamptz NOT NULL DEFAULT timezone('utc', now()),
    expires_at  timestamptz NOT NULL,
    revoked_at  timestamptz,
    replaced_by uuid        REFERENCES refresh_tokens(id) ON DELETE SET NULL,
    user_agent  text,
    ip          inet
);

CREATE INDEX idx_refresh_tokens_user    ON refresh_tokens (user_id);
CREATE INDEX idx_refresh_tokens_expires ON refresh_tokens (expires_at);

REVOKE ALL ON refresh_tokens FROM PUBLIC;

-- RLS: member-scoped — user sees only their own tokens.
ALTER TABLE refresh_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE refresh_tokens FORCE ROW LEVEL SECURITY;

CREATE POLICY refresh_tokens_select ON refresh_tokens FOR SELECT
    USING (user_id = current_user_id() OR is_service_role());

CREATE POLICY refresh_tokens_insert ON refresh_tokens FOR INSERT
    WITH CHECK (user_id = current_user_id() OR is_service_role());

CREATE POLICY refresh_tokens_update ON refresh_tokens FOR UPDATE
    USING (user_id = current_user_id() OR is_service_role())
    WITH CHECK (user_id = current_user_id() OR is_service_role());

CREATE POLICY refresh_tokens_delete ON refresh_tokens FOR DELETE
    USING (user_id = current_user_id() OR is_service_role());

-- ---------------------------------------------------------------------------
-- 3. password_reset_tokens
-- ---------------------------------------------------------------------------
-- Source: legacy 1.

CREATE TABLE password_reset_tokens (
    id          uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id     uuid        NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
    token_hash  text        NOT NULL UNIQUE,
    expires_at  timestamptz NOT NULL,
    consumed_at timestamptz,
    created_at  timestamptz NOT NULL DEFAULT timezone('utc', now())
);

CREATE INDEX idx_password_reset_tokens_user ON password_reset_tokens (user_id);

REVOKE ALL ON password_reset_tokens FROM PUBLIC;

-- RLS: member-scoped — user sees only their own tokens; service bypasses.
ALTER TABLE password_reset_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE password_reset_tokens FORCE ROW LEVEL SECURITY;

CREATE POLICY password_reset_tokens_select ON password_reset_tokens FOR SELECT
    USING (user_id = current_user_id() OR is_service_role());

CREATE POLICY password_reset_tokens_insert ON password_reset_tokens FOR INSERT
    WITH CHECK (user_id = current_user_id() OR is_service_role());

CREATE POLICY password_reset_tokens_update ON password_reset_tokens FOR UPDATE
    USING (user_id = current_user_id() OR is_service_role())
    WITH CHECK (user_id = current_user_id() OR is_service_role());

CREATE POLICY password_reset_tokens_delete ON password_reset_tokens FOR DELETE
    USING (user_id = current_user_id() OR is_service_role());

-- ---------------------------------------------------------------------------
-- 4. currencies
-- ---------------------------------------------------------------------------
-- Source: legacy 38. Placed before organizations because organizations has
-- a FK to currencies.code.
-- No RLS: global ISO reference data; readable by all, mutable by service only.

CREATE TABLE currencies (
    code           text        PRIMARY KEY,           -- ISO 4217 3-letter code
    name           text        NOT NULL,
    symbol         text        NOT NULL,
    decimal_digits int         NOT NULL DEFAULT 2,
    is_active      boolean     NOT NULL DEFAULT true,
    created_at     timestamptz NOT NULL DEFAULT now()
);

-- Grant public read access (reference data; no RLS needed per plan §5).
GRANT SELECT ON currencies TO PUBLIC;
REVOKE INSERT, UPDATE, DELETE ON currencies FROM PUBLIC;

COMMENT ON TABLE currencies IS
    'ISO 4217 currency reference. Global — not tenant-scoped. '
    'Mutable only by service_role.';

-- ---------------------------------------------------------------------------
-- 5. profiles
-- ---------------------------------------------------------------------------
-- Source: legacy 2, extended with whatsapp_count.
-- The whatsapp_count column is maintained by the
-- trg_whatsapp_accounts_count trigger defined after whatsapp_accounts.

CREATE TABLE profiles (
    id              uuid        NOT NULL PRIMARY KEY REFERENCES auth_users(id) ON DELETE CASCADE,
    updated_at      timestamptz,
    username        text        UNIQUE,
    full_name       text,
    email           text        UNIQUE,
    avatar_url      text,
    website         text,
    whatsapp_count  int         NOT NULL DEFAULT 0,  -- [NEW] maintained by trigger; max enforced on whatsapp_accounts
    CONSTRAINT username_length CHECK (char_length(username) >= 3)
);

REVOKE ALL ON profiles FROM PUBLIC;

-- updated_at trigger
CREATE TRIGGER trg_profiles_updated_at
    BEFORE UPDATE ON profiles
    FOR EACH ROW EXECUTE FUNCTION set_updated_at_now();

-- RLS: member-scoped — each profile owner sees only their own row.
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE profiles FORCE ROW LEVEL SECURITY;

CREATE POLICY profiles_select ON profiles FOR SELECT
    USING (id = current_user_id() OR is_service_role());

CREATE POLICY profiles_insert ON profiles FOR INSERT
    WITH CHECK (id = current_user_id() OR is_service_role());

CREATE POLICY profiles_update ON profiles FOR UPDATE
    USING (id = current_user_id() OR is_service_role())
    WITH CHECK (id = current_user_id() OR is_service_role());

CREATE POLICY profiles_delete ON profiles FOR DELETE
    USING (is_service_role());

-- ---------------------------------------------------------------------------
-- 6. organizations
-- ---------------------------------------------------------------------------
-- Source: legacy 2 + 38 (default_currency_code).

CREATE TABLE organizations (
    id                          uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
    name                        text        NOT NULL,
    is_active                   boolean     NOT NULL DEFAULT true,
    default_currency_code       text        REFERENCES currencies(code) DEFAULT 'ZAR', -- legacy 38
    created_at                  timestamptz NOT NULL DEFAULT timezone('utc', now()),
    updated_at                  timestamptz NOT NULL DEFAULT timezone('utc', now())
);

REVOKE ALL ON organizations FROM PUBLIC;

CREATE TRIGGER trg_organizations_updated_at
    BEFORE UPDATE ON organizations
    FOR EACH ROW EXECUTE FUNCTION set_updated_at_now();

-- RLS: org-scoped.
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE organizations FORCE ROW LEVEL SECURITY;

CREATE POLICY organizations_select ON organizations FOR SELECT
    USING (id = current_org_id() OR is_service_role());

CREATE POLICY organizations_insert ON organizations FOR INSERT
    WITH CHECK (id = current_org_id() OR is_service_role());

CREATE POLICY organizations_update ON organizations FOR UPDATE
    USING (id = current_org_id() OR is_service_role())
    WITH CHECK (id = current_org_id() OR is_service_role());

CREATE POLICY organizations_delete ON organizations FOR DELETE
    USING (is_service_role());

-- ---------------------------------------------------------------------------
-- 7. organization_members
-- ---------------------------------------------------------------------------
-- Source: legacy 2, extended with:
--   capabilities jsonb (plan §002)
--   role CHECK now includes 'kitchen', 'pos', 'driver'

CREATE TABLE organization_members (
    id              uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
    organization_id uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    profile_id      uuid        NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    role            text        NOT NULL
        CHECK (role IN ('owner', 'manager', 'staff', 'admin', 'kitchen', 'pos', 'driver')),
    -- [NEW] capability flags; documented keys: can_pos, can_kitchen, can_void,
    --       can_comp, can_settle, can_view_reports, can_drive
    capabilities    jsonb       NOT NULL DEFAULT '{}',
    created_at      timestamptz NOT NULL DEFAULT timezone('utc', now()),
    updated_at      timestamptz NOT NULL DEFAULT timezone('utc', now()),
    UNIQUE (organization_id, profile_id)
);

CREATE INDEX idx_org_members_org     ON organization_members (organization_id);
CREATE INDEX idx_org_members_profile ON organization_members (profile_id);

REVOKE ALL ON organization_members FROM PUBLIC;

CREATE TRIGGER trg_organization_members_updated_at
    BEFORE UPDATE ON organization_members
    FOR EACH ROW EXECUTE FUNCTION set_updated_at_now();

-- RLS: org-scoped.
ALTER TABLE organization_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE organization_members FORCE ROW LEVEL SECURITY;

CREATE POLICY organization_members_select ON organization_members FOR SELECT
    USING (organization_id = current_org_id() OR is_service_role());

CREATE POLICY organization_members_insert ON organization_members FOR INSERT
    WITH CHECK (organization_id = current_org_id() OR is_service_role());

CREATE POLICY organization_members_update ON organization_members FOR UPDATE
    USING (organization_id = current_org_id() OR is_service_role())
    WITH CHECK (organization_id = current_org_id() OR is_service_role());

CREATE POLICY organization_members_delete ON organization_members FOR DELETE
    USING (is_service_role());

-- ---------------------------------------------------------------------------
-- 8. organization_invites
-- ---------------------------------------------------------------------------
-- Source: legacy 2, role CHECK extended to match organization_members.

CREATE TABLE organization_invites (
    id              uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
    organization_id uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    email           text        NOT NULL,
    role            text        NOT NULL
        CHECK (role IN ('owner', 'manager', 'staff', 'admin', 'kitchen', 'pos', 'driver')),
    status          text        NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'accepted', 'rejected')),
    invited_by      uuid        REFERENCES profiles(id) ON DELETE SET NULL,
    created_at      timestamptz NOT NULL DEFAULT timezone('utc', now()),
    updated_at      timestamptz NOT NULL DEFAULT timezone('utc', now())
);

CREATE INDEX idx_org_invites_org   ON organization_invites (organization_id);
CREATE INDEX idx_org_invites_email ON organization_invites (email);

REVOKE ALL ON organization_invites FROM PUBLIC;

CREATE TRIGGER trg_organization_invites_updated_at
    BEFORE UPDATE ON organization_invites
    FOR EACH ROW EXECUTE FUNCTION set_updated_at_now();

-- RLS: org-scoped.
ALTER TABLE organization_invites ENABLE ROW LEVEL SECURITY;
ALTER TABLE organization_invites FORCE ROW LEVEL SECURITY;

CREATE POLICY organization_invites_select ON organization_invites FOR SELECT
    USING (organization_id = current_org_id() OR is_service_role());

CREATE POLICY organization_invites_insert ON organization_invites FOR INSERT
    WITH CHECK (organization_id = current_org_id() OR is_service_role());

CREATE POLICY organization_invites_update ON organization_invites FOR UPDATE
    USING (organization_id = current_org_id() OR is_service_role())
    WITH CHECK (organization_id = current_org_id() OR is_service_role());

CREATE POLICY organization_invites_delete ON organization_invites FOR DELETE
    USING (is_service_role());

-- ---------------------------------------------------------------------------
-- 9. whatsapp_accounts  [NEW — ROADMAP Now-8]
-- ---------------------------------------------------------------------------
-- One account = one verified phone number linked to a profile.
-- Max 3 per profile enforced by trigger (trg_whatsapp_accounts_max_3) below.

CREATE TABLE whatsapp_accounts (
    id           uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
    profile_id   uuid        NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    phone_e164   text        NOT NULL UNIQUE,   -- E.164 format e.g. +27821234567
    verified_at  timestamptz,
    created_at   timestamptz NOT NULL DEFAULT timezone('utc', now())
);

CREATE INDEX idx_whatsapp_accounts_profile ON whatsapp_accounts (profile_id);

REVOKE ALL ON whatsapp_accounts FROM PUBLIC;

-- Trigger 1: enforce max-3 per profile before insert.
CREATE OR REPLACE FUNCTION _check_whatsapp_account_limit()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF (
        SELECT count(*) FROM whatsapp_accounts WHERE profile_id = NEW.profile_id
    ) >= 3 THEN
        RAISE EXCEPTION 'profile % already has 3 WhatsApp accounts (maximum)', NEW.profile_id
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_whatsapp_accounts_max_3
    BEFORE INSERT ON whatsapp_accounts
    FOR EACH ROW EXECUTE FUNCTION _check_whatsapp_account_limit();

-- Trigger 2: maintain profiles.whatsapp_count on insert / delete.
CREATE OR REPLACE FUNCTION _sync_whatsapp_count()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        UPDATE profiles SET whatsapp_count = whatsapp_count + 1 WHERE id = NEW.profile_id;
    ELSIF TG_OP = 'DELETE' THEN
        UPDATE profiles SET whatsapp_count = GREATEST(whatsapp_count - 1, 0) WHERE id = OLD.profile_id;
    END IF;
    RETURN NULL;
END;
$$;

CREATE TRIGGER trg_whatsapp_accounts_count
    AFTER INSERT OR DELETE ON whatsapp_accounts
    FOR EACH ROW EXECUTE FUNCTION _sync_whatsapp_count();

-- RLS: member-scoped — each profile owner sees only their own linked numbers.
ALTER TABLE whatsapp_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE whatsapp_accounts FORCE ROW LEVEL SECURITY;

CREATE POLICY whatsapp_accounts_select ON whatsapp_accounts FOR SELECT
    USING (profile_id = current_user_id() OR is_service_role());

CREATE POLICY whatsapp_accounts_insert ON whatsapp_accounts FOR INSERT
    WITH CHECK (profile_id = current_user_id() OR is_service_role());

CREATE POLICY whatsapp_accounts_update ON whatsapp_accounts FOR UPDATE
    USING (profile_id = current_user_id() OR is_service_role())
    WITH CHECK (profile_id = current_user_id() OR is_service_role());

CREATE POLICY whatsapp_accounts_delete ON whatsapp_accounts FOR DELETE
    USING (profile_id = current_user_id() OR is_service_role());

-- ---------------------------------------------------------------------------
-- 10. whatsapp_link_tokens  [NEW — ROADMAP Now-8]
-- ---------------------------------------------------------------------------
-- Short-lived tokens for binding a phone to an account or starting an order.
-- Service-only: no public read. Only service_role writes.

CREATE TABLE whatsapp_link_tokens (
    token       text                 PRIMARY KEY,           -- random opaque token
    phone_e164  text                 NOT NULL,
    intent      whatsapp_link_intent NOT NULL,              -- 'bind' | 'order'
    profile_id  uuid                 REFERENCES profiles(id) ON DELETE SET NULL,  -- NULL for anonymous order intent
    expires_at  timestamptz          NOT NULL,
    used_at     timestamptz
);

CREATE INDEX idx_whatsapp_link_tokens_phone      ON whatsapp_link_tokens (phone_e164);
CREATE INDEX idx_whatsapp_link_tokens_expires    ON whatsapp_link_tokens (expires_at);

REVOKE ALL ON whatsapp_link_tokens FROM PUBLIC;

-- RLS: service-only — no public read or write; service_role bypasses via session var.
ALTER TABLE whatsapp_link_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE whatsapp_link_tokens FORCE ROW LEVEL SECURITY;

-- No SELECT policy for tenants; only service_role reads.
CREATE POLICY whatsapp_link_tokens_select ON whatsapp_link_tokens FOR SELECT
    USING (is_service_role());

CREATE POLICY whatsapp_link_tokens_insert ON whatsapp_link_tokens FOR INSERT
    WITH CHECK (is_service_role());

CREATE POLICY whatsapp_link_tokens_update ON whatsapp_link_tokens FOR UPDATE
    USING (is_service_role())
    WITH CHECK (is_service_role());

CREATE POLICY whatsapp_link_tokens_delete ON whatsapp_link_tokens FOR DELETE
    USING (is_service_role());

-- ---------------------------------------------------------------------------
-- INVITE MANAGEMENT FUNCTIONS (legacy 13)
-- ---------------------------------------------------------------------------
-- Retained here verbatim from legacy 13. These SECURITY DEFINER functions
-- are safe: they access only the tables defined in this migration.

CREATE OR REPLACE FUNCTION check_invites(p_user_id uuid)
RETURNS TABLE (
    invite_id         uuid,
    organization_id   uuid,
    organization_name text,
    invited_by_name   text,
    role              text,
    created_at        timestamptz
)
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
    current_user_email text;
BEGIN
    IF p_user_id IS NULL THEN
        RAISE EXCEPTION 'user_id is required';
    END IF;

    SELECT email INTO current_user_email
    FROM profiles
    WHERE id = p_user_id;

    IF current_user_email IS NULL THEN
        RAISE EXCEPTION 'User profile not found';
    END IF;

    RETURN QUERY
    SELECT
        oi.id,
        oi.organization_id,
        o.name,
        COALESCE(p.full_name, p.username, 'Unknown'),
        oi.role,
        oi.created_at
    FROM organization_invites oi
    JOIN organizations o ON oi.organization_id = o.id
    LEFT JOIN profiles p ON oi.invited_by = p.id
    WHERE oi.email = current_user_email
      AND oi.status = 'pending'
      AND o.is_active = true
    ORDER BY oi.created_at DESC;
END;
$$;

CREATE OR REPLACE FUNCTION respond_invitation(
    p_user_id  uuid,
    p_invite_id uuid,
    p_accept   boolean
)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
    current_user_email text;
    invite_record organization_invites%ROWTYPE;
    result json;
BEGIN
    IF p_user_id IS NULL THEN
        RETURN json_build_object('success', false, 'error', 'user_id is required');
    END IF;

    SELECT email INTO current_user_email
    FROM profiles WHERE id = p_user_id;

    IF current_user_email IS NULL THEN
        RETURN json_build_object('success', false, 'error', 'User profile not found');
    END IF;

    SELECT oi.* INTO invite_record
    FROM organization_invites oi
    JOIN organizations o ON oi.organization_id = o.id
    WHERE oi.id = p_invite_id
      AND oi.email = current_user_email
      AND oi.status = 'pending'
      AND o.is_active = true;

    IF NOT FOUND THEN
        RETURN json_build_object('success', false, 'error', 'No pending invitation found or invitation expired');
    END IF;

    IF p_accept THEN
        UPDATE organization_invites
        SET status = 'accepted', updated_at = now()
        WHERE id = invite_record.id;

        INSERT INTO organization_members (organization_id, profile_id, role)
        VALUES (invite_record.organization_id, p_user_id, invite_record.role)
        ON CONFLICT (organization_id, profile_id) DO UPDATE SET
            role = EXCLUDED.role,
            updated_at = now();

        result := json_build_object(
            'success', true,
            'message', 'Invitation accepted successfully',
            'organization_id', invite_record.organization_id,
            'role', invite_record.role
        );
    ELSE
        UPDATE organization_invites
        SET status = 'rejected', updated_at = now()
        WHERE id = invite_record.id;

        result := json_build_object('success', true, 'message', 'Invitation rejected');
    END IF;

    RETURN result;
EXCEPTION WHEN others THEN
    RETURN json_build_object('success', false, 'error', SQLERRM);
END;
$$;

CREATE OR REPLACE FUNCTION send_invitation(
    p_user_id        uuid,
    p_organization_id uuid,
    p_email          text,
    p_role           text DEFAULT 'staff'
)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
    organization_exists   boolean;
    user_is_member        boolean;
    user_role             text;
    invite_exists         boolean;
    user_already_member   boolean;
BEGIN
    IF p_user_id IS NULL THEN
        RETURN json_build_object('success', false, 'error', 'user_id is required');
    END IF;

    IF p_email !~ '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$' THEN
        RETURN json_build_object('success', false, 'error', 'Invalid email format');
    END IF;

    IF p_role NOT IN ('owner', 'manager', 'staff', 'admin', 'kitchen', 'pos', 'driver') THEN
        RETURN json_build_object(
            'success', false,
            'error', 'Invalid role. Must be owner, manager, staff, admin, kitchen, pos, or driver'
        );
    END IF;

    SELECT EXISTS(
        SELECT 1 FROM organizations WHERE id = p_organization_id AND is_active = true
    ) INTO organization_exists;

    IF NOT organization_exists THEN
        RETURN json_build_object('success', false, 'error', 'Organization not found or inactive');
    END IF;

    SELECT EXISTS(
        SELECT 1 FROM organization_members
        WHERE organization_id = p_organization_id AND profile_id = p_user_id
    ),
    COALESCE(
        (SELECT role FROM organization_members
         WHERE organization_id = p_organization_id AND profile_id = p_user_id),
        'none'
    ) INTO user_is_member, user_role;

    IF NOT user_is_member THEN
        RETURN json_build_object('success', false, 'error', 'You are not a member of this organization');
    END IF;

    IF user_role NOT IN ('owner', 'manager', 'admin') THEN
        RETURN json_build_object('success', false, 'error', 'Insufficient permissions to send invitations');
    END IF;

    SELECT EXISTS(
        SELECT 1 FROM organization_members om
        JOIN profiles p ON om.profile_id = p.id
        WHERE om.organization_id = p_organization_id AND p.email = p_email
    ) INTO user_already_member;

    IF user_already_member THEN
        RETURN json_build_object('success', false, 'error', 'User is already a member of this organization');
    END IF;

    SELECT EXISTS(
        SELECT 1 FROM organization_invites
        WHERE organization_id = p_organization_id
          AND email = p_email
          AND status = 'pending'
    ) INTO invite_exists;

    IF invite_exists THEN
        RETURN json_build_object('success', false, 'error', 'A pending invitation already exists for this email');
    END IF;

    INSERT INTO organization_invites (organization_id, email, invited_by, role, status)
    VALUES (p_organization_id, p_email, p_user_id, p_role, 'pending');

    RETURN json_build_object(
        'success', true,
        'message', 'Invitation sent successfully',
        'invited_email', p_email,
        'role', p_role
    );
EXCEPTION WHEN others THEN
    RETURN json_build_object('success', false, 'error', SQLERRM);
END;
$$;

CREATE OR REPLACE FUNCTION cancel_invitation(
    p_user_id   uuid,
    p_invite_id uuid
)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
    user_role     text;
    invite_record organization_invites%ROWTYPE;
BEGIN
    IF p_user_id IS NULL THEN
        RETURN json_build_object('success', false, 'error', 'user_id is required');
    END IF;

    SELECT * INTO invite_record
    FROM organization_invites WHERE id = p_invite_id AND status = 'pending';

    IF NOT FOUND THEN
        RETURN json_build_object('success', false, 'error', 'Invitation not found or already processed');
    END IF;

    SELECT role INTO user_role
    FROM organization_members
    WHERE organization_id = invite_record.organization_id AND profile_id = p_user_id;

    IF user_role IS NULL THEN
        RETURN json_build_object('success', false, 'error', 'You are not a member of this organization');
    END IF;

    IF user_role NOT IN ('owner', 'manager', 'admin') THEN
        RETURN json_build_object('success', false, 'error', 'Insufficient permissions to cancel invitations');
    END IF;

    DELETE FROM organization_invites WHERE id = p_invite_id;

    RETURN json_build_object('success', true, 'message', 'Invitation cancelled successfully');
EXCEPTION WHEN others THEN
    RETURN json_build_object('success', false, 'error', SQLERRM);
END;
$$;

CREATE OR REPLACE FUNCTION list_organization_invitations(
    p_user_id        uuid,
    p_organization_id uuid
)
RETURNS TABLE (
    invite_id       uuid,
    email           text,
    role            text,
    invited_by_name text,
    created_at      timestamptz,
    status          text
)
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
    user_role text;
BEGIN
    IF p_user_id IS NULL THEN
        RAISE EXCEPTION 'user_id is required';
    END IF;

    SELECT om.role INTO user_role
    FROM organization_members om
    WHERE om.organization_id = p_organization_id AND om.profile_id = p_user_id;

    IF user_role IS NULL THEN
        RAISE EXCEPTION 'You are not a member of this organization';
    END IF;

    IF user_role NOT IN ('owner', 'manager', 'admin') THEN
        RAISE EXCEPTION 'Insufficient permissions to view invitations';
    END IF;

    RETURN QUERY
    SELECT
        oi.id,
        oi.email,
        oi.role,
        COALESCE(p.full_name, p.username, 'Unknown'),
        oi.created_at,
        oi.status
    FROM organization_invites oi
    LEFT JOIN profiles p ON oi.invited_by = p.id
    WHERE oi.organization_id = p_organization_id
    ORDER BY oi.created_at DESC;
END;
$$;

-- ---------------------------------------------------------------------------
-- NEW USER TRIGGER (legacy 14)
-- ---------------------------------------------------------------------------
-- Auto-creates a profiles row when a new auth_users row is inserted.
-- Also auto-accepts any pending invites for the user's email.

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
    new_profile_id    uuid;
    proposed_username text;
    final_username    text;
    username_counter  integer := 1;
    username_exists   boolean;
    invite_count      integer;
BEGIN
    proposed_username := COALESCE(
        NULLIF(trim(new.raw_user_meta_data->>'username'), ''),
        split_part(new.email, '@', 1)
    );

    IF char_length(proposed_username) < 3 THEN
        proposed_username := proposed_username || '123';
    END IF;

    final_username := proposed_username;
    LOOP
        SELECT EXISTS(
            SELECT 1 FROM public.profiles WHERE username = final_username
        ) INTO username_exists;
        EXIT WHEN NOT username_exists;
        final_username := proposed_username || username_counter::text;
        username_counter := username_counter + 1;
    END LOOP;

    INSERT INTO public.profiles (id, full_name, email, avatar_url, username)
    VALUES (
        new.id,
        new.raw_user_meta_data->>'full_name',
        new.email,
        new.raw_user_meta_data->>'avatar_url',
        final_username
    )
    ON CONFLICT (id) DO NOTHING
    RETURNING id INTO new_profile_id;

    IF new_profile_id IS NULL THEN
        SELECT id INTO new_profile_id FROM public.profiles WHERE id = new.id;
    END IF;

    SELECT count(*) INTO invite_count
    FROM public.organization_invites
    WHERE email = new.email AND status = 'pending';

    IF invite_count > 0 THEN
        INSERT INTO public.organization_members (organization_id, profile_id, role)
        SELECT organization_id, new_profile_id, role
        FROM public.organization_invites
        WHERE email = new.email AND status = 'pending'
        ON CONFLICT (organization_id, profile_id) DO NOTHING;

        UPDATE public.organization_invites
        SET status = 'accepted', updated_at = now()
        WHERE email = new.email AND status = 'pending';
    END IF;

    RETURN new;
END;
$$;

CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth_users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ---------------------------------------------------------------------------
-- NEW ORGANIZATION TRIGGER (legacy 43)
-- ---------------------------------------------------------------------------
-- Auto-creates a default location when a new organization is inserted.
-- Depends on locations (migration 007).

CREATE OR REPLACE FUNCTION public.handle_new_organization()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
    -- Skip if a location already exists for this org.
    IF EXISTS (SELECT 1 FROM public.locations WHERE organization_id = NEW.id) THEN
        RETURN NEW;
    END IF;

    INSERT INTO public.locations (organization_id, name)
    VALUES (NEW.id, NEW.name);

    RETURN NEW;
END;
$$;

-- The trigger itself is deferred until migration 008 creates the locations
-- table. It is installed here as a function only; the trigger attachment
-- lives in migration 008 alongside the locations table definition to avoid
-- a forward-reference error at migration run time.
-- (See migration 008 header for: CREATE TRIGGER on_organization_created ...)

-- ---------------------------------------------------------------------------
-- DONE
-- ---------------------------------------------------------------------------
-- Migration 002 complete. Tables (10):
--   auth_users               — member-scoped RLS (id = current_user_id)
--   refresh_tokens           — member-scoped RLS (user_id = current_user_id)
--   password_reset_tokens    — member-scoped RLS (user_id = current_user_id)
--   currencies               — no RLS; public SELECT, service_role writes
--   profiles                 — member-scoped RLS (id = current_user_id)
--   organizations            — org-scoped RLS (id = current_org_id)
--   organization_members     — org-scoped RLS (organization_id = current_org_id)
--   organization_invites     — org-scoped RLS (organization_id = current_org_id)
--   whatsapp_accounts  [NEW] — member-scoped RLS (profile_id = current_user_id); max-3 trigger
--   whatsapp_link_tokens [NEW] — service-only RLS
--
-- Policies summary:
--   auth_users_select/insert/update: id = current_user_id() OR is_service_role()
--     Threat: cross-tenant account enumeration / credential leakage.
--   auth_users_delete: is_service_role()
--     Threat: user self-deletes bypassing audit; force through service job.
--   refresh_tokens_*: user_id = current_user_id() OR is_service_role()
--     Threat: token theft via cross-user query.
--   password_reset_tokens_*: same pattern.
--     Threat: attacker consuming another user's reset token.
--   profiles_select/insert/update: id = current_user_id() OR is_service_role()
--     Threat: PII leak (email, avatar, full_name) to other sessions.
--   profiles_delete: is_service_role()
--     Threat: account destruction without audit trail.
--   organizations_*: id = current_org_id() OR is_service_role()
--     Threat: tenant A reading/modifying tenant B's org settings.
--   organization_members_*: organization_id = current_org_id() OR is_service_role()
--     Threat: cross-tenant member enumeration / unauthorized role escalation.
--   organization_invites_*: same pattern.
--     Threat: invite forgery across tenants.
--   whatsapp_accounts_select/insert/update: profile_id = current_user_id() OR is_service_role()
--     Threat: one member seeing another member's linked phone numbers.
--   whatsapp_accounts_delete: same (user may delete their own binding).
--   whatsapp_link_tokens_*: is_service_role() only.
--     Threat: tenant code guessing or replaying link tokens of other users.
--     Rationale: tokens have no org or user context until consumed; only
--     the service layer (Go handler) validates and consumes them atomically.
