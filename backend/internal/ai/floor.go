package ai

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/beepbite/backend/internal/db"
	"github.com/jackc/pgx/v5"
)

// --- Floor-plan types ---

type FloorTable struct {
	Label    string `json:"label"`
	Capacity int    `json:"capacity"`
	PosX     int    `json:"x"`
	PosY     int    `json:"y"`
}

type FloorSection struct {
	Name   string       `json:"name"`
	Tables []FloorTable `json:"tables"`
}

type FloorPlan struct {
	Sections []FloorSection `json:"sections"`
}

// FloorConfirmStats is returned by ConfirmFloor.
type FloorConfirmStats struct {
	SectionsCreated int `json:"sections_created"`
	TablesCreated   int `json:"tables_created"`
}

// Layout / sanitization bounds. The canvas the front-end renders is roughly
// 880px wide by 560px tall; tables are spaced ~120px apart and snapped to a
// 16px grid so they line up cleanly and do not overlap.
const (
	floorMaxX        = 880
	floorMaxY        = 560
	floorGridSnap    = 16
	floorMaxTables   = 80
	floorMinCapacity = 1
	floorMaxCapacity = 20
	floorDefaultCap  = 2
)

// GenerateFloor asks Gemini to lay out a floor plan from a natural-language
// description, then sanitizes the result. No DB access is required — the
// generated plan is returned to the caller for review before ConfirmFloor
// writes it.
func (s *Service) GenerateFloor(ctx context.Context, locationID, description string) (*FloorPlan, error) {
	if strings.TrimSpace(description) == "" {
		return nil, svcErr(http.StatusBadRequest, "INVALID_DESCRIPTION", "No description provided")
	}
	if s.apiKey == "" {
		return nil, svcErr(http.StatusInternalServerError, "MISSING_API_KEY", "AI service configuration error. Please contact support.")
	}

	prompt := `You are a restaurant floor-plan designer. Based on the description below, design a seating layout.

Description:
"` + description + `"

Return ONLY a JSON object with this exact structure and nothing else:
{"sections":[{"name":"Main Room","tables":[{"label":"T1","capacity":4,"x":40,"y":40},{"label":"T2","capacity":2,"x":160,"y":40}]}]}

Layout rules:
1. Place tables on a grid spanning x from 0 to 880 and y from 0 to 560 (pixel coordinates).
2. Space tables roughly 120px apart so they do not overlap.
3. Group tables into sensible sections (e.g. "Main Room", "Patio", "Bar", "Private Room").
4. Lay out the tables of each section in tidy rows/columns within the canvas.
5. Infer table capacities (number of seats) and short labels (e.g. T1, T2, B1, P1) from the description.
6. Use integer coordinates and integer capacities.

Return only valid JSON, no markdown, no commentary.`

	requestBody := map[string]interface{}{
		"contents": []interface{}{
			map[string]interface{}{
				"parts": []interface{}{
					map[string]interface{}{"text": prompt},
				},
			},
		},
		"generationConfig": map[string]interface{}{
			"temperature":      0.2,
			"topK":             32,
			"topP":             1,
			"maxOutputTokens":  8192,
			"responseMimeType": "application/json", // force clean JSON (no prose/fences)
			// Disable Gemini 2.5 "thinking" so the full output budget goes to the
			// JSON answer (and the call is fast) instead of hidden reasoning tokens.
			"thinkingConfig": map[string]interface{}{"thinkingBudget": 0},
		},
	}

	plan, err := s.makeGeminiFloorRequest(ctx, requestBody)
	if err != nil {
		msg := err.Error()
		if strings.Contains(msg, "Gemini API error") {
			return nil, svcErr(http.StatusServiceUnavailable, "AI_SERVICE_ERROR", "AI service is temporarily unavailable. Please try again in a few moments.")
		}
		if strings.Contains(msg, "Failed to parse floor plan") {
			return nil, svcErr(http.StatusBadRequest, "PROCESSING_ERROR", "Unable to generate a floor plan from that description. Please try a clearer description.")
		}
		return nil, svcErr(http.StatusInternalServerError, "GENERATION_ERROR", "Failed to generate floor plan. Please try again.")
	}

	return sanitizeFloorPlan(plan), nil
}

// makeGeminiFloorRequest mirrors makeGeminiRequest in menu.go but parses the
// floor-plan JSON shape.
func (s *Service) makeGeminiFloorRequest(ctx context.Context, requestBody map[string]interface{}) (*FloorPlan, error) {
	body, err := json.Marshal(requestBody)
	if err != nil {
		return nil, err
	}

	url := fmt.Sprintf("https://generativelanguage.googleapis.com/v1beta/models/%s:generateContent?key=%s", s.model, s.apiKey)

	// Retry transient Gemini failures (429 rate-limit, 5xx "high demand") with
	// exponential backoff — the free tier is frequently/briefly overloaded.
	var raw []byte
	var status int
	for attempt := 0; attempt < 4; attempt++ {
		if attempt > 0 {
			select {
			case <-ctx.Done():
				return nil, ctx.Err()
			case <-time.After(time.Duration(1<<uint(attempt-1)) * time.Second): // 1s, 2s, 4s
			}
		}
		req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(body))
		if err != nil {
			return nil, err
		}
		req.Header.Set("Content-Type", "application/json")
		resp, err := s.httpClient.Do(req)
		if err != nil {
			if attempt == 3 {
				return nil, fmt.Errorf("Gemini API error: %w", err)
			}
			continue
		}
		raw, _ = io.ReadAll(resp.Body)
		status = resp.StatusCode
		resp.Body.Close()
		if status == 429 || status >= 500 {
			if attempt == 3 {
				return nil, fmt.Errorf("Gemini API error: %d - %s", status, string(raw))
			}
			continue // transient — back off and retry
		}
		break
	}
	if status < 200 || status >= 300 {
		return nil, fmt.Errorf("Gemini API error: %d - %s", status, string(raw))
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

	var plan FloorPlan
	if err := json.Unmarshal([]byte(clean), &plan); err != nil {
		return nil, fmt.Errorf("Failed to parse floor plan: %s", err.Error())
	}
	if plan.Sections == nil {
		return nil, errors.New("Failed to parse floor plan: sections array missing")
	}
	return &plan, nil
}

// sanitizeFloorPlan clamps coordinates and capacities to safe ranges, snaps
// positions to the 16px grid, fills in missing labels (T1, T2, …) uniquely,
// drops empty sections, and caps the total number of tables.
func sanitizeFloorPlan(plan *FloorPlan) *FloorPlan {
	out := &FloorPlan{Sections: make([]FloorSection, 0, len(plan.Sections))}

	total := 0
	seq := 0
	usedLabels := map[string]struct{}{}

	for _, sec := range plan.Sections {
		name := strings.TrimSpace(sec.Name)
		if name == "" {
			name = "Main Room"
		}

		cleanSec := FloorSection{Name: name, Tables: make([]FloorTable, 0, len(sec.Tables))}
		for _, t := range sec.Tables {
			if total >= floorMaxTables {
				break
			}

			seq++
			capacity := t.Capacity
			if capacity < floorMinCapacity || capacity > floorMaxCapacity {
				if capacity > floorMaxCapacity {
					capacity = floorMaxCapacity
				} else {
					capacity = floorDefaultCap
				}
			}

			label := strings.TrimSpace(t.Label)
			if label == "" {
				label = fmt.Sprintf("T%d", seq)
			}
			// Ensure label uniqueness within the plan (the tables table has a
			// UNIQUE (location_id, label) constraint).
			base := label
			for n := 2; ; n++ {
				if _, dup := usedLabels[strings.ToLower(label)]; !dup {
					break
				}
				label = fmt.Sprintf("%s-%d", base, n)
			}
			usedLabels[strings.ToLower(label)] = struct{}{}

			cleanSec.Tables = append(cleanSec.Tables, FloorTable{
				Label:    label,
				Capacity: capacity,
				PosX:     snapClamp(t.PosX, floorMaxX),
				PosY:     snapClamp(t.PosY, floorMaxY),
			})
			total++
		}

		if len(cleanSec.Tables) > 0 {
			out.Sections = append(out.Sections, cleanSec)
		}
	}

	return out
}

// snapClamp clamps v to [0, max] then snaps to the nearest 16px grid step,
// keeping the result within [0, max].
func snapClamp(v, max int) int {
	if v < 0 {
		v = 0
	}
	if v > max {
		v = max
	}
	snapped := ((v + floorGridSnap/2) / floorGridSnap) * floorGridSnap
	if snapped > max {
		snapped = (max / floorGridSnap) * floorGridSnap
	}
	if snapped < 0 {
		snapped = 0
	}
	return snapped
}

// ConfirmFloor persists a (sanitized) floor plan in a single tenant-scoped
// transaction. Sections are found-or-created by (location_id, name); tables are
// inserted, skipping any whose (location_id, label) already exists so the
// operation is idempotent.
func (s *Service) ConfirmFloor(ctx context.Context, locationID string, plan *FloorPlan) (*FloorConfirmStats, error) {
	if plan == nil || len(plan.Sections) == 0 {
		return nil, svcErr(http.StatusBadRequest, "EMPTY_PLAN", "No floor plan provided")
	}

	stats := &FloorConfirmStats{}

	err := db.Scoped(ctx, s.pool, db.ScopeFromContext(ctx), func(tx pgx.Tx) error {
		for _, sec := range plan.Sections {
			name := strings.TrimSpace(sec.Name)
			if name == "" {
				name = "Main Room"
			}

			// find-or-create section by (location_id, name)
			var sectionID string
			err := tx.QueryRow(ctx,
				`SELECT id FROM sections WHERE location_id = $1 AND name = $2 LIMIT 1`,
				locationID, name,
			).Scan(&sectionID)
			if errors.Is(err, pgx.ErrNoRows) {
				err = tx.QueryRow(ctx, `
INSERT INTO sections (location_id, name, is_active, sort_order)
VALUES ($1, $2, true, $3)
RETURNING id
`, locationID, name, stats.SectionsCreated).Scan(&sectionID)
				if err != nil {
					return err
				}
				stats.SectionsCreated++
			} else if err != nil {
				return err
			}

			for _, t := range sec.Tables {
				label := strings.TrimSpace(t.Label)
				if label == "" {
					continue
				}

				// Idempotent: skip if a table with this label already exists
				// for the location (UNIQUE (location_id, label)).
				var existingID string
				err := tx.QueryRow(ctx,
					`SELECT id FROM tables WHERE location_id = $1 AND label = $2 LIMIT 1`,
					locationID, label,
				).Scan(&existingID)
				if err == nil {
					continue
				}
				if !errors.Is(err, pgx.ErrNoRows) {
					return err
				}

				capacity := t.Capacity
				if capacity < floorMinCapacity {
					capacity = floorDefaultCap
				}
				if capacity > floorMaxCapacity {
					capacity = floorMaxCapacity
				}

				_, err = tx.Exec(ctx, `
INSERT INTO tables (location_id, section_id, label, capacity, status, pos_x, pos_y, is_active)
VALUES ($1, $2, $3, $4, 'available', $5, $6, true)
`, locationID, sectionID, label, capacity, t.PosX, t.PosY)
				if err != nil {
					return err
				}
				stats.TablesCreated++
			}
		}
		return nil
	})
	if err != nil {
		msg := err.Error()
		if strings.Contains(msg, "permission") {
			return nil, svcErr(http.StatusForbidden, "PERMISSION_DENIED", "Permission denied. Please check your access rights.")
		}
		if strings.Contains(msg, "connection") || strings.Contains(msg, "timeout") {
			return nil, svcErr(http.StatusServiceUnavailable, "DATABASE_CONNECTION_ERROR", "Database connection failed. Please try again.")
		}
		return nil, svcErr(http.StatusInternalServerError, "UPDATE_ERROR", "Failed to save floor plan. Please try again.")
	}

	return stats, nil
}
