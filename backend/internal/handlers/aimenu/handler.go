package aimenu

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/beepbite/backend/internal/ai"
)

type rawRequest struct {
	Action     string          `json:"action"`
	LocationID string          `json:"location_id"`
	Input      json.RawMessage `json:"input"`
	Decisions  json.RawMessage `json:"decisions"`
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

		loc, err := svc.GetLocation(r.Context(), raw.LocationID)
		if err != nil {
			var se *ai.ServiceError
			if errors.As(err, &se) {
				errorResponse(w, se.HTTPStatus, se.Code, se.Message)
				return
			}
			errorResponse(w, http.StatusInternalServerError, "DATABASE_ERROR", "Database connection failed. Please try again.")
			return
		}

		switch raw.Action {
		case "generate":
			if len(raw.Input) == 0 || string(raw.Input) == "null" {
				errorResponse(w, http.StatusBadRequest, "MISSING_INPUT", "No input provided")
				return
			}
			var input ai.MenuInput
			if err := json.Unmarshal(raw.Input, &input); err != nil {
				errorResponse(w, http.StatusBadRequest, "MISSING_INPUT", "No input provided")
				return
			}
			req := &ai.GenerateRequest{
				Action:     raw.Action,
				LocationID: raw.LocationID,
				Input:      input,
			}
			out, err := svc.HandleGenerate(r.Context(), req, loc)
			if err != nil {
				var se *ai.ServiceError
				if errors.As(err, &se) {
					errorResponse(w, se.HTTPStatus, se.Code, se.Message)
					return
				}
				errorResponse(w, http.StatusInternalServerError, "INTERNAL_ERROR", "An unexpected error occurred. Please try again.")
				return
			}
			writeJSON(w, http.StatusOK, out)

		case "confirm":
			if len(raw.Decisions) == 0 || string(raw.Decisions) == "null" {
				errorResponse(w, http.StatusBadRequest, "MISSING_DECISIONS", "No decisions provided")
				return
			}
			var decisions []ai.UserDecision
			if err := json.Unmarshal(raw.Decisions, &decisions); err != nil {
				errorResponse(w, http.StatusBadRequest, "INVALID_DECISIONS_FORMAT", "Decisions must be an array")
				return
			}
			req := &ai.ConfirmRequest{
				Action:     raw.Action,
				LocationID: raw.LocationID,
				Decisions:  decisions,
			}
			out, err := svc.HandleConfirm(r.Context(), req, loc)
			if err != nil {
				var se *ai.ServiceError
				if errors.As(err, &se) {
					errorResponse(w, se.HTTPStatus, se.Code, se.Message)
					return
				}
				errorResponse(w, http.StatusInternalServerError, "INTERNAL_ERROR", "An unexpected error occurred. Please try again.")
				return
			}
			writeJSON(w, http.StatusOK, out)
		}
	}
}
