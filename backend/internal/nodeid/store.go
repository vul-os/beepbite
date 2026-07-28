package nodeid

import (
	"crypto/ed25519"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"time"
)

// fileVersion is the persisted on-disk format version. Bump it (and add a
// migration branch in load) if the JSON shape below ever changes, so an old
// key file fails loudly with a clear "unsupported version" error instead of
// being silently misparsed by a newer binary.
const fileVersion = 1

// Identity is a node's keypair: the public NodeID plus the private key
// needed to sign under it.
//
// The private key field is unexported and this type has no String() or
// GoString(): the only thing about an Identity that is safe to log, print,
// or put in an error message is its Public NodeID (or Public.Fingerprint()).
type Identity struct {
	Public  NodeID
	private ed25519.PrivateKey
}

// onDisk is the JSON shape of the key file.
//
// The private key is stored as its 32-byte seed, not the 64-byte expanded
// form ed25519.PrivateKey normally carries in memory (seed || public key).
// The expanded form is fully derivable from the seed alone, so storing only
// the seed means there is exactly one value on disk that determines the
// keypair — there is no second, redundant private-key field that could
// drift out of sync with the first if the file were ever hand-edited.
// PublicKey is still stored explicitly (rather than always re-derived) so
// that load can cross-check it against the seed-derived key and treat any
// mismatch as corruption — see load().
type onDisk struct {
	Version   int       `json:"version"`
	CreatedAt time.Time `json:"created_at"`
	PublicKey string    `json:"public_key"`
	Seed      string    `json:"private_seed_b64"`
}

// LoadOrCreate loads the identity stored at path, or generates a fresh one
// and persists it if path does not exist.
//
// A corrupt file, a wrong-length key, or a public/private mismatch inside
// an existing file is a hard error — LoadOrCreate never falls back to
// generating a new identity in that case. Regenerating on read failure
// would silently change the node's identity out from under it, and any peer
// that had already pinned the old NodeID would be silently orphaned with no
// signal that anything had changed. A human has to look at the error and
// decide what to do (restore a backup, or deliberately delete the file to
// re-key).
func LoadOrCreate(path string) (*Identity, error) {
	info, err := os.Stat(path)
	switch {
	case err == nil:
		if err := checkPrivateMode(path, info.Mode()); err != nil {
			return nil, err
		}
		return load(path)
	case errors.Is(err, fs.ErrNotExist):
		return create(path)
	default:
		return nil, fmt.Errorf("nodeid: stat %s: %w", path, err)
	}
}

// load reads, parses, and validates an existing key file at path. Every
// failure mode returns an error rather than a zero-value Identity, so a
// caller cannot accidentally proceed with a bogus identity.
func load(path string) (*Identity, error) {
	raw, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("nodeid: read %s: %w", path, err)
	}

	var rec onDisk
	if err := json.Unmarshal(raw, &rec); err != nil {
		return nil, fmt.Errorf("nodeid: %s is not valid JSON: %w", path, err)
	}
	if rec.Version != fileVersion {
		return nil, fmt.Errorf("nodeid: %s has unsupported version %d (want %d)", path, rec.Version, fileVersion)
	}

	seed, err := base64.StdEncoding.DecodeString(rec.Seed)
	if err != nil {
		return nil, fmt.Errorf("nodeid: %s has an invalid private_seed_b64 field: %w", path, err)
	}
	if len(seed) != ed25519.SeedSize {
		return nil, fmt.Errorf("nodeid: %s has a %d-byte private seed, want %d", path, len(seed), ed25519.SeedSize)
	}

	priv := ed25519.NewKeyFromSeed(seed)
	pub, ok := priv.Public().(ed25519.PublicKey)
	if !ok {
		// Unreachable in practice — ed25519.PrivateKey.Public() always
		// returns an ed25519.PublicKey — but checked explicitly rather than
		// asserted, so a future stdlib change fails as an error here
		// instead of a panic deep in a caller.
		return nil, fmt.Errorf("nodeid: %s: could not derive public key from private seed", path)
	}
	derived, err := nodeIDFromPublicKey(pub)
	if err != nil {
		return nil, fmt.Errorf("nodeid: %s: %w", path, err)
	}

	stored, err := Parse(rec.PublicKey)
	if err != nil {
		return nil, fmt.Errorf("nodeid: %s has an invalid public_key field: %w", path, err)
	}
	if stored != derived {
		return nil, fmt.Errorf(
			"nodeid: %s is corrupt: stored public key %s does not match the key derived from its private seed (%s)",
			path, stored.Fingerprint(), derived.Fingerprint(),
		)
	}

	return &Identity{Public: derived, private: priv}, nil
}

// create generates a fresh Ed25519 keypair, persists it atomically at path,
// and returns the resulting Identity.
func create(path string) (*Identity, error) {
	pub, priv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		return nil, fmt.Errorf("nodeid: generate key: %w", err)
	}
	nid, err := nodeIDFromPublicKey(pub)
	if err != nil {
		return nil, err
	}

	rec := onDisk{
		Version:   fileVersion,
		CreatedAt: time.Now().UTC(),
		PublicKey: nid.String(),
		Seed:      base64.StdEncoding.EncodeToString(priv.Seed()),
	}
	data, err := json.MarshalIndent(&rec, "", "  ")
	if err != nil {
		return nil, fmt.Errorf("nodeid: encode new key: %w", err)
	}

	if err := writeFileAtomic(path, data); err != nil {
		return nil, err
	}

	// Re-stat and re-check the mode we actually ended up with on disk: a
	// private key readable by other users on the box is the whole game, so
	// we don't trust our own chmod call without confirming it took effect —
	// umask, an unusual filesystem, or a racing process could all defeat it
	// silently.
	info, err := os.Stat(path)
	if err != nil {
		return nil, fmt.Errorf("nodeid: stat newly written %s: %w", path, err)
	}
	if err := checkPrivateMode(path, info.Mode()); err != nil {
		return nil, err
	}

	return &Identity{Public: nid, private: priv}, nil
}

// checkPrivateMode refuses to use a key file that is readable or writable
// by anyone other than its owner. It is checked both before loading an
// existing file and right after writing a new one — a leaked private key is
// the whole game, and failing loudly beats running with one.
func checkPrivateMode(path string, mode fs.FileMode) error {
	if mode.Perm()&0o077 != 0 {
		return fmt.Errorf(
			"nodeid: refusing to use %s: mode %04o is readable or writable by group/other, want 0600 or stricter",
			path, mode.Perm(),
		)
	}
	return nil
}

// writeFileAtomic writes data to path such that no partial or
// wrong-permission file is ever visible at that path: it writes to a temp
// file in the same directory (so the final rename stays on one filesystem
// and is therefore atomic), sets 0600 on the temp file before writing any
// key material into it, fsyncs the contents, and only then renames it into
// place.
func writeFileAtomic(path string, data []byte) error {
	dir := filepath.Dir(path)
	tmp, err := os.CreateTemp(dir, ".nodeid-*.tmp")
	if err != nil {
		return fmt.Errorf("nodeid: create temp file in %s: %w", dir, err)
	}
	tmpPath := tmp.Name()

	// If anything below fails, don't leave a stray key-bearing temp file
	// behind.
	renamed := false
	defer func() {
		if !renamed {
			_ = os.Remove(tmpPath)
		}
	}()

	if err := tmp.Chmod(0o600); err != nil {
		_ = tmp.Close()
		return fmt.Errorf("nodeid: chmod temp file %s: %w", tmpPath, err)
	}
	if _, err := tmp.Write(data); err != nil {
		_ = tmp.Close()
		return fmt.Errorf("nodeid: write temp file %s: %w", tmpPath, err)
	}
	if err := tmp.Sync(); err != nil {
		_ = tmp.Close()
		return fmt.Errorf("nodeid: fsync temp file %s: %w", tmpPath, err)
	}
	if err := tmp.Close(); err != nil {
		return fmt.Errorf("nodeid: close temp file %s: %w", tmpPath, err)
	}
	if err := os.Rename(tmpPath, path); err != nil {
		return fmt.Errorf("nodeid: rename %s to %s: %w", tmpPath, path, err)
	}
	renamed = true

	// Best-effort: fsync the directory entry too, so the rename itself
	// survives a crash right after. Not fatal if unsupported — the file we
	// just renamed into place is still valid either way.
	if dirF, err := os.Open(dir); err == nil {
		_ = dirF.Sync()
		_ = dirF.Close()
	}

	return nil
}
