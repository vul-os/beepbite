// Package nodeid implements node identity: an Ed25519 keypair that durably
// names a BeepBite node, plus helpers to persist that keypair on disk and to
// sign and verify arbitrary payloads under it.
//
// Nothing in the running server uses this package yet. It is a prerequisite
// for the planned multi-branch sync (ROADMAP.md, "Now-5 — Multi-branch
// sync", which specifies "mutual Ed25519 over a canonical envelope") and for
// dispatch (ROADMAP.md, "Now-6", "a courier is an Ed25519 keypair from day
// one"), so that identity does not have to be retrofitted onto branches or
// couriers that already exist by the time either lands. Landing the identity
// primitive first, unwired, is deliberate — it lets both features build on
// a stable, independently-tested seam instead of inventing key handling
// inline under deadline.
//
// This package implements NO wire protocol: no network calls, no peer
// discovery, no session or handshake state, no nonce replay cache. The only
// framing it owns is the local signing envelope in sign.go, which exists so
// two future implementations (or two future BeepBite versions) sign the
// same bytes for the same (purpose, payload) pair. Everything above that —
// what gets signed, when, and what a peer does with a signature — belongs
// to whichever feature consumes this package, not to this package.
package nodeid

import (
	"crypto/ed25519"
	"encoding/base32"
	"fmt"
	"strings"
)

// textEncoding renders a NodeID as text.
//
// We use RFC 4648 base32, lowercased, unpadded. Base32 was chosen over
// base58 or hex because: it needs nothing beyond the standard library
// (base58 has no stdlib implementation, and hand-rolling a big-integer codec
// for an identity type is exactly the kind of thing that grows a subtle bug
// later); it is alphabet-safe when lowercased consistently, unlike base58
// which is case-sensitive and easy to mistransribe by hand; and it is about
// 20% shorter than hex for the same 32 bytes. Padding is stripped because a
// NodeID is always exactly ed25519.PublicKeySize bytes — the length is
// fixed, so padding carries no information and would only be one more
// character a human has to type or a diff has to show.
//
// base32.StdEncoding's alphabet is uppercase (A-Z2-7); its Decode is
// case-sensitive and rejects lowercase input outright. We build our own
// encoding with a lowercase copy of the same alphabet, rather than
// uppercasing on decode and lowercasing on encode, so the encoding itself
// is the single source of truth for what "canonical text form" means and
// there is no separate case-conversion step that could drift out of sync
// with it.
var textEncoding = base32.NewEncoding("abcdefghijklmnopqrstuvwxyz234567").WithPadding(base32.NoPadding)

// NodeID is an Ed25519 public key: 32 bytes that durably name a node.
//
// It is a fixed-size byte array, not a slice, specifically so that NodeID
// values are comparable with == and usable as map keys — both matter once
// sync or dispatch code starts tracking "have I seen this peer" state.
type NodeID [ed25519.PublicKeySize]byte

// String renders id in its canonical text form: lowercase, unpadded base32.
// Parse(id.String()) always returns id unchanged.
//
// This is a public-key Stringer only. Identity never implements String() or
// any other formatting interface for the private key — printing a private
// key is exactly the mistake this type exists to make hard.
func (id NodeID) String() string {
	return textEncoding.EncodeToString(id[:])
}

// Fingerprint returns a short prefix of the text form (8 characters),
// suitable for logs and error messages, e.g. "gezdgnbv...".
//
// It is deliberately short and therefore NOT collision-resistant enough to
// use as an identity check on its own — always compare full NodeID values
// (or their full String()) when the answer actually needs to be "is this
// the same node".
func (id NodeID) Fingerprint() string {
	s := id.String()
	const n = 8
	if len(s) < n {
		return s
	}
	return s[:n]
}

// PublicKey returns id as a standard-library ed25519.PublicKey, for handing
// to crypto/ed25519 APIs directly.
func (id NodeID) PublicKey() ed25519.PublicKey {
	pk := make(ed25519.PublicKey, ed25519.PublicKeySize)
	copy(pk, id[:])
	return pk
}

// Parse decodes the canonical text form produced by String() back into a
// NodeID. It rejects anything that does not decode to exactly
// ed25519.PublicKeySize bytes, so a truncated or hand-edited string fails
// loudly instead of silently producing a different identity than the one
// that was meant.
func Parse(s string) (NodeID, error) {
	var id NodeID
	raw, err := textEncoding.DecodeString(strings.ToLower(strings.TrimSpace(s)))
	if err != nil {
		return id, fmt.Errorf("nodeid: %q is not valid base32: %w", s, err)
	}
	if len(raw) != ed25519.PublicKeySize {
		return id, fmt.Errorf("nodeid: %q decodes to %d bytes, want %d", s, len(raw), ed25519.PublicKeySize)
	}
	copy(id[:], raw)
	return id, nil
}

// nodeIDFromPublicKey converts a standard-library ed25519.PublicKey into a
// NodeID, refusing anything of the wrong length rather than truncating or
// padding it.
func nodeIDFromPublicKey(pub ed25519.PublicKey) (NodeID, error) {
	var id NodeID
	if len(pub) != ed25519.PublicKeySize {
		return id, fmt.Errorf("nodeid: public key has %d bytes, want %d", len(pub), ed25519.PublicKeySize)
	}
	copy(id[:], pub)
	return id, nil
}
