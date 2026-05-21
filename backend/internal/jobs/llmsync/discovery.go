package llmsync

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"time"
)

// ---------------------------------------------------------------------------
// Provider descriptor
// ---------------------------------------------------------------------------

// provider groups the configuration needed to enumerate models for one LLM
// provider.
type provider struct {
	// code is our internal provider identifier (matches llm_model_pricing.provider).
	code string
	// envKey is the environment variable whose presence enables this provider.
	envKey string
	// discover returns a list of model IDs visible via the provider's API.
	// It receives the API key as its first argument.
	discover func(ctx context.Context, apiKey string) ([]string, error)
}

// enabledProviders iterates the known providers and returns only those whose
// API key environment variable is set to a non-empty value.
func enabledProviders() []provider {
	all := []provider{
		{
			code:     "anthropic",
			envKey:   "ANTHROPIC_API_KEY",
			discover: discoverAnthropic,
		},
		{
			code:     "openai",
			envKey:   "OPENAI_API_KEY",
			discover: discoverOpenAI,
		},
		{
			code:     "gemini",
			envKey:   "GEMINI_API_KEY",
			discover: discoverGemini,
		},
		{
			code:     "moonshot",
			envKey:   "MOONSHOT_API_KEY",
			discover: discoverMoonshot,
		},
	}

	var out []provider
	for _, p := range all {
		if os.Getenv(p.envKey) != "" {
			out = append(out, p)
		}
	}
	return out
}

// ---------------------------------------------------------------------------
// Generic helpers
// ---------------------------------------------------------------------------

// getJSON performs a GET request with an Authorization: Bearer header, reads
// the response body (capped at 5 MiB), and decodes it into dst.
func getJSON(ctx context.Context, url, apiKey string, dst interface{}) error {
	reqCtx, cancel := context.WithTimeout(ctx, 20*time.Second)
	defer cancel()

	req, err := http.NewRequestWithContext(reqCtx, http.MethodGet, url, nil)
	if err != nil {
		return fmt.Errorf("build request: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+apiKey)
	req.Header.Set("User-Agent", "beepbite-llmsync/1.0")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return fmt.Errorf("GET %s: %w", url, err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("unexpected status %d from %s", resp.StatusCode, url)
	}

	body, err := io.ReadAll(io.LimitReader(resp.Body, 5<<20))
	if err != nil {
		return fmt.Errorf("read body: %w", err)
	}

	if err := json.Unmarshal(body, dst); err != nil {
		return fmt.Errorf("JSON decode from %s: %w", url, err)
	}
	return nil
}

// ---------------------------------------------------------------------------
// Provider-specific discovery implementations
// ---------------------------------------------------------------------------

// openAIModelsResponse is the shape returned by GET https://api.openai.com/v1/models.
// Anthropic and Moonshot also follow the same OpenAI-compatible envelope.
type openAIModelsResponse struct {
	Data []struct {
		ID string `json:"id"`
	} `json:"data"`
}

// discoverOpenAI enumerates models from https://api.openai.com/v1/models.
func discoverOpenAI(ctx context.Context, apiKey string) ([]string, error) {
	var resp openAIModelsResponse
	if err := getJSON(ctx, "https://api.openai.com/v1/models", apiKey, &resp); err != nil {
		return nil, fmt.Errorf("openai: %w", err)
	}
	ids := make([]string, 0, len(resp.Data))
	for _, m := range resp.Data {
		if m.ID != "" {
			ids = append(ids, m.ID)
		}
	}
	return ids, nil
}

// discoverAnthropic enumerates models from https://api.anthropic.com/v1/models.
// Anthropic uses the same data envelope as OpenAI but requires the
// anthropic-version header instead of Bearer auth.
//
// TODO: Anthropic's models endpoint may require x-api-key header rather than
// Authorization: Bearer. If the shape changes, adjust this function.
func discoverAnthropic(ctx context.Context, apiKey string) ([]string, error) {
	reqCtx, cancel := context.WithTimeout(ctx, 20*time.Second)
	defer cancel()

	req, err := http.NewRequestWithContext(reqCtx, http.MethodGet, "https://api.anthropic.com/v1/models", nil)
	if err != nil {
		return nil, fmt.Errorf("anthropic: build request: %w", err)
	}
	req.Header.Set("x-api-key", apiKey)
	req.Header.Set("anthropic-version", "2023-06-01")
	req.Header.Set("User-Agent", "beepbite-llmsync/1.0")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("anthropic: GET /v1/models: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("anthropic: unexpected status %d", resp.StatusCode)
	}

	body, err := io.ReadAll(io.LimitReader(resp.Body, 5<<20))
	if err != nil {
		return nil, fmt.Errorf("anthropic: read body: %w", err)
	}

	var payload openAIModelsResponse
	if err := json.Unmarshal(body, &payload); err != nil {
		return nil, fmt.Errorf("anthropic: JSON decode: %w", err)
	}

	ids := make([]string, 0, len(payload.Data))
	for _, m := range payload.Data {
		if m.ID != "" {
			ids = append(ids, m.ID)
		}
	}
	return ids, nil
}

// geminiModelsResponse is the shape returned by the Gemini model-list endpoint.
// See https://ai.google.dev/api/models#models_list
type geminiModelsResponse struct {
	Models []struct {
		Name string `json:"name"` // e.g. "models/gemini-1.5-pro"
	} `json:"models"`
}

// discoverGemini enumerates models from the Google AI REST API.
// The API key is passed as a query parameter (not Bearer auth).
func discoverGemini(ctx context.Context, apiKey string) ([]string, error) {
	url := "https://generativelanguage.googleapis.com/v1beta/models?key=" + apiKey

	reqCtx, cancel := context.WithTimeout(ctx, 20*time.Second)
	defer cancel()

	req, err := http.NewRequestWithContext(reqCtx, http.MethodGet, url, nil)
	if err != nil {
		return nil, fmt.Errorf("gemini: build request: %w", err)
	}
	req.Header.Set("User-Agent", "beepbite-llmsync/1.0")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("gemini: GET models: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("gemini: unexpected status %d", resp.StatusCode)
	}

	body, err := io.ReadAll(io.LimitReader(resp.Body, 5<<20))
	if err != nil {
		return nil, fmt.Errorf("gemini: read body: %w", err)
	}

	var payload geminiModelsResponse
	if err := json.Unmarshal(body, &payload); err != nil {
		return nil, fmt.Errorf("gemini: JSON decode: %w", err)
	}

	ids := make([]string, 0, len(payload.Models))
	for _, m := range payload.Models {
		// Strip "models/" prefix to get the bare model name.
		name := m.Name
		if len(name) > 7 && name[:7] == "models/" {
			name = name[7:]
		}
		if name != "" {
			ids = append(ids, name)
		}
	}
	return ids, nil
}

// discoverMoonshot enumerates models from https://api.moonshot.cn/v1/models.
// Moonshot uses the same OpenAI-compatible envelope.
func discoverMoonshot(ctx context.Context, apiKey string) ([]string, error) {
	var resp openAIModelsResponse
	if err := getJSON(ctx, "https://api.moonshot.cn/v1/models", apiKey, &resp); err != nil {
		return nil, fmt.Errorf("moonshot: %w", err)
	}
	ids := make([]string, 0, len(resp.Data))
	for _, m := range resp.Data {
		if m.ID != "" {
			ids = append(ids, m.ID)
		}
	}
	return ids, nil
}

// ---------------------------------------------------------------------------
// Discovery result
// ---------------------------------------------------------------------------

// discoveryResult pairs a provider code with the list of model IDs returned by
// its discovery call.
type discoveryResult struct {
	provider string
	models   []string
}

// runDiscovery calls each enabled provider's discover function and collects
// results. Per-provider errors are logged but do not abort other providers.
func runDiscovery(ctx context.Context) []discoveryResult {
	providers := enabledProviders()
	if len(providers) == 0 {
		log.Println("llmsync/discovery: no providers enabled (no API keys set) — skipping")
		return nil
	}

	results := make([]discoveryResult, 0, len(providers))
	for _, p := range providers {
		apiKey := os.Getenv(p.envKey)
		models, err := p.discover(ctx, apiKey)
		if err != nil {
			log.Printf("llmsync/discovery: provider=%s error: %v", p.code, err)
			continue
		}
		log.Printf("llmsync/discovery: provider=%s discovered %d model(s)", p.code, len(models))
		results = append(results, discoveryResult{provider: p.code, models: models})
	}
	return results
}
