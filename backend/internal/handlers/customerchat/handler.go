package customerchat

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"

	"github.com/beepbite/backend/internal/auth"
	"github.com/beepbite/backend/internal/llm"
	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// systemPrompt is the persona/instruction set for the customer chat assistant.
const systemPrompt = `You are BeepBite's friendly customer assistant. You help customers:
- Search for nearby stores and restaurants
- Browse menus and item details
- Add items to their cart
- Confirm and track orders

Always be concise, helpful, and guide the customer through their order naturally.
When showing store or menu results, summarize the most relevant information.
When a customer wants to order, help them choose items, add to cart, then confirm.
After confirming an order, summarise what was ordered and the total.`

// maxToolRounds is the maximum number of tool-call → tool-result rounds per request.
// Prevents infinite loops in case the model keeps calling tools.
const maxToolRounds = 5

// ── Request / Response types ──────────────────────────────────────────────────

// ChatRequest is the inbound POST body.
type ChatRequest struct {
	// Messages is the full conversation history up to and including the latest
	// user turn. The client is responsible for accumulating history.
	Messages []llm.Message `json:"messages"`
	// ConversationID is an optional client-generated ID used for LLM usage
	// metering (stored in llm_messages.conversation_id).
	ConversationID string `json:"conversation_id,omitempty"`
}

// ChatResponse is the response body returned after all tool rounds resolve.
type ChatResponse struct {
	// Reply is the final assistant text to display to the user.
	Reply string `json:"reply"`
	// ToolResults contains structured data from tool calls, suitable for rendering
	// rich UI cards (store cards, cart view, order confirmation, etc.).
	ToolResults []ToolResult `json:"tool_results,omitempty"`
}

// ToolResult pairs a tool name with its parsed JSON payload for frontend rendering.
type ToolResult struct {
	Tool string `json:"tool"`
	Data any    `json:"data"`
}

// ── Handler ───────────────────────────────────────────────────────────────────

// Handler serves POST /chat.
type Handler struct {
	store  *Store
	router *llm.Router
}

// NewHandler constructs the Handler.
// router is the shared LLM router (constructed once at startup via llm.NewRouter).
func NewHandler(pool *pgxpool.Pool, router *llm.Router) *Handler {
	return &Handler{
		store:  NewStore(pool),
		router: router,
	}
}

// Mount registers POST /chat on r.
// r must be wrapped in auth.Middleware so that ClaimsFrom(ctx) is populated.
func (h *Handler) Mount(r chi.Router) {
	r.Post("/chat", h.chat)
}

// ── chat handler ──────────────────────────────────────────────────────────────

func (h *Handler) chat(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	// 1. Authenticate — require a valid JWT customer session.
	claims, ok := auth.ClaimsFrom(ctx)
	if !ok || claims == nil || claims.UserID == "" {
		writeErr(w, http.StatusUnauthorized, "unauthorized")
		return
	}

	// 2. Decode request body.
	var req ChatRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if len(req.Messages) == 0 {
		writeErr(w, http.StatusBadRequest, "messages must not be empty")
		return
	}

	// 3. Resolve customer record from JWT profile ID.
	customerID, orgID, err := h.store.CustomerByProfileID(ctx, claims.UserID)
	if err != nil {
		log.Printf("customerchat: CustomerByProfileID(%s): %v", claims.UserID, err)
		writeErr(w, http.StatusInternalServerError, "failed to resolve customer")
		return
	}
	if customerID == "" {
		// Customer has not yet been created (e.g. brand-new account). For the
		// purposes of read-only tools (search, menu, track) we can still proceed;
		// cart / order tools will fail gracefully with a meaningful message.
		// We use the profile ID itself as a stand-in — all cart writes check
		// customerID against customers.id (FK), so they will return DB errors
		// that the tool dispatcher converts to error JSON for the model to relay.
		customerID = claims.UserID
	}

	// 4. Pick LLM via router (CustomerChat task → cheapest tool-capable model).
	providerName, model, err := h.router.Pick(ctx, llm.CustomerChat, llm.Capabilities{
		Tools: true,
	})
	if err != nil {
		log.Printf("customerchat: router.Pick: %v", err)
		// Fall back: try any enabled provider.
		for _, p := range h.router.EnabledProviders() {
			providerName = p.Name()
			break
		}
		if providerName == "" {
			writeErr(w, http.StatusServiceUnavailable, "no LLM provider available")
			return
		}
		model = defaultModelFor(providerName)
	}

	provider, err := h.router.GetProvider(providerName)
	if err != nil {
		writeErr(w, http.StatusServiceUnavailable, "LLM provider unavailable")
		return
	}

	// 5. Build the initial message list, injecting the system prompt.
	messages := make([]llm.Message, 0, len(req.Messages)+1)
	messages = append(messages, llm.Message{Role: "system", Content: systemPrompt})
	messages = append(messages, req.Messages...)

	tools := toolDefs()
	var allToolResults []ToolResult
	var totalIn, totalOut int

	// 6. Tool loop: call the model, execute any tool calls, feed results back.
	for round := 0; round < maxToolRounds; round++ {
		llmReq := llm.ChatRequest{
			Messages:  messages,
			Model:     model,
			Tools:     tools,
			MaxTokens: 1024,
		}

		resp, err := provider.Chat(ctx, llmReq)
		if err != nil {
			log.Printf("customerchat: Chat: %v", err)
			writeErr(w, http.StatusBadGateway, fmt.Sprintf("LLM error: %v", err))
			return
		}
		totalIn += resp.TokensIn
		totalOut += resp.TokensOut

		// If there are no tool calls, the model has finished — return the text.
		if len(resp.ToolCalls) == 0 {
			// Meter usage.
			// TODO meter call — wire metering package when available.
			h.store.RecordLLMUsage(ctx, orgID, req.ConversationID, providerName, model, totalIn, totalOut)

			writeJSON(w, http.StatusOK, ChatResponse{
				Reply:       resp.Text,
				ToolResults: allToolResults,
			})
			return
		}

		// Append the assistant's tool-call turn to the conversation.
		// Encode tool calls as a JSON string so the next user turn is paired.
		assistantContent := resp.Text
		if len(resp.ToolCalls) > 0 {
			b, _ := json.Marshal(resp.ToolCalls)
			if assistantContent == "" {
				assistantContent = string(b)
			} else {
				assistantContent = assistantContent + "\n" + string(b)
			}
		}
		messages = append(messages, llm.Message{Role: "assistant", Content: assistantContent})

		// Execute each tool call and collect results.
		var toolResultParts []string
		for _, tc := range resp.ToolCalls {
			result, err := dispatchTool(ctx, h.store, customerID, tc)
			if err != nil {
				result = fmt.Sprintf(`{"error": %q}`, err.Error())
			}

			toolResultParts = append(toolResultParts, fmt.Sprintf(`{"id":%q,"name":%q,"result":%s}`, tc.ID, tc.Name, result))

			// Parse result for structured frontend rendering.
			var data any
			if jErr := json.Unmarshal([]byte(result), &data); jErr == nil {
				allToolResults = append(allToolResults, ToolResult{Tool: tc.Name, Data: data})
			}
		}

		// Feed tool results back as a user turn (standard tool-use pattern).
		toolMsg := "[" + joinStrings(toolResultParts, ",") + "]"
		messages = append(messages, llm.Message{Role: "user", Content: toolMsg})
	}

	// If we exhausted rounds without a final text response, return the last tool results.
	h.store.RecordLLMUsage(ctx, orgID, req.ConversationID, providerName, model, totalIn, totalOut)
	writeJSON(w, http.StatusOK, ChatResponse{
		Reply:       "I've processed your request. Here are the results.",
		ToolResults: allToolResults,
	})
}

// ── Helpers ───────────────────────────────────────────────────────────────────

func defaultModelFor(provider string) string {
	switch provider {
	case "anthropic":
		return "claude-haiku-4-5"
	case "openai":
		return "gpt-4o-mini"
	case "gemini":
		return "gemini-1.5-flash"
	default:
		return ""
	}
}

func joinStrings(parts []string, sep string) string {
	result := ""
	for i, p := range parts {
		if i > 0 {
			result += sep
		}
		result += p
	}
	return result
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func writeErr(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}
