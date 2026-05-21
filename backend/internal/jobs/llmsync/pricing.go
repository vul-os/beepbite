package llmsync

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"time"
)

// litellmURL is the raw GitHub URL for BerriAI/litellm's model price manifest.
const litellmURL = "https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json"

// litellmEntry is the per-model shape inside the litellm JSON manifest.
// Not every field is always present; we use pointers for optional numerics.
type litellmEntry struct {
	InputCostPerToken       *float64 `json:"input_cost_per_token"`
	OutputCostPerToken      *float64 `json:"output_cost_per_token"`
	MaxInputTokens          *int     `json:"max_input_tokens"`
	SupportsVision          bool     `json:"supports_vision"`
	SupportsFunctionCalling bool     `json:"supports_function_calling"`
	LitellmProvider         string   `json:"litellm_provider"`
}

// providerMap translates litellm_provider values to our internal provider codes.
// Entries absent from this map are skipped.
var providerMap = map[string]string{
	"anthropic": "anthropic",
	"openai":    "openai",
	"gemini":    "gemini",
	"moonshot":  "moonshot",
}

// ---------------------------------------------------------------------------
// Local fallback snapshot
// ---------------------------------------------------------------------------

// fallbackModels is a hardcoded snapshot of well-known models used when the
// remote fetch fails or is rate-limited, ensuring the table is never empty on
// first boot.
var fallbackModels = []modelRow{
	// Anthropic
	{Provider: "anthropic", Model: "claude-opus-4-5", InputCostPer1k: 15.0, OutputCostPer1k: 75.0, SupportsVision: true, SupportsTools: true, ContextLength: intPtr(200000), Source: "fallback"},
	{Provider: "anthropic", Model: "claude-sonnet-4-5", InputCostPer1k: 3.0, OutputCostPer1k: 15.0, SupportsVision: true, SupportsTools: true, ContextLength: intPtr(200000), Source: "fallback"},
	{Provider: "anthropic", Model: "claude-haiku-3-5", InputCostPer1k: 0.8, OutputCostPer1k: 4.0, SupportsVision: true, SupportsTools: true, ContextLength: intPtr(200000), Source: "fallback"},
	// OpenAI
	{Provider: "openai", Model: "gpt-4o", InputCostPer1k: 2.5, OutputCostPer1k: 10.0, SupportsVision: true, SupportsTools: true, ContextLength: intPtr(128000), Source: "fallback"},
	{Provider: "openai", Model: "gpt-4o-mini", InputCostPer1k: 0.15, OutputCostPer1k: 0.60, SupportsVision: true, SupportsTools: true, ContextLength: intPtr(128000), Source: "fallback"},
	{Provider: "openai", Model: "o1", InputCostPer1k: 15.0, OutputCostPer1k: 60.0, SupportsVision: true, SupportsTools: false, ContextLength: intPtr(200000), Source: "fallback"},
	{Provider: "openai", Model: "o1-mini", InputCostPer1k: 3.0, OutputCostPer1k: 12.0, SupportsVision: false, SupportsTools: false, ContextLength: intPtr(128000), Source: "fallback"},
	// Gemini
	{Provider: "gemini", Model: "gemini-2.0-flash", InputCostPer1k: 0.10, OutputCostPer1k: 0.40, SupportsVision: true, SupportsTools: true, ContextLength: intPtr(1000000), Source: "fallback"},
	{Provider: "gemini", Model: "gemini-1.5-pro", InputCostPer1k: 1.25, OutputCostPer1k: 5.00, SupportsVision: true, SupportsTools: true, ContextLength: intPtr(2000000), Source: "fallback"},
	// Moonshot
	{Provider: "moonshot", Model: "moonshot-v1-128k", InputCostPer1k: 1.20, OutputCostPer1k: 1.20, SupportsVision: false, SupportsTools: true, ContextLength: intPtr(128000), Source: "fallback"},
	{Provider: "moonshot", Model: "moonshot-v1-32k", InputCostPer1k: 0.40, OutputCostPer1k: 0.40, SupportsVision: false, SupportsTools: true, ContextLength: intPtr(32000), Source: "fallback"},
}

func intPtr(v int) *int { return &v }

// ---------------------------------------------------------------------------
// Fetch + parse
// ---------------------------------------------------------------------------

// fetchLitellmPricing downloads the litellm manifest and parses it into a slice
// of modelRows ready for UPSERT.  On any error it returns nil, err so the
// caller can fall back to the local snapshot.
func fetchLitellmPricing(ctx context.Context) ([]modelRow, error) {
	reqCtx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()

	req, err := http.NewRequestWithContext(reqCtx, http.MethodGet, litellmURL, nil)
	if err != nil {
		return nil, fmt.Errorf("llmsync/pricing: build request: %w", err)
	}
	req.Header.Set("User-Agent", "beepbite-llmsync/1.0")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("llmsync/pricing: GET %s: %w", litellmURL, err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("llmsync/pricing: unexpected status %d from litellm manifest", resp.StatusCode)
	}

	body, err := io.ReadAll(io.LimitReader(resp.Body, 20<<20)) // 20 MiB cap
	if err != nil {
		return nil, fmt.Errorf("llmsync/pricing: read body: %w", err)
	}

	return parseLitellmJSON(body)
}

// parseLitellmJSON decodes the litellm JSON manifest (a flat object keyed by
// "<provider>/<model>") and returns modelRows for supported providers only.
func parseLitellmJSON(data []byte) ([]modelRow, error) {
	// The manifest is a JSON object: { "<model_key>": { ...entry... }, ... }
	var raw map[string]json.RawMessage
	if err := json.Unmarshal(data, &raw); err != nil {
		return nil, fmt.Errorf("llmsync/pricing: JSON parse: %w", err)
	}

	rows := make([]modelRow, 0, len(raw))

	for key, entryRaw := range raw {
		var entry litellmEntry
		if err := json.Unmarshal(entryRaw, &entry); err != nil {
			// Malformed entry — skip silently.
			continue
		}

		ourProvider, ok := providerMap[entry.LitellmProvider]
		if !ok {
			continue
		}

		// Both costs must be present to be useful.
		if entry.InputCostPerToken == nil || entry.OutputCostPerToken == nil {
			continue
		}

		// Convert per-token cost → per-1k tokens.
		inputPer1k := *entry.InputCostPerToken * 1000
		outputPer1k := *entry.OutputCostPerToken * 1000

		rows = append(rows, modelRow{
			Provider:        ourProvider,
			Model:           key,
			InputCostPer1k:  inputPer1k,
			OutputCostPer1k: outputPer1k,
			SupportsVision:  entry.SupportsVision,
			SupportsTools:   entry.SupportsFunctionCalling,
			ContextLength:   entry.MaxInputTokens,
			Source:          "litellm",
		})
	}

	if len(rows) == 0 {
		return nil, fmt.Errorf("llmsync/pricing: manifest parsed but no supported-provider rows found")
	}

	log.Printf("llmsync/pricing: parsed %d model rows from litellm manifest", len(rows))
	return rows, nil
}

// pricingRows returns the rows to UPSERT: remote manifest on success, local
// fallback on any error.
func pricingRows(ctx context.Context) []modelRow {
	rows, err := fetchLitellmPricing(ctx)
	if err != nil {
		log.Printf("llmsync/pricing: remote fetch failed (%v) — using local fallback snapshot (%d models)", err, len(fallbackModels))
		return fallbackModels
	}
	return rows
}
