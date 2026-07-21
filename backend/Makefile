.PHONY: build test vet patala-generate build-patala test-patala

BIN := beepbite-server-patala

# Scoped Go package patterns, matching cmd/server's Dockerfile build and
# go vet's own convention elsewhere in this repo.
GO_PKGS := ./cmd/... ./internal/...

# Where the sibling patala repo lives, relative to this Makefile (this repo
# is a sibling of patala, one level up from backend/ — see the `beepbite`
# and `patala` checkouts sitting next to each other). Override with
# `make PATALA_DIR=/path/to/patala patala-generate` if your checkout lives
# somewhere else.
PATALA_DIR := ../../patala
PATALA_GO_DIR := $(PATALA_DIR)/patala-go
PATALA_BINDINGS := $(PATALA_GO_DIR)/bindings/patala
UNAME_S := $(shell uname -s)
ifeq ($(UNAME_S),Darwin)
	PATALA_LIB := $(PATALA_BINDINGS)/libpatala_py.dylib
else
	PATALA_LIB := $(PATALA_BINDINGS)/libpatala_py.so
endif

# ── Everyday targets ────────────────────────────────────────────────────────
build:
	go build -o $(BIN) ./cmd/server

test:
	go test $(GO_PKGS)

vet:
	go vet $(GO_PKGS)

# ── The patala path (real payment gateways) ─────────────────────────────────
# See internal/payments/patala_gateway.go's own module doc comment for the
# full explanation. The targets above (and every other target in this repo)
# are completely unaffected by any of this — they never pass `-tags patala`,
# so they never import patala-go, need no cgo, and stay exactly the pure-Go
# build BeepBite has always shipped (see internal/payments/manual.go, still
# the only PaymentProvider actually wired into the POS/checkout paths).
# Everything below is opt-in, for a deployment that wants a real online
# gateway (Stripe, Paystack, Adyen, ...) available behind the seam — NOT
# wired into checkout/marketplace by this change; that is separate work.
#
# Prerequisites, once, before any target below works:
#   1. Clone patala next to this repo's parent checkout (so
#      ../../patala/patala-go exists from backend/ — see PATALA_DIR above to
#      override).
#   2. Install uniffi-bindgen-go pinned to this workspace's uniffi version
#      (see ../../patala/patala-go/README.md's exact `cargo install` command).
#   3. A Rust toolchain (cargo/rustc) and a C toolchain (cc/clang/gcc).

# go.work (gitignored) wires the sibling patala-go module into the build for
# `-tags patala` ONLY. It deliberately lives here and NOT as a local-path
# `replace` in go.mod: a `replace => ../../patala/patala-go` in go.mod would
# break `go mod download` in Docker/CI, where no sibling patala checkout
# exists — go.mod's own `require github.com/vul-os/patala/patala-go`
# resolves against the real published repo for that case (its generated
# `bindings/` package is gitignored there too, so that require is only ever
# actually exercised through this workspace override, never fetched
# package-and-built standalone; see go.mod's comment on this).
go.work:
	go work init
	go work use .
	go work use $(PATALA_GO_DIR)

# Regenerate patala-go's Go bindings from a cdylib built with every
# patala-fiat processor compiled in. Delegates entirely to patala-go's own
# Makefile — this target exists so `make build-patala`/`test-patala` don't
# silently build against stale bindings.
patala-generate:
	$(MAKE) -C $(PATALA_GO_DIR) FEATURES=fiat-all generate

# Build the server WITH the patala path linked in. Requires CGO_ENABLED=1
# and a C toolchain — see internal/payments/patala_gateway.go's build
# comment.
build-patala: go.work patala-generate
	CGO_ENABLED=1 CGO_LDFLAGS="-lpatala_py -L$(PATALA_BINDINGS)" \
		go build -tags patala -o $(BIN) ./cmd/server

# Run the patala-tagged test suite (internal/payments/patala_gateway_test.go
# + every other package's own tests, unaffected). DYLD/LD_LIBRARY_PATH point
# the dynamic linker at the freshly generated cdylib at RUN time (macOS/
# Linux — same reasoning as patala-go's own Makefile).
test-patala: go.work patala-generate
	CGO_ENABLED=1 CGO_LDFLAGS="-lpatala_py -L$(PATALA_BINDINGS)" \
		DYLD_LIBRARY_PATH="$(PATALA_BINDINGS):$$DYLD_LIBRARY_PATH" \
		LD_LIBRARY_PATH="$(PATALA_BINDINGS):$$LD_LIBRARY_PATH" \
		go test -tags patala $(GO_PKGS)
