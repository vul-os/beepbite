package llm

import (
	"context"
	"errors"
	"fmt"
	"math"
	"os"

	"github.com/jackc/pgx/v5/pgxpool"
)

// TaskKind describes the nature of the LLM task, used to select a routing tier.
type TaskKind int

const (
	// CustomerChat routes to the cheapest capable model (e.g. Haiku / gpt-4o-mini / gemini-flash).
	CustomerChat TaskKind = iota
	// OwnerChat routes to a mid-tier model with better reasoning.
	OwnerChat
	// BulkVision routes to the best vision-capable model available.
	BulkVision
)

// Capabilities describes the feature requirements a chosen model must satisfy.
type Capabilities struct {
	// Vision requires the model to support image input.
	Vision bool
	// Tools requires the model to support function/tool calling.
	Tools bool
	// MinContext is the minimum context window (in tokens) required.
	MinContext int
}

// Router holds the registry of enabled providers and a store for pricing data.
// It is constructed once at start-up via NewRouter; Pick is safe for concurrent use.
type Router struct {
	providers map[string]Provider // keyed by Provider.Name()
	store     *store
}

// NewRouter constructs a Router from the given pgxpool and a variadic list of
// extra providers.  In normal usage callers pass no extra providers; the
// function auto-registers all four well-known providers whose API key env vars
// are set:
//
//   - ANTHROPIC_API_KEY → anthropic
//   - OPENAI_API_KEY    → openai
//   - GEMINI_API_KEY    → gemini
//   - MOONSHOT_API_KEY  → moonshot
//
// Providers with no API key are silently skipped.
// Extra providers passed in extras are always registered (used in tests).
func NewRouter(pool *pgxpool.Pool, extras ...Provider) *Router {
	r := &Router{
		providers: make(map[string]Provider),
		store:     &store{pool: pool},
	}

	// Auto-register well-known providers when env key is present.
	if key := os.Getenv("ANTHROPIC_API_KEY"); key != "" {
		p := newAnthropicProvider(key)
		r.providers[p.Name()] = p
	}
	if key := os.Getenv("OPENAI_API_KEY"); key != "" {
		p := newOpenAIProvider(key)
		r.providers[p.Name()] = p
	}
	if key := os.Getenv("GEMINI_API_KEY"); key != "" {
		p := newGeminiProvider(key)
		r.providers[p.Name()] = p
	}
	if key := os.Getenv("MOONSHOT_API_KEY"); key != "" {
		p := newMoonshotProvider(key)
		r.providers[p.Name()] = p
	}

	// Register any extras (test stubs, custom providers, etc.).
	for _, p := range extras {
		r.providers[p.Name()] = p
	}

	return r
}

// GetProvider returns the named provider, or an error if it is not enabled.
func (r *Router) GetProvider(name string) (Provider, error) {
	p, ok := r.providers[name]
	if !ok {
		return nil, fmt.Errorf("llm router: provider %q is not enabled", name)
	}
	return p, nil
}

// EnabledProviders returns all currently registered providers.
func (r *Router) EnabledProviders() []Provider {
	out := make([]Provider, 0, len(r.providers))
	for _, p := range r.providers {
		out = append(out, p)
	}
	return out
}

// ── Pick ──────────────────────────────────────────────────────────────────────

// ErrNoProvider is returned when no enabled provider can satisfy the request.
var ErrNoProvider = errors.New("llm router: no enabled provider satisfies the requirements")

// Pick selects the most appropriate (provider, model) pair for the given task
// and capability requirements.
//
// Algorithm:
//  1. Fetch all rows from llm_model_pricing (migration 024).
//  2. Filter to rows whose provider is in the enabled provider registry.
//  3. Filter to rows that satisfy needs (vision, tools, context length).
//  4. For BulkVision: pick the cheapest vision-capable model (bulk = volume matters).
//     For CustomerChat: pick the absolute cheapest capable model.
//     For OwnerChat: exclude the cheapest third (by cost range), then pick
//     the cheapest of the remainder to stay cost-conscious while avoiding
//     the lowest quality tier.
//  5. Return (provider name, model name, nil) or (_, _, ErrNoProvider).
//
// Cost is measured as input_cost_per_1k + output_cost_per_1k.
// Models not present in llm_model_pricing are treated as disabled.
func (r *Router) Pick(ctx context.Context, task TaskKind, needs Capabilities) (provider, model string, err error) {
	allPricing, err := r.store.listPricing(ctx)
	if err != nil {
		return "", "", fmt.Errorf("llm router: Pick: fetch pricing: %w", err)
	}

	// Filter to enabled providers only.
	var eligible []modelPricing
	for _, row := range allPricing {
		if _, ok := r.providers[row.Provider]; !ok {
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

	// Route by task kind.
	switch task {
	case CustomerChat:
		// Cheapest capable model.
		best := cheapest(capable)
		return best.Provider, best.Model, nil

	case OwnerChat:
		// Mid-tier: exclude the cheapest third of the cost range, then pick
		// cheapest of the remainder.
		best := midTier(capable)
		return best.Provider, best.Model, nil

	case BulkVision:
		// Vision tasks: prefer vision-capable models, pick cheapest for bulk efficiency.
		var visionCapable []modelPricing
		for _, row := range capable {
			if row.SupportsVision {
				visionCapable = append(visionCapable, row)
			}
		}
		if len(visionCapable) == 0 {
			// Defensive: needs.Vision should have already filtered this,
			// but fall back to any capable model.
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

// ── cost helpers ─────────────────────────────────────────────────────────────

// combinedCost returns the sum of input and output cost per 1k tokens.
func combinedCost(p modelPricing) float64 {
	return p.InputCostPer1k + p.OutputCostPer1k
}

// cheapest returns the modelPricing with the lowest combined cost.
func cheapest(rows []modelPricing) modelPricing {
	best := rows[0]
	bestCost := combinedCost(best)
	for _, row := range rows[1:] {
		if c := combinedCost(row); c < bestCost {
			bestCost = c
			best = row
		}
	}
	return best
}

// midTier excludes the cheapest third of models (by cost range) and returns the
// cheapest of the remaining models.  This implements the OwnerChat heuristic:
// avoid the lowest quality tier while still preferring lower cost within the
// mid-to-high tier.
func midTier(rows []modelPricing) modelPricing {
	if len(rows) <= 2 {
		// Not enough entries to form a meaningful tier split; return cheapest.
		return cheapest(rows)
	}

	// Find min/max cost to compute the cutoff threshold.
	minCost := math.MaxFloat64
	maxCost := 0.0
	for _, row := range rows {
		c := combinedCost(row)
		if c < minCost {
			minCost = c
		}
		if c > maxCost {
			maxCost = c
		}
	}

	// Threshold: bottom third of cost range.
	threshold := minCost + (maxCost-minCost)/3.0

	var upper []modelPricing
	for _, row := range rows {
		if combinedCost(row) > threshold {
			upper = append(upper, row)
		}
	}

	if len(upper) == 0 {
		// All models have nearly identical costs; fall back to cheapest.
		return cheapest(rows)
	}
	return cheapest(upper)
}
