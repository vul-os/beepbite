package aifloor

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/beepbite/backend/internal/ai"
)

type rawRequest struct {
	Action      string          `json:"action"`
	LocationID  string          `json:"location_id"`
	Description string          `json:"description"`
	Plan        json.RawMessage `json:"plan"`
}

type generateResponse struct {
	Success bool          `json:"success"`
	Action  string        `json:"action"`
	Plan    *ai.FloorPlan `json:"plan"`
	Stats   floorStats    `json:"stats"`
}

type confirmResponse struct {
	Success bool                  `json:"success"`
	Action  string                `json:"action"`
	Stats   *ai.FloorConfirmStats `json:"stats"`
}

// floorStats summarizes a generated (not yet persisted) plan.
type floorStats struct {
	Sections int `json:"sections"`
	Tables   int `json:"tables"`
}

func writeJSON(w http.ResponseWriter, status int, body interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}

func errorResponse(w http.ResponseWriter, status int, code, msg string) {
	writeJSON(w, status, ai.ErrorResponse{
		Success:   false,
		Error:     msg,
		ErrorCode: code,
	})
}

// NewHandler returns the POST /ai/floor handler. It dispatches on the request
// "action": "generate" produces a floor plan from a description, "confirm"
// persists a (reviewed) plan.
func NewHandler(svc *ai.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusOK)
			return
		}

		var raw rawRequest
		if err := json.NewDecoder(r.Body).Decode(&raw); err != nil {
			errorResponse(w, http.StatusBadRequest, "INVALID_JSON", "Invalid JSON in request body")
			return
		}

		if raw.LocationID == "" {
			errorResponse(w, http.StatusBadRequest, "MISSING_LOCATION_ID", "location_id is required")
			return
		}
		if raw.Action != "generate" && raw.Action != "confirm" {
			errorResponse(w, http.StatusBadRequest, "INVALID_ACTION", `action must be either "generate" or "confirm"`)
			return
		}

		// Validate the location (and access) up front. This
		// 404s on not-found / denied via the ServiceError carried back.
		loc, err := svc.GetLocation(r.Context(), raw.LocationID)
		if err != nil {
			var se *ai.ServiceError
			if errors.As(err, &se) {
				status := se.HTTPStatus
				if se.Code == "LOCATION_NOT_FOUND" {
					status = http.StatusNotFound
				}
				errorResponse(w, status, se.Code, se.Message)
				return
			}
			errorResponse(w, http.StatusInternalServerError, "DATABASE_ERROR", "Database connection failed. Please try again.")
			return
		}
		_ = loc

		switch raw.Action {
		case "generate":
			if raw.Description == "" {
				errorResponse(w, http.StatusBadRequest, "MISSING_DESCRIPTION", "No description provided")
				return
			}
			plan, err := svc.GenerateFloor(r.Context(), raw.LocationID, raw.Description)
			if err != nil {
				writeServiceError(w, err)
				return
			}
			writeJSON(w, http.StatusOK, generateResponse{
				Success: true,
				Action:  "generate",
				Plan:    plan,
				Stats:   planStats(plan),
			})

		case "confirm":
			if len(raw.Plan) == 0 || string(raw.Plan) == "null" {
				errorResponse(w, http.StatusBadRequest, "MISSING_PLAN", "No plan provided")
				return
			}
			var plan ai.FloorPlan
			if err := json.Unmarshal(raw.Plan, &plan); err != nil {
				errorResponse(w, http.StatusBadRequest, "INVALID_PLAN_FORMAT", "plan is not in the expected format")
				return
			}
			stats, err := svc.ConfirmFloor(r.Context(), raw.LocationID, &plan)
			if err != nil {
				writeServiceError(w, err)
				return
			}
			writeJSON(w, http.StatusOK, confirmResponse{
				Success: true,
				Action:  "confirm",
				Stats:   stats,
			})
		}
	}
}

func planStats(plan *ai.FloorPlan) floorStats {
	st := floorStats{}
	if plan == nil {
		return st
	}
	st.Sections = len(plan.Sections)
	for _, s := range plan.Sections {
		st.Tables += len(s.Tables)
	}
	return st
}

func writeServiceError(w http.ResponseWriter, err error) {
	var se *ai.ServiceError
	if errors.As(err, &se) {
		errorResponse(w, se.HTTPStatus, se.Code, se.Message)
		return
	}
	errorResponse(w, http.StatusInternalServerError, "INTERNAL_ERROR", "An unexpected error occurred. Please try again.")
}
