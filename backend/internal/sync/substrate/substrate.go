package substrate

import (
	"context"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"sync"
	"time"

	kotvasync "github.com/vul-os/kotva/bindings/go"

	"github.com/beepbite/backend/internal/nodeid"
	"github.com/beepbite/backend/internal/oplog"
)

// SkewRefusalCode is the §12 registry code the engine returns when an op's HLC
// sits further from the receiver's clock than §3 allows.
//
// Named rather than matched on prose: a fail-closed engine that is matched on
// message text eventually takes the wrong refusal path when the text is
// reworded. §12's action for this code is FAIL_CLOSED_BLOCK, and the engine
// leaves the replica untouched when it fires.
const SkewRefusalCode = "0x0A05"

// Record is one minted operation: the op as BeepBite models it, the §4.1 content
// address the engine identifies it by, and the COSE_Sign1 envelope that carries
// it to a peer.
//
// The envelope is the replicable unit and the row's source of truth. Everything
// else migration 004 stores is a projection of it, kept so the pull path and the
// read path are index scans rather than a decode of every row.
type Record struct {
	// ID is the §4.1 content address, lowercase hex (33 bytes, 66 characters).
	ID string
	// Cose is the COSE_Sign1 envelope: the signed, canonical op.
	Cose []byte
	// Op is the operation in BeepBite's own vocabulary.
	Op oplog.Op
}

// Member is one element of an append-only ledger as the engine holds it.
type Member struct {
	// Value is the op's opaque payload, exactly as it was minted.
	Value []byte
	// TS is the stamp that distinguishes this fact from an identical one
	// recorded at another moment. See the package doc.
	TS oplog.Timestamp
}

// Options configures an Engine.
type Options struct {
	// Identity is this node's Ed25519 keypair. Required: an op the engine will
	// not assemble an envelope for cannot be minted at all, so there is no
	// "signing not wired up yet" mode here the way migration 002 had one.
	Identity *nodeid.Identity

	// NS is the §7 namespace. BeepBite uses the organisation id, so an op from
	// another tenant is not merely rejected by the store's org check — it lands
	// in a different namespace in the algebra too, and §7 refuses a
	// cross-namespace reference rather than merging it.
	NS string

	// MaxDrift bounds how far ahead of this node's physical clock a peer's
	// advertised timestamp may sit before Observe refuses it. Zero means
	// oplog.DefaultMaxDrift. See Observe for why this bound exists on top of
	// the engine's own.
	MaxDrift time.Duration

	// CacheDir, if set, persists wazero's compiled machine code so a restart
	// does not pay the compile again. Optional.
	CacheDir string
}

// Engine is BeepBite's handle on the shared sync engine: one compiled runtime,
// one instance, one replica, one §3 clock.
//
// Every method takes the mutex. A wazero instance's linear memory is shared
// mutable state and the binding's contract is that an Instance is correct but
// serialized, so this is the binding's own concurrency model made explicit
// rather than a lock added on top of one.
type Engine struct {
	mu  sync.Mutex
	rt  *kotvasync.Runtime
	in  *kotvasync.Instance
	eng *kotvasync.Engine

	// clock is the substrate's §3 hybrid logical clock — the timeline every op
	// this node mints is stamped from.
	clock *kotvasync.Clock

	// guard is internal/oplog's clock, used for its drift predicate alone. Its
	// Update return value is deliberately discarded: the substrate's clock
	// above is the timeline, and a second one kept in parallel would be a
	// second source of truth about what time it is here. What guard supplies
	// is the bound the engine structurally cannot apply — see Observe.
	guard *oplog.Clock

	signer kotvasync.Signer
	node   string // this node's id, base32
	author string // the same key, lowercase hex — the §3 author
	ns     string
	kinds  kinds

	minted   int
	ingested int
	refused  int
}

// Open compiles the engine and creates this node's replica.
//
// Compiling is by far the most expensive step and happens exactly once per
// process; the Engine is then held for the process's life. A deployment that is
// power-cycled daily should pass Options.CacheDir, which turns a few hundred
// milliseconds of startup into single-digit milliseconds for every start after
// the first.
//
// No key material crosses into the engine at any point. The module's own test
// asserts that its dispatch table has no entry point that could accept a private
// key, and signing here is detached: the engine emits the RFC 9052 Sig_structure,
// this node's key signs it where the key already lives, and the engine verifies
// the result before it will assemble an envelope.
func Open(ctx context.Context, opt Options) (*Engine, error) {
	if opt.Identity == nil {
		return nil, errors.New("substrate: an identity is required")
	}
	if opt.NS == "" {
		return nil, errors.New("substrate: a namespace is required")
	}
	maxDrift := opt.MaxDrift
	if maxDrift <= 0 {
		maxDrift = oplog.DefaultMaxDrift
	}

	var opts []kotvasync.Option
	if opt.CacheDir != "" {
		opts = append(opts, kotvasync.WithCompilationCacheDir(opt.CacheDir))
	}
	rt, err := kotvasync.New(ctx, opts...)
	if err != nil {
		return nil, fmt.Errorf("substrate: compiling the engine: %w", err)
	}
	in, err := rt.Instance(ctx)
	if err != nil {
		_ = rt.Close(ctx)
		return nil, fmt.Errorf("substrate: instantiating the engine: %w", err)
	}

	e := &Engine{
		rt:     rt,
		in:     in,
		signer: kotvasync.CryptoSigner{Key: opt.Identity.CryptoSigner()},
		node:   opt.Identity.Public.String(),
		author: hex.EncodeToString(opt.Identity.Public[:]),
		ns:     opt.NS,
		guard:  oplog.NewClockWithMaxDrift(opt.Identity.Public.String(), maxDrift),
	}

	if e.eng, err = in.NewEngine(); err != nil {
		_ = e.Close(ctx)
		return nil, fmt.Errorf("substrate: creating the replica: %w", err)
	}
	if e.clock, err = in.NewClock(opt.Identity.Public[:]); err != nil {
		_ = e.Close(ctx)
		return nil, fmt.Errorf("substrate: creating the clock: %w", err)
	}
	// Never hard-code the §4.2 numbers — ask the engine which kind is which.
	k, err := in.OpKinds()
	if err != nil {
		_ = e.Close(ctx)
		return nil, fmt.Errorf("substrate: reading op kinds: %w", err)
	}
	e.kinds = kinds{setAdd: k.SetAdd, lwwSet: k.LWWSet}

	return e, nil
}

// Close releases the engine.
func (e *Engine) Close(ctx context.Context) error {
	e.mu.Lock()
	defer e.mu.Unlock()
	if e.clock != nil {
		_ = e.clock.Close()
		e.clock = nil
	}
	if e.eng != nil {
		_ = e.eng.Close()
		e.eng = nil
	}
	if e.in != nil {
		_ = e.in.Close(ctx)
		e.in = nil
	}
	if e.rt != nil {
		rt := e.rt
		e.rt = nil
		return rt.Close(ctx)
	}
	return nil
}

// Node returns this node's id.
func (e *Engine) Node() string { return e.node }

// ---------------------------------------------------------------------------
// The clock
// ---------------------------------------------------------------------------

// Now stamps a local event, advancing the substrate's §3 clock.
func (e *Engine) Now(now time.Time) (oplog.Timestamp, error) {
	e.mu.Lock()
	defer e.mu.Unlock()
	return e.tick(now)
}

func (e *Engine) tick(now time.Time) (oplog.Timestamp, error) {
	ms := now.UnixMilli()
	if ms < 0 {
		return oplog.Timestamp{}, fmt.Errorf("substrate: %s predates the epoch", now)
	}
	h, err := e.clock.Tick(uint64(ms))
	if err != nil {
		return oplog.Timestamp{}, fmt.Errorf("substrate: ticking the clock: %w", err)
	}
	return oplog.Timestamp{Wall: int64(h.Wall), Counter: h.Counter, Node: e.node}, nil
}

// Observe folds a peer's advertised timestamp into this node's clock, refusing
// one that sits further in the future than the drift bound allows.
//
// # Why the bound is here and not only in the engine
//
// The engine applies §3's skew check on the op-ingest path — ValidateOp and
// IngestSigned both refuse an op stamped more than 120 s from the receiver's
// clock with SkewRefusalCode, and leave the replica untouched when they do. It
// does not, and structurally cannot, apply it here: the substrate's
// hlc.observe entry point takes a timestamp and a clock handle and no receiver
// clock reading at all, so it has nothing to compare against. Probed against
// v0.2.0, observing a stamp ten years in the future returns no error and drags
// the clock's wall permanently forward.
//
// That is precisely the poisoning internal/oplog's Clock.Update was written to
// prevent, and it is reachable here because this is not the ingest path. A pull
// response advertises a peer's version vector — §5.1 marks, one HLC per author
// — and those stamps are folded in to decide what to ask for. They are never
// ops, so they never pass ValidateOp. Without this bound a peer whose clock is
// broken (or who is lying) needs only to advertise a far-future mark: HLC wall
// values are monotonic non-decreasing by construction, so once adopted the value
// can never come back down, every op this node mints afterwards carries it, and
// this node out-ranks every honest peer in every future last-writer-wins
// comparison regardless of true recency.
//
// The order below is the whole guarantee. guard.Update runs FIRST and refuses
// without touching anything; only a stamp that survives it reaches the engine's
// clock. Reversing the two, or dropping the guard, poisons the clock before
// anything has decided whether the stamp was acceptable — and the refusal
// afterwards would be a report of damage already done. drift_test.go asserts the
// ordering by its consequence rather than by its shape.
//
// The two bounds are deliberately different sizes and neither is loosened to
// match the other. 120 s is what the substrate froze for ops it can check
// against a receiver clock; oplog.DefaultMaxDrift's five minutes is what
// BeepBite chose for the timestamps nothing else checks, generous enough to
// absorb ordinary NTP skew between two shops' routers.
func (e *Engine) Observe(remote oplog.Timestamp) error {
	e.mu.Lock()
	defer e.mu.Unlock()

	// (1) The bound the engine cannot apply. Refuses without side effects.
	if _, err := e.guard.Update(remote); err != nil {
		e.refused++
		return err
	}

	// (2) Only now does the stamp reach a clock that cannot refuse it.
	author, err := authorHex(remote.Node)
	if err != nil {
		e.refused++
		return err
	}
	if remote.Wall < 0 {
		e.refused++
		return fmt.Errorf("substrate: peer advertised a negative wall clock")
	}
	if err := e.clock.Observe(kotvasync.HLC{
		Wall: uint64(remote.Wall), Counter: remote.Counter, Author: author,
	}); err != nil {
		e.refused++
		return fmt.Errorf("substrate: observing a peer stamp: %w", err)
	}
	return nil
}

// ClockWall reports the substrate clock's current wall value, without advancing
// it. It exists so a caller — and drift_test.go — can see whether a rejected
// stamp left the timeline alone.
func (e *Engine) ClockWall() (int64, error) {
	e.mu.Lock()
	defer e.mu.Unlock()
	h, err := e.clock.Current()
	if err != nil {
		return 0, fmt.Errorf("substrate: reading the clock: %w", err)
	}
	return int64(h.Wall), nil
}

// SkewBoundMS reports the §3 skew bound the linked engine enforces on the ingest
// path, read from the engine rather than written down here.
func (e *Engine) SkewBoundMS() (uint64, error) {
	e.mu.Lock()
	defer e.mu.Unlock()
	v, err := e.in.Version()
	if err != nil {
		return 0, fmt.Errorf("substrate: reading the engine version: %w", err)
	}
	return v.HLCSkewMS, nil
}

// ---------------------------------------------------------------------------
// Minting and ingest
// ---------------------------------------------------------------------------

// Mint stamps, encodes, signs and admits a locally authored operation, returning
// the record to persist and replicate.
//
// op.ID is ignored on the way in and set on the way out: an op's identity is the
// §4.1 content address of its canonical bytes, which is not knowable until the
// op is fully formed. That is the whole reason migration 004 exists — a
// caller-minted uuid alongside content-address dedup means one operation is two
// rows in Postgres and one op to the engine, and Append's idempotence quietly
// stops holding.
//
// op.TS is likewise supplied here rather than by the caller, from the substrate's
// own §3 clock, so the stamp and the author key cannot disagree.
func (e *Engine) Mint(op oplog.Op, now time.Time) (Record, error) {
	rec, err := e.Prepare(op, now)
	if err != nil {
		return Record{}, err
	}
	// Admit our own op through the same path a peer's takes. Minting an op this
	// replica would refuse to ingest is a divergence between what this node
	// publishes and what it believes, and it should fail here rather than on
	// some other branch's ingest path hours later.
	if _, err := e.Admit(rec, time.UnixMilli(rec.Op.TS.Wall)); err != nil {
		return Record{}, err
	}
	return rec, nil
}

// Prepare is Mint without the admission: it stamps, encodes, addresses, checks
// and signs an operation, and does not touch this replica's state.
//
// It exists because minting and persisting an operation cannot happen in that
// order safely. internal/sync/emit writes sync_ops inside the same Postgres
// transaction as the row the operation describes, so that neither can exist
// without the other — and a transaction can still roll back afterwards. An
// operation already admitted to an in-memory replica cannot be un-admitted, so
// a rolled-back write would leave this node's replica holding an operation that
// is in no log, advertising a version vector it cannot serve.
//
// So the checking happens here and the admission happens in Admit, after the
// commit has returned. Nothing is skipped by splitting them: the engine's
// ValidateOp applies the same §3 skew bound and the same structural rules
// IngestSigned would, against the same receiver clock reading, and refuses
// without side effects — which is exactly the property that makes it usable
// before the row is durable.
func (e *Engine) Prepare(op oplog.Op, now time.Time) (Record, error) {
	e.mu.Lock()
	defer e.mu.Unlock()

	ts, err := e.tick(now)
	if err != nil {
		return Record{}, err
	}
	op.TS = ts
	op.ID = ""

	sop, err := syncOp(op, e.kinds, e.ns)
	if err != nil {
		return Record{}, err
	}
	if sop.HLC.Author != e.author {
		// Unreachable while tick() stamps with this node's id, and checked
		// anyway because the whole detached-signing story rests on it: the key
		// an op CLAIMS and the key it is SIGNED with have to be the same one,
		// and a mismatch would be caught by the engine at attach time with a
		// far less specific message.
		return Record{}, fmt.Errorf(
			"substrate: op claims author %s but this node is %s", sop.HLC.Author, e.author)
	}
	raw, err := e.in.EncodeOp(sop)
	if err != nil {
		return Record{}, fmt.Errorf("substrate: encoding op: %w", err)
	}
	id, err := e.in.OpID(raw)
	if err != nil {
		return Record{}, fmt.Errorf("substrate: addressing op: %w", err)
	}
	// Check before signing, against this replica, without touching it. An op
	// this node would refuse to ingest is one it must not publish either, and
	// finding that out here rather than on another branch's ingest path hours
	// later is the whole point.
	if err := e.in.ValidateOp(raw, uint64(ts.Wall)); err != nil {
		return Record{}, fmt.Errorf("substrate: validating our own op: %w", err)
	}
	cose, err := e.in.SignOp(raw, e.signer)
	if err != nil {
		return Record{}, fmt.Errorf("substrate: signing op: %w", err)
	}

	op.ID = hex.EncodeToString(id)
	e.minted++
	return Record{ID: op.ID, Cose: cose, Op: op}, nil
}

// Admit folds an operation this node prepared into this node's replica.
//
// It is the second half of Prepare and takes the same path a peer's operation
// takes — the envelope, verified and ingested — rather than a shortcut that
// trusts the record because this process built it. The bool reports whether the
// operation was new to the replica; re-admitting one is a no-op, which is what
// makes a retry after a crash between commit and admission safe.
//
// receiverNow is this node's clock reading for the §3 skew check, as on Ingest.
func (e *Engine) Admit(rec Record, receiverNow time.Time) (bool, error) {
	e.mu.Lock()
	defer e.mu.Unlock()

	if len(rec.Cose) == 0 {
		return false, errors.New("substrate: record has no signed envelope to admit")
	}
	ms := receiverNow.UnixMilli()
	if ms < 0 {
		return false, fmt.Errorf("substrate: receiver clock %s predates the epoch", receiverNow)
	}
	fresh, err := e.eng.IngestSigned(rec.Cose, uint64(ms))
	if err != nil {
		e.refused++
		return false, fmt.Errorf("substrate: admitting our own op %s: %w", rec.ID, err)
	}
	if fresh {
		e.ingested++
	}
	return fresh, nil
}

// Ingest admits an operation authored elsewhere, from the envelope its author
// minted, and returns the record along with whether the op was new.
//
// It fails closed. The signature (0x0A02), the structure and causality (0x0A03)
// and the skew (SkewRefusalCode) are all checked before any state is touched, so
// a refused op leaves this replica exactly as it was and the caller can abort
// its transaction knowing nothing was half-applied.
//
// receiverNow is this node's own clock reading for the §3 skew check. It is a
// parameter rather than a call to time.Now inside because replaying a stored log
// at startup must be checked against the log's own era, not against today.
func (e *Engine) Ingest(cose []byte, receiverNow time.Time) (Record, bool, error) {
	e.mu.Lock()
	defer e.mu.Unlock()

	ms := receiverNow.UnixMilli()
	if ms < 0 {
		return Record{}, false, fmt.Errorf("substrate: receiver clock %s predates the epoch", receiverNow)
	}

	// Decode before ingest so a refusal can still name the op, and so the
	// projection this returns is read out of the verified envelope rather than
	// out of whatever the peer claimed alongside it.
	raw, err := e.in.VerifySignedOp(cose)
	if err != nil {
		e.refused++
		return Record{}, false, err
	}
	sop, err := e.in.DecodeOp(raw)
	if err != nil {
		e.refused++
		return Record{}, false, fmt.Errorf("substrate: decoding a verified op: %w", err)
	}
	if sop.NS != e.ns {
		// §7: an op from another namespace is not this replica's to merge.
		e.refused++
		return Record{}, false, fmt.Errorf("substrate: op is in namespace %q, not %q", sop.NS, e.ns)
	}
	id, err := e.in.OpID(raw)
	if err != nil {
		e.refused++
		return Record{}, false, fmt.Errorf("substrate: addressing op: %w", err)
	}
	op, err := fromSyncOp(sop, hex.EncodeToString(id), e.kinds)
	if err != nil {
		e.refused++
		return Record{}, false, err
	}

	fresh, err := e.eng.IngestSigned(cose, uint64(ms))
	if err != nil {
		e.refused++
		return Record{}, false, err
	}
	if fresh {
		e.ingested++
	}
	return Record{ID: op.ID, Cose: cose, Op: op}, fresh, nil
}

// ---------------------------------------------------------------------------
// Reading the merged state
// ---------------------------------------------------------------------------

// Get returns the engine's last-writer-wins verdict for one register.
func (e *Engine) Get(entity, key, field string) ([]byte, bool, error) {
	e.mu.Lock()
	defer e.mu.Unlock()

	cell, err := e.eng.LWWCell(targetOf(entity, key), field)
	if err != nil {
		return nil, false, fmt.Errorf("substrate: reading %s/%s.%s: %w", entity, key, field, err)
	}
	if cell == nil {
		return nil, false, nil
	}
	v, err := untagBytes(cell.Value)
	if err != nil {
		return nil, false, err
	}
	return v, true, nil
}

// Members returns the union-merged ledger for one (entity, key), in unspecified
// order — the point of an append-only set is that order does not matter, so a
// caller that needs a stable one sorts the result itself.
func (e *Engine) Members(entity, key string) ([]Member, error) {
	e.mu.Lock()
	defer e.mu.Unlock()

	pairs, err := e.eng.SetMembers()
	if err != nil {
		return nil, fmt.Errorf("substrate: reading set members: %w", err)
	}
	want := targetOf(entity, key)
	var out []Member
	for _, pair := range pairs {
		if len(pair) != 2 {
			continue
		}
		var target string
		if err := json.Unmarshal(pair[0], &target); err != nil || target != want {
			continue
		}
		payload, ts, err := ledgerPayload(pair[1])
		if err != nil {
			return nil, err
		}
		out = append(out, Member{Value: payload, TS: ts})
	}
	return out, nil
}

// VersionVector derives this replica's version vector in BeepBite's own
// spelling: the highest stamp seen per node.
func (e *Engine) VersionVector() (oplog.VersionVector, error) {
	e.mu.Lock()
	defer e.mu.Unlock()

	marks, err := e.eng.VersionVector()
	if err != nil {
		return nil, fmt.Errorf("substrate: reading the version vector: %w", err)
	}
	vv := oplog.NewVersionVector()
	for _, m := range marks {
		node, err := nodeFromAuthor(m.Author)
		if err != nil {
			return nil, err
		}
		if m.HLC.Wall > 1<<62 {
			return nil, fmt.Errorf("substrate: node %s advertises an out-of-range wall clock", node)
		}
		vv[node] = oplog.Timestamp{Wall: int64(m.HLC.Wall), Counter: m.HLC.Counter, Node: node}
	}
	return vv, nil
}

// StateRoot is the §6.1 content address of this replica's whole observable
// state, lowercase hex.
//
// Two replicas that have converged agree on it byte for byte, which is a far
// stronger check than comparing rendered rows: it covers every register and
// every set element, including the ones no screen displays.
func (e *Engine) StateRoot() (string, error) {
	e.mu.Lock()
	defer e.mu.Unlock()
	root, err := e.eng.StateRoot()
	if err != nil {
		return "", fmt.Errorf("substrate: reading the state root: %w", err)
	}
	return hex.EncodeToString(root), nil
}

// Stats reports what this replica has seen.
type Stats struct {
	Minted   int `json:"minted"`
	Ingested int `json:"ingested"`
	Refused  int `json:"refused"`
}

// Stats returns a snapshot of the counters.
func (e *Engine) Stats() Stats {
	e.mu.Lock()
	defer e.mu.Unlock()
	return Stats{Minted: e.minted, Ingested: e.ingested, Refused: e.refused}
}
