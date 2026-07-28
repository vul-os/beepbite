package protocol

import (
	"crypto/sha256"
	"encoding/binary"

	"github.com/beepbite/backend/internal/canon"
	"github.com/beepbite/backend/internal/nodeid"
)

// Envelope is the set of facts both sides sign over.
//
// It deliberately covers more than the body: the method and path are in here so
// a signature captured from a pull cannot be replayed against push, and the org
// is in here so a signature valid for one tenant cannot be aimed at another.
// Signing the body alone would leave all of that malleable.
type Envelope struct {
	Engine    string
	Method    string
	Path      string
	Nonce     string
	Timestamp int64 // Unix milliseconds
	NodeID    string
	Org       string
	Body      []byte
}

// Canonical renders the envelope as the exact bytes that get signed.
//
// Every variable-length field is length-prefixed, by canon.AppendChunk — the
// one definition of that framing, shared with internal/nodeid's signing
// envelope. Plain concatenation would let two different envelopes produce
// identical bytes — path "/sync" + nonce "ab" and path "/syncab" + nonce "" are
// the same string and must not be the same signature. The tests build exactly
// that collision and assert the encodings differ.
//
// encoding/json is not used on purpose: field ordering and string escaping are
// implementation details there, and a signature is a promise about bytes.
//
// The body is hashed rather than inlined so signing a large push does not mean
// copying it a second time; the hash is over the exact bytes received, so this
// is a size optimisation and not a weakening.
func (e Envelope) Canonical() []byte {
	bodyHash := sha256.Sum256(e.Body)

	fields := [][]byte{
		[]byte("beepbite-sync-v1"), // context, so these bytes mean nothing elsewhere
		[]byte(e.Engine),
		[]byte(e.Method),
		[]byte(e.Path),
		[]byte(e.Nonce),
		[]byte(e.NodeID),
		[]byte(e.Org),
		bodyHash[:],
	}

	n := 8 // timestamp
	for _, f := range fields {
		n += 4 + len(f)
	}
	out := make([]byte, 0, n)

	for _, f := range fields {
		out = canon.AppendChunk(out, f)
	}
	var ts [8]byte
	binary.BigEndian.PutUint64(ts[:], uint64(e.Timestamp))
	out = append(out, ts[:]...)

	return out
}

// Sign signs the envelope with this node's identity.
func Sign(id *nodeid.Identity, e Envelope) []byte {
	return id.Sign(SignPurpose, e.Canonical())
}

// Verify checks a signature against the peer's pinned public key. It returns
// false rather than an error for every malformed input — a caller at a trust
// boundary wants one boolean, not a taxonomy of ways a hostile peer can be
// wrong.
func Verify(pub nodeid.NodeID, e Envelope, sig []byte) bool {
	return nodeid.Verify(pub, SignPurpose, e.Canonical(), sig)
}
