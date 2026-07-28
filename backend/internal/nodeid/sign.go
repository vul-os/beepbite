package nodeid

import (
	"crypto/ed25519"
	"encoding/binary"
)

// domainContext is prepended to every signed message.
//
// It exists so a signature produced under BeepBite's node-identity scheme
// can never be replayed as valid under some other protocol that happens to
// also sign length-prefixed Ed25519 messages, and so that changing it (e.g.
// to "beepbite-v2") is a deliberate, visible way to invalidate every
// existing signature at once if the envelope format ever needs to change
// incompatibly.
const domainContext = "beepbite-v1"

// Sign signs payload under purpose and returns the raw 64-byte Ed25519
// signature.
//
// purpose is a short, caller-defined string naming what kind of message
// this is (e.g. "branch-head", "peer-invite", "job-bid"). Folding it into
// the signed bytes (see envelope) means a signature valid for one purpose
// can never be replayed as valid for a different purpose, even over a
// byte-identical payload.
func (id *Identity) Sign(purpose string, payload []byte) []byte {
	return ed25519.Sign(id.private, envelope(purpose, payload))
}

// Verify reports whether sig is a valid signature over payload, under
// purpose, by pub.
//
// It never panics: a malformed public key, a wrong-length or empty
// signature, or an empty payload/purpose all simply fail verification
// rather than crash the caller — callers will be handling attacker-supplied
// bytes (peers, sync payloads, job bids), and a crash there is a denial of
// service. The actual cryptographic check is delegated to crypto/ed25519,
// whose Verify runs in constant time with respect to the message and
// signature; the only branch added here is a cheap length comparison that
// leaks nothing secret.
func Verify(pub NodeID, purpose string, payload, sig []byte) bool {
	if len(sig) != ed25519.SignatureSize {
		return false
	}
	return ed25519.Verify(pub.PublicKey(), envelope(purpose, payload), sig)
}

// envelope builds the exact bytes that get signed: the domain context, the
// purpose, and the payload, each preceded by its own 4-byte big-endian
// length prefix.
//
// Length-prefixing — rather than plain concatenation — matters because
// concatenation alone is ambiguous about where one field ends and the next
// begins. purpose="ab", payload="c" and purpose="a", payload="bc" would
// concatenate to the identical bytes "abc", so a signature computed for one
// pair would also verify as valid for the other: a courier's signature over
// (purpose="bid", payload="job-42:accept") could then be replayed as a
// valid signature over some other (purpose, payload) split of the same
// bytes that the attacker chooses. Prefixing each field with its own length
// makes the field boundaries part of what is signed rather than something
// inferred from content, which removes that ambiguity entirely.
func envelope(purpose string, payload []byte) []byte {
	ctx := []byte(domainContext)
	p := []byte(purpose)

	buf := make([]byte, 0, 3*4+len(ctx)+len(p)+len(payload))
	buf = appendChunk(buf, ctx)
	buf = appendChunk(buf, p)
	buf = appendChunk(buf, payload)
	return buf
}

// appendChunk appends a 4-byte big-endian length prefix followed by b.
// 4 bytes comfortably bounds any purpose or payload BeepBite will ever
// sign; a fixed-width prefix (rather than a varint) keeps decoding
// trivial for the day something needs to parse an envelope back apart.
func appendChunk(buf, b []byte) []byte {
	var lenBuf [4]byte
	binary.BigEndian.PutUint32(lenBuf[:], uint32(len(b)))
	buf = append(buf, lenBuf[:]...)
	buf = append(buf, b...)
	return buf
}
