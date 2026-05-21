// Package ownerassistant implements the owner AI assistant endpoint.
//
// POST /assistant (owner JWT, org-scoped):
//
//   - Direct commands parsed first (no LLM):
//     /86 <item>   — set is_86ed=true on the named item
//     /price <item> <amount> — update item price
//     /sales today — return today's daily summary
//     /help        — list available commands and tools
//
//   - Free-form messages fall through to the LLM router with a set of owner
//     tools: list_items, create_item, update_item, set_price, eighty_six_item,
//     un_eighty_six_item, list_categories, create_category, view_today_sales,
//     view_kds_status, view_low_stock, import_menu (produces a reviewable draft).
//
// All DB writes go through db.Scoped with the request's org scope so Postgres
// RLS restricts mutations to the caller's tenant. Every mutation writes an
// audit_log row via db.WithTxServiceRole.
package ownerassistant

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/beepbite/backend/internal/ai"
	"github.com/beepbite/backend/internal/auth"
	"github.com/beepbite/backend/internal/db"
	"github.com/beepbite/backend/internal/llm"
)

// Handler is the HTTP handler for the owner assistant.
type Handler struct {
	store *Store
	llmR  *llm.Router
	aiSvc *ai.Service
}

// NewHandler constructs a Handler.
// llmRouter may be nil — in that case free-form messages return a fallback
// response indicating that AI is not configured.
// aiSvc is used for menu-import vision; may be nil.
func NewHandler(pool *pgxpool.Pool, llmRouter *llm.Router, aiSvc *ai.Service) *Handler {
	return &Handler{
		store: NewStore(pool),
		llmR:  llmRouter,
		aiSvc: aiSvc,
	}
}

// Mount registers the assistant routes on r.
// r is expected to be inside an authenticated, org-scoped chi.Router group.
func (h *Handler) Mount(r chi.Router) {
	r.Post("/assistant", h.postAssistant)
	r.Post("/assistant/draft/{draft_id}/commit", h.commitDraft)
	r.Delete("/assistant/draft/{draft_id}", h.discardDraft)
	r.Get("/assistant/draft/{draft_id}", h.getDraft)
}

// ---------------------------------------------------------------------------
// Request / response shapes
// ---------------------------------------------------------------------------

type assistantRequest struct {
	Message    string `json:"message"`
	LocationID string `json:"location_id"`
}

type assistantResponse struct {
	Reply string        `json:"reply"`
	Draft *DraftSummary `json:"draft,omitempty"`
}

// DraftSummary is the minimal info returned to the client so they can
// render a review UI and then POST /assistant/draft/{id}/commit.
type DraftSummary struct {
	ID         string      `json:"id"`
	LocationID string      `json:"location_id"`
	Categories interface{} `json:"categories"`
	Items      interface{} `json:"items"`
}

// ---------------------------------------------------------------------------
// POST /assistant
// ---------------------------------------------------------------------------

func (h *Handler) postAssistant(w http.ResponseWriter, r *http.Request) {
	var req assistantRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid JSON")
		return
	}
	msg := strings.TrimSpace(req.Message)
	if msg == "" {
		writeErr(w, http.StatusBadRequest, "message is required")
		return
	}

	ctx := r.Context()
	scope := db.ScopeFromContext(ctx)
	orgID := scope.OrgID

	// Try direct-command parse first.
	if strings.HasPrefix(msg, "/") {
		reply, draft, err := h.handleDirectCommand(ctx, msg, req.LocationID, orgID)
		if err != nil {
			writeErr(w, http.StatusInternalServerError, err.Error())
			return
		}
		if reply != "" {
			writeJSON(w, http.StatusOK, assistantResponse{Reply: reply, Draft: draft})
			return
		}
		// "/" prefix but unknown command → fall through to LLM.
	}

	// Free-form: route through LLM with owner tools.
	reply, draft, err := h.handleLLM(ctx, msg, req.LocationID, orgID)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "LLM error: "+err.Error())
		return
	}
	writeJSON(w, http.StatusOK, assistantResponse{Reply: reply, Draft: draft})
}

// ---------------------------------------------------------------------------
// Direct-command parser
// ---------------------------------------------------------------------------

// handleDirectCommand parses /86, /price, /sales, /help.
// Returns ("", nil, nil) when the command is unrecognised (caller falls through).
func (h *Handler) handleDirectCommand(ctx context.Context, msg, locationID, orgID string) (string, *DraftSummary, error) {
	parts := strings.Fields(msg)
	if len(parts) == 0 {
		return "", nil, nil
	}
	cmd := strings.ToLower(parts[0])

	switch cmd {
	case "/86":
		if len(parts) < 2 {
			return "Usage: /86 <item name>", nil, nil
		}
		itemName := strings.Join(parts[1:], " ")
		item, err := h.store.FindItemByName(ctx, itemName)
		if errors.Is(err, ErrItemNotFound) {
			return fmt.Sprintf("Item %q not found.", itemName), nil, nil
		}
		if err != nil {
			return "", nil, err
		}
		if err := h.store.Set86(ctx, item.ID, orgID, true); err != nil {
			return "", nil, err
		}
		return fmt.Sprintf("Done! %q has been 86'd (marked unavailable).", item.Name), nil, nil

	case "/un86":
		if len(parts) < 2 {
			return "Usage: /un86 <item name>", nil, nil
		}
		itemName := strings.Join(parts[1:], " ")
		item, err := h.store.FindItemByName(ctx, itemName)
		if errors.Is(err, ErrItemNotFound) {
			return fmt.Sprintf("Item %q not found.", itemName), nil, nil
		}
		if err != nil {
			return "", nil, err
		}
		if err := h.store.Set86(ctx, item.ID, orgID, false); err != nil {
			return "", nil, err
		}
		return fmt.Sprintf("Done! %q is back in service.", item.Name), nil, nil

	case "/price":
		// /price <item name> <amount>
		if len(parts) < 3 {
			return "Usage: /price <item name> <amount>", nil, nil
		}
		// Last token is the price; everything in between is the item name.
		priceStr := parts[len(parts)-1]
		itemName := strings.Join(parts[1:len(parts)-1], " ")
		price, err := strconv.ParseFloat(priceStr, 64)
		if err != nil || price <= 0 {
			return fmt.Sprintf("Invalid price %q. Use a positive number.", priceStr), nil, nil
		}
		item, err := h.store.FindItemByName(ctx, itemName)
		if errors.Is(err, ErrItemNotFound) {
			return fmt.Sprintf("Item %q not found.", itemName), nil, nil
		}
		if err != nil {
			return "", nil, err
		}
		if err := h.store.SetPrice(ctx, item.ID, orgID, price); err != nil {
			return "", nil, err
		}
		return fmt.Sprintf("Done! %q price updated to %.2f.", item.Name, price), nil, nil

	case "/sales":
		row, err := h.store.TodaySales(ctx, locationID)
		if err != nil {
			return "", nil, err
		}
		reply := fmt.Sprintf(
			"Today's sales: %d orders | Gross R%.2f | Net R%.2f | Avg R%.2f per order",
			row.OrderCount,
			float64(row.GrossSalesCents)/100,
			float64(row.NetSalesCents)/100,
			float64(row.AvgOrderValueCents)/100,
		)
		return reply, nil, nil

	case "/help":
		help := strings.Join([]string{
			"Direct commands:",
			"  /86 <item>            — mark item as unavailable (86'd)",
			"  /un86 <item>          — bring item back",
			"  /price <item> <amt>   — update item price",
			"  /sales                — today's sales summary",
			"  /help                 — this message",
			"",
			"Or just type naturally, e.g.:",
			"  • 'list all items'",
			"  • 'create category Desserts'",
			"  • 'add Cheesecake at $12 in Desserts'",
			"  • 'how many tickets are on the KDS?'",
			"  • 'what items are low on stock?'",
			"  • 'import menu from this image: <base64>'",
		}, "\n")
		return help, nil, nil
	}

	return "", nil, nil // unrecognised command
}

// ---------------------------------------------------------------------------
// LLM tool loop
// ---------------------------------------------------------------------------

const systemPrompt = `You are a helpful store manager AI assistant for a restaurant/cafe owner using BeepBite POS.
You can help the owner manage their store through a set of tools.
Always be concise and action-oriented. When a tool call succeeds, confirm the action briefly.
For menu imports, always create a draft for the owner to review before committing.`

func (h *Handler) handleLLM(ctx context.Context, userMsg, locationID, orgID string) (string, *DraftSummary, error) {
	if h.llmR == nil {
		return "AI assistant is not configured (no LLM provider API keys found).", nil, nil
	}

	provName, model, err := h.llmR.Pick(ctx, llm.OwnerChat, llm.Capabilities{Tools: true})
	if errors.Is(err, llm.ErrNoProvider) {
		return "AI assistant is not available right now (no suitable model found).", nil, nil
	}
	if err != nil {
		return "", nil, fmt.Errorf("pick provider: %w", err)
	}

	prov, err := h.llmR.GetProvider(provName)
	if err != nil {
		return "", nil, fmt.Errorf("get provider: %w", err)
	}

	tools := ownerTools()
	messages := []llm.Message{
		{Role: "system", Content: systemPrompt},
		{Role: "user", Content: userMsg},
	}

	// Agentic loop: model may call tools repeatedly until it emits a text reply.
	const maxIter = 8
	var finalDraft *DraftSummary

	for i := 0; i < maxIter; i++ {
		resp, err := prov.Chat(ctx, llm.ChatRequest{
			Messages:  messages,
			Model:     model,
			Tools:     tools,
			MaxTokens: 1024,
		})
		if err != nil {
			return "", nil, fmt.Errorf("llm chat: %w", err)
		}

		// No tool calls → model produced its final answer.
		if len(resp.ToolCalls) == 0 {
			return resp.Text, finalDraft, nil
		}

		// Execute each tool call and collect results.
		toolResults := make([]string, 0, len(resp.ToolCalls))
		for _, tc := range resp.ToolCalls {
			result, draft, toolErr := h.executeTool(ctx, tc, locationID, orgID)
			if toolErr != nil {
				result = fmt.Sprintf("error: %v", toolErr)
			}
			toolResults = append(toolResults, fmt.Sprintf("[%s] %s", tc.Name, result))
			if draft != nil {
				finalDraft = draft
			}
		}

		// Append the assistant's tool-call turn and a synthetic user turn with results.
		messages = append(messages,
			llm.Message{Role: "assistant", Content: strings.Join(toolResults, "\n")},
			llm.Message{Role: "user", Content: "Tool results:\n" + strings.Join(toolResults, "\n")},
		)
	}

	return "I've processed your request.", finalDraft, nil
}

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------

func ownerTools() []llm.ToolDef {
	return []llm.ToolDef{
		{
			Name:        "list_items",
			Description: "List all active menu items.",
			InputSchema: map[string]any{
				"type":       "object",
				"properties": map[string]any{},
			},
		},
		{
			Name:        "create_item",
			Description: "Create a new menu item.",
			InputSchema: map[string]any{
				"type": "object",
				"properties": map[string]any{
					"location_id": map[string]any{"type": "string", "description": "Location UUID"},
					"category_id": map[string]any{"type": "string", "description": "Category UUID"},
					"name":        map[string]any{"type": "string"},
					"description": map[string]any{"type": "string"},
					"price":       map[string]any{"type": "number"},
				},
				"required": []string{"name", "price"},
			},
		},
		{
			Name:        "update_item",
			Description: "Update an existing menu item's name, description or price.",
			InputSchema: map[string]any{
				"type": "object",
				"properties": map[string]any{
					"item_id":     map[string]any{"type": "string", "description": "Item UUID"},
					"name":        map[string]any{"type": "string"},
					"description": map[string]any{"type": "string"},
					"price":       map[string]any{"type": "number"},
				},
				"required": []string{"item_id"},
			},
		},
		{
			Name:        "set_price",
			Description: "Set the price of an item by name.",
			InputSchema: map[string]any{
				"type": "object",
				"properties": map[string]any{
					"item_name": map[string]any{"type": "string"},
					"price":     map[string]any{"type": "number"},
				},
				"required": []string{"item_name", "price"},
			},
		},
		{
			Name:        "eighty_six_item",
			Description: "Mark an item as 86'd (unavailable) by name.",
			InputSchema: map[string]any{
				"type": "object",
				"properties": map[string]any{
					"item_name": map[string]any{"type": "string"},
				},
				"required": []string{"item_name"},
			},
		},
		{
			Name:        "un_eighty_six_item",
			Description: "Un-86 (re-enable) an item by name.",
			InputSchema: map[string]any{
				"type": "object",
				"properties": map[string]any{
					"item_name": map[string]any{"type": "string"},
				},
				"required": []string{"item_name"},
			},
		},
		{
			Name:        "list_categories",
			Description: "List all active menu categories.",
			InputSchema: map[string]any{
				"type":       "object",
				"properties": map[string]any{},
			},
		},
		{
			Name:        "create_category",
			Description: "Create a new menu category.",
			InputSchema: map[string]any{
				"type": "object",
				"properties": map[string]any{
					"location_id": map[string]any{"type": "string", "description": "Location UUID"},
					"name":        map[string]any{"type": "string"},
				},
				"required": []string{"name"},
			},
		},
		{
			Name:        "view_today_sales",
			Description: "View today's sales summary (order count, gross, net, avg).",
			InputSchema: map[string]any{
				"type":       "object",
				"properties": map[string]any{},
			},
		},
		{
			Name:        "view_kds_status",
			Description: "View the current KDS ticket status (fired, in_progress, ready).",
			InputSchema: map[string]any{
				"type": "object",
				"properties": map[string]any{
					"location_id": map[string]any{"type": "string"},
				},
			},
		},
		{
			Name:        "view_low_stock",
			Description: "List items that are low on inventory stock.",
			InputSchema: map[string]any{
				"type":       "object",
				"properties": map[string]any{},
			},
		},
		{
			Name:        "import_menu",
			Description: "Import a menu from a PDF (base64), image (base64), CSV text, or plain text. Produces a draft that the owner must review and commit.",
			InputSchema: map[string]any{
				"type": "object",
				"properties": map[string]any{
					"input_type":  map[string]any{"type": "string", "enum": []string{"text", "pdf", "images", "csv"}},
					"content":     map[string]any{"type": "string", "description": "base64 for pdf/image, raw text for text/csv"},
					"location_id": map[string]any{"type": "string"},
				},
				"required": []string{"input_type", "content"},
			},
		},
	}
}

// ---------------------------------------------------------------------------
// Tool executor
// ---------------------------------------------------------------------------

func (h *Handler) executeTool(ctx context.Context, tc llm.ToolCall, locationID, orgID string) (string, *DraftSummary, error) {
	in := tc.Input

	str := func(key string) string {
		if v, ok := in[key]; ok {
			if s, ok := v.(string); ok {
				return s
			}
		}
		return ""
	}
	num := func(key string) float64 {
		if v, ok := in[key]; ok {
			switch n := v.(type) {
			case float64:
				return n
			case json.Number:
				f, _ := n.Float64()
				return f
			}
		}
		return 0
	}

	switch tc.Name {
	case "list_items":
		items, err := h.store.ListItems(ctx)
		if err != nil {
			return "", nil, err
		}
		if len(items) == 0 {
			return "No items found.", nil, nil
		}
		var sb strings.Builder
		sb.WriteString(fmt.Sprintf("%d items:\n", len(items)))
		for _, it := range items {
			flag := ""
			if it.Is86ed {
				flag = " [86'd]"
			}
			sb.WriteString(fmt.Sprintf("- %s (%.2f)%s [id:%s]\n", it.Name, it.Price, flag, it.ID))
		}
		return sb.String(), nil, nil

	case "create_item":
		name := str("name")
		desc := str("description")
		price := num("price")
		catID := str("category_id")
		locID := firstNonEmpty(str("location_id"), locationID)
		if name == "" || price <= 0 || locID == "" || catID == "" {
			return "create_item requires: name, price > 0, location_id, category_id", nil, nil
		}
		id, err := h.store.CreateItem(ctx, orgID, locID, catID, name, desc, price)
		if err != nil {
			return "", nil, err
		}
		return fmt.Sprintf("Created item %q (id: %s)", name, id), nil, nil

	case "update_item":
		itemID := str("item_id")
		if itemID == "" {
			return "update_item requires item_id", nil, nil
		}
		name := str("name")
		desc := str("description")
		price := num("price")
		if err := h.store.UpdateItem(ctx, orgID, itemID, name, desc, price); errors.Is(err, ErrItemNotFound) {
			return "Item not found.", nil, nil
		} else if err != nil {
			return "", nil, err
		}
		return fmt.Sprintf("Updated item %s.", itemID), nil, nil

	case "set_price":
		itemName := str("item_name")
		price := num("price")
		if itemName == "" || price <= 0 {
			return "set_price requires item_name and price > 0", nil, nil
		}
		item, err := h.store.FindItemByName(ctx, itemName)
		if errors.Is(err, ErrItemNotFound) {
			return fmt.Sprintf("Item %q not found.", itemName), nil, nil
		}
		if err != nil {
			return "", nil, err
		}
		if err := h.store.SetPrice(ctx, item.ID, orgID, price); err != nil {
			return "", nil, err
		}
		return fmt.Sprintf("Price of %q updated to %.2f.", item.Name, price), nil, nil

	case "eighty_six_item":
		itemName := str("item_name")
		item, err := h.store.FindItemByName(ctx, itemName)
		if errors.Is(err, ErrItemNotFound) {
			return fmt.Sprintf("Item %q not found.", itemName), nil, nil
		}
		if err != nil {
			return "", nil, err
		}
		if err := h.store.Set86(ctx, item.ID, orgID, true); err != nil {
			return "", nil, err
		}
		return fmt.Sprintf("%q has been 86'd.", item.Name), nil, nil

	case "un_eighty_six_item":
		itemName := str("item_name")
		item, err := h.store.FindItemByName(ctx, itemName)
		if errors.Is(err, ErrItemNotFound) {
			return fmt.Sprintf("Item %q not found.", itemName), nil, nil
		}
		if err != nil {
			return "", nil, err
		}
		if err := h.store.Set86(ctx, item.ID, orgID, false); err != nil {
			return "", nil, err
		}
		return fmt.Sprintf("%q is back in service.", item.Name), nil, nil

	case "list_categories":
		cats, err := h.store.ListCategories(ctx)
		if err != nil {
			return "", nil, err
		}
		if len(cats) == 0 {
			return "No categories found.", nil, nil
		}
		var sb strings.Builder
		sb.WriteString(fmt.Sprintf("%d categories:\n", len(cats)))
		for _, c := range cats {
			sb.WriteString(fmt.Sprintf("- %s [id:%s]\n", c.Name, c.ID))
		}
		return sb.String(), nil, nil

	case "create_category":
		name := str("name")
		locID := firstNonEmpty(str("location_id"), locationID)
		if name == "" || locID == "" {
			return "create_category requires name and location_id", nil, nil
		}
		id, err := h.store.CreateCategory(ctx, orgID, locID, name)
		if err != nil {
			return "", nil, err
		}
		return fmt.Sprintf("Created category %q (id: %s)", name, id), nil, nil

	case "view_today_sales":
		row, err := h.store.TodaySales(ctx, locationID)
		if err != nil {
			return "", nil, err
		}
		return fmt.Sprintf("Today: %d orders | Gross R%.2f | Net R%.2f | Avg R%.2f",
			row.OrderCount,
			float64(row.GrossSalesCents)/100,
			float64(row.NetSalesCents)/100,
			float64(row.AvgOrderValueCents)/100,
		), nil, nil

	case "view_kds_status":
		locID := firstNonEmpty(str("location_id"), locationID)
		if locID == "" {
			return "view_kds_status requires location_id", nil, nil
		}
		row, err := h.store.KDSStatus(ctx, locID)
		if err != nil {
			return "", nil, err
		}
		return fmt.Sprintf("KDS: %d fired | %d in progress | %d ready",
			row.Pending, row.InProgress, row.Done), nil, nil

	case "view_low_stock":
		items, err := h.store.LowStockItems(ctx)
		if err != nil {
			return "", nil, err
		}
		if len(items) == 0 {
			return "No low-stock items.", nil, nil
		}
		var sb strings.Builder
		sb.WriteString(fmt.Sprintf("%d low-stock items:\n", len(items)))
		for _, it := range items {
			sb.WriteString(fmt.Sprintf("- %s: %.1f units\n", it.ItemName, it.Stock))
		}
		return sb.String(), nil, nil

	case "import_menu":
		return h.executeImportMenu(ctx, tc, locationID, orgID)
	}

	return fmt.Sprintf("unknown tool %q", tc.Name), nil, nil
}

// executeImportMenu calls the existing ai.Service to generate a menu draft.
func (h *Handler) executeImportMenu(ctx context.Context, tc llm.ToolCall, locationID, orgID string) (string, *DraftSummary, error) {
	if h.aiSvc == nil {
		return "menu import is not available (AI service not configured)", nil, nil
	}
	in := tc.Input
	str := func(key string) string {
		if v, ok := in[key]; ok {
			if s, ok := v.(string); ok {
				return s
			}
		}
		return ""
	}

	inputType := str("input_type")
	content := str("content")
	locID := firstNonEmpty(str("location_id"), locationID)

	if inputType == "" || content == "" {
		return "import_menu requires input_type and content", nil, nil
	}
	if locID == "" {
		return "import_menu requires location_id", nil, nil
	}

	// Normalize csv→text (Gemini handles text).
	if inputType == "csv" {
		inputType = "text"
	}

	contentJSON, _ := json.Marshal(content)
	req := &ai.GenerateRequest{
		Action:     "generate",
		LocationID: locID,
		Input: ai.MenuInput{
			Type:    inputType,
			Content: contentJSON,
		},
	}

	loc, err := h.aiSvc.GetLocation(ctx, locID)
	if err != nil {
		return fmt.Sprintf("location not found: %v", err), nil, nil
	}

	genResp, err := h.aiSvc.HandleGenerate(ctx, req, loc)
	if err != nil {
		return fmt.Sprintf("menu generation failed: %v", err), nil, nil
	}

	// Save as a reviewable draft.
	draft := &Draft{
		LocationID: locID,
		OrgID:      orgID,
		Categories: genResp.Categories,
		Items:      genResp.Suggestions,
	}
	draftID := SaveDraft(draft)

	summary := &DraftSummary{
		ID:         draftID,
		LocationID: locID,
		Categories: genResp.Categories,
		Items:      genResp.Suggestions,
	}
	return fmt.Sprintf("Menu import draft created (id: %s). Review and commit via /assistant/draft/%s/commit.", draftID, draftID), summary, nil
}

// ---------------------------------------------------------------------------
// Draft endpoints
// ---------------------------------------------------------------------------

func (h *Handler) getDraft(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "draft_id")
	d := GetDraft(id)
	if d == nil {
		writeErr(w, http.StatusNotFound, "draft not found or expired")
		return
	}
	// Verify org ownership.
	scope := db.ScopeFromContext(r.Context())
	if scope.OrgID != "" && d.OrgID != "" && scope.OrgID != d.OrgID {
		writeErr(w, http.StatusNotFound, "draft not found or expired")
		return
	}
	writeJSON(w, http.StatusOK, DraftSummary{
		ID:         d.ID,
		LocationID: d.LocationID,
		Categories: d.Categories,
		Items:      d.Items,
	})
}

// commitDraft delegates to the existing ai.Service HandleConfirm logic.
// Body: { "decisions": [...ai.UserDecision...] }
func (h *Handler) commitDraft(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "draft_id")
	d := GetDraft(id)
	if d == nil {
		writeErr(w, http.StatusNotFound, "draft not found or expired")
		return
	}
	scope := db.ScopeFromContext(r.Context())
	if scope.OrgID != "" && d.OrgID != "" && scope.OrgID != d.OrgID {
		writeErr(w, http.StatusNotFound, "draft not found or expired")
		return
	}

	if h.aiSvc == nil {
		writeErr(w, http.StatusServiceUnavailable, "AI service not configured")
		return
	}

	var body struct {
		Decisions []ai.UserDecision `json:"decisions"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid JSON")
		return
	}

	loc, err := h.aiSvc.GetLocation(r.Context(), d.LocationID)
	if err != nil {
		writeErr(w, http.StatusBadRequest, "location not found")
		return
	}

	confirmReq := &ai.ConfirmRequest{
		Action:     "confirm",
		LocationID: d.LocationID,
		Decisions:  body.Decisions,
	}
	resp, err := h.aiSvc.HandleConfirm(r.Context(), confirmReq, loc)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}

	// Remove the draft on successful commit.
	DeleteDraft(id)
	writeJSON(w, http.StatusOK, resp)
}

func (h *Handler) discardDraft(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "draft_id")
	d := GetDraft(id)
	if d == nil {
		writeErr(w, http.StatusNotFound, "draft not found or expired")
		return
	}
	scope := db.ScopeFromContext(r.Context())
	if scope.OrgID != "" && d.OrgID != "" && scope.OrgID != d.OrgID {
		writeErr(w, http.StatusNotFound, "draft not found or expired")
		return
	}
	DeleteDraft(id)
	writeJSON(w, http.StatusOK, map[string]any{"deleted": true})
}

// ---------------------------------------------------------------------------
// Auth guard helper
// ---------------------------------------------------------------------------

// RequireOwner checks that the caller is an org member (OrgScope has at least
// one membership). Returns true when allowed; writes 403 and returns false when not.
// This is belt-and-suspenders: RequireOrgScope already gates the router group.
func RequireOwner(ctx context.Context, w http.ResponseWriter) bool {
	scope := auth.OrgScopeFrom(ctx)
	if len(scope.Memberships) == 0 {
		writeErr(w, http.StatusForbidden, "owner membership required")
		return false
	}
	return true
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

func firstNonEmpty(vals ...string) string {
	for _, v := range vals {
		if v != "" {
			return v
		}
	}
	return ""
}

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(v)
}

func writeErr(w http.ResponseWriter, code int, msg string) {
	writeJSON(w, code, map[string]string{"error": msg})
}
