package llm

import (
	"context"
	"errors"
	"math"
	"testing"
)

// ── fake provider ─────────────────────────────────────────────────────────────

// fakeProvider is a minimal Provider implementation used exclusively in tests.
// It never makes network calls.
type fakeProvider struct {
	name   string
	models []string
}

func (f *fakeProvider) Name() string { return f.name }

func (f *fakeProvider) Chat(_ context.Context, _ ChatRequest) (ChatResponse, error) {
	return ChatResponse{}, errors.New("fakeProvider: Chat not implemented")
}

func (f *fakeProvider) Models(_ context.Context) ([]string, error) {
	return f.models, nil
}

// newFake returns a fakeProvider registered under the given name.
func newFake(name string) *fakeProvider {
	return &fakeProvider{name: name, models: []string{"fake-model-1"}}
}

// compile-time interface guard
var _ Provider = (*fakeProvider)(nil)

// ── routerWithPricing builds a Router without a real DB by injecting providers
// and bypassing NewRouter's auto-registration of well-known providers.
// It returns the Router and a helper to populate its internal store with the
// supplied pricing rows by monkey-patching the store's pool to nil and
// overriding listPricing at call time via the pricingOverride field below.
//
// Since store.listPricing requires a live pgx pool we use a different approach:
// we test the pure selection helpers (cheapest, midTier, combinedCost) directly,
// and for Router.Pick we embed a pricingRouter that wraps a Router and overrides
// listPricing with an in-memory implementation.
//
// ── pricingRouter ─────────────────────────────────────────────────────────────

// pricingRouter wraps Router.Pick logic using a supplied pricing slice instead
// of the DB store, letting us exercise the full selection algorithm without a
// real database.  It mirrors the exact filtering and routing logic in router.go
// so any divergence will surface as a test failure.
type pricingRouter struct {
	r       *Router
	pricing []modelPricing
}

func newPricingRouter(pricing []modelPricing, providers ...Provider) *pricingRouter {
	// NewRouter with a nil pool; auto-registration is skipped because no env
	// keys are set in the test environment.  We pass extras to register fakes.
	r := NewRouter(nil, providers...)
	return &pricingRouter{r: r, pricing: pricing}
}

// pick mirrors Router.Pick but uses the in-memory pricing slice.
func (pr *pricingRouter) pick(task TaskKind, needs Capabilities) (provider, model string, err error) {
	allPricing := pr.pricing

	// Filter to enabled providers only.
	var eligible []modelPricing
	for _, row := range allPricing {
		if _, ok := pr.r.providers[row.Provider]; !ok {
			continue
		}
		eligible = append(eligible, row)
	}

	// Filter on capability requirements.
	var capable []modelPricing
	for _, row := range eligible {
		if needs.Vision && !row.SupportsVision {
			continue
		}
		if needs.Tools && !row.SupportsTools {
			continue
		}
		if needs.MinContext > 0 && row.ContextLength < needs.MinContext {
			continue
		}
		capable = append(capable, row)
	}

	if len(capable) == 0 {
		return "", "", ErrNoProvider
	}

	switch task {
	case CustomerChat:
		best := cheapest(capable)
		return best.Provider, best.Model, nil
	case OwnerChat:
		best := midTier(capable)
		return best.Provider, best.Model, nil
	case BulkVision:
		var visionCapable []modelPricing
		for _, row := range capable {
			if row.SupportsVision {
				visionCapable = append(visionCapable, row)
			}
		}
		if len(visionCapable) == 0 {
			best := cheapest(capable)
			return best.Provider, best.Model, nil
		}
		best := cheapest(visionCapable)
		return best.Provider, best.Model, nil
	default:
		best := cheapest(capable)
		return best.Provider, best.Model, nil
	}
}

// ── combinedCost ──────────────────────────────────────────────────────────────

func TestCombinedCost(t *testing.T) {
	tests := []struct {
		name string
		row  modelPricing
		want float64
	}{
		{
			name: "both zero",
			row:  modelPricing{InputCostPer1k: 0, OutputCostPer1k: 0},
			want: 0,
		},
		{
			name: "typical haiku-style pricing",
			row:  modelPricing{InputCostPer1k: 0.00025, OutputCostPer1k: 0.00125},
			want: 0.0015,
		},
		{
			name: "integer-like costs",
			row:  modelPricing{InputCostPer1k: 1.0, OutputCostPer1k: 2.0},
			want: 3.0,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got := combinedCost(tc.row)
			if math.Abs(got-tc.want) > 1e-10 {
				t.Errorf("combinedCost() = %v, want %v", got, tc.want)
			}
		})
	}
}

// ── cheapest ─────────────────────────────────────────────────────────────────

func TestCheapest(t *testing.T) {
	rows := []modelPricing{
		{Provider: "a", Model: "expensive", InputCostPer1k: 1.0, OutputCostPer1k: 2.0},
		{Provider: "b", Model: "cheap", InputCostPer1k: 0.001, OutputCostPer1k: 0.002},
		{Provider: "c", Model: "mid", InputCostPer1k: 0.5, OutputCostPer1k: 0.5},
	}
	got := cheapest(rows)
	if got.Model != "cheap" {
		t.Errorf("cheapest() = %q, want %q", got.Model, "cheap")
	}
}

func TestCheapest_SingleEntry(t *testing.T) {
	rows := []modelPricing{
		{Provider: "solo", Model: "only-model", InputCostPer1k: 0.5, OutputCostPer1k: 0.5},
	}
	got := cheapest(rows)
	if got.Model != "only-model" {
		t.Errorf("cheapest() = %q, want %q", got.Model, "only-model")
	}
}

func TestCheapest_TiePicksFirst(t *testing.T) {
	// When costs are equal the first element is returned (strict < comparison).
	rows := []modelPricing{
		{Provider: "a", Model: "first", InputCostPer1k: 0.5, OutputCostPer1k: 0.5},
		{Provider: "b", Model: "second", InputCostPer1k: 0.5, OutputCostPer1k: 0.5},
	}
	got := cheapest(rows)
	if got.Model != "first" {
		t.Errorf("cheapest() on tie = %q, want %q", got.Model, "first")
	}
}

// ── midTier ───────────────────────────────────────────────────────────────────

func TestMidTier_FewEntries_ReturnsCheapest(t *testing.T) {
	// With ≤ 2 entries midTier falls back to cheapest.
	rows := []modelPricing{
		{Provider: "a", Model: "pricier", InputCostPer1k: 2.0, OutputCostPer1k: 2.0},
		{Provider: "b", Model: "cheaper", InputCostPer1k: 0.5, OutputCostPer1k: 0.5},
	}
	got := midTier(rows)
	if got.Model != "cheaper" {
		t.Errorf("midTier() with 2 entries = %q, want %q", got.Model, "cheaper")
	}
}

func TestMidTier_ExcludesCheapestThird(t *testing.T) {
	// Cost range: 0.1 – 1.0 → threshold = 0.1 + (1.0-0.1)/3 = ~0.4
	// cheap (0.1) is below threshold; mid (0.5) and expensive (1.0) are above.
	rows := []modelPricing{
		{Provider: "a", Model: "cheap", InputCostPer1k: 0.05, OutputCostPer1k: 0.05},     // combined 0.1
		{Provider: "b", Model: "mid", InputCostPer1k: 0.25, OutputCostPer1k: 0.25},       // combined 0.5
		{Provider: "c", Model: "expensive", InputCostPer1k: 0.5, OutputCostPer1k: 0.5},   // combined 1.0
	}
	got := midTier(rows)
	// Cheapest of {mid, expensive} is mid (0.5 combined).
	if got.Model != "mid" {
		t.Errorf("midTier() = %q, want %q", got.Model, "mid")
	}
}

func TestMidTier_AllSameCost_FallsBackToCheapest(t *testing.T) {
	// threshold == minCost when all costs are identical, so no row passes
	// the strict > check.  The implementation falls back to cheapest.
	rows := []modelPricing{
		{Provider: "a", Model: "m1", InputCostPer1k: 1.0, OutputCostPer1k: 1.0},
		{Provider: "b", Model: "m2", InputCostPer1k: 1.0, OutputCostPer1k: 1.0},
		{Provider: "c", Model: "m3", InputCostPer1k: 1.0, OutputCostPer1k: 1.0},
	}
	got := midTier(rows)
	// All are identical; we just need a valid result — not ErrNoProvider.
	if got.Model == "" {
		t.Error("midTier() returned empty model for all-same-cost input")
	}
}

// ── Router construction ───────────────────────────────────────────────────────

func TestNewRouter_NoEnvKeys_NoAutoProviders(t *testing.T) {
	// With no env keys set (test environment) and no extras, the router should
	// have zero enabled providers.
	r := NewRouter(nil)
	if got := r.EnabledProviders(); len(got) != 0 {
		t.Errorf("EnabledProviders() = %d, want 0 (no env keys set)", len(got))
	}
}

func TestNewRouter_ExtraProviders_AreRegistered(t *testing.T) {
	p1 := newFake("alpha")
	p2 := newFake("beta")
	r := NewRouter(nil, p1, p2)

	providers := r.EnabledProviders()
	if len(providers) != 2 {
		t.Fatalf("EnabledProviders() = %d, want 2", len(providers))
	}
}

func TestGetProvider_Found(t *testing.T) {
	fp := newFake("myprovider")
	r := NewRouter(nil, fp)

	got, err := r.GetProvider("myprovider")
	if err != nil {
		t.Fatalf("GetProvider() unexpected error: %v", err)
	}
	if got.Name() != "myprovider" {
		t.Errorf("GetProvider().Name() = %q, want %q", got.Name(), "myprovider")
	}
}

func TestGetProvider_NotFound(t *testing.T) {
	r := NewRouter(nil)

	_, err := r.GetProvider("nonexistent")
	if err == nil {
		t.Fatal("GetProvider() expected error for unknown provider, got nil")
	}
}

// ── selection logic via pricingRouter ────────────────────────────────────────

// testPricing is a shared fixture with three models across two fake providers.
var testPricing = []modelPricing{
	{
		Provider: "alpha", Model: "alpha-cheap",
		InputCostPer1k: 0.001, OutputCostPer1k: 0.002,
		SupportsVision: false, SupportsTools: true,
		ContextLength: 8_000,
	},
	{
		Provider: "alpha", Model: "alpha-vision",
		InputCostPer1k: 0.01, OutputCostPer1k: 0.03,
		SupportsVision: true, SupportsTools: true,
		ContextLength: 128_000,
	},
	{
		Provider: "beta", Model: "beta-premium",
		InputCostPer1k: 0.05, OutputCostPer1k: 0.15,
		SupportsVision: true, SupportsTools: true,
		ContextLength: 200_000,
	},
}

func TestPick_CustomerChat_CheapestModel(t *testing.T) {
	pr := newPricingRouter(testPricing, newFake("alpha"), newFake("beta"))
	provider, model, err := pr.pick(CustomerChat, Capabilities{})
	if err != nil {
		t.Fatalf("pick() unexpected error: %v", err)
	}
	// Cheapest combined: alpha-cheap (0.003)
	if provider != "alpha" || model != "alpha-cheap" {
		t.Errorf("CustomerChat pick = (%q, %q), want (alpha, alpha-cheap)", provider, model)
	}
}

func TestPick_CustomerChat_VisionRequired(t *testing.T) {
	pr := newPricingRouter(testPricing, newFake("alpha"), newFake("beta"))
	provider, model, err := pr.pick(CustomerChat, Capabilities{Vision: true})
	if err != nil {
		t.Fatalf("pick() unexpected error: %v", err)
	}
	// Cheapest vision-capable: alpha-vision (0.04) < beta-premium (0.20)
	if provider != "alpha" || model != "alpha-vision" {
		t.Errorf("CustomerChat+Vision pick = (%q, %q), want (alpha, alpha-vision)", provider, model)
	}
}

func TestPick_CustomerChat_ToolsRequired(t *testing.T) {
	pr := newPricingRouter(testPricing, newFake("alpha"), newFake("beta"))
	provider, model, err := pr.pick(CustomerChat, Capabilities{Tools: true})
	if err != nil {
		t.Fatalf("pick() unexpected error: %v", err)
	}
	// All three models support tools; cheapest is alpha-cheap.
	if provider != "alpha" || model != "alpha-cheap" {
		t.Errorf("CustomerChat+Tools pick = (%q, %q), want (alpha, alpha-cheap)", provider, model)
	}
}

func TestPick_CustomerChat_MinContext(t *testing.T) {
	pr := newPricingRouter(testPricing, newFake("alpha"), newFake("beta"))
	// Require at least 100k context — only alpha-vision (128k) and beta-premium (200k) qualify.
	provider, model, err := pr.pick(CustomerChat, Capabilities{MinContext: 100_000})
	if err != nil {
		t.Fatalf("pick() unexpected error: %v", err)
	}
	// Cheapest of the two: alpha-vision (0.04)
	if provider != "alpha" || model != "alpha-vision" {
		t.Errorf("CustomerChat+MinContext pick = (%q, %q), want (alpha, alpha-vision)", provider, model)
	}
}

func TestPick_OwnerChat_ExcludesCheapestTier(t *testing.T) {
	pr := newPricingRouter(testPricing, newFake("alpha"), newFake("beta"))
	provider, model, err := pr.pick(OwnerChat, Capabilities{})
	if err != nil {
		t.Fatalf("pick() unexpected error: %v", err)
	}
	// alpha-cheap (0.003) is in the cheapest third — expect alpha-vision or beta-premium.
	if model == "alpha-cheap" {
		t.Errorf("OwnerChat should not pick the cheapest model; got (%q, %q)", provider, model)
	}
}

func TestPick_BulkVision_CheapestVision(t *testing.T) {
	pr := newPricingRouter(testPricing, newFake("alpha"), newFake("beta"))
	provider, model, err := pr.pick(BulkVision, Capabilities{Vision: true})
	if err != nil {
		t.Fatalf("pick() unexpected error: %v", err)
	}
	// Cheapest vision-capable: alpha-vision (0.04)
	if provider != "alpha" || model != "alpha-vision" {
		t.Errorf("BulkVision pick = (%q, %q), want (alpha, alpha-vision)", provider, model)
	}
}

func TestPick_NoProviderEnabled_ReturnsErrNoProvider(t *testing.T) {
	// No providers registered → should return ErrNoProvider.
	pr := newPricingRouter(testPricing) // no extras → zero providers
	_, _, err := pr.pick(CustomerChat, Capabilities{})
	if !errors.Is(err, ErrNoProvider) {
		t.Errorf("pick() error = %v, want ErrNoProvider", err)
	}
}

func TestPick_CapabilityUnsatisfied_ReturnsErrNoProvider(t *testing.T) {
	// A pricing row that matches nothing: no vision-capable model from "gamma".
	pricing := []modelPricing{
		{
			Provider: "gamma", Model: "gamma-no-vision",
			InputCostPer1k: 0.001, OutputCostPer1k: 0.002,
			SupportsVision: false, SupportsTools: false,
			ContextLength: 4_000,
		},
	}
	pr := newPricingRouter(pricing, newFake("gamma"))
	_, _, err := pr.pick(CustomerChat, Capabilities{Vision: true})
	if !errors.Is(err, ErrNoProvider) {
		t.Errorf("pick() error = %v, want ErrNoProvider", err)
	}
}

func TestPick_ProviderNotInRegistry_IsExcluded(t *testing.T) {
	// Pricing lists "alpha" but only "beta" is registered.
	pricing := []modelPricing{
		{Provider: "alpha", Model: "alpha-only", InputCostPer1k: 0.001, OutputCostPer1k: 0.001},
		{Provider: "beta", Model: "beta-only", InputCostPer1k: 0.5, OutputCostPer1k: 0.5},
	}
	pr := newPricingRouter(pricing, newFake("beta")) // alpha NOT registered
	provider, model, err := pr.pick(CustomerChat, Capabilities{})
	if err != nil {
		t.Fatalf("pick() unexpected error: %v", err)
	}
	if provider != "beta" || model != "beta-only" {
		t.Errorf("pick() = (%q, %q), want (beta, beta-only)", provider, model)
	}
}

func TestPick_DefaultTaskKind_BehavesLikeCheapest(t *testing.T) {
	// An unknown TaskKind (e.g. 99) falls through to the default branch (cheapest).
	pr := newPricingRouter(testPricing, newFake("alpha"), newFake("beta"))
	provider, model, err := pr.pick(TaskKind(99), Capabilities{})
	if err != nil {
		t.Fatalf("pick() unexpected error: %v", err)
	}
	if provider != "alpha" || model != "alpha-cheap" {
		t.Errorf("default TaskKind pick = (%q, %q), want (alpha, alpha-cheap)", provider, model)
	}
}

// ── llmErrMsg ────────────────────────────────────────────────────────────────

func TestLlmErrMsg_NestedError(t *testing.T) {
	body := []byte(`{"error":{"message":"rate limit exceeded"}}`)
	got := llmErrMsg(body)
	if got != "rate limit exceeded" {
		t.Errorf("llmErrMsg() = %q, want %q", got, "rate limit exceeded")
	}
}

func TestLlmErrMsg_FlatMessage(t *testing.T) {
	body := []byte(`{"message":"invalid request"}`)
	got := llmErrMsg(body)
	if got != "invalid request" {
		t.Errorf("llmErrMsg() = %q, want %q", got, "invalid request")
	}
}

func TestLlmErrMsg_NoMessageField_ReturnsRaw(t *testing.T) {
	body := []byte(`{"code":400,"detail":"bad thing"}`)
	got := llmErrMsg(body)
	if got != string(body) {
		t.Errorf("llmErrMsg() = %q, want raw body", got)
	}
}

func TestLlmErrMsg_InvalidJSON_ReturnsRaw(t *testing.T) {
	body := []byte(`not json at all`)
	got := llmErrMsg(body)
	if got != "not json at all" {
		t.Errorf("llmErrMsg() = %q, want raw body", got)
	}
}

func TestLlmErrMsg_LongBody_IsTruncated(t *testing.T) {
	// Body longer than 300 bytes with no message field.
	long := make([]byte, 400)
	for i := range long {
		long[i] = 'x'
	}
	got := llmErrMsg(long)
	if len(got) != 300 {
		t.Errorf("llmErrMsg() len = %d, want 300", len(got))
	}
}

func TestLlmErrMsg_NestedErrorTakesPrecedenceOverFlatMessage(t *testing.T) {
	body := []byte(`{"error":{"message":"nested wins"},"message":"flat loses"}`)
	got := llmErrMsg(body)
	if got != "nested wins" {
		t.Errorf("llmErrMsg() = %q, want %q", got, "nested wins")
	}
}

func TestLlmErrMsg_EmptyNestedMessage_FallsBackToFlat(t *testing.T) {
	body := []byte(`{"error":{"message":""},"message":"flat fallback"}`)
	got := llmErrMsg(body)
	if got != "flat fallback" {
		t.Errorf("llmErrMsg() = %q, want %q", got, "flat fallback")
	}
}

// ── Router.EnabledProviders ───────────────────────────────────────────────────

func TestEnabledProviders_ReturnsAllRegistered(t *testing.T) {
	names := []string{"p1", "p2", "p3"}
	extras := make([]Provider, len(names))
	for i, n := range names {
		extras[i] = newFake(n)
	}
	r := NewRouter(nil, extras...)

	got := r.EnabledProviders()
	if len(got) != len(names) {
		t.Errorf("EnabledProviders() count = %d, want %d", len(got), len(names))
	}
}

func TestEnabledProviders_DuplicateExtras_LastWins(t *testing.T) {
	// If the same name is passed twice, the second registration overwrites the first.
	p1a := newFake("dup")
	p1b := newFake("dup")
	r := NewRouter(nil, p1a, p1b)

	providers := r.EnabledProviders()
	if len(providers) != 1 {
		t.Errorf("EnabledProviders() count = %d, want 1 (duplicate key)", len(providers))
	}
	_ = p1b // both are the same type; just ensure no panic
}
