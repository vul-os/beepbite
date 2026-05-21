// Command tests is an end-to-end smoke/integration runner for the backend.
// It hits a running server over HTTP and exercises each feature area behind a
// flag.
//
// Usage:
//
//	# run everything against the local dev server
//	go run ./cmd/tests --env=local --all
//
//	# just the auth flows
//	go run ./cmd/tests --auth
//
//	# pentest-style checks (unauth access, token reuse, allowlist bypass)
//	go run ./cmd/tests --pentest
//
//	# several at once
//	go run ./cmd/tests --sanity --auth --menu
//
// The runner expects the server to be up (and the DB migrated). Tests pick
// unique identifiers so they're rerunnable without a fresh DB, though
// `--reset` will call the migrate tool to wipe first.
package main

import (
	"flag"
	"fmt"
	"os"
	"os/exec"

	"github.com/beepbite/backend/internal/config"
)

type flags struct {
	env     string
	baseURL string
	verbose bool
	reset   bool
	all     bool

	sanity       bool
	auth         bool
	pentest      bool
	menu         bool
	recipes      bool
	orders       bool
	members      bool
	whatsapp     bool
	onboarding   bool
	pos          bool
	kds          bool
	cashdrawer   bool
	adjustments  bool
	staff        bool
	audit        bool
	actorOverlay bool
	crosstenant  bool
}

func main() {
	var f flags
	flag.StringVar(&f.env, "env", "", "environment: local, dev, main (for config + default base url)")
	flag.StringVar(&f.baseURL, "url", "", "base URL override (default http://localhost:$PORT)")
	flag.BoolVar(&f.verbose, "v", false, "verbose output (print request/response snippets)")
	flag.BoolVar(&f.verbose, "verbose", false, "verbose (alias)")
	flag.BoolVar(&f.reset, "reset", false, "before running, run `migrate --reset` on the chosen env")
	flag.BoolVar(&f.all, "all", false, "run every suite")

	flag.BoolVar(&f.sanity, "sanity", false, "basic sanity checks (health, CORS, 404s)")
	flag.BoolVar(&f.auth, "auth", false, "auth flows: signup, signin, me, refresh, signout")
	flag.BoolVar(&f.pentest, "pentest", false, "security checks (unauth, reuse, injection attempts, allowlist)")
	flag.BoolVar(&f.menu, "menu", false, "menu CRUD (categories, items, variations)")
	flag.BoolVar(&f.recipes, "recipes", false, "recipe components + cost RPC")
	flag.BoolVar(&f.orders, "orders", false, "order create + detail + status flow")
	flag.BoolVar(&f.members, "members", false, "org members + invite RPCs")
	flag.BoolVar(&f.whatsapp, "whatsapp", false, "whatsapp webhook verify handshake")
	flag.BoolVar(&f.onboarding, "onboarding", false, "signup → org → member → profile → location flow")
	flag.BoolVar(&f.pos, "pos", false, "POS order create + single/split charge + order_payments rows")
	flag.BoolVar(&f.kds, "kds", false, "KDS ticket fanout + bump → status transition + recall")
	flag.BoolVar(&f.cashdrawer, "cashdrawer", false, "cash drawer open → movement → close → EOD list")
	flag.BoolVar(&f.adjustments, "adjustments", false, "void/comp on an order + order_adjustments row")
	flag.BoolVar(&f.staff, "staff", false, "staff create + set-pin + pin-login + manager-set-password")
	flag.BoolVar(&f.audit, "audit", false, "financial mutations leave audit_log rows with non-null actor_id")
	flag.BoolVar(&f.actorOverlay, "actor-overlay", false, "pin-verify happy path + lockout + capability check")
	flag.BoolVar(&f.crosstenant, "crosstenant", false, "adversarial cross-tenant isolation probes (org A token vs org B resources)")
	flag.Parse()

	cfg := loadCfg(f.env)
	if f.baseURL == "" {
		f.baseURL = "http://localhost:" + cfg.Port
	}

	if f.reset {
		if err := runMigrateReset(f.env); err != nil {
			fmt.Fprintf(os.Stderr, "reset failed: %v\n", err)
			os.Exit(1)
		}
	}

	if !anySelected(f) {
		fmt.Fprintln(os.Stderr, "no suite selected. Pass --all or one of: --sanity --auth --pentest --menu --recipes --orders --members --whatsapp --onboarding --pos --kds --cashdrawer --adjustments")
		flag.Usage()
		os.Exit(2)
	}

	r := newRunner(f.baseURL, f.verbose)
	r.cfg = cfg
	fmt.Printf("▶ target %s (env=%s)\n\n", r.base, firstNonEmpty(f.env, "local"))

	if f.all || f.sanity {
		r.Suite("sanity", suiteSanity)
	}
	if f.all || f.auth {
		r.Suite("auth", suiteAuth)
	}
	if f.all || f.pentest {
		r.Suite("pentest", suitePentest)
	}
	if f.all || f.menu {
		r.Suite("menu", suiteMenu)
	}
	if f.all || f.recipes {
		r.Suite("recipes", suiteRecipes)
	}
	if f.all || f.orders {
		r.Suite("orders", suiteOrders)
	}
	if f.all || f.members {
		r.Suite("members", suiteMembers)
	}
	if f.all || f.whatsapp {
		r.Suite("whatsapp", suiteWhatsApp)
	}
	if f.all || f.onboarding {
		r.Suite("onboarding", suiteOnboarding)
	}
	if f.all || f.pos {
		r.Suite("pos", suitePOS)
	}
	if f.all || f.kds {
		r.Suite("kds", suiteKDS)
	}
	if f.all || f.cashdrawer {
		r.Suite("cashdrawer", suiteCashDrawer)
	}
	if f.all || f.adjustments {
		r.Suite("adjustments", suiteAdjustments)
	}
	if f.all || f.staff {
		r.Suite("staff", suiteStaff)
	}
	if f.all || f.audit {
		r.Suite("audit", suiteAudit)
	}
	if f.all || f.actorOverlay {
		r.Suite("actor-overlay", suiteActorOverlay)
	}
	if f.all || f.crosstenant {
		r.Suite("crosstenant", suiteCrossTenant)
	}

	r.Report()
	if r.failed > 0 {
		os.Exit(1)
	}
}

func loadCfg(env string) *config.Config {
	c, err := config.Load(env)
	if err != nil {
		// Don't explode — we only need the port; fall back to defaults.
		return &config.Config{Port: "8080"}
	}
	return c
}

func runMigrateReset(env string) error {
	args := []string{"run", "./cmd/migrate", "--reset"}
	if env != "" {
		args = append(args, "--env="+env)
	}
	cmd := exec.Command("go", args...)
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	return cmd.Run()
}

func anySelected(f flags) bool {
	return f.all || f.sanity || f.auth || f.pentest || f.menu || f.recipes ||
		f.orders || f.members || f.whatsapp || f.onboarding ||
		f.pos || f.kds || f.cashdrawer || f.adjustments ||
		f.staff || f.audit || f.actorOverlay || f.crosstenant
}

func firstNonEmpty(a, b string) string {
	if a != "" {
		return a
	}
	return b
}
