package nodeid

import (
	"crypto/ed25519"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"os"
	"path/filepath"
	"runtime"
	"testing"
	"time"
)

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

// skipOnWindows skips permission-mode tests where os.Chmod does not carry
// the POSIX group/other bits this package checks.
func skipOnWindows(t *testing.T) {
	t.Helper()
	if runtime.GOOS == "windows" {
		t.Skip("POSIX file mode bits are not meaningful on windows")
	}
}

// writeRaw writes data to path with an explicit mode, for tests that need
// to plant a file LoadOrCreate did not itself create.
func writeRaw(t *testing.T, path string, data []byte, mode os.FileMode) {
	t.Helper()
	if err := os.WriteFile(path, data, mode); err != nil {
		t.Fatalf("write %s: %v", path, err)
	}
	// os.WriteFile only applies mode to a newly created file; force it in
	// case the file already existed with different permissions.
	if err := os.Chmod(path, mode); err != nil {
		t.Fatalf("chmod %s: %v", path, err)
	}
}

// ---------------------------------------------------------------------------
// LoadOrCreate — happy path
// ---------------------------------------------------------------------------

func TestLoadOrCreate_CreatesThenReloadsSameIdentity(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "node.json")

	if _, err := os.Stat(path); !os.IsNotExist(err) {
		t.Fatalf("precondition: %s should not exist yet", path)
	}

	first, err := LoadOrCreate(path)
	if err != nil {
		t.Fatalf("LoadOrCreate (create): %v", err)
	}
	if _, err := os.Stat(path); err != nil {
		t.Fatalf("expected %s to exist after LoadOrCreate: %v", path, err)
	}

	second, err := LoadOrCreate(path)
	if err != nil {
		t.Fatalf("LoadOrCreate (reload): %v", err)
	}

	if first.Public != second.Public {
		t.Fatalf("reloaded identity differs from created one: %s vs %s", first.Public.Fingerprint(), second.Public.Fingerprint())
	}

	// The private key must also match, or sign/verify across process
	// restarts (the whole point of persistence) would silently break.
	sig := second.Sign("test", []byte("payload"))
	if !Verify(first.Public, "test", []byte("payload"), sig) {
		t.Fatal("signature from reloaded identity does not verify against the originally created public key")
	}
}

func TestLoadOrCreate_WritesOwnerOnlyMode(t *testing.T) {
	skipOnWindows(t)

	dir := t.TempDir()
	path := filepath.Join(dir, "node.json")

	if _, err := LoadOrCreate(path); err != nil {
		t.Fatalf("LoadOrCreate: %v", err)
	}

	info, err := os.Stat(path)
	if err != nil {
		t.Fatalf("stat: %v", err)
	}
	if perm := info.Mode().Perm(); perm != 0o600 {
		t.Errorf("newly created key file has mode %04o, want 0600", perm)
	}
}

func TestLoadOrCreate_DoesNotLeaveTempFilesBehind(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "node.json")

	if _, err := LoadOrCreate(path); err != nil {
		t.Fatalf("LoadOrCreate: %v", err)
	}

	entries, err := os.ReadDir(dir)
	if err != nil {
		t.Fatalf("ReadDir: %v", err)
	}
	if len(entries) != 1 {
		names := make([]string, len(entries))
		for i, e := range entries {
			names[i] = e.Name()
		}
		t.Fatalf("expected exactly 1 file in %s, found %v", dir, names)
	}
}

// ---------------------------------------------------------------------------
// LoadOrCreate — corruption is a hard error, never silent regeneration
// ---------------------------------------------------------------------------

func TestLoadOrCreate_CorruptFileErrors(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "node.json")
	writeRaw(t, path, []byte("this is not json"), 0o600)

	_, err := LoadOrCreate(path)
	if err == nil {
		t.Fatal("expected an error for a corrupt (non-JSON) key file, got nil")
	}

	// The file must be left exactly as it was: LoadOrCreate must never
	// paper over corruption by regenerating a fresh identity in place.
	raw, readErr := os.ReadFile(path)
	if readErr != nil {
		t.Fatalf("re-read %s: %v", path, readErr)
	}
	if string(raw) != "this is not json" {
		t.Fatalf("corrupt file was modified by LoadOrCreate; contents now: %q", raw)
	}
}

func TestLoadOrCreate_WrongLengthSeedErrors(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "node.json")

	rec := onDisk{
		Version:   fileVersion,
		CreatedAt: time.Now().UTC(),
		PublicKey: randomNodeID(t).String(),
		Seed:      base64.StdEncoding.EncodeToString([]byte("too-short")),
	}
	data, err := json.Marshal(&rec)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	writeRaw(t, path, data, 0o600)

	if _, err := LoadOrCreate(path); err == nil {
		t.Fatal("expected an error for a wrong-length private seed, got nil")
	}
}

func TestLoadOrCreate_PublicPrivateMismatchErrors(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "node.json")

	_, priv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatalf("generate: %v", err)
	}

	rec := onDisk{
		Version:   fileVersion,
		CreatedAt: time.Now().UTC(),
		PublicKey: randomNodeID(t).String(), // deliberately NOT derived from priv below
		Seed:      base64.StdEncoding.EncodeToString(priv.Seed()),
	}
	data, err := json.Marshal(&rec)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	writeRaw(t, path, data, 0o600)

	_, err = LoadOrCreate(path)
	if err == nil {
		t.Fatal("expected an error when stored public key does not match the seed-derived key, got nil")
	}
}

func TestLoadOrCreate_UnsupportedVersionErrors(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "node.json")

	rec := onDisk{
		Version:   999,
		CreatedAt: time.Now().UTC(),
		PublicKey: randomNodeID(t).String(),
		Seed:      base64.StdEncoding.EncodeToString(make([]byte, 32)),
	}
	data, err := json.Marshal(&rec)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	writeRaw(t, path, data, 0o600)

	if _, err := LoadOrCreate(path); err == nil {
		t.Fatal("expected an error for an unsupported version field, got nil")
	}
}

// ---------------------------------------------------------------------------
// LoadOrCreate — file permission enforcement
// ---------------------------------------------------------------------------

func TestLoadOrCreate_RejectsGroupWorldReadableFile(t *testing.T) {
	skipOnWindows(t)

	dir := t.TempDir()
	path := filepath.Join(dir, "node.json")

	// Create a valid identity first, then loosen its permissions to
	// simulate a leaked/misconfigured key file.
	if _, err := LoadOrCreate(path); err != nil {
		t.Fatalf("LoadOrCreate (create): %v", err)
	}
	if err := os.Chmod(path, 0o644); err != nil {
		t.Fatalf("chmod: %v", err)
	}

	_, err := LoadOrCreate(path)
	if err == nil {
		t.Fatal("expected an error loading a 0644 key file, got nil")
	}
}
