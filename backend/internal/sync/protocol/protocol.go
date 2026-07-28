// Package protocol is the wire between two BeepBite branches.
//
// ROADMAP Now-5 specifies it in one sentence: "auth is mutual Ed25519 over a
// canonical envelope with a nonce replay cache, TOFU only at pairing and
// fail-closed after." This package is that sentence, and nothing else — no
// database, no HTTP server, no transport. A handler supplies the request, a
// store supplies the peer's pinned key and the replay cache, and this decides
// whether the round may proceed.
//
// # The engine is part of the handshake
//
// Every request and response carries the name of the merge algebra that
// produced it, and a round across a mismatch is refused rather than allowed to
// proceed. Two engines in one mesh converge only by luck: they will agree on
// almost every operation and disagree on the exact-timestamp tie, which
// produces a divergence that no error surfaces and no test catches until two
// branches quote different stock counts at each other.
//
// This is also the seam where a different engine could one day be advertised —
// FlowStock pins its own with `substrate_sync: false` for exactly this reason.
// BeepBite advertises one engine today. Refusing the mismatch is the feature.
package protocol

import (
	"context"
	"errors"
	"time"

	"github.com/beepbite/backend/internal/nodeid"
	"github.com/beepbite/backend/internal/oplog"
)

// Engine names the merge algebra this build speaks.
//
// Per ROADMAP Stage 0 this is BeepBite's own engine and must not be described
// as, or confused with, any external sync specification. The version suffix
// moves when the algebra changes in a way that would make two nodes disagree —
// not when the transport or the JSON shape changes.
const Engine = "beepbite-oplog-v1"

// SignPurpose domain-separates sync signatures from every other thing this node
// might ever sign with the same key.
const SignPurpose = "sync-envelope"

// DefaultSkew bounds how far a peer's clock may be from ours before a request
// is refused as stale.
//
// It also bounds the replay cache: a nonce only has to be remembered for as
// long as a request bearing it could still be accepted. An unbounded freshness
// window would mean an unbounded nonce table, which is a slow disk-fill with
// extra steps.
const DefaultSkew = 5 * time.Minute

var (
	// ErrEngineMismatch — the peer speaks a different merge algebra. Hard
	// refusal; see the package doc for why this is not a warning.
	ErrEngineMismatch = errors.New("sync: peer advertises a different merge engine")

	// ErrStaleTimestamp — outside the freshness window in either direction.
	ErrStaleTimestamp = errors.New("sync: request timestamp outside the freshness window")

	// ErrBadSignature — the envelope was not signed by the pinned key.
	ErrBadSignature = errors.New("sync: envelope signature does not verify")

	// ErrReplayed — this nonce has been seen before from this peer.
	ErrReplayed = errors.New("sync: nonce replayed")

	// ErrMalformed — a peer sent something structurally invalid. A trust
	// boundary error, never a panic.
	ErrMalformed = errors.New("sync: malformed request")
)

// ReplayCache remembers the nonces a peer has already spent.
//
// It is an interface because the durable implementation belongs next to the
// database and the tests want an in-memory one — and because a single-process
// deployment can legitimately use the in-memory version.
type ReplayCache interface {
	// Seen reports whether this peer has already used this nonce.
	Seen(ctx context.Context, peerNode, nonce string) (bool, error)
	// Remember records the nonce as spent.
	Remember(ctx context.Context, peerNode, nonce string, at time.Time) error
}

// Authenticate runs every check a request must pass, in the order it must pass
// them, and returns the first failure.
//
// The order is not arbitrary and is the reason this is one function rather than
// four the caller composes:
//
//  1. Engine — a mismatch means we should not be talking at all, and it costs
//     a string comparison.
//  2. Freshness — rejects a stale or far-future request before any crypto.
//  3. Signature — proves the peer holds the pinned private key.
//  4. Replay — only now do we touch the cache. Checking replay first would let
//     an unauthenticated caller write into our nonce table by sending garbage,
//     which is a free denial-of-service against the store.
//
// A caller must map every one of these to the same opaque rejection on the
// wire. The distinct sentinels exist so the operator's log can say which check
// failed; telling the peer which check failed is a probing oracle.
func Authenticate(
	ctx context.Context,
	e Envelope,
	sig []byte,
	pub nodeid.NodeID,
	cache ReplayCache,
	now time.Time,
	skew time.Duration,
) error {
	if e.Engine != Engine {
		return ErrEngineMismatch
	}
	if err := CheckFreshness(e, now, skew); err != nil {
		return err
	}
	if !Verify(pub, e, sig) {
		return ErrBadSignature
	}
	if e.Nonce == "" {
		return ErrMalformed
	}
	seen, err := cache.Seen(ctx, e.NodeID, e.Nonce)
	if err != nil {
		// Fail closed. A cache we cannot read is a replay check we cannot
		// make, and proceeding would silently downgrade the guarantee.
		return err
	}
	if seen {
		return ErrReplayed
	}
	return cache.Remember(ctx, e.NodeID, e.Nonce, now)
}

// CheckFreshness rejects a timestamp outside ±skew of now.
//
// Both directions matter. Too old is a captured request being resent after the
// nonce cache has swept; too far in the future is a peer trying to mint a
// request that stays valid long after its key is revoked.
func CheckFreshness(e Envelope, now time.Time, skew time.Duration) error {
	if skew <= 0 {
		skew = DefaultSkew
	}
	if e.Timestamp == 0 {
		return ErrStaleTimestamp
	}
	t := time.UnixMilli(e.Timestamp)
	if t.Before(now.Add(-skew)) || t.After(now.Add(skew)) {
		return ErrStaleTimestamp
	}
	return nil
}

// ─── Round types ─────────────────────────────────────────────────────────────

// PullRequest asks a peer for everything we have not seen. Have is our own
// version vector; the peer answers with operations beyond it.
type PullRequest struct {
	Engine string              `json:"engine"`
	Have   oplog.VersionVector `json:"have"`
	Limit  int                 `json:"limit"`
}

// PullResponse carries operations in total order. HaveMore tells the caller to
// come back with an updated vector rather than assuming one round drains the
// peer — which is what makes the round stateless on the serving side.
type PullResponse struct {
	Engine   string   `json:"engine"`
	Ops      []WireOp `json:"ops"`
	HaveMore bool     `json:"have_more"`
}

// PushRequest offers operations to a peer.
type PushRequest struct {
	Engine string   `json:"engine"`
	Ops    []WireOp `json:"ops"`
}

// PushResponse reports what the peer did with them. Duplicate is not an error:
// re-offering an operation is normal and the storage layer is idempotent, so
// the count exists for the operator's benefit, not the protocol's.
type PushResponse struct {
	Engine    string              `json:"engine"`
	Accepted  int                 `json:"accepted"`
	Duplicate int                 `json:"duplicate"`
	Have      oplog.VersionVector `json:"have"`
}

// Hello is the pairing handshake. It is the only message exchanged before a key
// is pinned, and therefore the only one that is not signed by a key the
// receiver already trusts — trust on first use, and never again.
type Hello struct {
	Engine    string `json:"engine"`
	NodeID    string `json:"node_id"`
	PublicKey []byte `json:"public_key"`
	Name      string `json:"name"`
}

// CheckEngine is the one-line guard every handler and client response path
// calls. It exists so that "did we check the engine?" has a single answer.
func CheckEngine(advertised string) error {
	if advertised != Engine {
		return ErrEngineMismatch
	}
	return nil
}
