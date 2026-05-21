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

const geminiBaseURL = "https://generativelanguage.googleapis.com/v1beta"

// geminiProvider implements Provider for Google Gemini.
// Enabled when GEMINI_API_KEY is set.
type geminiProvider struct {
	apiKey     string
	httpClient *http.Client
}

func newGeminiProvider(apiKey string) *geminiProvider {
	return &geminiProvider{
		apiKey:     apiKey,
		httpClient: &http.Client{Timeout: 120 * time.Second},
	}
}

func (p *geminiProvider) Name() string { return "gemini" }

// ── wire types ────────────────────────────────────────────────────────────────

type geminiPart struct {
	Text string `json:"text"`
}

type geminiContent struct {
	Role  string       `json:"role"` // "user" | "model"
	Parts []geminiPart `json:"parts"`
}

// geminiToolFunctionDecl mirrors the FunctionDeclaration schema.
type geminiToolFunctionDecl struct {
	Name        string         `json:"name"`
	Description string         `json:"description"`
	Parameters  map[string]any `json:"parameters"`
}

type geminiTool struct {
	FunctionDeclarations []geminiToolFunctionDecl `json:"function_declarations"`
}

type geminiGenerationConfig struct {
	MaxOutputTokens int `json:"maxOutputTokens,omitempty"`
}

type geminiRequest struct {
	Contents         []geminiContent        `json:"contents"`
	Tools            []geminiTool           `json:"tools,omitempty"`
	GenerationConfig geminiGenerationConfig `json:"generationConfig,omitempty"`
	// System instruction is a Content with role "user" prepended, or use
	// systemInstruction field (v1beta supports it).
	SystemInstruction *geminiContent `json:"system_instruction,omitempty"`
}

type geminiUsageMetadata struct {
	PromptTokenCount     int `json:"promptTokenCount"`
	CandidatesTokenCount int `json:"candidatesTokenCount"`
}

type geminiFunctionCall struct {
	Name string         `json:"name"`
	Args map[string]any `json:"args"`
}

type geminiResponsePart struct {
	Text         string              `json:"text,omitempty"`
	FunctionCall *geminiFunctionCall `json:"functionCall,omitempty"`
}

type geminiCandidate struct {
	Content struct {
		Parts []geminiResponsePart `json:"parts"`
		Role  string               `json:"role"`
	} `json:"content"`
	FinishReason string `json:"finishReason"`
}

type geminiResponse struct {
	Candidates    []geminiCandidate   `json:"candidates"`
	UsageMetadata geminiUsageMetadata `json:"usageMetadata"`
}

// ── Chat ─────────────────────────────────────────────────────────────────────

func (p *geminiProvider) Chat(ctx context.Context, req ChatRequest) (ChatResponse, error) {
	// Gemini uses "user"/"model" roles; map "assistant" → "model".
	var contents []geminiContent
	var sysInst *geminiContent
	for _, m := range req.Messages {
		switch m.Role {
		case "system":
			sysInst = &geminiContent{
				Role:  "user",
				Parts: []geminiPart{{Text: m.Content}},
			}
		case "assistant":
			contents = append(contents, geminiContent{
				Role:  "model",
				Parts: []geminiPart{{Text: m.Content}},
			})
		default:
			contents = append(contents, geminiContent{
				Role:  m.Role,
				Parts: []geminiPart{{Text: m.Content}},
			})
		}
	}

	apiReq := geminiRequest{
		Contents:          contents,
		SystemInstruction: sysInst,
	}
	if req.MaxTokens > 0 {
		apiReq.GenerationConfig.MaxOutputTokens = req.MaxTokens
	}
	if len(req.Tools) > 0 {
		decls := make([]geminiToolFunctionDecl, 0, len(req.Tools))
		for _, t := range req.Tools {
			decls = append(decls, geminiToolFunctionDecl{
				Name:        t.Name,
				Description: t.Description,
				Parameters:  t.InputSchema,
			})
		}
		apiReq.Tools = []geminiTool{{FunctionDeclarations: decls}}
	}

	body, err := json.Marshal(apiReq)
	if err != nil {
		return ChatResponse{}, fmt.Errorf("gemini: Chat: marshal: %w", err)
	}

	// Model name goes in the URL path; key is a query param.
	url := fmt.Sprintf("%s/models/%s:generateContent?key=%s",
		geminiBaseURL, req.Model, p.apiKey)

	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(body))
	if err != nil {
		return ChatResponse{}, fmt.Errorf("gemini: Chat: build request: %w", err)
	}
	httpReq.Header.Set("Content-Type", "application/json")

	resp, err := p.httpClient.Do(httpReq)
	if err != nil {
		return ChatResponse{}, fmt.Errorf("gemini: Chat: http: %w", err)
	}
	defer resp.Body.Close()

	raw, _ := io.ReadAll(resp.Body)
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return ChatResponse{}, fmt.Errorf("gemini: Chat: HTTP %d: %s", resp.StatusCode, llmErrMsg(raw))
	}

	var out geminiResponse
	if err := json.Unmarshal(raw, &out); err != nil {
		return ChatResponse{}, fmt.Errorf("gemini: Chat: decode: %w", err)
	}

	var text string
	var toolCalls []ToolCall
	for _, cand := range out.Candidates {
		for i, part := range cand.Content.Parts {
			if part.FunctionCall != nil {
				toolCalls = append(toolCalls, ToolCall{
					ID:    fmt.Sprintf("%s_%d", part.FunctionCall.Name, i),
					Name:  part.FunctionCall.Name,
					Input: part.FunctionCall.Args,
				})
			} else {
				text += part.Text
			}
		}
	}

	return ChatResponse{
		Text:      text,
		TokensIn:  out.UsageMetadata.PromptTokenCount,
		TokensOut: out.UsageMetadata.CandidatesTokenCount,
		ToolCalls: toolCalls,
	}, nil
}

// ── Models ────────────────────────────────────────────────────────────────────

// Models returns a curated list of Gemini model identifiers.
//
// TODO: call GET /models?key=... to fetch the live list if dynamic discovery
// is needed. The static list below covers the current production models.
func (p *geminiProvider) Models(_ context.Context) ([]string, error) {
	return []string{
		"gemini-2.0-flash",
		"gemini-2.0-flash-lite",
		"gemini-2.5-pro",
		"gemini-2.5-flash",
	}, nil
}

// compile-time interface check
var _ Provider = (*geminiProvider)(nil)
