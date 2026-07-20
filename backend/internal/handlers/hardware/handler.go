package hardware

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"sync"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/beepbite/backend/internal/auth"
	"github.com/beepbite/backend/internal/escpos"
	"github.com/beepbite/backend/internal/locations"
	"github.com/beepbite/backend/internal/money"
)

// Handler wires HTTP routes to the Store.
type Handler struct {
	store *Store
	pool  *pgxpool.Pool
}

// NewHandler constructs a Handler backed by pool.
func NewHandler(pool *pgxpool.Pool) *Handler {
	return &Handler{
		store: NewStore(pool),
		pool:  pool,
	}
}

// Mount registers all hardware routes under the provided router.
// Wire as: r.Route("/hardware", hw.Mount)
func (h *Handler) Mount(r chi.Router) {
	// Printer CRUD
	r.Get("/printers", h.listPrinters)
	r.Post("/printers", h.createPrinter)
	r.Get("/printers/{id}", h.getPrinter)
	r.Put("/printers/{id}", h.updatePrinter)
	r.Delete("/printers/{id}", h.deletePrinter)
	r.Post("/printers/{id}/test", h.testPrinter)

	// Print jobs
	r.Post("/print/receipt", h.printReceipt)
	r.Post("/print/kitchen", h.printKitchen)
}

// ---------------------------------------------------------------------------
// Request / response helpers
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Printer CRUD handlers
// ---------------------------------------------------------------------------

// GET /hardware/printers?location_id=<uuid>
func (h *Handler) listPrinters(w http.ResponseWriter, r *http.Request) {
	locationID := r.URL.Query().Get("location_id")
	if locationID == "" {
		writeErr(w, http.StatusBadRequest, "location_id query param required")
		return
	}
	if !auth.OrgScopeFrom(r.Context()).AllowsLocation(locationID) {
		writeErr(w, http.StatusNotFound, "not found")
		return
	}
	printers, err := h.store.ListPrinters(r.Context(), locationID)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, printers)
}

// POST /hardware/printers
func (h *Handler) createPrinter(w http.ResponseWriter, r *http.Request) {
	var req CreatePrinterReq
	if err := decodeJSON(r, &req); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid request body: "+err.Error())
		return
	}
	if req.LocationID == "" || req.Name == "" || req.Kind == "" || req.Connection == "" {
		writeErr(w, http.StatusBadRequest, "location_id, name, kind, and connection are required")
		return
	}
	if !auth.OrgScopeFrom(r.Context()).AllowsLocation(req.LocationID) {
		writeErr(w, http.StatusNotFound, "not found")
		return
	}
	p, err := h.store.CreatePrinter(r.Context(), req)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, p)
}

// GET /hardware/printers/{id}
func (h *Handler) getPrinter(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	p, err := h.store.GetPrinter(r.Context(), id)
	switch {
	case err == ErrPrinterNotFound:
		writeErr(w, http.StatusNotFound, "printer not found")
		return
	case err != nil:
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	if !auth.OrgScopeFrom(r.Context()).AllowsLocation(p.LocationID) {
		writeErr(w, http.StatusNotFound, "not found")
		return
	}
	writeJSON(w, http.StatusOK, p)
}

// PUT /hardware/printers/{id}
func (h *Handler) updatePrinter(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	// Load first for cross-tenant guard.
	existing, err := h.store.GetPrinter(r.Context(), id)
	switch {
	case err == ErrPrinterNotFound:
		writeErr(w, http.StatusNotFound, "printer not found")
		return
	case err != nil:
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	if !auth.OrgScopeFrom(r.Context()).AllowsLocation(existing.LocationID) {
		writeErr(w, http.StatusNotFound, "not found")
		return
	}

	var req UpdatePrinterReq
	if err := decodeJSON(r, &req); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid request body: "+err.Error())
		return
	}
	p, err := h.store.UpdatePrinter(r.Context(), id, req)
	switch {
	case err == ErrPrinterNotFound:
		writeErr(w, http.StatusNotFound, "printer not found")
		return
	case err != nil:
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, p)
}

// DELETE /hardware/printers/{id}
func (h *Handler) deletePrinter(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	// Load first for cross-tenant guard.
	existing, err := h.store.GetPrinter(r.Context(), id)
	switch {
	case err == ErrPrinterNotFound:
		writeErr(w, http.StatusNotFound, "printer not found")
		return
	case err != nil:
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	if !auth.OrgScopeFrom(r.Context()).AllowsLocation(existing.LocationID) {
		writeErr(w, http.StatusNotFound, "not found")
		return
	}

	if err := h.store.DeletePrinter(r.Context(), id); err != nil {
		if err == ErrPrinterNotFound {
			writeErr(w, http.StatusNotFound, "printer not found")
		} else {
			writeErr(w, http.StatusInternalServerError, err.Error())
		}
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// ---------------------------------------------------------------------------
// Test print
// ---------------------------------------------------------------------------

type testPrintResp struct {
	PrinterID string `json:"printer_id"`
	Sent      bool   `json:"sent"`
	Error     string `json:"error,omitempty"`
}

// POST /hardware/printers/{id}/test
// Sends a test ESC/POS ticket to the printer. Only works for network printers;
// USB printers return a stub success (the POS agent handles USB).
func (h *Handler) testPrinter(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	p, err := h.store.GetPrinter(r.Context(), id)
	switch {
	case err == ErrPrinterNotFound:
		writeErr(w, http.StatusNotFound, "printer not found")
		return
	case err != nil:
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	if !auth.OrgScopeFrom(r.Context()).AllowsLocation(p.LocationID) {
		writeErr(w, http.StatusNotFound, "not found")
		return
	}

	resp := testPrintResp{PrinterID: id}

	if p.Connection == "usb" {
		// USB is handled by the POS agent; we cannot reach it from the backend.
		resp.Sent = true
		resp.Error = "usb: send via pos agent"
		writeJSON(w, http.StatusOK, resp)
		return
	}

	if p.Host == nil || *p.Host == "" {
		writeErr(w, http.StatusBadRequest, "printer has no host configured")
		return
	}

	data := buildTestTicket(p.Name)
	printer := escpos.NewNetworkPrinter(*p.Host, p.Port)
	if err := printer.Print(r.Context(), data); err != nil {
		resp.Error = err.Error()
		writeJSON(w, http.StatusOK, resp)
		return
	}
	resp.Sent = true
	writeJSON(w, http.StatusOK, resp)
}

// buildTestTicket builds a minimal ESC/POS test page.
func buildTestTicket(printerName string) []byte {
	return escpos.New().
		Init().
		Align(escpos.AlignCenter).
		Bold(true).
		Text("BEEPBITE\n").
		Bold(false).
		Text("Printer Test\n").
		Divider().
		Align(escpos.AlignLeft).
		Text(fmt.Sprintf("Printer : %s\n", printerName)).
		Text("Status  : OK\n").
		Divider().
		Align(escpos.AlignCenter).
		Text("ESC/POS communication OK\n").
		LineFeed().
		Cut().
		Bytes()
}

// ---------------------------------------------------------------------------
// Print job request types
// ---------------------------------------------------------------------------

type printReceiptReq struct {
	OrderID    string  `json:"order_id"`
	PrinterID  *string `json:"printer_id,omitempty"` // nil → auto-select first active receipt printer
	LocationID string  `json:"location_id"`
}

type printKitchenReq struct {
	OrderID    string  `json:"order_id"`
	StationID  *string `json:"station_id,omitempty"` // nil → all active kitchen printers
	LocationID string  `json:"location_id"`
}

type printJobResp struct {
	PrinterID string `json:"printer_id"`
	Sent      bool   `json:"sent"`
	Error     string `json:"error,omitempty"`
}

// ---------------------------------------------------------------------------
// Print job handlers
// ---------------------------------------------------------------------------

// POST /hardware/print/receipt
func (h *Handler) printReceipt(w http.ResponseWriter, r *http.Request) {
	var req printReceiptReq
	if err := decodeJSON(r, &req); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid request: "+err.Error())
		return
	}
	if req.OrderID == "" || req.LocationID == "" {
		writeErr(w, http.StatusBadRequest, "order_id and location_id are required")
		return
	}
	if !auth.OrgScopeFrom(r.Context()).AllowsLocation(req.LocationID) {
		writeErr(w, http.StatusNotFound, "not found")
		return
	}

	snap, err := h.store.GetOrderSnapshot(r.Context(), req.OrderID)
	if err == ErrOrderNotFound {
		writeErr(w, http.StatusNotFound, "order not found")
		return
	}
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}

	// Resolve how this location prints money before building the ticket; a
	// wrong exponent silently misstates every amount on the slip.
	set, err := locations.SettingsFor(r.Context(), h.pool, req.LocationID)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "resolve location settings: "+err.Error())
		return
	}

	data := buildReceiptTicket(snap, set)

	// Resolve printer(s) to send to.
	var printers []Printer
	if req.PrinterID != nil && *req.PrinterID != "" {
		p, err := h.store.GetPrinter(r.Context(), *req.PrinterID)
		if err != nil {
			writeErr(w, http.StatusNotFound, "printer not found")
			return
		}
		printers = []Printer{*p}
	} else {
		printers, err = h.store.GetPrintersForLocation(r.Context(), req.LocationID, "receipt")
		if err != nil {
			writeErr(w, http.StatusInternalServerError, err.Error())
			return
		}
	}

	results := dispatchPrint(r.Context(), printers, data)
	writeJSON(w, http.StatusOK, results)
}

// POST /hardware/print/kitchen
func (h *Handler) printKitchen(w http.ResponseWriter, r *http.Request) {
	var req printKitchenReq
	if err := decodeJSON(r, &req); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid request: "+err.Error())
		return
	}
	if req.OrderID == "" || req.LocationID == "" {
		writeErr(w, http.StatusBadRequest, "order_id and location_id are required")
		return
	}
	if !auth.OrgScopeFrom(r.Context()).AllowsLocation(req.LocationID) {
		writeErr(w, http.StatusNotFound, "not found")
		return
	}

	snap, err := h.store.GetOrderSnapshot(r.Context(), req.OrderID)
	if err == ErrOrderNotFound {
		writeErr(w, http.StatusNotFound, "order not found")
		return
	}
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}

	data := buildKitchenTicket(snap)

	// Fetch active kitchen printers; filter by station_id if provided.
	allPrinters, err := h.store.GetPrintersForLocation(r.Context(), req.LocationID, "kitchen")
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}

	var printers []Printer
	for _, p := range allPrinters {
		if req.StationID != nil && *req.StationID != "" {
			// Only send to printers mapped to this station (or unmapped printers).
			if p.StationID == nil || *p.StationID == *req.StationID {
				printers = append(printers, p)
			}
		} else {
			printers = append(printers, p)
		}
	}

	results := dispatchPrint(r.Context(), printers, data)
	writeJSON(w, http.StatusOK, results)
}

// dispatchPrint sends data to all network printers concurrently and returns
// per-printer results. USB printers get a stub success (the POS agent handles
// those locally).
func dispatchPrint(ctx context.Context, printers []Printer, data []byte) []printJobResp {
	// Pre-allocate one result slot per printer and index into it by position so
	// the goroutines never share/append to the same slice (no data race).
	results := make([]printJobResp, len(printers))
	var wg sync.WaitGroup
	for i, p := range printers {
		results[i] = printJobResp{PrinterID: p.ID}
		switch {
		case p.Connection == "usb":
			// USB printers are handled locally by the POS agent — stub success.
			results[i].Sent = true
			results[i].Error = "usb: send via pos agent"
		case p.Host == nil || *p.Host == "":
			results[i].Error = "no host configured"
		default:
			// Dial + print each network printer concurrently so one offline
			// printer's dial timeout doesn't serialize the whole response.
			wg.Add(1)
			go func(i int, host string, port int) {
				defer wg.Done()
				np := escpos.NewNetworkPrinter(host, port)
				if err := np.Print(ctx, data); err != nil {
					results[i].Error = err.Error()
				} else {
					results[i].Sent = true
				}
			}(i, *p.Host, p.Port)
		}
	}
	wg.Wait()
	return results
}

// ---------------------------------------------------------------------------
// ESC/POS ticket builders
// ---------------------------------------------------------------------------

// buildReceiptTicket builds a customer-facing receipt ticket.
//
// set is the printing location's locale posture. Only its currency matters
// here: it supplies the ISO code for the header and, more importantly, the
// minor-unit exponent. Thermal receipts previously divided every amount by 100
// and printed it with two decimals, which turns a ¥1000 line into "10.00" and
// a KD 1.234 line into "12.34" — the customer is handed a slip that disagrees
// with what the card machine charged.
//
// Amounts use money.Decimal, not money.Format: this is a fixed-pitch 42-column
// thermal printer, so the column must contain digits only. Locale grouping
// ("1 234,56") and a variable-width symbol would both break the alignment, and
// most ESC/POS code pages cannot render ¥ or ₦ at all. The currency is stated
// once, in the header, where it applies to every figure below it.
func buildReceiptTicket(s *OrderSnapshot, set locations.Settings) []byte {
	decimals := set.Decimals()

	// amount renders one right-aligned money column. The width matches the old
	// "R%7.2f" field (symbol + 7) so the 42-column layout is unchanged; a
	// 3-decimal currency simply uses more of the reserved space.
	amount := func(minor int64) string {
		return fmt.Sprintf("%8s", money.Decimal(minor, decimals))
	}

	b := escpos.New().
		Init().
		Align(escpos.AlignCenter).
		Bold(true).
		Text(s.StoreName + "\n").
		Bold(false)

	if s.StoreAddress != nil && *s.StoreAddress != "" {
		b.Text(*s.StoreAddress + "\n")
	}

	b.Divider().
		Align(escpos.AlignLeft).
		Text(fmt.Sprintf("Order : %s\n", s.OrderNumber))

	// State the currency once. Omitted entirely when the location has none
	// configured — a bare number is honest, an invented "R" is not.
	if code := currencyCode(s, set); code != "" {
		b.Text(fmt.Sprintf("Prices in %s\n", code))
	}
	b.Divider()

	for _, item := range s.Items {
		line := fmt.Sprintf("%-24s %3d %s\n",
			truncate(item.ItemName, 24),
			item.Quantity,
			amount(item.UnitPriceCents*item.Quantity),
		)
		b.Text(line)
	}

	b.Divider().
		Text(fmt.Sprintf("%-24s        %s\n", "Subtotal", amount(s.SubtotalCents))).
		Text(fmt.Sprintf("%-24s        %s\n", set.Tax.EffectiveLabel(), amount(s.TaxCents)))

	if s.TipCents > 0 {
		b.Text(fmt.Sprintf("%-24s        %s\n", "Tip", amount(s.TipCents)))
	}

	// The grand total repeats the currency, because it is the one figure a
	// customer reads in isolation.
	totalLabel := "TOTAL"
	if code := currencyCode(s, set); code != "" {
		totalLabel = "TOTAL " + code
	}
	b.Bold(true).
		Text(fmt.Sprintf("%-24s        %s\n", totalLabel, amount(s.TotalCents))).
		Bold(false).
		Divider().
		Align(escpos.AlignCenter).
		Text("Thank you!\n").
		LineFeed().
		Cut()

	return b.Bytes()
}

// currencyCode picks the ISO code to print on a ticket.
//
// The order's own snapshot wins: it records what the customer was actually
// charged in, and must not be relabelled if the location's setting changes
// later. The live location setting is only a fallback for orders written
// before currency_code was populated.
func currencyCode(s *OrderSnapshot, set locations.Settings) string {
	if s.CurrencyCode != "" {
		return s.CurrencyCode
	}
	return set.Currency.Code
}

// buildKitchenTicket builds a kitchen order ticket.
func buildKitchenTicket(s *OrderSnapshot) []byte {
	b := escpos.New().
		Init().
		Align(escpos.AlignCenter).
		Bold(true).
		Text("KITCHEN TICKET\n").
		Bold(false).
		Text(fmt.Sprintf("Order: %s\n", s.OrderNumber)).
		Divider().
		Align(escpos.AlignLeft)

	for _, item := range s.Items {
		b.Bold(true).
			Text(fmt.Sprintf("%d x %s\n", item.Quantity, item.ItemName)).
			Bold(false)
	}

	b.Divider().
		LineFeed().
		Cut()

	return b.Bytes()
}

// truncate shortens s to maxLen runes, appending "…" if truncated.
func truncate(s string, maxLen int) string {
	runes := []rune(s)
	if len(runes) <= maxLen {
		return s
	}
	return string(runes[:maxLen-1]) + "…"
}
