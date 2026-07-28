-- BeepBite — sync_ops moves to the shared engine's op identity.
--
-- This migration DROPs and re-CREATEs public.sync_ops. That is a bigger hammer
-- than this schema's forward-only rule normally allows, so the reason is
-- written down here rather than in a commit message.
--
-- # What was wrong
--
-- Migration 002 gave sync_ops a `uuid PRIMARY KEY` minted by whichever node
-- emitted the operation, and built the whole append path on it: `INSERT ...
-- ON CONFLICT (id) DO NOTHING` is what makes a replayed batch a no-op rather
-- than a duplicate.
--
-- internal/sync/substrate now expresses BeepBite's operations in the shared
-- DMTAP Sync algebra, and that algebra addresses an operation by the §4.1
-- CONTENT ADDRESS of its canonical bytes — a 33-byte value derived from the op
-- itself, not a name anybody chooses. The engine deduplicates on it.
--
-- Those two identities do not agree, and the disagreement is not cosmetic. One
-- operation minted twice — a retried push, a replayed batch, an op re-derived
-- after a crash — carries two different uuids and one content address. Postgres
-- sees two rows and inserts both; the engine sees one op and ignores the
-- second. The `ON CONFLICT` clause still runs and still reports success, so
-- nothing errors, nothing logs, and the store quietly stops being the log the
-- engine believes it is. That is a correctness bug, and it is the silent kind.
--
-- # Why DROP rather than ALTER
--
-- Because there is nothing to preserve and everything to get wrong. sync_ops is
-- EMPTY in every deployment: no code path in the POS emits an operation, the
-- sync transport does not exist, and internal/sync/opstore has never been
-- called outside its own tests. Re-typing a primary key, rewriting a CHECK and
-- re-pointing three indexes in place would produce the same table with a longer
-- and less readable definition, and the intermediate states of that ALTER
-- sequence are exactly where a mistake hides. Doing it now costs nothing. Doing
-- it after the first operation is written costs a data migration across every
-- branch in every mesh.
--
-- Migrations 001-003 are untouched. This licence is spent on this table.
--
-- # The kind numbers changed meaning — read this before trusting a WHERE clause
--
-- Migration 002's `kind` stored internal/oplog's own constants: 1 = Set,
-- 2 = Add. The column now stores the substrate's §4.2 op kinds, and they are
-- NOT a renumbering of the same two ideas:
--
--     oplog.KindSet = 1   ->   substrate lww_set = 3
--     oplog.KindAdd = 2   ->   substrate set_add = 1
--
-- Note the collision. `1` was Set and is now Add. A query written against the
-- old schema that says `kind = 1` still runs, still returns rows, and now
-- returns the opposite ones. There is no version of this table where both
-- meanings are live — the DROP is what makes that true — but anybody reading a
-- `kind IN (1, 3)` predicate deserves to know the number moved.
--
-- Go never hard-codes these values: internal/sync/substrate reads them from the
-- engine at startup (`op_kinds`), because SYNC.md's own adoption notes say to,
-- and because this collision is precisely the sort of thing a hard-coded 1
-- gets silently wrong.

DROP TABLE IF EXISTS public.sync_ops;

CREATE TABLE public.sync_ops (
    -- The operation's §4.1 content address: 33 bytes, the §18.1.5 v0 form.
    -- Derived from the op's canonical CBOR, so two nodes that hold the same
    -- operation compute the same id without coordinating, and a replayed batch
    -- conflicts here exactly as it deduplicates in the engine. bytea rather
    -- than text because it is a hash and not a word.
    id              bytea PRIMARY KEY CHECK (octet_length(id) = 33),
    organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,

    -- The signed COSE_Sign1 envelope, and the row's source of truth. Every
    -- other column below is a PROJECTION of what this carries, present so the
    -- pull path and the read path are index scans instead of a decode of every
    -- row. If the two ever disagree, the envelope is right: it is what the
    -- author signed and what a peer verifies.
    --
    -- NOT NULL, unlike migration 002's nullable `signature`. That column was
    -- nullable so a node with no identity could still write local operations.
    -- It cannot any more, and this is not a tightening for its own sake: the
    -- engine will not assemble an envelope without a valid signature, so an
    -- unsigned operation is one that was never minted rather than one that is
    -- merely unreplicable.
    cose            bytea NOT NULL,

    -- The address the op acts on, split the way BeepBite models it. The engine
    -- sees one target string, "<entity>/<key>"; these two columns are that
    -- string's halves, stored apart so "everything touching this row" is an
    -- index scan. field is the column a last-writer-wins register writes and is
    -- empty for a set-add.
    entity          text NOT NULL,
    key             text NOT NULL,
    field           text NOT NULL DEFAULT '',

    -- The §4.2 op kind. 1 = set_add (an append-only ledger member), 3 = lww_set
    -- (a last-writer-wins register). The other six kinds of the algebra —
    -- set_remove, death, counter, seq_insert, seq_remove, tree_move — are
    -- deliberately absent from BeepBite's mapping (see internal/sync/substrate's
    -- package doc for the §4.10 selection test behind each choice), so a row
    -- carrying one did not come from this product.
    kind            smallint NOT NULL CHECK (kind IN (1, 3)),

    -- The op's opaque payload, as BeepBite minted it. For a ledger member this
    -- is the payload alone; the engine's element additionally carries the stamp
    -- below, because §4.3 identifies a set element by its value and two
    -- identical facts recorded at different moments must not collapse into one.
    value           bytea NOT NULL DEFAULT '\x'::bytea,

    -- The §3 HLC stamp, in three parts so the total order (wall, counter,
    -- author) is an index-ordered scan rather than a sort.
    --
    -- ts_node is the author. In the substrate an author is an Ed25519 public
    -- key; in BeepBite a node id IS an Ed25519 public key (internal/nodeid),
    -- so this is the same 32 bytes the envelope's HLC carries, written in
    -- BeepBite's lowercase-base32 spelling. There is no mapping table anywhere
    -- and no second identity space to keep in step.
    ts_wall         bigint NOT NULL,
    ts_counter      integer NOT NULL,
    ts_node         text NOT NULL,

    created_at      timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT sync_ops_lww_has_field CHECK (kind <> 3 OR field <> ''),
    CONSTRAINT sync_ops_add_has_no_field CHECK (kind <> 1 OR field = '')
);

-- The pull path: everything for an org after a given point, in total order.
CREATE INDEX sync_ops_org_order_idx
    ON public.sync_ops (organization_id, ts_wall, ts_counter, ts_node);

-- Deriving a version vector: the highest stamp per author, per org.
CREATE INDEX sync_ops_org_node_idx
    ON public.sync_ops (organization_id, ts_node, ts_wall DESC, ts_counter DESC);

-- Applying to local state: everything touching one row.
CREATE INDEX sync_ops_entity_key_idx
    ON public.sync_ops (organization_id, entity, key);

COMMENT ON TABLE public.sync_ops IS
    'Append-only operation log for multi-branch replication. id is the shared engine''s §4.1 content address; cose is the signed envelope and the source of truth, every other column a projection of it. Never updated or deleted outside compaction; RLS grants no UPDATE/DELETE to tenant roles.';

-- Row-level security is re-established verbatim from migration 002. Dropping
-- the table dropped its policies with it, and a table that came back without
-- them would be an open one — the failure would be invisible, because every
-- query a single tenant runs looks identical either way. scripts/verify-sync-rls.sh
-- is what proves these are actually in force.
ALTER TABLE public.sync_ops ENABLE ROW LEVEL SECURITY;

CREATE POLICY sync_ops_select ON public.sync_ops FOR SELECT
    USING (((organization_id = public.current_org_id()) OR public.is_service_role()));

CREATE POLICY sync_ops_insert ON public.sync_ops FOR INSERT
    WITH CHECK (((organization_id = public.current_org_id()) OR public.is_service_role()));

-- Deliberately no tenant UPDATE policy. An operation log that can be edited is
-- not a log, and "append-only" enforced only in Go is enforced only until the
-- next handler forgets. It matters more now than it did under migration 002:
-- the id is a hash of the row's own content, so an edited row is one whose
-- primary key no longer describes it.
CREATE POLICY sync_ops_update_service ON public.sync_ops FOR UPDATE
    USING (public.is_service_role()) WITH CHECK (public.is_service_role());

CREATE POLICY sync_ops_delete_service ON public.sync_ops FOR DELETE
    USING (public.is_service_role());
