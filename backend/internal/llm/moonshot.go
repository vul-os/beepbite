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

const moonshotBaseURL = "https://api.moonshot.cn/v1"

// moonshotProvider implements Provider for Moonshot Kimi.
// Enabled when MOONSHOT_API_KEY is set.
// Moonshot exposes an OpenAI-compatible API, so the wire format mirrors openai.go.
type moonshotProvider struct {
	apiKey     string
	httpClient *http.Client
}

func newMoonshotProvider(apiKey string) *moonshotProvider {
	return &moonshotProvider{
		apiKey:     apiKey,
		httpClient: &http.Client{Timeout: 120 * time.Second},
	}
}

func (p *moonshotProvider) Name() string { return "moonshot" }

// ── wire types (OpenAI-compatible) ───────────────────────────────────────────

type moonshotMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

type moonshotFunction struct {
	Name        string         `json:"name"`
	Description string         `json:"description"`
	Parameters  map[string]any `json:"parameters"`
}

type moonshotTool struct {
	Type     string           `json:"type"` // always "function"
	Function moonshotFunction `json:"function"`
}

type moonshotRequest struct {
	Model     string            `json:"model"`
	Messages  []moonshotMessage `json:"messages"`
	Tools     []moonshotTool    `json:"tools,omitempty"`
	MaxTokens int               `json:"max_tokens,omitempty"`
}

type moonshotUsage struct {
	PromptTokens     int `json:"prompt_tokens"`
	CompletionTokens int `json:"completion_tokens"`
}

type moonshotToolCall struct {
	ID       string `json:"id"`
	Type     string `json:"type"`
	Function struct {
		Name      string `json:"name"`
		Arguments string `json:"arguments"` // JSON-encoded string
	} `json:"function"`
}

type moonshotChoiceMessage struct {
	Role      string             `json:"role"`
	Content   *string            `json:"content"`
	ToolCalls []moonshotToolCall `json:"tool_calls,omitempty"`
}

type moonshotChoice struct {
	Message      moonshotChoiceMessage `json:"message"`
	FinishReason string                `json:"finish_reason"`
}

type moonshotResponse struct {
	ID      string           `json:"id"`
	Choices []moonshotChoice `json:"choices"`
	Usage   moonshotUsage    `json:"usage"`
}

// ── Chat ─────────────────────────────────────────────────────────────────────

func (p *moonshotProvider) Chat(ctx context.Context, req ChatRequest) (ChatResponse, error) {
	var msgs []moonshotMessage
	for _, m := range req.Messages {
		msgs = append(msgs, moonshotMessage{Role: m.Role, Content: m.Content})
	}

	apiReq := moonshotRequest{
		Model:     req.Model,
		Messages:  msgs,
		MaxTokens: req.MaxTokens,
	}
	for _, t := range req.Tools {
		apiReq.Tools = append(apiReq.Tools, moonshotTool{
			Type: "function",
			Function: moonshotFunction{
				Name:        t.Name,
				Description: t.Description,
				Parameters:  t.InputSchema,
			},
		})
	}

	body, err := json.Marshal(apiReq)
	if err != nil {
		return ChatResponse{}, fmt.Errorf("moonshot: Chat: marshal: %w", err)
	}

	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost,
		moonshotBaseURL+"/chat/completions", bytes.NewReader(body))
	if err != nil {
		return ChatResponse{}, fmt.Errorf("moonshot: Chat: build request: %w", err)
	}
	httpReq.Header.Set("Authorization", "Bearer "+p.apiKey)
	httpReq.Header.Set("Content-Type", "application/json")

	resp, err := p.httpClient.Do(httpReq)
	if err != nil {
		return ChatResponse{}, fmt.Errorf("moonshot: Chat: http: %w", err)
	}
	defer resp.Body.Close()

	raw, _ := io.ReadAll(resp.Body)
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return ChatResponse{}, fmt.Errorf("moonshot: Chat: HTTP %d: %s", resp.StatusCode, llmErrMsg(raw))
	}

	var out moonshotResponse
	if err := json.Unmarshal(raw, &out); err != nil {
		return ChatResponse{}, fmt.Errorf("moonshot: Chat: decode: %w", err)
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

// Models returns the well-known Moonshot Kimi model IDs.
//
// TODO: call GET /models if Moonshot exposes a listing endpoint.
func (p *moonshotProvider) Models(_ context.Context) ([]string, error) {
	return []string{
		"moonshot-v1-8k",
		"moonshot-v1-32k",
		"moonshot-v1-128k",
		"kimi-vl-a3b-thinking",
	}, nil
}

// compile-time interface check
var _ Provider = (*moonshotProvider)(nil)
