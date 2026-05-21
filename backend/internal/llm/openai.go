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

const openaiBaseURL = "https://api.openai.com/v1"

// openaiProvider implements Provider for OpenAI.
// Enabled when OPENAI_API_KEY is set.
type openaiProvider struct {
	apiKey     string
	httpClient *http.Client
}

func newOpenAIProvider(apiKey string) *openaiProvider {
	return &openaiProvider{
		apiKey:     apiKey,
		httpClient: &http.Client{Timeout: 120 * time.Second},
	}
}

func (p *openaiProvider) Name() string { return "openai" }

// ── wire types ────────────────────────────────────────────────────────────────

type openaiMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

type openaiFunction struct {
	Name        string         `json:"name"`
	Description string         `json:"description"`
	Parameters  map[string]any `json:"parameters"`
}

type openaiTool struct {
	Type     string         `json:"type"` // always "function"
	Function openaiFunction `json:"function"`
}

type openaiRequest struct {
	Model     string          `json:"model"`
	Messages  []openaiMessage `json:"messages"`
	Tools     []openaiTool    `json:"tools,omitempty"`
	MaxTokens int             `json:"max_tokens,omitempty"`
}

type openaiUsage struct {
	PromptTokens     int `json:"prompt_tokens"`
	CompletionTokens int `json:"completion_tokens"`
}

type openaiToolCall struct {
	ID       string `json:"id"`
	Type     string `json:"type"`
	Function struct {
		Name      string `json:"name"`
		Arguments string `json:"arguments"` // JSON-encoded string
	} `json:"function"`
}

type openaiChoiceMessage struct {
	Role      string           `json:"role"`
	Content   *string          `json:"content"`
	ToolCalls []openaiToolCall `json:"tool_calls,omitempty"`
}

type openaiChoice struct {
	Message      openaiChoiceMessage `json:"message"`
	FinishReason string              `json:"finish_reason"`
}

type openaiResponse struct {
	ID      string         `json:"id"`
	Choices []openaiChoice `json:"choices"`
	Usage   openaiUsage    `json:"usage"`
}

// ── Chat ─────────────────────────────────────────────────────────────────────

func (p *openaiProvider) Chat(ctx context.Context, req ChatRequest) (ChatResponse, error) {
	var msgs []openaiMessage
	for _, m := range req.Messages {
		msgs = append(msgs, openaiMessage{Role: m.Role, Content: m.Content})
	}

	apiReq := openaiRequest{
		Model:     req.Model,
		Messages:  msgs,
		MaxTokens: req.MaxTokens,
	}
	for _, t := range req.Tools {
		apiReq.Tools = append(apiReq.Tools, openaiTool{
			Type: "function",
			Function: openaiFunction{
				Name:        t.Name,
				Description: t.Description,
				Parameters:  t.InputSchema,
			},
		})
	}

	body, err := json.Marshal(apiReq)
	if err != nil {
		return ChatResponse{}, fmt.Errorf("openai: Chat: marshal: %w", err)
	}

	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost,
		openaiBaseURL+"/chat/completions", bytes.NewReader(body))
	if err != nil {
		return ChatResponse{}, fmt.Errorf("openai: Chat: build request: %w", err)
	}
	httpReq.Header.Set("Authorization", "Bearer "+p.apiKey)
	httpReq.Header.Set("Content-Type", "application/json")

	resp, err := p.httpClient.Do(httpReq)
	if err != nil {
		return ChatResponse{}, fmt.Errorf("openai: Chat: http: %w", err)
	}
	defer resp.Body.Close()

	raw, _ := io.ReadAll(resp.Body)
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return ChatResponse{}, fmt.Errorf("openai: Chat: HTTP %d: %s", resp.StatusCode, llmErrMsg(raw))
	}

	var out openaiResponse
	if err := json.Unmarshal(raw, &out); err != nil {
		return ChatResponse{}, fmt.Errorf("openai: Chat: decode: %w", err)
	}

	var text string
	var toolCalls []ToolCall
	if len(out.Choices) > 0 {
		ch := out.Choices[0]
		if ch.Message.Content != nil {
			text = *ch.Message.Content
		}
		for _, tc := range ch.Message.ToolCalls {
			var input map[string]any
			// Arguments is a JSON string; decode it into a map.
			_ = json.Unmarshal([]byte(tc.Function.Arguments), &input)
			toolCalls = append(toolCalls, ToolCall{
				ID:    tc.ID,
				Name:  tc.Function.Name,
				Input: input,
			})
		}
	}

	return ChatResponse{
		Text:      text,
		TokensIn:  out.Usage.PromptTokens,
		TokensOut: out.Usage.CompletionTokens,
		ToolCalls: toolCalls,
	}, nil
}

// ── Models ────────────────────────────────────────────────────────────────────

// openaiModelsResponse mirrors GET /models.
type openaiModelsResponse struct {
	Data []struct {
		ID string `json:"id"`
	} `json:"data"`
}

// Models calls GET /models and returns the IDs of all available models.
func (p *openaiProvider) Models(ctx context.Context) ([]string, error) {
	httpReq, err := http.NewRequestWithContext(ctx, http.MethodGet,
		openaiBaseURL+"/models", nil)
	if err != nil {
		return nil, fmt.Errorf("openai: Models: build request: %w", err)
	}
	httpReq.Header.Set("Authorization", "Bearer "+p.apiKey)

	resp, err := p.httpClient.Do(httpReq)
	if err != nil {
		return nil, fmt.Errorf("openai: Models: http: %w", err)
	}
	defer resp.Body.Close()

	raw, _ := io.ReadAll(resp.Body)
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("openai: Models: HTTP %d: %s", resp.StatusCode, llmErrMsg(raw))
	}

	var out openaiModelsResponse
	if err := json.Unmarshal(raw, &out); err != nil {
		return nil, fmt.Errorf("openai: Models: decode: %w", err)
	}

	ids := make([]string, 0, len(out.Data))
	for _, m := range out.Data {
		ids = append(ids, m.ID)
	}
	return ids, nil
}

// compile-time interface check
var _ Provider = (*openaiProvider)(nil)
