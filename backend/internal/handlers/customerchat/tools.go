package customerchat

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/beepbite/backend/internal/llm"
)

// ── Tool definitions ──────────────────────────────────────────────────────────

// toolDefs returns the LLM tool registry that the customer chat assistant can call.
func toolDefs() []llm.ToolDef {
	return []llm.ToolDef{
		{
			Name:        "search_stores",
			Description: "Search for stores/restaurants by keyword and/or location. Returns a list of matching stores.",
			InputSchema: map[string]any{
				"type": "object",
				"properties": map[string]any{
					"q": map[string]any{
						"type":        "string",
						"description": "Keyword to search store names (optional)",
					},
					"lat": map[string]any{
						"type":        "number",
						"description": "Latitude for geo-search (optional)",
					},
					"lng": map[string]any{
						"type":        "number",
						"description": "Longitude for geo-search (optional)",
					},
					"radius_km": map[string]any{
						"type":        "number",
						"description": "Search radius in km when lat/lng provided (default 10)",
					},
				},
			},
		},
		{
			Name:        "get_store_menu",
			Description: "Fetch the full menu (categories + items) for a store, identified by its URL slug.",
			InputSchema: map[string]any{
				"type": "object",
				"properties": map[string]any{
					"slug": map[string]any{
						"type":        "string",
						"description": "The store's URL slug (from search results)",
					},
				},
				"required": []string{"slug"},
			},
		},
		{
			Name:        "get_item_details",
			Description: "Get the full details for a menu item including available modifiers/variations.",
			InputSchema: map[string]any{
				"type": "object",
				"properties": map[string]any{
					"item_id": map[string]any{
						"type":        "string",
						"description": "UUID of the menu item",
					},
				},
				"required": []string{"item_id"},
			},
		},
		{
			Name:        "add_to_cart",
			Description: "Add a menu item to the customer's cart. Specify selected modifiers as a list of modifier UUIDs (the 'id' values from get_item_details variations options).",
			InputSchema: map[string]any{
				"type": "object",
				"properties": map[string]any{
					"item_id": map[string]any{
						"type":        "string",
						"description": "UUID of the menu item to add",
					},
					"qty": map[string]any{
						"type":        "integer",
						"description": "Quantity to add (default 1)",
						"minimum":     1,
					},
					"modifier_ids": map[string]any{
						"type":        "array",
						"description": "List of selected modifier UUIDs (option ids from get_item_details)",
						"items": map[string]any{
							"type": "string",
						},
					},
				},
				"required": []string{"item_id"},
			},
		},
		{
			Name:        "view_cart",
			Description: "Show the current contents of the customer's cart including item names, quantities, and subtotal.",
			InputSchema: map[string]any{
				"type":       "object",
				"properties": map[string]any{},
			},
		},
		{
			Name:        "confirm_order",
			Description: "Convert the current cart into a confirmed order. The cart is cleared after successful order creation.",
			InputSchema: map[string]any{
				"type":       "object",
				"properties": map[string]any{},
			},
		},
		{
			Name:        "track_order",
			Description: "Check the status of an order using its tracking token.",
			InputSchema: map[string]any{
				"type": "object",
				"properties": map[string]any{
					"token": map[string]any{
						"type":        "string",
						"description": "The order tracking token",
					},
				},
				"required": []string{"token"},
			},
		},
	}
}

// ── Tool dispatcher ───────────────────────────────────────────────────────────

// dispatchTool executes a single tool call and returns a JSON-encoded result string.
func dispatchTool(ctx context.Context, store *Store, customerID string, call llm.ToolCall) (string, error) {
	switch call.Name {
	case "search_stores":
		return toolSearchStores(ctx, store, call.Input)
	case "get_store_menu":
		return toolGetStoreMenu(ctx, store, call.Input)
	case "get_item_details":
		return toolGetItemDetails(ctx, store, call.Input)
	case "add_to_cart":
		return toolAddToCart(ctx, store, customerID, call.Input)
	case "view_cart":
		return toolViewCart(ctx, store, customerID)
	case "confirm_order":
		return toolConfirmOrder(ctx, store, customerID)
	case "track_order":
		return toolTrackOrder(ctx, store, call.Input)
	default:
		return "", fmt.Errorf("unknown tool: %s", call.Name)
	}
}

// ── Individual tool functions ─────────────────────────────────────────────────

func toolSearchStores(ctx context.Context, store *Store, input map[string]any) (string, error) {
	q, _ := input["q"].(string)
	var lat, lng *float64
	var radiusKM float64 = 10
	if v, ok := input["lat"].(float64); ok {
		lat = &v
	}
	if v, ok := input["lng"].(float64); ok {
		lng = &v
	}
	if v, ok := input["radius_km"].(float64); ok && v > 0 {
		radiusKM = v
	}

	results, err := store.SearchStores(ctx, q, lat, lng, radiusKM)
	if err != nil {
		return jsonErr(err)
	}
	return jsonResult(map[string]any{"stores": results, "count": len(results)})
}

func toolGetStoreMenu(ctx context.Context, store *Store, input map[string]any) (string, error) {
	slug, _ := input["slug"].(string)
	if slug == "" {
		return jsonErr(fmt.Errorf("slug is required"))
	}
	categories, err := store.GetStoreMenu(ctx, slug)
	if err != nil {
		return jsonErr(err)
	}
	return jsonResult(map[string]any{"categories": categories})
}

func toolGetItemDetails(ctx context.Context, store *Store, input map[string]any) (string, error) {
	itemID, _ := input["item_id"].(string)
	if itemID == "" {
		return jsonErr(fmt.Errorf("item_id is required"))
	}
	det, err := store.GetItemDetails(ctx, itemID)
	if err != nil {
		return jsonErr(err)
	}
	return jsonResult(det)
}

func toolAddToCart(ctx context.Context, store *Store, customerID string, input map[string]any) (string, error) {
	itemID, _ := input["item_id"].(string)
	if itemID == "" {
		return jsonErr(fmt.Errorf("item_id is required"))
	}
	qty := 1
	if v, ok := input["qty"].(float64); ok && v >= 1 {
		qty = int(v)
	}
	var modifierIDs []string
	if arr, ok := input["modifier_ids"].([]any); ok {
		for _, v := range arr {
			if sv, ok := v.(string); ok && sv != "" {
				modifierIDs = append(modifierIDs, sv)
			}
		}
	}

	if err := store.AddToCart(ctx, customerID, itemID, qty, modifierIDs); err != nil {
		return jsonErr(err)
	}
	return jsonResult(map[string]any{"success": true, "message": "Item added to cart"})
}

func toolViewCart(ctx context.Context, store *Store, customerID string) (string, error) {
	cart, err := store.ViewCart(ctx, customerID)
	if err != nil {
		return jsonErr(err)
	}
	return jsonResult(cart)
}

func toolConfirmOrder(ctx context.Context, store *Store, customerID string) (string, error) {
	conf, err := store.ConfirmOrder(ctx, customerID)
	if err != nil {
		return jsonErr(err)
	}
	return jsonResult(conf)
}

func toolTrackOrder(ctx context.Context, store *Store, input map[string]any) (string, error) {
	token, _ := input["token"].(string)
	if token == "" {
		return jsonErr(fmt.Errorf("token is required"))
	}
	status, err := store.TrackOrder(ctx, token)
	if err != nil {
		return jsonErr(err)
	}
	return jsonResult(status)
}

// ── JSON helpers ──────────────────────────────────────────────────────────────

func jsonResult(v any) (string, error) {
	b, err := json.Marshal(v)
	if err != nil {
		return "", err
	}
	return string(b), nil
}

func jsonErr(err error) (string, error) {
	b, _ := json.Marshal(map[string]string{"error": err.Error()})
	return string(b), nil // return nil so the loop continues with the error message
}
