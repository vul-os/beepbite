package promotions

import (
	"encoding/json"
	"net/http"
)

// writeJSON is a tiny helper so handlers don't repeat boilerplate.
func writeJSON(w http.ResponseWriter, status int, body interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}

func writeError(w http.ResponseWriter, status int, code, msg string) {
	writeJSON(w, status, map[string]any{
		"success":    false,
		"error":      msg,
		"error_code": code,
	})
}
