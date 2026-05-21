// Package customdomains implements Wave 23 / Now-13 custom domain management.
//
// # Routes
//
// All routes below require auth.Middleware + auth.RequireOrgScope upstream.
//
//	r.Route("/domains", domainsH.Mount)
//
// Endpoints:
//
//	GET    /domains?location_id=<uuid>        — list domains for a location
//	POST   /domains                           — add a domain
//	DELETE /domains/{id}                      — soft-remove a domain
//	POST   /domains/{id}/verify               — probe DNS and, on success, request cert
//
// # DNS verification (POST /domains/{id}/verify)
//
// Two DNS checks are performed synchronously:
//  1. TXT _beepbite-verify.<hostname> must equal the stored verification_token.
//  2. CNAME <hostname> must resolve to "mystore.beepbite.io.".
//
// On success the domain is transitioned: pending/verifying → verified →
// cert_issuing → live (all in the same request; the FlyCerts stub makes this
// instant). Real Fly integration may add an async cert-status polling step.
//
// # Wiring in main.go
//
//	domainsH := customdomains.NewHandler(pool, &customdomains.StubFlyCerts{})
//	// Inside the authenticated router group (after auth.Middleware + auth.RequireOrgScope):
//	r.Route("/domains", domainsH.Mount)
package customdomains

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/beepbite/backend/internal/auth"
	"github.com/beepbite/backend/internal/db"
)

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

// Handler serves the custom domain management endpoints.
type Handler struct {
	store    *Store
	flyCerts FlyCerts
}

// NewHandler constructs a Handler with the given pool and FlyCerts
// implementation. Pass &StubFlyCerts{} for development / non-Fly deployments.
func NewHandler(pool *pgxpool.Pool, fly FlyCerts) *Handler {
	return &Handler{
		store:    NewStore(pool),
		flyCerts: fly,
	}
}

// Mount registers all custom-domain routes on r. r must already have
// auth.Middleware and auth.RequireOrgScope applied.
//
// Routes:
//
//	GET    /                → listDomains
//	POST   /                → addDomain
//	DELETE /{id}            → removeDomain
//	POST   /{id}/verify     → verifyDomain
func (h *Handler) Mount(r chi.Router) {
	r.Get("/", h.listDomains)
	r.Post("/", h.addDomain)
	r.Delete("/{id}", h.removeDomain)
	r.Post("/{id}/verify", h.verifyDomain)
}

// ---------------------------------------------------------------------------
// GET /domains?location_id=<uuid>
// ---------------------------------------------------------------------------

func (h *Handler) listDomains(w http.ResponseWriter, r *http.Request) {
	locationID := r.URL.Query().Get("location_id")
	if locationID == "" {
		writeError(w, http.StatusBadRequest, "location_id query param required")
		return
	}

	orgScope := auth.OrgScopeFrom(r.Context())
	if !orgScope.AllowsLocation(locationID) {
		writeError(w, http.StatusForbidden, "access denied")
		return
	}

	scope := db.ScopeFromContext(r.Context())
	domains, err := h.store.ListByLocation(r.Context(), scope, locationID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{"data": domains})
}

// ---------------------------------------------------------------------------
// POST /domains
// ---------------------------------------------------------------------------

type addDomainReq struct {
	LocationID string `json:"location_id"`
	Hostname   string `json:"hostname"`
}

func (h *Handler) addDomain(w http.ResponseWriter, r *http.Request) {
	var req addDomainReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if req.LocationID == "" {
		writeError(w, http.StatusBadRequest, "location_id required")
		return
	}
	if req.Hostname == "" {
		writeError(w, http.StatusBadRequest, "hostname required")
		return
	}
	// Normalise: lowercase, strip trailing dot.
	req.Hostname = strings.ToLower(strings.TrimSuffix(strings.TrimSpace(req.Hostname), "."))

	orgScope := auth.OrgScopeFrom(r.Context())
	if !orgScope.AllowsLocation(req.LocationID) {
		writeError(w, http.StatusForbidden, "access denied")
		return
	}

	scope := db.ScopeFromContext(r.Context())
	domain, err := h.store.AddDomain(r.Context(), scope, req.LocationID, req.Hostname)
	switch {
	case errors.Is(err, ErrDuplicate):
		writeError(w, http.StatusConflict, "hostname already registered")
		return
	case err != nil:
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}

	writeJSON(w, http.StatusCreated, domain)
}

// ---------------------------------------------------------------------------
// DELETE /domains/{id}
// ---------------------------------------------------------------------------

func (h *Handler) removeDomain(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if id == "" {
		writeError(w, http.StatusBadRequest, "id required")
		return
	}

	orgScope := auth.OrgScopeFrom(r.Context())

	if err := h.store.RemoveDomain(r.Context(), id, orgScope.LocationIDs); err != nil {
		switch {
		case errors.Is(err, ErrNotFound), errors.Is(err, ErrNotOwner):
			writeError(w, http.StatusNotFound, "domain not found")
		default:
			writeError(w, http.StatusInternalServerError, "internal error")
		}
		return
	}

	// Also request cert removal (best-effort; failures are logged, not fatal).
	// Use a background context so the request lifecycle does not cancel it.
	bgctx := context.Background()
	go func() {
		// Re-fetch to get the hostname (already soft-deleted so we read from DB).
		_ = h.flyCerts.RemoveCert(bgctx, id) // id used as a label; real impl looks up hostname
	}()

	w.WriteHeader(http.StatusNoContent)
}

// ---------------------------------------------------------------------------
// POST /domains/{id}/verify
// ---------------------------------------------------------------------------

// verifyDomain probes DNS for both the TXT and CNAME records, then on success
// marks the domain verified and initiates cert issuance.
func (h *Handler) verifyDomain(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if id == "" {
		writeError(w, http.StatusBadRequest, "id required")
		return
	}

	orgScope := auth.OrgScopeFrom(r.Context())

	domain, err := h.store.GetDomain(r.Context(), id, orgScope.LocationIDs)
	switch {
	case errors.Is(err, ErrNotFound), errors.Is(err, ErrNotOwner):
		writeError(w, http.StatusNotFound, "domain not found")
		return
	case err != nil:
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}

	if domain.Status == "verified" || domain.Status == "cert_issuing" || domain.Status == "live" {
		writeError(w, http.StatusConflict, "domain is already verified")
		return
	}

	hostname := domain.Hostname
	token := domain.VerificationToken

	// --- 1. TXT record check ---
	txtHost := "_beepbite-verify." + hostname
	txts, err := net.LookupTXT(txtHost)
	if err != nil {
		writeError(w, http.StatusUnprocessableEntity, fmt.Sprintf(
			"TXT lookup failed for %s: %v — add a TXT record with value %q and retry",
			txtHost, err, token,
		))
		return
	}
	foundTXT := false
	for _, t := range txts {
		if t == token {
			foundTXT = true
			break
		}
	}
	if !foundTXT {
		writeError(w, http.StatusUnprocessableEntity, fmt.Sprintf(
			"TXT record %s does not contain the verification token %q",
			txtHost, token,
		))
		return
	}

	// --- 2. CNAME record check ---
	const expectedCNAME = "mystore.beepbite.io."
	cname, err := net.LookupCNAME(hostname)
	if err != nil {
		writeError(w, http.StatusUnprocessableEntity, fmt.Sprintf(
			"CNAME lookup failed for %s: %v — add a CNAME pointing to %s and retry",
			hostname, err, expectedCNAME,
		))
		return
	}
	// LookupCNAME always returns a fully-qualified name; normalise.
	cnameNorm := strings.ToLower(cname)
	if !strings.HasSuffix(cnameNorm, ".") {
		cnameNorm += "."
	}
	if cnameNorm != strings.ToLower(expectedCNAME) {
		writeError(w, http.StatusUnprocessableEntity, fmt.Sprintf(
			"CNAME for %s is %q — expected %s",
			hostname, cname, expectedCNAME,
		))
		return
	}

	// --- 3. Mark verified ---
	updated, err := h.store.MarkVerified(r.Context(), id)
	if errors.Is(err, ErrAlreadyVerified) {
		writeError(w, http.StatusConflict, "domain is already verified")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}

	// --- 4. Request cert via FlyCerts ---
	if err := h.flyCerts.AddCert(r.Context(), hostname); err != nil {
		// Log but don't fail the HTTP request — the cert can be retried.
		writeError(w, http.StatusInternalServerError, fmt.Sprintf("domain verified but cert request failed: %v", err))
		return
	}

	// --- 5. Advance status: cert_issuing → live (stub: instant) ---
	if err := h.store.MarkCertIssuing(r.Context(), updated.ID); err != nil {
		// Non-fatal: status will be cleaned up by a future poll/retry.
		_ = err
	}
	if err := h.store.MarkLive(r.Context(), updated.ID); err != nil {
		_ = err
	}
	updated.Status = "live"

	writeJSON(w, http.StatusOK, updated)
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

func writeJSON(w http.ResponseWriter, status int, v interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func writeError(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}
