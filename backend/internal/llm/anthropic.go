package llm

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"
)

const anthropicBaseURL = "https://api.anthropic.com/v1"

// anthropicProvider implements Provider for Anthropic Claude.
// Enabled when ANTHROPIC_API_KEY is set.
type anthropicProvider struct {
	apiKey     string
	httpClient *http.Client
}

func newAnthropicProvider(apiKey string) *anthropicProvider {
	return &anthropicProvider{
		apiKey:     apiKey,
		httpClient: &http.Client{Timeout: 120 * time.Second},
	}
}

func (p *anthropicProvider) Name() string { return "anthropic" }

// ── wire types ────────────────────────────────────────────────────────────────

// anthropicMessage is a single message in the Anthropic Messages API format.
type anthropicMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

// anthropicTool maps to Anthropic's tool schema shape.
type anthropicTool struct {
	Name        string         `json:"name"`
	Description string         `json:"description"`
	InputSchema map[string]any `json:"input_schema"`
}

// anthropicRequest is the body sent to POST /messages.
type anthropicRequest struct {
	Model     string             `json:"model"`
	MaxTokens int                `json:"max_tokens"`
	System    string             `json:"system,omitempty"`
	Messages  []anthropicMessage `json:"messages"`
	Tools     []anthropicTool    `json:"tools,omitempty"`
}

type anthropicUsage struct {
	InputTokens  int `json:"input_tokens"`
	OutputTokens int `json:"output_tokens"`
}

type anthropicContentBlock struct {
	Type  string         `json:"type"` // "text" | "tool_use"
	Text  string         `json:"text,omitempty"`
	ID    string         `json:"id,omitempty"`
	Name  string         `json:"name,omitempty"`
	Input map[string]any `json:"input,omitempty"`
}

type anthropicResponse struct {
	ID      string                  `json:"id"`
	Type    string                  `json:"type"`
	Content []anthropicContentBlock `json:"content"`
	Usage   anthropicUsage          `json:"usage"`
}

// ── Chat ─────────────────────────────────────────────────────────────────────

func (p *anthropicProvider) Chat(ctx context.Context, req ChatRequest) (ChatResponse, error) {
	// Separate system messages from the turn sequence.
	var systemText string
	var msgs []anthropicMessage
	for _, m := range req.Messages {
		if m.Role == "system" {
			systemText = m.Content
			continue
		}
		msgs = append(msgs, anthropicMessage{Role: m.Role, Content: m.Content})
	}

	maxTok := req.MaxTokens
	if maxTok == 0 {
		maxTok = 1024
	}

	apiReq := anthropicRequest{
		Model:     req.Model,
		MaxTokens: maxTok,
		System:    systemText,
		Messages:  msgs,
	}
	for _, t := range req.Tools {
		apiReq.Tools = append(apiReq.Tools, anthropicTool{
			Name:        t.Name,
			Description: t.Description,
			InputSchema: t.InputSchema,
		})
	}

	body, err := json.Marshal(apiReq)
	if err != nil {
		return ChatResponse{}, fmt.Errorf("anthropic: Chat: marshal: %w", err)
	}

	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost,
		anthropicBaseURL+"/messages", bytes.NewReader(body))
	if err != nil {
		return ChatResponse{}, fmt.Errorf("anthropic: Chat: build request: %w", err)
	}
	httpReq.Header.Set("x-api-key", p.apiKey)
	httpReq.Header.Set("anthropic-version", "2023-06-01")
	httpReq.Header.Set("Content-Type", "application/json")

	resp, err := p.httpClient.Do(httpReq)
	if err != nil {
		return ChatResponse{}, fmt.Errorf("anthropic: Chat: http: %w", err)
	}
	defer resp.Body.Close()

	raw, _ := io.ReadAll(resp.Body)
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return ChatResponse{}, fmt.Errorf("anthropic: Chat: HTTP %d: %s", resp.StatusCode, llmErrMsg(raw))
	}

	var out anthropicResponse
	if err := json.Unmarshal(raw, &out); err != nil {
		return ChatResponse{}, fmt.Errorf("anthropic: Chat: decode: %w", err)
	}

	var textBuf string
	var toolCalls []ToolCall
	for _, blk := range out.Content {
		switch blk.Type {
		case "text":
			textBuf += blk.Text
		case "tool_use":
			toolCalls = append(toolCalls, ToolCall{
				ID:    blk.ID,
				Name:  blk.Name,
				Input: blk.Input,
			})
		}
	}

	return ChatResponse{
		Text:      textBuf,
		TokensIn:  out.Usage.InputTokens,
		TokensOut: out.Usage.OutputTokens,
		ToolCalls: toolCalls,
	}, nil
}

// ── Models ────────────────────────────────────────────────────────────────────

// Models returns the well-known Claude model IDs.
// The Anthropic API does not expose a public model-listing endpoint as of the
// implementation date, so this returns a curated static list.
//
// TODO: replace with a live call to GET /models if/when Anthropic publishes one.
func (p *anthropicProvider) Models(_ context.Context) ([]string, error) {
	return []string{
		"claude-haiku-4-5",
		"claude-sonnet-4-5",
		"claude-opus-4-5",
	}, nil
}

// compile-time interface check
var _ Provider = (*anthropicProvider)(nil)
