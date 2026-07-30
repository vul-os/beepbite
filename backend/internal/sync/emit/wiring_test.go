package emit_test

// wiring_test.go — the property that lets the emit layer sit on the write path
// without changing what a BeepBite install costs.
//
// ROADMAP Stage 0 records a standing claim about this repository: cmd/server
// does not link internal/sync/substrate, "no request path reaches it, and a
// BeepBite that never syncs never instantiates it". Wiring the engine in costs
// +4.31 MiB on the server binary, of which only 418 KiB is the engine itself —
// roughly 90% is wazero's optimizing compiler — so this is not a rounding
// error, and it is a claim in the ROADMAP that somebody will read as true.
//
// internal/handlers/data now calls into internal/sync/emit on every insert,
// update and delete. That is fine exactly as long as emit speaks to a Sink
// INTERFACE and the implementation lives in internal/sync/opsink, which nothing
// in the server's graph constructs. This test is what stops that from decaying
// into a comment: an innocuous-looking import added to emit, or a convenience
// constructor added to a handler, would move the engine into every binary this
// project ships, and nothing else would notice.
//
// It fails closed. If `go list` cannot be run, the test FAILS rather than
// skipping — a skip here is indistinguishable from the property holding, and
// this is precisely the sort of claim that is only checked when it is checked.

import (
	"os/exec"
	"strings"
	"testing"
)

// engineDeps are the packages whose presence in a binary means the WebAssembly
// engine and its compiler are in it.
var engineDeps = map[string]string{
	"github.com/beepbite/backend/internal/sync/substrate": "BeepBite's handle on the engine",
	"github.com/beepbite/backend/internal/sync/opsink":    "the Sink that constructs one",
	"github.com/vul-os/kotva/bindings/go":                 "the engine binding itself",
	"github.com/tetratelabs/wazero":                       "the WebAssembly runtime and its optimizing compiler",
}

func deps(t *testing.T, pkg string) map[string]bool {
	t.Helper()
	out, err := exec.Command("go", "list", "-deps", pkg).CombinedOutput()
	if err != nil {
		t.Fatalf("go list -deps %s failed: %v\n%s\n\n"+
			"This test fails rather than skips: a skip would look exactly like the property "+
			"holding, and the property is that the server binary does not carry the sync engine.",
			pkg, err, out)
	}
	set := make(map[string]bool)
	for _, line := range strings.Split(string(out), "\n") {
		if line = strings.TrimSpace(line); line != "" {
			set[line] = true
		}
	}
	if len(set) < 50 {
		t.Fatalf("go list -deps %s returned only %d packages; that is not a real dependency "+
			"graph and every assertion below would pass vacuously", pkg, len(set))
	}
	return set
}

func TestServerBinaryDoesNotLinkTheSyncEngine(t *testing.T) {
	graph := deps(t, "github.com/beepbite/backend/cmd/server")

	for pkg, what := range engineDeps {
		if graph[pkg] {
			t.Errorf(`cmd/server now depends on %s (%s).

ROADMAP Stage 0 states that it does not, and the difference is +4.31 MiB on
every binary BeepBite ships. The emit layer is allowed on the write path only
because internal/sync/emit speaks to a Sink INTERFACE: the implementation lives
in internal/sync/opsink and a deployment with no sync configured holds a nil
*emit.Emitter.

Either take the import back out, or change the ROADMAP — but do not leave it
saying something this test can see is false.`, pkg, what)
		}
	}

	// And the seam itself is genuinely reachable, so that the test above is
	// asserting something rather than passing because nothing is wired at all.
	if !graph["github.com/beepbite/backend/internal/sync/emit"] {
		t.Error("cmd/server does not reach internal/sync/emit either, so the write path emits " +
			"nothing even when a deployment configures sync — this test would then be " +
			"guarding an absence rather than a boundary")
	}
}

// TestTheEmitPackageItselfStaysEngineFree is the structural reason the test
// above passes, checked directly. cmd/server's graph is large and something
// else could keep the engine out by accident; this pins the actual rule.
func TestTheEmitPackageItselfStaysEngineFree(t *testing.T) {
	graph := deps(t, "github.com/beepbite/backend/internal/sync/emit")
	for pkg, what := range engineDeps {
		if graph[pkg] {
			t.Errorf("internal/sync/emit depends on %s (%s). It must not: every handler that "+
				"emits would then link the engine, whether or not the deployment syncs.", pkg, what)
		}
	}
}
