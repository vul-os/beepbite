// Package canon owns BeepBite's one framing rule for bytes that get hashed or
// signed: every variable-length field is written as a fixed-width, big-endian
// uint32 length followed by its raw bytes.
//
// # Why a package for six lines
//
// This rule was written out three separate times — internal/oplog's op encoder,
// internal/sync/protocol's envelope, and internal/nodeid's signing envelope —
// each with its own name (writeLenPrefixed, an inline loop, appendChunk) and its
// own comment explaining the same reasoning. Three copies of a framing rule is
// three chances for one of them to drift, and a framing rule that has drifted is
// not a bug that shows up as a test failure: it shows up as a signature that
// verifies on one build and not on another, or as two nodes computing different
// addresses for the same operation. The copies were identical, which is the
// argument for collapsing them rather than against it — nothing was gained by
// having three, and the day one of them acquires a varint or a different
// endianness is the day the other two silently disagree with it.
//
// The oplog copy is gone for a different reason: operations are addressed and
// signed by the shared engine's own §4.1 deterministic CBOR now (see
// internal/sync/substrate), so BeepBite no longer has an operation encoder to
// keep. The two survivors are here.
//
// # Why length-prefixing rather than a delimiter
//
// Concatenation alone is ambiguous about where one field ends and the next
// begins: purpose="ab", payload="c" and purpose="a", payload="bc" concatenate to
// the identical bytes, so a signature computed over one pair would also verify
// as valid over the other. A delimiter has the same problem wherever a field's
// content can contain the delimiter. Prefixing each field with its own length
// makes the field boundaries part of what is signed rather than something
// inferred from content, which removes the ambiguity entirely.
//
// Four bytes comfortably bounds anything BeepBite signs, and a fixed-width
// prefix (rather than a varint) keeps decoding trivial for the day something
// needs to parse a frame back apart.
package canon

import "encoding/binary"

// AppendChunk appends a 4-byte big-endian length prefix followed by b, and
// returns the extended slice.
func AppendChunk(buf, b []byte) []byte {
	var length [4]byte
	binary.BigEndian.PutUint32(length[:], uint32(len(b)))
	buf = append(buf, length[:]...)
	return append(buf, b...)
}
