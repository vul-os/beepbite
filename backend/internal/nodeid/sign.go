package nodeid

import (
	"crypto"
	"crypto/ed25519"

	"github.com/beepbite/backend/internal/canon"
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
//
// The prefixing itself is canon.AppendChunk — one definition, shared with
// internal/sync/protocol's envelope, because two copies of a framing rule is two
// chances for one of them to drift. See that package's doc.
func envelope(purpose string, payload []byte) []byte {
	ctx := []byte(domainContext)
	p := []byte(purpose)

	buf := make([]byte, 0, 3*4+len(ctx)+len(p)+len(payload))
	buf = canon.AppendChunk(buf, ctx)
	buf = canon.AppendChunk(buf, p)
	buf = canon.AppendChunk(buf, payload)
	return buf
}

// CryptoSigner exposes this identity as a crypto.Signer, for a protocol that
// supplies its own domain separation and needs a raw Ed25519 signature over a
// preimage it computed itself.
//
// This deliberately bypasses envelope() above, so it needs justifying rather
// than merely documenting. domainContext exists so a BeepBite signature can
// never be replayed as valid under another protocol, and a signer that skips it
// hands out exactly that replay — unless the caller's preimage carries domain
// separation of its own that is at least as strong.
//
// The one caller today is internal/sync/substrate, whose preimage is an RFC 9052
// Sig_structure carrying the shared engine's own DMTAP-SYNC-v0/op external_aad.
// A signature minted under that tag cannot verify as a BeepBite envelope
// signature and vice versa: neither byte string is a prefix or a re-framing of
// the other, because each begins with its own fixed context. So the property
// domainContext protects is preserved by the caller rather than dropped.
//
// The key does not leave the process and never enters the WebAssembly module —
// the substrate binding accepts a signer, not a seed, and asserts on every run
// that its module exposes no entry point that could accept key material. Use
// Sign for anything that does not carry a domain tag of its own.
func (id *Identity) CryptoSigner() crypto.Signer { return id.private }
