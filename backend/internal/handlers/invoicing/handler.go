// Package invoicing exposes tax_profiles + invoices REST endpoints and PDF
// generation (org-scoped).
//
// Wire-up snippet (in main.go, inside the authenticated org-scoped group):
//
//	ih := invoicing.NewHandler(pool, invoicing.PlatformConfig{
//	    LegalName:         os.Getenv("BEEPBITE_LEGAL_NAME"),
//	    RegisteredAddress: os.Getenv("BEEPBITE_REGISTERED_ADDRESS"),
//	    VATNumber:         os.Getenv("BEEPBITE_VAT_NUMBER"),
//	    Country:           os.Getenv("BEEPBITE_REGISTERED_COUNTRY"),
//	    CompanyNumber:     os.Getenv("BEEPBITE_COMPANY_NUMBER"),
//	})
//	r.Route("/invoicing", func(r chi.Router) {
//	    ih.Mount(r)
//	})
//
// Routes registered (all under /invoicing):
//
//	GET    /tax-profile          — fetch org tax_profile
//	PUT    /tax-profile          — upsert org tax_profile
//	GET    /invoices             — list invoices (newest first)
//	POST   /invoices             — create draft invoice
//	GET    /invoices/{id}        — fetch invoice + lines
//	PATCH  /invoices/{id}        — update draft invoice
//	DELETE /invoices/{id}        — delete draft invoice
//	POST   /invoices/{id}/issue  — draft → sent
//	POST   /invoices/{id}/pay    — sent → paid
//	POST   /invoices/{id}/void   — draft|sent → void
//	GET    /invoices/{id}.pdf    — download invoice as PDF
package invoicing

import (
	"encoding/json"
	"errors"
	"net/http"
	"os"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Handler is the HTTP surface for the invoicing feature.
type Handler struct {
	store    *Store
	platform PlatformConfig
}

// NewHandler constructs a Handler backed by pool with the given platform config.
// Platform fields are read from env vars by the caller and passed in — they are
// never stored in the database.
func NewHandler(pool *pgxpool.Pool, platform PlatformConfig) *Handler {
	return &Handler{
		store:    NewStore(pool),
		platform: platform,
	}
}

// NewHandlerFromEnv constructs a Handler reading platform config from environment
// variables. Convenience wrapper for main.go.
func NewHandlerFromEnv(pool *pgxpool.Pool) *Handler {
	return NewHandler(pool, PlatformConfig{
		LegalName:         os.Getenv("BEEPBITE_LEGAL_NAME"),
		RegisteredAddress: os.Getenv("BEEPBITE_REGISTERED_ADDRESS"),
		VATNumber:         os.Getenv("BEEPBITE_VAT_NUMBER"),
		Country:           os.Getenv("BEEPBITE_REGISTERED_COUNTRY"),
		CompanyNumber:     os.Getenv("BEEPBITE_COMPANY_NUMBER"),
	})
}

// Mount registers all invoicing routes onto r.
// r should be rooted at /invoicing (or any prefix the caller chooses).
func (h *Handler) Mount(r chi.Router) {
	r.Get("/tax-profile", h.getTaxProfile)
	r.Put("/tax-profile", h.putTaxProfile)

	r.Get("/invoices", h.listInvoices)
	r.Post("/invoices", h.createInvoice)

	// PDF route must be registered before the /{id} routes to avoid the
	// chi router treating ".pdf" as a URL parameter suffix.
	r.Get("/invoices/{id}.pdf", h.getInvoicePDF)

	r.Get("/invoices/{id}", h.getInvoice)
	r.Patch("/invoices/{id}", h.patchInvoice)
	r.Delete("/invoices/{id}", h.deleteInvoice)
	r.Post("/invoices/{id}/issue", h.issueInvoice)
	r.Post("/invoices/{id}/pay", h.payInvoice)
	r.Post("/invoices/{id}/void", h.voidInvoice)
}

// ---------------------------------------------------------------------------
// tax_profile handlers
// ---------------------------------------------------------------------------

func (h *Handler) getTaxProfile(w http.ResponseWriter, r *http.Request) {
	tp, err := h.store.GetTaxProfile(r.Context())
	if errors.Is(err, ErrNotFound) {
		writeErr(w, http.StatusNotFound, "no tax profile set")
		return
	}
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, tp)
}

func (h *Handler) putTaxProfile(w http.ResponseWriter, r *http.Request) {
	var body TaxProfile
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid JSON: "+err.Error())
		return
	}

	saved, err := h.store.UpsertTaxProfile(r.Context(), body)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, saved)
}

// ---------------------------------------------------------------------------
// invoice list / create
// ---------------------------------------------------------------------------

func (h *Handler) listInvoices(w http.ResponseWriter, r *http.Request) {
	invs, err := h.store.ListInvoices(r.Context())
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, invs)
}

func (h *Handler) createInvoice(w http.ResponseWriter, r *http.Request) {
	var req CreateInvoiceReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid JSON: "+err.Error())
		return
	}
	if req.Issuer != "platform" && req.Issuer != "tenant" {
		writeErr(w, http.StatusBadRequest, "issuer must be 'platform' or 'tenant'")
		return
	}

	vatNumber, vatRatePct, err := h.resolveVAT(r, req.Issuer, req.VATRatePct)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}

	inv, err := h.store.CreateInvoice(r.Context(), req, vatNumber, vatRatePct)
	if errors.Is(err, ErrMissingRecipient) {
		writeErr(w, http.StatusUnprocessableEntity, err.Error())
		return
	}
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, inv)
}

// ---------------------------------------------------------------------------
// invoice get / patch / delete
// ---------------------------------------------------------------------------

func (h *Handler) getInvoice(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	inv, err := h.store.GetInvoice(r.Context(), id)
	if errors.Is(err, ErrNotFound) {
		writeErr(w, http.StatusNotFound, "not found")
		return
	}
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, inv)
}

func (h *Handler) patchInvoice(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	var req UpdateInvoiceReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid JSON: "+err.Error())
		return
	}

	// Fetch current invoice to know the issuer (needed to resolve VAT).
	current, err := h.store.GetInvoice(r.Context(), id)
	if errors.Is(err, ErrNotFound) {
		writeErr(w, http.StatusNotFound, "not found")
		return
	}
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}

	// Determine rate from request override or issuer profile.
	callerRate := 0.0
	if req.VATRatePct != nil {
		callerRate = *req.VATRatePct
	}
	vatNumber, _, err := h.resolveVAT(r, current.Issuer, callerRate)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}

	inv, err := h.store.UpdateInvoice(r.Context(), id, req, vatNumber)
	switch {
	case errors.Is(err, ErrNotFound):
		writeErr(w, http.StatusNotFound, "not found")
	case errors.Is(err, ErrInvoiceNotDraft):
		writeErr(w, http.StatusConflict, "only draft invoices can be updated")
	case err != nil:
		writeErr(w, http.StatusInternalServerError, err.Error())
	default:
		writeJSON(w, http.StatusOK, inv)
	}
}

func (h *Handler) deleteInvoice(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	err := h.store.DeleteInvoice(r.Context(), id)
	switch {
	case errors.Is(err, ErrNotFound):
		writeErr(w, http.StatusNotFound, "not found")
	case errors.Is(err, ErrInvoiceNotDraft):
		writeErr(w, http.StatusConflict, "only draft invoices can be deleted")
	case err != nil:
		writeErr(w, http.StatusInternalServerError, err.Error())
	default:
		w.WriteHeader(http.StatusNoContent)
	}
}

// ---------------------------------------------------------------------------
// invoice status transitions
// ---------------------------------------------------------------------------

func (h *Handler) issueInvoice(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	inv, err := h.store.IssueInvoice(r.Context(), id)
	h.handleTransition(w, inv, err)
}

func (h *Handler) payInvoice(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	inv, err := h.store.MarkPaid(r.Context(), id)
	h.handleTransition(w, inv, err)
}

func (h *Handler) voidInvoice(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	inv, err := h.store.VoidInvoice(r.Context(), id)
	h.handleTransition(w, inv, err)
}

func (h *Handler) handleTransition(w http.ResponseWriter, inv *Invoice, err error) {
	switch {
	case errors.Is(err, ErrNotFound):
		writeErr(w, http.StatusNotFound, "not found")
	case errors.Is(err, ErrInvoiceNotDraft):
		writeErr(w, http.StatusConflict, "invalid status transition")
	case errors.Is(err, ErrInvoiceNotIssued):
		writeErr(w, http.StatusConflict, "invoice must be in sent status")
	case err != nil:
		writeErr(w, http.StatusInternalServerError, err.Error())
	default:
		writeJSON(w, http.StatusOK, inv)
	}
}

// ---------------------------------------------------------------------------
// PDF endpoint
// ---------------------------------------------------------------------------

func (h *Handler) getInvoicePDF(w http.ResponseWriter, r *http.Request) {
	// chi URL param for "/invoices/{id}.pdf" — the param name is "id" and
	// it will contain the UUID portion before ".pdf".  Strip any trailing
	// ".pdf" that might be included depending on chi version/config.
	rawID := chi.URLParam(r, "id")
	id := strings.TrimSuffix(rawID, ".pdf")

	inv, err := h.store.GetInvoice(r.Context(), id)
	if errors.Is(err, ErrNotFound) {
		writeErr(w, http.StatusNotFound, "not found")
		return
	}
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}

	// Resolve issuer info
	issuer, err := h.resolveIssuerInfo(r, inv.Issuer)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}

	pdfBytes, err := renderPDF(InvoicePDFInput{
		Invoice:  inv,
		Lines:    inv.Lines,
		Issuer:   issuer,
		Platform: h.platform,
	})
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "pdf generation failed: "+err.Error())
		return
	}

	w.Header().Set("Content-Type", "application/pdf")
	w.Header().Set("Content-Disposition", `attachment; filename="invoice-`+id[:8]+`.pdf"`)
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(pdfBytes)
}

// ---------------------------------------------------------------------------
// VAT / issuer helpers
// ---------------------------------------------------------------------------

// resolveVAT returns the VAT number and the effective rate percentage for the
// given issuer.  For "platform" the number comes from PlatformConfig and the
// rate is callerRatePct (from the request body).  For "tenant" the number and
// default rate come from the DB tax_profile; callerRatePct overrides if > 0.
// Returns ("", 0) when no VAT number is set → vat_applied=false.
func (h *Handler) resolveVAT(r *http.Request, issuer string, callerRatePct float64) (vatNumber string, ratePct float64, err error) {
	if issuer == "platform" {
		return h.platform.VATNumber, callerRatePct, nil
	}
	// tenant
	tp, tpErr := h.store.GetTaxProfile(r.Context())
	if errors.Is(tpErr, ErrNotFound) {
		return "", 0, nil // no profile → no VAT
	}
	if tpErr != nil {
		return "", 0, tpErr
	}
	if tp.VATNumber == nil {
		return "", 0, nil
	}
	rate := callerRatePct
	if rate == 0 && tp.VATRatePercent != nil {
		rate = *tp.VATRatePercent
	}
	return *tp.VATNumber, rate, nil
}

// resolveIssuerInfo builds the IssuerInfo for a given issuer type.
func (h *Handler) resolveIssuerInfo(r *http.Request, issuer string) (IssuerInfo, error) {
	if issuer == "platform" {
		return IssuerInfo{
			LegalName:         h.platform.LegalName,
			RegisteredAddress: h.platform.RegisteredAddress,
			Country:           h.platform.Country,
			VATNumber:         h.platform.VATNumber,
			CompanyNumber:     h.platform.CompanyNumber,
		}, nil
	}

	tp, err := h.store.GetTaxProfile(r.Context())
	if errors.Is(err, ErrNotFound) {
		return IssuerInfo{}, nil // tenant has no profile yet — still render
	}
	if err != nil {
		return IssuerInfo{}, err
	}

	info := IssuerInfo{
		LegalName:         tp.LegalName,
		RegisteredAddress: tp.RegisteredAddress,
		Country:           tp.Country,
	}
	if tp.VATNumber != nil {
		info.VATNumber = *tp.VATNumber
	}
	if tp.CompanyNumber != nil {
		info.CompanyNumber = *tp.CompanyNumber
	}
	if tp.ContactEmail != nil {
		info.ContactEmail = *tp.ContactEmail
	}
	if tp.ContactPhone != nil {
		info.ContactPhone = *tp.ContactPhone
	}
	return info, nil
}

// ---------------------------------------------------------------------------
// JSON helpers
// ---------------------------------------------------------------------------

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(v)
}

func writeErr(w http.ResponseWriter, code int, msg string) {
	writeJSON(w, code, map[string]string{"error": msg})
}
