-- BeepBite — multi-branch sync tables (ROADMAP Now-5).
--
-- Forward-only and additive: the baseline's one-time consolidation licence is
-- spent, so this adds tables and touches nothing that exists.
--
-- Three tables, and the reason each is shaped the way it is:
--
--   sync_ops     the operation log. Append-only, and enforced as such by RLS
--                rather than by convention — see the policies below, which
--                grant no UPDATE or DELETE to anybody but the service role.
--                Re-receiving an operation is a no-op because the operation's
--                own ID is the primary key, so a peer that replays a batch
--                cannot double-apply it. That is the storage half of the same
--                idempotence internal/oplog implements in memory.
--
--   sync_peers   manually enrolled branches. The peer's public key is pinned
--                at pairing (trust on first use) and never re-learned: after
--                enrolment a key change is an error, not an update, because a
--                peer whose key silently changed is either compromised or a
--                different machine wearing its name.
--
--   sync_nonces  replay protection for signed requests. Rows are short-lived;
--                a periodic sweep deletes anything past its window.
--
-- No version-vector table exists on purpose. A vector is always derived from
-- sync_ops by MAX() per node, because a stored vector is a second source of
-- truth that can drift from the log it claims to describe — and the failure
-- when it does is silent, permanent data loss on the pull path.

-- ---------------------------------------------------------------------------
-- sync_ops
-- ---------------------------------------------------------------------------

CREATE TABLE public.sync_ops (
    -- The operation's own ID, minted by whichever node emitted it, and the
    -- reason a replayed batch is a no-op rather than a duplicate. A uuid
    -- because every other identity in this schema is one; a caller minting
    -- some other globally-unique form would fail the cast here rather than
    -- silently storing something the rest of the database cannot join on.
    id              uuid PRIMARY KEY,
    organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,

    -- What it touches. entity is the logical collection (usually a table
    -- name), key the row identity within it, field the column for a Set.
    entity          text NOT NULL,
    key             text NOT NULL,
    field           text NOT NULL DEFAULT '',

    -- 1 = Set (last-writer-wins register), 2 = Add (add-only set member).
    -- These are internal/oplog.Kind's own values, not a re-numbering: zero is
    -- reserved there for "unset", and a column that renumbers them would need a
    -- translation table in Go that nothing stops a later caller from skipping.
    -- The CHECK keeps an unknown kind out of the log rather than letting it
    -- surface as an apply error on a peer.
    kind            smallint NOT NULL CHECK (kind IN (1, 2)),

    value           bytea NOT NULL DEFAULT '\x'::bytea,

    -- The hybrid logical clock stamp, stored as its three parts so the total
    -- order (wall, counter, node) is an index-ordered scan rather than a sort.
    -- ts_node is also "which node emitted this": the node that stamps the
    -- clock is the node that wrote the operation, so a separate node_id column
    -- would be a second copy of the same fact and an invitation for the two to
    -- disagree. Text, not a FK — the emitting branch need not exist as a row
    -- here for its operations to be storable.
    ts_wall         bigint NOT NULL,
    ts_counter      integer NOT NULL,
    ts_node         text NOT NULL,

    -- Ed25519 over internal/oplog.Op.Canonical(). Nullable while sync is off:
    -- an operation written by a node that has no identity yet is still a valid
    -- local operation, it simply cannot be replicated.
    signature       bytea,

    created_at      timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT sync_ops_set_has_field CHECK (kind <> 1 OR field <> ''),
    CONSTRAINT sync_ops_add_has_no_field CHECK (kind <> 2 OR field = '')
);

-- The pull path: everything for an org after a given point, in total order.
CREATE INDEX sync_ops_org_order_idx
    ON public.sync_ops (organization_id, ts_wall, ts_counter, ts_node);

-- Deriving a version vector: the highest stamp per node, per org.
CREATE INDEX sync_ops_org_node_idx
    ON public.sync_ops (organization_id, ts_node, ts_wall DESC, ts_counter DESC);

-- Applying to local state: everything touching one row.
CREATE INDEX sync_ops_entity_key_idx
    ON public.sync_ops (organization_id, entity, key);

COMMENT ON TABLE public.sync_ops IS
    'Append-only operation log for multi-branch replication (ROADMAP Now-5). Never updated or deleted outside compaction; RLS grants no UPDATE/DELETE to tenant roles.';

ALTER TABLE public.sync_ops ENABLE ROW LEVEL SECURITY;

CREATE POLICY sync_ops_select ON public.sync_ops FOR SELECT
    USING (((organization_id = public.current_org_id()) OR public.is_service_role()));

CREATE POLICY sync_ops_insert ON public.sync_ops FOR INSERT
    WITH CHECK (((organization_id = public.current_org_id()) OR public.is_service_role()));

-- Deliberately no tenant UPDATE policy. An operation log that can be edited is
-- not a log, and "append-only" enforced only in Go is enforced only until the
-- next handler forgets.
CREATE POLICY sync_ops_update_service ON public.sync_ops FOR UPDATE
    USING (public.is_service_role()) WITH CHECK (public.is_service_role());

CREATE POLICY sync_ops_delete_service ON public.sync_ops FOR DELETE
    USING (public.is_service_role());

-- ---------------------------------------------------------------------------
-- sync_peers
-- ---------------------------------------------------------------------------

CREATE TABLE public.sync_peers (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,

    -- Human label, and the base URL an operator typed in Settings → Sync.
    -- Discovery is deliberately manual: there is no directory to consult and
    -- nobody operating one.
    name            text NOT NULL,
    url             text NOT NULL,

    -- The peer's node ID and its pinned public key. Set once at pairing.
    node_id         text NOT NULL,
    public_key      bytea NOT NULL,

    -- The merge engine the peer advertised at the last handshake. A round
    -- across a mismatch is refused rather than allowed to diverge quietly:
    -- two algebras in one mesh converge only by luck.
    engine          text NOT NULL DEFAULT '',

    last_pull_at    timestamptz,
    last_push_at    timestamptz,
    last_error      text,

    -- Revocation is a timestamp, not a delete, so an operator can see that a
    -- branch was unpaired and when.
    revoked_at      timestamptz,
    created_at      timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT sync_peers_org_node_unique UNIQUE (organization_id, node_id)
);

CREATE INDEX sync_peers_org_idx ON public.sync_peers (organization_id) WHERE revoked_at IS NULL;

COMMENT ON TABLE public.sync_peers IS
    'Manually enrolled sync peers. public_key is pinned at pairing (TOFU) and a later change is an error, never an update.';

ALTER TABLE public.sync_peers ENABLE ROW LEVEL SECURITY;

CREATE POLICY sync_peers_select ON public.sync_peers FOR SELECT
    USING (((organization_id = public.current_org_id()) OR public.is_service_role()));

CREATE POLICY sync_peers_insert ON public.sync_peers FOR INSERT
    WITH CHECK (((organization_id = public.current_org_id()) OR public.is_service_role()));

CREATE POLICY sync_peers_update ON public.sync_peers FOR UPDATE
    USING (((organization_id = public.current_org_id()) OR public.is_service_role()))
    WITH CHECK (((organization_id = public.current_org_id()) OR public.is_service_role()));

CREATE POLICY sync_peers_delete ON public.sync_peers FOR DELETE
    USING (((organization_id = public.current_org_id()) OR public.is_service_role()));

-- ---------------------------------------------------------------------------
-- sync_nonces
-- ---------------------------------------------------------------------------

CREATE TABLE public.sync_nonces (
    nonce       text NOT NULL,
    peer_node   text NOT NULL,
    seen_at     timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (peer_node, nonce)
);

CREATE INDEX sync_nonces_seen_at_idx ON public.sync_nonces (seen_at);

COMMENT ON TABLE public.sync_nonces IS
    'Replay cache for signed sync requests. Not org-scoped: a nonce is a property of the peer connection, which is authenticated before any org context exists.';

-- Deliberately NOT org-scoped and not RLS-protected: replay checking happens
-- during authentication, before an organization has been established, so an
-- org-scoped policy here would make the check unable to see its own rows. The
-- table carries no tenant data — a nonce and a timestamp — and is written only
-- by the sync handler.
ALTER TABLE public.sync_nonces ENABLE ROW LEVEL SECURITY;

CREATE POLICY sync_nonces_service ON public.sync_nonces FOR ALL
    USING (public.is_service_role()) WITH CHECK (public.is_service_role());
