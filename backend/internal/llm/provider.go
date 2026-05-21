// Package llm provides a multi-provider LLM abstraction with cost-aware routing.
//
// Supported providers: Anthropic Claude, OpenAI, Google Gemini, Moonshot Kimi.
// Each provider is enabled only when its API key environment variable is set.
//
// Migration 024 is expected to create the llm_model_pricing table:
//
//	CREATE TABLE llm_model_pricing (
//	    provider           text NOT NULL,
//	    model              text NOT NULL,
//	    input_cost_per_1k  numeric(12,8) NOT NULL,
//	    output_cost_per_1k numeric(12,8) NOT NULL,
//	    supports_vision    boolean NOT NULL DEFAULT false,
//	    supports_tools     boolean NOT NULL DEFAULT false,
//	    context_length     integer NOT NULL DEFAULT 0,
//	    PRIMARY KEY (provider, model)
//	);
package llm

import "context"

// Message is a single turn in a conversation.
type Message struct {
	Role    string `json:"role"`    // "system" | "user" | "assistant"
	Content string `json:"content"` // plain text; base64-encoded image data goes here for vision
}

// ToolDef describes a callable tool exposed to the model.
type ToolDef struct {
	Name        string         `json:"name"`
	Description string         `json:"description"`
	InputSchema map[string]any `json:"input_schema"`
}

// ToolCall is a single tool invocation returned by the model.
type ToolCall struct {
	ID    string         `json:"id"`
	Name  string         `json:"name"`
	Input map[string]any `json:"input"`
}

// ChatRequest is the provider-agnostic input to a chat completion.
type ChatRequest struct {
	Messages  []Message `json:"messages"`
	Model     string    `json:"model"`
	Tools     []ToolDef `json:"tools,omitempty"`
	MaxTokens int       `json:"max_tokens,omitempty"`
}

// ChatResponse is the provider-agnostic output of a chat completion.
type ChatResponse struct {
	Text      string     `json:"text"`
	TokensIn  int        `json:"tokens_in"`
	TokensOut int        `json:"tokens_out"`
	ToolCalls []ToolCall `json:"tool_calls,omitempty"`
}

// Provider is implemented by every LLM backend.
type Provider interface {
	// Name returns the canonical provider identifier (e.g. "anthropic", "openai").
	Name() string
	// Chat sends a chat completion request and returns the response.
	Chat(ctx context.Context, req ChatRequest) (ChatResponse, error)
	// Models returns the list of model identifiers the provider exposes.
	Models(ctx context.Context) ([]string, error)
}
