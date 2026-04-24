package ai

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"net/http"
	"regexp"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

const geminiURL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent"

type Service struct {
	pool       *pgxpool.Pool
	apiKey     string
	httpClient *http.Client
}

func New(pool *pgxpool.Pool, openaiKey string) *Service {
	return &Service{
		pool:       pool,
		apiKey:     openaiKey,
		httpClient: &http.Client{Timeout: 120 * time.Second},
	}
}

// --- Types mirroring the TS contract ---

type MenuInput struct {
	Type           string          `json:"type"`
	Content        json.RawMessage `json:"content"`
	Filename       string          `json:"filename,omitempty"`
	AdditionalText string          `json:"additional_text,omitempty"`
}

type VariationOption struct {
	Name          string  `json:"name"`
	PriceModifier float64 `json:"price_modifier"`
	IsDefault     bool    `json:"is_default"`
}

type ItemVariation struct {
	Name       string            `json:"name"`
	IsRequired bool              `json:"is_required"`
	Options    []VariationOption `json:"options"`
}

type MenuItem struct {
	Name            string          `json:"name"`
	Description     string          `json:"description,omitempty"`
	Price           float64         `json:"price"`
	CategoryPath    []string        `json:"category_path"`
	PreparationTime int             `json:"preparation_time,omitempty"`
	Variations      []ItemVariation `json:"variations,omitempty"`
}

type MenuCategory struct {
	Name          string         `json:"name"`
	Description   string         `json:"description,omitempty"`
	Subcategories []MenuCategory `json:"subcategories,omitempty"`
	Items         []MenuItem     `json:"items,omitempty"`
}

type ProcessedMenu struct {
	Categories []MenuCategory `json:"categories"`
	Items      []MenuItem     `json:"items"`
}

type ExistingItem struct {
	ID              string          `json:"id"`
	Name            string          `json:"name"`
	Description     string          `json:"description"`
	Price           float64         `json:"price"`
	CategoryID      string          `json:"category_id"`
	CategoryName    string          `json:"category_name"`
	CategoryPath    []string        `json:"category_path"`
	PreparationTime int             `json:"preparation_time"`
	Variations      []ItemVariation `json:"variations"`
}

type SimilarityMatch struct {
	ExistingItem    ExistingItem `json:"existing_item"`
	SimilarityScore float64      `json:"similarity_score"`
	Differences     []string     `json:"differences"`
	Reasons         []string     `json:"reasons"`
}

type ItemSuggestion struct {
	GeneratedItem        MenuItem          `json:"generated_item"`
	SimilarItems         []SimilarityMatch `json:"similar_items"`
	Recommendation       string            `json:"recommendation"`
	RecommendationReason string            `json:"recommendation_reason"`
}

type UserDecision struct {
	GeneratedItem  MenuItem  `json:"generated_item"`
	Action         string    `json:"action"`
	ExistingItemID string    `json:"existing_item_id,omitempty"`
	Modifications  *MenuItem `json:"modifications,omitempty"`
}

type GenerateRequest struct {
	Action     string    `json:"action"`
	LocationID string    `json:"location_id"`
	Input      MenuInput `json:"input"`
}

type ConfirmRequest struct {
	Action     string         `json:"action"`
	LocationID string         `json:"location_id"`
	Decisions  []UserDecision `json:"decisions"`
}

type GenerateStats struct {
	GeneratedItems int `json:"generated_items"`
	ExistingItems  int `json:"existing_items"`
	Suggestions    int `json:"suggestions"`
	Categories     int `json:"categories"`
}

type GenerateResponse struct {
	Success     bool             `json:"success"`
	Action      string           `json:"action"`
	Message     string           `json:"message"`
	InputType   string           `json:"input_type"`
	Stats       GenerateStats    `json:"stats"`
	Suggestions []ItemSuggestion `json:"suggestions"`
	Categories  []MenuCategory   `json:"categories"`
}

type ConfirmStats struct {
	ItemsUpdated       int `json:"items_updated"`
	ItemsCreated       int `json:"items_created"`
	ItemsSkipped       int `json:"items_skipped"`
	ItemsFailed        int `json:"items_failed"`
	ItemsSuccessful    int `json:"items_successful"`
	CategoriesCreated  int `json:"categories_created"`
	VariationsCreated  int `json:"variations_created"`
}

type ConfirmResults struct {
	ItemsUpdated      int            `json:"itemsUpdated"`
	ItemsCreated      int            `json:"itemsCreated"`
	ItemsSkipped      int            `json:"itemsSkipped"`
	CategoriesCreated int            `json:"categoriesCreated"`
	VariationsCreated int            `json:"variationsCreated"`
	SuccessfulItems   []UserDecision `json:"successful_items"`
	FailedItems       []UserDecision `json:"failed_items"`
}

type ConfirmResponse struct {
	Success         bool           `json:"success"`
	Action          string         `json:"action"`
	Message         string         `json:"message"`
	HasFailures     bool           `json:"has_failures"`
	Stats           ConfirmStats   `json:"stats"`
	SuccessfulItems []UserDecision `json:"successful_items"`
	FailedItems     []UserDecision `json:"failed_items"`
	Results         ConfirmResults `json:"results"`
}

type ErrorResponse struct {
	Success   bool   `json:"success"`
	Error     string `json:"error"`
	ErrorCode string `json:"error_code"`
}

type Location struct {
	ID   string
	Name string
}

// --- Error sentinels to classify responses ---

type ServiceError struct {
	HTTPStatus int
	Code       string
	Message    string
}

func (e *ServiceError) Error() string { return e.Message }

func svcErr(status int, code, msg string) *ServiceError {
	return &ServiceError{HTTPStatus: status, Code: code, Message: msg}
}

// --- Entry points ---

func (s *Service) GetLocation(ctx context.Context, locationID string) (*Location, error) {
	var loc Location
	err := s.pool.QueryRow(ctx,
		`SELECT id, name FROM locations WHERE id = $1`, locationID,
	).Scan(&loc.ID, &loc.Name)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, svcErr(http.StatusBadRequest, "LOCATION_NOT_FOUND", "Location not found")
	}
	if err != nil {
		return nil, svcErr(http.StatusBadRequest, "LOCATION_NOT_FOUND", "Location not found or access denied")
	}
	return &loc, nil
}

func (s *Service) HandleGenerate(ctx context.Context, req *GenerateRequest, loc *Location) (*GenerateResponse, error) {
	input := req.Input
	if len(input.Content) == 0 {
		return nil, svcErr(http.StatusBadRequest, "MISSING_CONTENT", "No content provided in input")
	}

	switch input.Type {
	case "images":
		var imgs []string
		if err := json.Unmarshal(input.Content, &imgs); err != nil || len(imgs) == 0 {
			return nil, svcErr(http.StatusBadRequest, "INVALID_IMAGES", "No images provided or invalid image format")
		}
	case "text":
		var txt string
		if err := json.Unmarshal(input.Content, &txt); err != nil || strings.TrimSpace(txt) == "" {
			return nil, svcErr(http.StatusBadRequest, "INVALID_TEXT", "No text content provided or invalid text format")
		}
	case "pdf":
		var pdf string
		if err := json.Unmarshal(input.Content, &pdf); err != nil || pdf == "" {
			return nil, svcErr(http.StatusBadRequest, "INVALID_PDF", "No PDF content provided or invalid PDF format")
		}
	default:
		return nil, svcErr(http.StatusBadRequest, "INVALID_INPUT", fmt.Sprintf("Unsupported input type: %s", input.Type))
	}

	if s.apiKey == "" {
		return nil, svcErr(http.StatusInternalServerError, "MISSING_API_KEY", "AI service configuration error. Please contact support.")
	}

	processed, err := s.processMenuInput(ctx, input)
	if err != nil {
		msg := err.Error()
		if strings.Contains(msg, "Gemini API error") {
			return nil, svcErr(http.StatusServiceUnavailable, "AI_SERVICE_ERROR", "AI service is temporarily unavailable. Please try again in a few moments.")
		}
		if strings.Contains(msg, "Failed to parse menu data") {
			return nil, svcErr(http.StatusBadRequest, "PROCESSING_ERROR", "Unable to process the menu content. Please try with clearer images or better formatted text.")
		}
		return nil, svcErr(http.StatusInternalServerError, "GENERATION_ERROR", "Failed to generate menu. Please try again.")
	}

	existing, err := s.getExistingItems(ctx, req.LocationID)
	if err != nil {
		return nil, svcErr(http.StatusInternalServerError, "GENERATION_ERROR", "Failed to generate menu. Please try again.")
	}

	suggestions := generateSuggestions(processed.Items, existing)

	return &GenerateResponse{
		Success:   true,
		Action:    "generate",
		Message:   fmt.Sprintf("Menu generated successfully for %s", loc.Name),
		InputType: input.Type,
		Stats: GenerateStats{
			GeneratedItems: len(processed.Items),
			ExistingItems:  len(existing),
			Suggestions:    len(suggestions),
			Categories:     len(processed.Categories),
		},
		Suggestions: suggestions,
		Categories:  processed.Categories,
	}, nil
}

func (s *Service) HandleConfirm(ctx context.Context, req *ConfirmRequest, loc *Location) (*ConfirmResponse, error) {
	if req.Decisions == nil {
		return nil, svcErr(http.StatusBadRequest, "MISSING_DECISIONS", "No decisions provided")
	}
	if len(req.Decisions) == 0 {
		return nil, svcErr(http.StatusBadRequest, "EMPTY_DECISIONS", "No decisions provided")
	}

	results, err := s.processUserDecisions(ctx, req.LocationID, req.Decisions)
	if err != nil {
		msg := err.Error()
		if strings.Contains(msg, "permission") {
			return nil, svcErr(http.StatusForbidden, "PERMISSION_DENIED", "Permission denied. Please check your access rights.")
		}
		if strings.Contains(msg, "connection") || strings.Contains(msg, "timeout") {
			return nil, svcErr(http.StatusServiceUnavailable, "DATABASE_CONNECTION_ERROR", "Database connection failed. Please try again.")
		}
		return nil, svcErr(http.StatusInternalServerError, "UPDATE_ERROR", "Failed to update menu. Please try again.")
	}

	hasFailures := len(results.FailedItems) > 0
	message := fmt.Sprintf("Menu updated successfully for %s", loc.Name)
	if hasFailures {
		message = fmt.Sprintf("Menu partially updated for %s. %d items failed validation.", loc.Name, len(results.FailedItems))
	}

	return &ConfirmResponse{
		Success:     true,
		Action:      "confirm",
		Message:     message,
		HasFailures: hasFailures,
		Stats: ConfirmStats{
			ItemsUpdated:      results.ItemsUpdated,
			ItemsCreated:      results.ItemsCreated,
			ItemsSkipped:      results.ItemsSkipped,
			ItemsFailed:       len(results.FailedItems),
			ItemsSuccessful:   len(results.SuccessfulItems),
			CategoriesCreated: results.CategoriesCreated,
			VariationsCreated: results.VariationsCreated,
		},
		SuccessfulItems: results.SuccessfulItems,
		FailedItems:     results.FailedItems,
		Results:         *results,
	}, nil
}

// --- DB: existing items ---

func (s *Service) getExistingItems(ctx context.Context, locationID string) ([]ExistingItem, error) {
	rows, err := s.pool.Query(ctx, `
SELECT i.id, i.name, COALESCE(i.description, ''), i.price,
       COALESCE(i.preparation_time, 0),
       i.category_id, c.name
FROM items i
JOIN categories c ON c.id = i.category_id
WHERE i.location_id = $1 AND i.is_active = true
`, locationID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []ExistingItem
	for rows.Next() {
		var e ExistingItem
		if err := rows.Scan(&e.ID, &e.Name, &e.Description, &e.Price, &e.PreparationTime, &e.CategoryID, &e.CategoryName); err != nil {
			return nil, err
		}
		e.CategoryPath = []string{e.CategoryName}
		e.Variations = []ItemVariation{}
		out = append(out, e)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	for i := range out {
		vRows, err := s.pool.Query(ctx, `
SELECT iv.id, iv.name, iv.is_required
FROM item_variations iv
WHERE iv.item_id = $1
`, out[i].ID)
		if err != nil {
			continue
		}
		type vrow struct {
			id         string
			name       string
			isRequired bool
		}
		var vrows []vrow
		for vRows.Next() {
			var v vrow
			if err := vRows.Scan(&v.id, &v.name, &v.isRequired); err == nil {
				vrows = append(vrows, v)
			}
		}
		vRows.Close()

		for _, v := range vrows {
			variation := ItemVariation{Name: v.name, IsRequired: v.isRequired, Options: []VariationOption{}}
			optRows, err := s.pool.Query(ctx, `
SELECT name, COALESCE(price_modifier, 0), COALESCE(is_default, false)
FROM item_variation_options
WHERE variation_id = $1
`, v.id)
			if err == nil {
				for optRows.Next() {
					var o VariationOption
					if err := optRows.Scan(&o.Name, &o.PriceModifier, &o.IsDefault); err == nil {
						variation.Options = append(variation.Options, o)
					}
				}
				optRows.Close()
			}
			out[i].Variations = append(out[i].Variations, variation)
		}
	}

	return out, nil
}

// --- Similarity / suggestions ---

func generateSuggestions(generated []MenuItem, existing []ExistingItem) []ItemSuggestion {
	out := make([]ItemSuggestion, 0, len(generated))
	for _, g := range generated {
		var similar []SimilarityMatch
		for _, e := range existing {
			sim := calculateSimilarity(g, e)
			if sim.SimilarityScore >= 0.6 {
				similar = append(similar, sim)
			}
		}
		// sort desc by score
		for i := 1; i < len(similar); i++ {
			for j := i; j > 0 && similar[j].SimilarityScore > similar[j-1].SimilarityScore; j-- {
				similar[j], similar[j-1] = similar[j-1], similar[j]
			}
		}
		action, reason := getRecommendation(similar)
		top := similar
		if len(top) > 3 {
			top = top[:3]
		}
		out = append(out, ItemSuggestion{
			GeneratedItem:        g,
			SimilarItems:         top,
			Recommendation:       action,
			RecommendationReason: reason,
		})
	}
	return out
}

func calculateSimilarity(g MenuItem, e ExistingItem) SimilarityMatch {
	var score float64
	var differences []string
	var reasons []string

	nameSim := stringSimilarity(g.Name, e.Name)
	score += nameSim * 0.5
	if nameSim > 0.7 {
		reasons = append(reasons, fmt.Sprintf("Name similarity: %d%%", int(math.Round(nameSim*100))))
	}
	if !strings.EqualFold(g.Name, e.Name) {
		differences = append(differences, "name")
	}

	categoryMatch := false
	for _, gc := range g.CategoryPath {
		for _, ec := range e.CategoryPath {
			if stringSimilarity(gc, ec) > 0.8 {
				categoryMatch = true
				break
			}
		}
		if categoryMatch {
			break
		}
	}
	if categoryMatch {
		score += 0.2
		reasons = append(reasons, "Category match")
	} else {
		differences = append(differences, "category")
	}

	maxPrice := g.Price
	if e.Price > maxPrice {
		maxPrice = e.Price
	}
	var priceDiff float64
	if maxPrice > 0 {
		priceDiff = math.Abs(g.Price-e.Price) / maxPrice
	}
	priceSim := 1 - priceDiff
	if priceSim < 0 {
		priceSim = 0
	}
	score += priceSim * 0.2
	if priceSim > 0.8 {
		reasons = append(reasons, fmt.Sprintf("Price similarity: %d%%", int(math.Round(priceSim*100))))
	}
	if math.Abs(g.Price-e.Price) > 0.01 {
		differences = append(differences, "price")
	}

	if g.Description != "" && e.Description != "" {
		descSim := stringSimilarity(g.Description, e.Description)
		score += descSim * 0.1
		if descSim > 0.6 {
			reasons = append(reasons, fmt.Sprintf("Description similarity: %d%%", int(math.Round(descSim*100))))
		}
		if g.Description != e.Description {
			differences = append(differences, "description")
		}
	}

	return SimilarityMatch{
		ExistingItem:    e,
		SimilarityScore: score,
		Differences:     differences,
		Reasons:         reasons,
	}
}

func stringSimilarity(a, b string) float64 {
	s1 := strings.ToLower(strings.TrimSpace(a))
	s2 := strings.ToLower(strings.TrimSpace(b))
	if s1 == s2 {
		return 1
	}

	r1 := []rune(s1)
	r2 := []rune(s2)
	m := len(r2)
	n := len(r1)

	matrix := make([][]int, m+1)
	for i := 0; i <= m; i++ {
		matrix[i] = make([]int, n+1)
		matrix[i][0] = i
	}
	for j := 0; j <= n; j++ {
		matrix[0][j] = j
	}

	for i := 1; i <= m; i++ {
		for j := 1; j <= n; j++ {
			if r2[i-1] == r1[j-1] {
				matrix[i][j] = matrix[i-1][j-1]
			} else {
				matrix[i][j] = min3(matrix[i-1][j-1]+1, matrix[i][j-1]+1, matrix[i-1][j]+1)
			}
		}
	}

	distance := matrix[m][n]
	maxLen := n
	if m > maxLen {
		maxLen = m
	}
	if maxLen == 0 {
		return 1
	}
	return float64(maxLen-distance) / float64(maxLen)
}

func min3(a, b, c int) int {
	m := a
	if b < m {
		m = b
	}
	if c < m {
		m = c
	}
	return m
}

func getRecommendation(similar []SimilarityMatch) (string, string) {
	if len(similar) == 0 {
		return "create_new", "No similar items found"
	}
	best := similar[0]
	if best.SimilarityScore >= 0.9 {
		return "update", fmt.Sprintf(`Very similar to "%s" (%d%% match)`, best.ExistingItem.Name, int(math.Round(best.SimilarityScore*100)))
	}
	if best.SimilarityScore >= 0.75 {
		return "update", fmt.Sprintf(`Similar to "%s" (%d%% match) - consider updating`, best.ExistingItem.Name, int(math.Round(best.SimilarityScore*100)))
	}
	return "create_new", fmt.Sprintf("Low similarity to existing items (best match: %d%%)", int(math.Round(best.SimilarityScore*100)))
}

// --- Decisions / DB writes ---

func mergeDecision(d UserDecision) MenuItem {
	item := d.GeneratedItem
	if d.Modifications == nil {
		return item
	}
	m := d.Modifications
	if m.Name != "" {
		item.Name = m.Name
	}
	if m.Description != "" {
		item.Description = m.Description
	}
	if m.Price != 0 {
		item.Price = m.Price
	}
	if len(m.CategoryPath) > 0 {
		item.CategoryPath = m.CategoryPath
	}
	if m.PreparationTime != 0 {
		item.PreparationTime = m.PreparationTime
	}
	if m.Variations != nil {
		item.Variations = m.Variations
	}
	return item
}

func (s *Service) processUserDecisions(ctx context.Context, locationID string, decisions []UserDecision) (*ConfirmResults, error) {
	results := &ConfirmResults{SuccessfulItems: []UserDecision{}, FailedItems: []UserDecision{}}

	// Gather categories needed (last leaf of path, matching TS behavior)
	categoryMap := map[string]string{}
	needed := map[string]struct{}{}
	for _, d := range decisions {
		if d.Action == "skip" {
			continue
		}
		item := mergeDecision(d)
		for _, cat := range item.CategoryPath {
			needed[cat] = struct{}{}
		}
	}

	for name := range needed {
		var id string
		err := s.pool.QueryRow(ctx,
			`SELECT id FROM categories WHERE location_id = $1 AND name = $2 LIMIT 1`,
			locationID, name,
		).Scan(&id)
		if err == nil {
			categoryMap[name] = id
			continue
		}
		if !errors.Is(err, pgx.ErrNoRows) {
			return nil, err
		}

		err = s.pool.QueryRow(ctx, `
INSERT INTO categories (location_id, name, is_active, sort_order)
VALUES ($1, $2, true, $3)
RETURNING id
`, locationID, name, results.CategoriesCreated).Scan(&id)
		if err == nil {
			categoryMap[name] = id
			results.CategoriesCreated++
		}
	}

	for _, d := range decisions {
		if d.Action == "skip" {
			results.ItemsSkipped++
			results.SuccessfulItems = append(results.SuccessfulItems, d)
			continue
		}

		item := mergeDecision(d)
		if strings.TrimSpace(item.Name) == "" {
			results.FailedItems = append(results.FailedItems, d)
			continue
		}
		if math.IsNaN(item.Price) {
			results.FailedItems = append(results.FailedItems, d)
			continue
		}
		if len(item.CategoryPath) == 0 {
			results.FailedItems = append(results.FailedItems, d)
			continue
		}
		leaf := item.CategoryPath[len(item.CategoryPath)-1]
		categoryID, ok := categoryMap[leaf]
		if !ok {
			results.FailedItems = append(results.FailedItems, d)
			continue
		}

		prepTime := item.PreparationTime
		if prepTime == 0 {
			prepTime = 15
		}

		switch d.Action {
		case "update":
			if d.ExistingItemID == "" {
				results.FailedItems = append(results.FailedItems, d)
				continue
			}
			_, err := s.pool.Exec(ctx, `
UPDATE items SET name=$1, description=$2, price=$3, preparation_time=$4, category_id=$5
WHERE id = $6
`, item.Name, nullIfEmpty(item.Description), item.Price, prepTime, categoryID, d.ExistingItemID)
			if err != nil {
				results.FailedItems = append(results.FailedItems, d)
				continue
			}
			results.ItemsUpdated++
			results.SuccessfulItems = append(results.SuccessfulItems, d)
			results.VariationsCreated += len(item.Variations)

		case "create_new":
			var newItemID string
			err := s.pool.QueryRow(ctx, `
INSERT INTO items (location_id, category_id, name, description, price, preparation_time, is_active, sort_order)
VALUES ($1, $2, $3, $4, $5, $6, true, $7)
RETURNING id
`, locationID, categoryID, item.Name, nullIfEmpty(item.Description), item.Price, prepTime, results.ItemsCreated).Scan(&newItemID)
			if err != nil {
				results.FailedItems = append(results.FailedItems, d)
				continue
			}
			results.ItemsCreated++
			results.SuccessfulItems = append(results.SuccessfulItems, d)

			for _, variation := range item.Variations {
				var newVarID string
				err := s.pool.QueryRow(ctx, `
INSERT INTO item_variations (item_id, name, is_required)
VALUES ($1, $2, $3)
RETURNING id
`, newItemID, variation.Name, variation.IsRequired).Scan(&newVarID)
				if err != nil {
					continue
				}
				results.VariationsCreated++
				for _, opt := range variation.Options {
					_, _ = s.pool.Exec(ctx, `
INSERT INTO item_variation_options (variation_id, name, price_modifier, is_default)
VALUES ($1, $2, $3, $4)
`, newVarID, opt.Name, opt.PriceModifier, opt.IsDefault)
				}
			}
		default:
			results.FailedItems = append(results.FailedItems, d)
		}
	}

	return results, nil
}

func nullIfEmpty(s string) interface{} {
	if s == "" {
		return nil
	}
	return s
}

// --- Gemini: input processing ---

func (s *Service) processMenuInput(ctx context.Context, input MenuInput) (*ProcessedMenu, error) {
	switch input.Type {
	case "images":
		var imgs []string
		if err := json.Unmarshal(input.Content, &imgs); err != nil {
			// TS tolerates a single string: treat content as single image
			var single string
			if err2 := json.Unmarshal(input.Content, &single); err2 == nil {
				imgs = []string{single}
			} else {
				return nil, err
			}
		}
		return s.processMenuImages(ctx, imgs, input.AdditionalText)
	case "text":
		var txt string
		if err := json.Unmarshal(input.Content, &txt); err != nil {
			return nil, err
		}
		return s.processMenuText(ctx, txt)
	case "pdf":
		var pdf string
		if err := json.Unmarshal(input.Content, &pdf); err != nil {
			return nil, err
		}
		return s.processMenuPDF(ctx, pdf)
	default:
		return nil, fmt.Errorf("Unsupported input type: %s", input.Type)
	}
}

func (s *Service) processMenuText(ctx context.Context, textContent string) (*ProcessedMenu, error) {
	prompt := `
    Analyze this menu text and extract a comprehensive menu structure. The text content is:

    "` + textContent + `"

    Return a JSON object with the following structure:
    {
      "categories": [
        {
          "name": "Category Name",
          "description": "Optional description",
          "subcategories": [
            {
              "name": "Subcategory Name",
              "description": "Optional description",
              "items": []
            }
          ],
          "items": [
            {
              "name": "Item Name",
              "description": "Item description",
              "price": 0.00,
              "category_path": ["Main Category", "Subcategory"],
              "preparation_time": 15,
              "variations": [
                {
                  "name": "Size",
                  "is_required": true,
                  "options": [
                    {
                      "name": "Small",
                      "price_modifier": 0.00,
                      "is_default": true
                    },
                    {
                      "name": "Large",
                      "price_modifier": 5.00,
                      "is_default": false
                    }
                  ]
                }
              ]
            }
          ]
        }
      ]
    }

    Guidelines:
    1. Create logical category hierarchies
    2. Extract accurate prices in decimal format
    3. Include item descriptions when available
    4. Identify variations like sizes, toppings, spice levels
    5. Set reasonable preparation times (10-45 minutes)
    6. Use clear, consistent naming
    7. Handle multiple currencies if present
    8. Create subcategories for better organization
    9. Include allergen information in descriptions if visible
    10. Maintain original menu structure where possible

    Return only valid JSON, no additional text.
  `

	requestBody := map[string]interface{}{
		"contents": []interface{}{
			map[string]interface{}{
				"parts": []interface{}{
					map[string]interface{}{"text": prompt},
				},
			},
		},
		"generationConfig": map[string]interface{}{
			"temperature":     0.1,
			"topK":            32,
			"topP":            1,
			"maxOutputTokens": 8192,
		},
	}

	return s.makeGeminiRequest(ctx, requestBody)
}

var pdfPrefixRe = regexp.MustCompile(`^data:application/pdf;base64,`)
var imgPrefixRe = regexp.MustCompile(`^data:image/([a-z]+);base64,`)
var jsonFenceRe = regexp.MustCompile("```json\\n?|\\n?```")

func (s *Service) processMenuPDF(ctx context.Context, base64Content string) (*ProcessedMenu, error) {
	base64Data := pdfPrefixRe.ReplaceAllString(base64Content, "")

	prompt := `
    Analyze this PDF menu document and extract a comprehensive menu structure.

    Return a JSON object with the following structure:
    {
      "categories": [
        {
          "name": "Category Name",
          "description": "Optional description",
          "subcategories": [
            {
              "name": "Subcategory Name",
              "description": "Optional description",
              "items": []
            }
          ],
          "items": [
            {
              "name": "Item Name",
              "description": "Item description",
              "price": 0.00,
              "category_path": ["Main Category", "Subcategory"],
              "preparation_time": 15,
              "variations": [
                {
                  "name": "Size",
                  "is_required": true,
                  "options": [
                    {
                      "name": "Small",
                      "price_modifier": 0.00,
                      "is_default": true
                    },
                    {
                      "name": "Large",
                      "price_modifier": 5.00,
                      "is_default": false
                    }
                  ]
                }
              ]
            }
          ]
        }
      ]
    }

    Guidelines:
    1. Create logical category hierarchies
    2. Extract accurate prices in South African Rand (R) format
    3. Include item descriptions when available
    4. Identify variations like sizes, toppings, spice levels
    5. Set reasonable preparation times (10-45 minutes)
    6. Use clear, consistent naming
    7. Create subcategories for better organization
    8. Include allergen information in descriptions if visible
    9. Maintain original menu structure where possible

    Return only valid JSON, no additional text.
  `

	requestBody := map[string]interface{}{
		"contents": []interface{}{
			map[string]interface{}{
				"parts": []interface{}{
					map[string]interface{}{
						"inline_data": map[string]interface{}{
							"mime_type": "application/pdf",
							"data":      base64Data,
						},
					},
					map[string]interface{}{"text": prompt},
				},
			},
		},
		"generationConfig": map[string]interface{}{
			"temperature":     0.1,
			"topK":            32,
			"topP":            1,
			"maxOutputTokens": 8192,
		},
	}

	return s.makeGeminiRequest(ctx, requestBody)
}

func (s *Service) processMenuImages(ctx context.Context, images []string, additionalText string) (*ProcessedMenu, error) {
	imageParts := make([]interface{}, 0, len(images))
	for _, image := range images {
		mimeType := "image/jpeg"
		if m := imgPrefixRe.FindStringSubmatch(image); len(m) > 1 {
			mimeType = "image/" + m[1]
		}
		data := imgPrefixRe.ReplaceAllString(image, "")
		imageParts = append(imageParts, map[string]interface{}{
			"inline_data": map[string]interface{}{
				"mime_type": mimeType,
				"data":      data,
			},
		})
	}

	prompt := `
    Analyze these menu images and extract a comprehensive menu structure.`

	if additionalText != "" {
		prompt += `

    Additional context provided by the user:
    "` + additionalText + `"

    Use this text to supplement and clarify the information you extract from the images.`
	}

	prompt += `

    Return a JSON object with the following structure:

    {
      "categories": [
        {
          "name": "Category Name",
          "description": "Optional description",
          "subcategories": [
            {
              "name": "Subcategory Name",
              "description": "Optional description",
              "items": []
            }
          ],
          "items": [
            {
              "name": "Item Name",
              "description": "Item description",
              "price": 0.00,
              "category_path": ["Main Category", "Subcategory"],
              "preparation_time": 15,
              "variations": [
                {
                  "name": "Size",
                  "is_required": true,
                  "options": [
                    {
                      "name": "Small",
                      "price_modifier": 0.00,
                      "is_default": true
                    },
                    {
                      "name": "Large",
                      "price_modifier": 5.00,
                      "is_default": false
                    }
                  ]
                }
              ]
            }
          ]
        }
      ]
    }

    Guidelines:
    1. Create logical category hierarchies (e.g., "Mains" > "Pizza", "Beverages" > "Hot Drinks")
    2. Extract accurate prices in decimal format
    3. Include item descriptions when available
    4. Identify variations like sizes, toppings, spice levels
    5. Set reasonable preparation times (10-45 minutes)
    6. Use clear, consistent naming
    7. Handle multiple currencies if present
    8. Create subcategories for better organization
    9. Include allergen information in descriptions if visible
    10. Maintain original menu structure where possible

    Return only valid JSON, no additional text.
  `

	parts := []interface{}{map[string]interface{}{"text": prompt}}
	parts = append(parts, imageParts...)

	requestBody := map[string]interface{}{
		"contents": []interface{}{
			map[string]interface{}{"parts": parts},
		},
		"generationConfig": map[string]interface{}{
			"temperature":     0.1,
			"topK":            32,
			"topP":            1,
			"maxOutputTokens": 8192,
		},
	}

	return s.makeGeminiRequest(ctx, requestBody)
}

func (s *Service) makeGeminiRequest(ctx context.Context, requestBody map[string]interface{}) (*ProcessedMenu, error) {
	body, err := json.Marshal(requestBody)
	if err != nil {
		return nil, err
	}

	url := fmt.Sprintf("%s?key=%s", geminiURL, s.apiKey)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := s.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("Gemini API error: %w", err)
	}
	defer resp.Body.Close()

	raw, _ := io.ReadAll(resp.Body)
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("Gemini API error: %d - %s", resp.StatusCode, string(raw))
	}

	var result struct {
		Candidates []struct {
			Content struct {
				Parts []struct {
					Text string `json:"text"`
				} `json:"parts"`
			} `json:"content"`
		} `json:"candidates"`
	}
	if err := json.Unmarshal(raw, &result); err != nil {
		return nil, fmt.Errorf("Gemini API error: %w", err)
	}
	if len(result.Candidates) == 0 || len(result.Candidates[0].Content.Parts) == 0 {
		return nil, errors.New("No response from Gemini AI")
	}

	content := result.Candidates[0].Content.Parts[0].Text
	clean := strings.TrimSpace(jsonFenceRe.ReplaceAllString(content, ""))

	var menuData struct {
		Categories []MenuCategory `json:"categories"`
	}
	if err := json.Unmarshal([]byte(clean), &menuData); err != nil {
		return nil, fmt.Errorf("Failed to parse menu data: %s", err.Error())
	}
	if menuData.Categories == nil {
		return nil, errors.New("Failed to parse menu data: categories array missing")
	}

	var allItems []MenuItem
	flattenMenuItems(menuData.Categories, &allItems, nil)

	return &ProcessedMenu{
		Categories: menuData.Categories,
		Items:      allItems,
	}, nil
}

func flattenMenuItems(categories []MenuCategory, out *[]MenuItem, parentPath []string) {
	for _, cat := range categories {
		currentPath := append([]string{}, parentPath...)
		currentPath = append(currentPath, cat.Name)

		for _, item := range cat.Items {
			if len(item.CategoryPath) == 0 {
				item.CategoryPath = append([]string{}, currentPath...)
			}
			*out = append(*out, item)
		}

		if len(cat.Subcategories) > 0 {
			flattenMenuItems(cat.Subcategories, out, currentPath)
		}
	}
}
