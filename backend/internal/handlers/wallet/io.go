// Package wallet exposes the org-wallet REST surface (balance, ledger,
// top-up initiation, auto-refill config).  Mount under an already-authenticated,
// org-scoped chi.Router group.
package wallet

import (
	"encoding/json"
	"net/http"
)

// JSON helpers are package-local — same pattern as cashdrawer/io.go.

func decodeJSON(r *http.Request, v any) error {
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	return dec.Decode(v)
}

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(v)
}

func writeErr(w http.ResponseWriter, code int, msg string) {
	writeJSON(w, code, map[string]string{"error": msg})
}
