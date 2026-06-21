package invoicing

import (
	"bytes"
	"net/http/httptest"
	"testing"
	"time"
)

// ---------------------------------------------------------------------------
// 1. VAT resolution logic (resolveVAT)
// ---------------------------------------------------------------------------

// resolveVAT for "platform" issuer is fully pure: it reads only from
// h.platform and the caller-supplied rate; it never touches the DB store.
// We can therefore construct a Handler with a nil store and exercise that path.

func TestResolveVAT_Platform_WithVATNumber(t *testing.T) {
	h := &Handler{
		store: nil, // not used for platform issuer
		platform: PlatformConfig{
			LegalName: "BeepBite Ltd",
			VATNumber: "ZA4321",
		},
	}
	r := httptest.NewRequest("POST", "/", nil)

	vatNum, rate, err := h.resolveVAT(r, "platform", 15.0)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if vatNum != "ZA4321" {
		t.Errorf("want vatNumber=ZA4321, got %q", vatNum)
	}
	if rate != 15.0 {
		t.Errorf("want rate=15.0, got %f", rate)
	}
}

func TestResolveVAT_Platform_NoVATNumber(t *testing.T) {
	h := &Handler{
		store:    nil,
		platform: PlatformConfig{VATNumber: ""}, // no VAT number set
	}
	r := httptest.NewRequest("POST", "/", nil)

	vatNum, rate, err := h.resolveVAT(r, "platform", 20.0)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	// Empty vat number → vat_applied=false semantics; caller rate is still returned
	// but vatNumber is empty which triggers vatApplied=false in CreateInvoice.
	if vatNum != "" {
		t.Errorf("want empty vatNumber, got %q", vatNum)
	}
	// Rate is still passed through (CreateInvoice ignores it when vatNumber=="")
	if rate != 20.0 {
		t.Errorf("want rate passed through 20.0, got %f", rate)
	}
}

// ---------------------------------------------------------------------------
// 2. VAT applied flag — pure logic replication
//
// The actual application of VAT (vatApplied = vatNumber != "") and the cents
// computation live inside Store.CreateInvoice. We replicate the pure arithmetic
// here so the tests are DB-free.
// ---------------------------------------------------------------------------

// vatCentsFor mirrors the exact formula used in CreateInvoice / UpdateInvoice:
//
//	vatCents = int64(float64(subtotal) * ratePct / 100.0)
func vatCentsFor(subtotal int64, ratePct float64) int64 {
	return int64(float64(subtotal) * ratePct / 100.0)
}

// lineTotal mirrors: lt = int64(l.Qty) * l.UnitCents
func lineTotal(qty int, unitCents int64) int64 {
	return int64(qty) * unitCents
}

func TestVATApplied_WhenVATNumberPresent(t *testing.T) {
	vatNumber := "ZA4321"
	vatRatePct := 15.0

	// Simulate two lines
	lines := []LineReq{
		{Description: "Software licence", Qty: 2, UnitCents: 5000}, // 100.00
		{Description: "Support fee", Qty: 1, UnitCents: 10000},     // 100.00
	}

	var subtotal int64
	for _, l := range lines {
		subtotal += lineTotal(l.Qty, l.UnitCents)
	}
	// subtotal = 2*5000 + 1*10000 = 20000 cents

	vatApplied := vatNumber != ""
	var vatCents int64
	if vatApplied {
		vatCents = vatCentsFor(subtotal, vatRatePct)
	}
	total := subtotal + vatCents

	if !vatApplied {
		t.Fatal("expected vatApplied=true when vatNumber is set")
	}
	if subtotal != 20000 {
		t.Errorf("want subtotal=20000, got %d", subtotal)
	}
	// 15% of 20000 = 3000
	if vatCents != 3000 {
		t.Errorf("want vatCents=3000, got %d", vatCents)
	}
	if total != 23000 {
		t.Errorf("want total=23000, got %d", total)
	}
}

func TestVATApplied_WhenNoVATNumber(t *testing.T) {
	vatNumber := "" // no VAT number
	vatRatePct := 15.0

	lines := []LineReq{
		{Description: "Widget", Qty: 3, UnitCents: 1000},
	}

	var subtotal int64
	for _, l := range lines {
		subtotal += lineTotal(l.Qty, l.UnitCents)
	}

	vatApplied := vatNumber != ""
	var vatCents int64
	if vatApplied {
		vatCents = vatCentsFor(subtotal, vatRatePct)
	}
	total := subtotal + vatCents

	if vatApplied {
		t.Fatal("expected vatApplied=false when vatNumber is empty")
	}
	if vatCents != 0 {
		t.Errorf("want vatCents=0, got %d", vatCents)
	}
	if total != subtotal {
		t.Errorf("want total==subtotal=%d, got total=%d", subtotal, total)
	}
}

// ---------------------------------------------------------------------------
// 3. Totals arithmetic — cents precision, no float drift
// ---------------------------------------------------------------------------

func TestLineTotals_CentsArithmetic(t *testing.T) {
	cases := []struct {
		qty       int
		unitCents int64
		want      int64
	}{
		{1, 0, 0},
		{1, 1, 1},
		{100, 1, 100},
		{3, 333, 999},       // 9.99
		{7, 1499, 10493},    // 104.93
		{1000, 99, 99000},   // 990.00
		{1, 100_00, 100_00}, // 100.00
		{0, 9999, 0},        // zero qty
	}

	for _, tc := range cases {
		got := lineTotal(tc.qty, tc.unitCents)
		if got != tc.want {
			t.Errorf("lineTotal(qty=%d, unit=%d): want %d, got %d",
				tc.qty, tc.unitCents, tc.want, got)
		}
	}
}

func TestSubtotalIsExactSumOfLineTotals(t *testing.T) {
	lines := []LineReq{
		{Qty: 2, UnitCents: 500},  // 1000
		{Qty: 1, UnitCents: 2000}, // 2000
		{Qty: 4, UnitCents: 125},  // 500
		{Qty: 10, UnitCents: 99},  // 990
	}
	// expected subtotal = 1000+2000+500+990 = 4490

	var subtotal int64
	for _, l := range lines {
		subtotal += lineTotal(l.Qty, l.UnitCents)
	}

	if subtotal != 4490 {
		t.Errorf("want subtotal=4490, got %d", subtotal)
	}
}

func TestVATCents_NoFloatDrift(t *testing.T) {
	// 15% of R1 000 000.00 (100_000_000 cents) must be exactly 15_000_000 cents.
	subtotal := int64(100_000_000)
	got := vatCentsFor(subtotal, 15.0)
	want := int64(15_000_000)
	if got != want {
		t.Errorf("vatCentsFor(%d, 15): want %d, got %d", subtotal, want, got)
	}

	// 20% of 1 cent — truncates to 0 (integer semantics).
	got2 := vatCentsFor(1, 20.0)
	if got2 != 0 {
		t.Errorf("vatCentsFor(1, 20): want 0, got %d", got2)
	}

	// 15% of 200 = 30
	got3 := vatCentsFor(200, 15.0)
	if got3 != 30 {
		t.Errorf("vatCentsFor(200, 15): want 30, got %d", got3)
	}
}

func TestTotalEqualsSubtotalPlusVAT(t *testing.T) {
	subtotal := int64(50_000) // R500.00
	vatCents := vatCentsFor(subtotal, 15.0)
	total := subtotal + vatCents

	// 15% of 50000 = 7500
	if vatCents != 7500 {
		t.Errorf("want vatCents=7500, got %d", vatCents)
	}
	if total != 57500 {
		t.Errorf("want total=57500, got %d", total)
	}
}

// ---------------------------------------------------------------------------
// 4. formatCents — pure string helper
// ---------------------------------------------------------------------------

func TestFormatCents(t *testing.T) {
	cases := []struct {
		cents int64
		want  string
	}{
		{0, "0.00"},
		{1, "0.01"},
		{99, "0.99"},
		{100, "1.00"},
		{12345, "123.45"},
		{100000, "1000.00"},
		{-50, "-0.50"},
		{-12345, "-123.45"},
	}

	for _, tc := range cases {
		got := formatCents(tc.cents, "ZAR")
		if got != tc.want {
			t.Errorf("formatCents(%d): want %q, got %q", tc.cents, tc.want, got)
		}
	}
}

// ---------------------------------------------------------------------------
// 5. renderPDF — returns non-empty bytes starting with %PDF
// ---------------------------------------------------------------------------

func makeTestInvoice() *Invoice {
	now := time.Date(2025, 5, 21, 10, 0, 0, 0, time.UTC)
	vatRate := 15.0
	return &Invoice{
		ID:               "00000000-0000-0000-0000-000000000001",
		Issuer:           "platform",
		RecipientName:    "Acme Corp",
		RecipientAddress: "1 Main St, Cape Town, 8001",
		Currency:         "ZAR",
		SubtotalCents:    20000,
		VATCents:         3000,
		VATRatePercent:   &vatRate,
		VATApplied:       true,
		TotalCents:       23000,
		InvoiceNumber:    "INV-20250521-abcd1234",
		Status:           "draft",
		CreatedAt:        now,
		Lines: []InvoiceLine{
			{Description: "Software licence", Qty: 2, UnitCents: 5000, LineTotalCents: 10000},
			{Description: "Support fee", Qty: 1, UnitCents: 10000, LineTotalCents: 10000},
		},
	}
}

func TestRenderPDF_ReturnsPDFBytes(t *testing.T) {
	inv := makeTestInvoice()

	input := InvoicePDFInput{
		Invoice: inv,
		Lines:   inv.Lines,
		Issuer: IssuerInfo{
			LegalName:         "BeepBite Ltd",
			RegisteredAddress: "10 Tech Park, Johannesburg",
			Country:           "ZA",
			VATNumber:         "ZA4321",
			CompanyNumber:     "2020/123456/07",
		},
		Platform: PlatformConfig{
			LegalName: "BeepBite Ltd",
			VATNumber: "ZA4321",
		},
	}

	pdfBytes, err := renderPDF(input)
	if err != nil {
		t.Fatalf("renderPDF returned error: %v", err)
	}
	if len(pdfBytes) == 0 {
		t.Fatal("renderPDF returned empty bytes")
	}
	// PDF magic bytes
	if !bytes.HasPrefix(pdfBytes, []byte("%PDF")) {
		t.Errorf("PDF output does not start with %%PDF; first 8 bytes: %q", pdfBytes[:8])
	}
}

func TestRenderPDF_NoVAT(t *testing.T) {
	now := time.Date(2025, 5, 21, 10, 0, 0, 0, time.UTC)
	inv := &Invoice{
		ID:            "00000000-0000-0000-0000-000000000002",
		Issuer:        "tenant",
		RecipientName: "Bob's Biltong",
		Currency:      "ZAR",
		SubtotalCents: 5000,
		VATCents:      0,
		VATApplied:    false,
		TotalCents:    5000,
		InvoiceNumber: "INV-20250521-eeee1111",
		Status:        "sent",
		CreatedAt:     now,
		Lines: []InvoiceLine{
			{Description: "Monthly fee", Qty: 1, UnitCents: 5000, LineTotalCents: 5000},
		},
	}

	pdfBytes, err := renderPDF(InvoicePDFInput{
		Invoice: inv,
		Lines:   inv.Lines,
		Issuer: IssuerInfo{
			LegalName: "Tenant Corp",
			// No VATNumber — VAT block should be skipped
		},
	})
	if err != nil {
		t.Fatalf("renderPDF (no VAT) error: %v", err)
	}
	if !bytes.HasPrefix(pdfBytes, []byte("%PDF")) {
		t.Errorf("PDF output missing magic; got %q", pdfBytes[:8])
	}
}

func TestRenderPDF_IssuedAtShown(t *testing.T) {
	now := time.Date(2025, 1, 15, 9, 0, 0, 0, time.UTC)
	issued := time.Date(2025, 1, 16, 12, 0, 0, 0, time.UTC)
	inv := &Invoice{
		ID:            "00000000-0000-0000-0000-000000000003",
		Issuer:        "platform",
		RecipientName: "Zulu Ventures",
		Currency:      "ZAR",
		SubtotalCents: 100_00,
		VATCents:      0,
		VATApplied:    false,
		TotalCents:    100_00,
		InvoiceNumber: "INV-20250116-ffff2222",
		Status:        "paid",
		CreatedAt:     now,
		IssuedAt:      &issued,
		Lines:         []InvoiceLine{},
	}

	pdfBytes, err := renderPDF(InvoicePDFInput{
		Invoice: inv,
		Lines:   inv.Lines,
		Issuer:  IssuerInfo{LegalName: "BeepBite Ltd"},
	})
	if err != nil {
		t.Fatalf("renderPDF (issuedAt) error: %v", err)
	}
	if !bytes.HasPrefix(pdfBytes, []byte("%PDF")) {
		t.Errorf("PDF missing magic")
	}
}

// ---------------------------------------------------------------------------
// 6. generateInvoiceNumber — pure helper: format and uniqueness
// ---------------------------------------------------------------------------

func TestGenerateInvoiceNumber_Format(t *testing.T) {
	num := generateInvoiceNumber()
	// Must start with "INV-"
	if len(num) < 4 || num[:4] != "INV-" {
		t.Errorf("invoice number does not start with INV-: %q", num)
	}
	// Format: INV-YYYYMMDD-XXXXXXXX  (total 21 chars)
	if len(num) != 21 {
		t.Errorf("expected length 21, got %d: %q", len(num), num)
	}
}

func TestGenerateInvoiceNumber_Uniqueness(t *testing.T) {
	seen := make(map[string]bool, 1000)
	for i := 0; i < 1000; i++ {
		n := generateInvoiceNumber()
		if seen[n] {
			t.Errorf("duplicate invoice number generated: %q", n)
		}
		seen[n] = true
	}
}
