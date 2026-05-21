-- Migration 045: legal_documents + legal_acceptances — Wave 42 legal foundation
-- ---------------------------------------------------------------------------
-- Context
-- -------
-- Provides first-class storage for versioned legal documents (Terms of Service,
-- Privacy Policy) and per-user acceptance records with IP logging.
-- Documents are publicly readable; acceptances are readable only by the owning
-- profile (owning user's UUID = profile_id).
--
-- Degradation: tax_profiles and profiles tables are expected to exist (created
-- in 002 and 010 respectively).  This migration does NOT depend on any Wave-42
-- specific tables and applies cleanly on any database running migrations ≥ 010.
--
-- Style follows migration 033 (DO blocks, IF NOT EXISTS guards, rich summary).
-- ---------------------------------------------------------------------------

-- =============================================================================
-- §1  legal_documents — versioned policy content store
-- =============================================================================

CREATE TABLE IF NOT EXISTS legal_documents (
    id           uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
    kind         text        NOT NULL
                     CHECK (kind IN ('terms', 'privacy')),
    version      text        NOT NULL,
    body_md      text        NOT NULL,
    effective_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
    created_at   timestamptz NOT NULL DEFAULT timezone('utc', now())
);

-- Unique version per kind: only one document body per version string per kind.
CREATE UNIQUE INDEX IF NOT EXISTS idx_legal_documents_kind_version
    ON legal_documents (kind, version);

-- Fast lookup of the latest effective document per kind (used by the GET endpoint).
CREATE INDEX IF NOT EXISTS idx_legal_documents_kind_effective
    ON legal_documents (kind, effective_at DESC);

COMMENT ON TABLE legal_documents IS
    'Versioned legal documents (terms of service, privacy policy). '
    'Each (kind, version) pair is unique. The current document is the row with '
    'the greatest effective_at that is <= now().';

COMMENT ON COLUMN legal_documents.kind IS
    'Document type: ''terms'' = Terms of Service; ''privacy'' = Privacy Policy.';

COMMENT ON COLUMN legal_documents.version IS
    'Human-readable version string, e.g. ''2026-05-21'' or ''v2.1''.';

COMMENT ON COLUMN legal_documents.body_md IS
    'Full document body in Markdown, rendered client-side.';

-- =============================================================================
-- §2  legal_acceptances — per-user acceptance log
-- =============================================================================

CREATE TABLE IF NOT EXISTS legal_acceptances (
    id           uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
    profile_id   uuid        NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    document_id  uuid        NOT NULL REFERENCES legal_documents(id) ON DELETE CASCADE,
    accepted_at  timestamptz NOT NULL DEFAULT timezone('utc', now()),
    ip           text        -- client IP at time of acceptance; NULL if unavailable
);

-- Each profile may accept each document version once.
CREATE UNIQUE INDEX IF NOT EXISTS idx_legal_acceptances_profile_document
    ON legal_acceptances (profile_id, document_id);

-- Fast lookup of all acceptances by profile (for user-facing history).
CREATE INDEX IF NOT EXISTS idx_legal_acceptances_profile
    ON legal_acceptances (profile_id, accepted_at DESC);

COMMENT ON TABLE legal_acceptances IS
    'Immutable log of when each profile accepted a specific document version. '
    'Records are never updated; a new row is inserted per acceptance event. '
    'IP is stored for audit purposes only and must not be surfaced in product UIs.';

-- =============================================================================
-- §3  RLS — legal_documents (public read, service-role write)
-- =============================================================================

ALTER TABLE legal_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE legal_documents FORCE ROW LEVEL SECURITY;

-- Public SELECT: any connection (marketplace role OR authenticated user OR
-- unauthenticated) may read documents. This mirrors the pattern used for
-- public-facing tables like locations.
DO $$
BEGIN
    CREATE POLICY legal_documents_select_public
        ON legal_documents
        FOR SELECT
        USING (true);
EXCEPTION WHEN duplicate_object THEN
    RAISE NOTICE 'policy legal_documents_select_public already exists; skipping.';
END;
$$;

-- INSERT / UPDATE / DELETE: service_role only.  Operators seed documents via
-- migration or a platform-admin tool; no tenant path needed.
DO $$
BEGIN
    CREATE POLICY legal_documents_write_service
        ON legal_documents
        FOR ALL
        USING (is_service_role())
        WITH CHECK (is_service_role());
EXCEPTION WHEN duplicate_object THEN
    RAISE NOTICE 'policy legal_documents_write_service already exists; skipping.';
END;
$$;

-- =============================================================================
-- §4  RLS — legal_acceptances (profile-scoped read, self-insert only)
-- =============================================================================

ALTER TABLE legal_acceptances ENABLE ROW LEVEL SECURITY;
ALTER TABLE legal_acceptances FORCE ROW LEVEL SECURITY;

-- SELECT: each profile sees only its own acceptances.
DO $$
BEGIN
    CREATE POLICY legal_acceptances_select_owner
        ON legal_acceptances
        FOR SELECT
        USING (profile_id = current_user_id() OR is_service_role());
EXCEPTION WHEN duplicate_object THEN
    RAISE NOTICE 'policy legal_acceptances_select_owner already exists; skipping.';
END;
$$;

-- INSERT: authenticated users may record their own acceptance; service_role bypass
-- allows backend to create records on behalf of users (e.g. during onboarding).
DO $$
BEGIN
    CREATE POLICY legal_acceptances_insert_self
        ON legal_acceptances
        FOR INSERT
        WITH CHECK (profile_id = current_user_id() OR is_service_role());
EXCEPTION WHEN duplicate_object THEN
    RAISE NOTICE 'policy legal_acceptances_insert_self already exists; skipping.';
END;
$$;

-- UPDATE / DELETE: service_role only.  Acceptances are immutable from the user
-- perspective; only platform operations (e.g., GDPR erasure) may touch them.
DO $$
BEGIN
    CREATE POLICY legal_acceptances_write_service
        ON legal_acceptances
        FOR ALL
        USING (is_service_role())
        WITH CHECK (is_service_role());
EXCEPTION WHEN duplicate_object THEN
    RAISE NOTICE 'policy legal_acceptances_write_service already exists; skipping.';
END;
$$;

-- =============================================================================
-- OBJECT & RLS SUMMARY
-- =============================================================================
--
-- TABLES CREATED
--   legal_documents
--     id           uuid PK, gen_random_uuid()
--     kind         text NOT NULL CHECK (terms | privacy)
--     version      text NOT NULL
--     body_md      text NOT NULL
--     effective_at timestamptz NOT NULL DEFAULT now()
--     created_at   timestamptz NOT NULL DEFAULT now()
--     UNIQUE (kind, version)
--
--   legal_acceptances
--     id           uuid PK, gen_random_uuid()
--     profile_id   uuid NOT NULL FK → profiles(id) ON DELETE CASCADE
--     document_id  uuid NOT NULL FK → legal_documents(id) ON DELETE CASCADE
--     accepted_at  timestamptz NOT NULL DEFAULT now()
--     ip           text NULL
--     UNIQUE (profile_id, document_id)
--
-- RLS REASONING
--   legal_documents SELECT (public):
--     USING (true) — any DB connection may read document text.  This is
--     intentional: legal documents must be universally accessible, including
--     to unauthenticated users loading the /legal/terms or /legal/privacy pages.
--     No bare GRANT to anon is needed because our app always connects as the
--     application role, which is checked by the policies.
--   legal_documents ALL (service write):
--     USING/WITH CHECK is_service_role() — only platform migrations or the
--     platform-admin tool may insert/update documents; no tenant path.
--   legal_acceptances SELECT (owner):
--     profile_id = current_user_id() OR is_service_role() — each user sees
--     only their own acceptance history; service_role can query all rows for
--     audit, GDPR export, etc.
--   legal_acceptances INSERT (self):
--     WITH CHECK profile_id = current_user_id() OR is_service_role() — a user
--     can only insert their own acceptance record.
--   legal_acceptances ALL (service):
--     Covers UPDATE/DELETE for GDPR erasure / platform admin; is_service_role()
--     gated per the project-wide convention (migration 001).
--
-- INDEXES
--   idx_legal_documents_kind_version       UNIQUE (kind, version)
--   idx_legal_documents_kind_effective     (kind, effective_at DESC) — GET current
--   idx_legal_acceptances_profile_document UNIQUE (profile_id, document_id)
--   idx_legal_acceptances_profile          (profile_id, accepted_at DESC)
-- =============================================================================
