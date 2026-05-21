package invoicing

// DB-backed integration tests for the invoicing Store.
//
// Run:
//
//	cd /home/exo/Documents/beepbite-mono/backend
//	go test ./internal/handlers/invoicing/ -run Integration -v
//
// The tests are skipped automatically when no Postgres backend is available
// (Docker absent and DATABASE_URL unset) via testenv.ErrSkip → os.Exit(0).
//
// Each sub-test seeds its own unique organization via ServiceRoleScope so that
// RLS isolation is verified: an invoice created under org-A is invisible when
// listing under org-B's scope.

import (
	"context"
	"errors"
	"fmt"
	"log"
	"os"
	"testing"

	"github.com/beepbite/backend/cmd/tests/testenv"
	"github.com/beepbite/backend/internal/db"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// ---------------------------------------------------------------------------
// Package-level state — set once in TestMain, shared across Integration* tests
// ---------------------------------------------------------------------------

var integrationPool *pgxpool.Pool

func TestMain(m *testing.M) {
	ctx := context.Background()
	pool, cleanup, err := testenv.StartPostgres(ctx)
	if errors.Is(err, testenv.ErrSkip) {
		fmt.Println("skipping integration tests: no postgres available:", err)
		os.Exit(0)
	}
	if err != nil {
		log.Fatal("testenv.StartPostgres:", err)
	}
	defer cleanup()
	integrationPool = pool
	os.Exit(m.Run())
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// seedOrg inserts a fresh organization via service-role and returns its UUID.
// Each test calls this so RLS isolation can be verified between distinct orgs.
func seedOrg(t *testing.T, ctx context.Context, pool *pgxpool.Pool, name string) string {
	t.Helper()
	var orgID string
	err := db.Scoped(ctx, pool, db.ServiceRoleScope(), func(tx pgx.Tx) error {
		return tx.QueryRow(ctx,
			`INSERT INTO organizations (name) VALUES ($1) RETURNING id`,
			name,
		).Scan(&orgID)
	})
	if err != nil {
		t.Fatalf("seedOrg %q: %v", name, err)
	}
	return orgID
}

// orgCtx returns a context that carries a db.Scope scoped to orgID.
func orgCtx(parent context.Context, orgID string) context.Context {
	return db.ContextWithScope(parent, db.Scope{OrgID: orgID})
}

// strPtr is a convenience pointer-from-literal helper.
func strPtr(s string) *string { return &s }

// float64Ptr is a convenience pointer-from-literal helper.
func float64Ptr(f float64) *float64 { return &f }

// ---------------------------------------------------------------------------
// 1. TaxProfile round-trip (UpsertTaxProfile → GetTaxProfile)
// ---------------------------------------------------------------------------

func TestIntegration_TaxProfile_RoundTrip(t *testing.T) {
	ctx := context.Background()
	orgID := seedOrg(t, ctx, integrationPool, "TaxProfile RoundTrip Org")
	store := NewStore(integrationPool)

	// --- 1a. Insert a full profile with all optional fields ---
	vatNum := "ZA1234567"
	vatRate := 15.0
	compNum := "2020/123456/07"
	email := "billing@example.com"
	phone := "+27821234567"

	input := TaxProfile{
		LegalName:         "Acme Pty Ltd",
		RegisteredAddress: "1 Main St, Cape Town",
		Country:           "ZA",
		VATNumber:         &vatNum,
		VATRatePercent:    &vatRate,
		CompanyNumber:     &compNum,
		ContactEmail:      &email,
		ContactPhone:      &phone,
	}

	ctx1 := orgCtx(ctx, orgID)
	saved, err := store.UpsertTaxProfile(ctx1, input)
	if err != nil {
		t.Fatalf("UpsertTaxProfile: %v", err)
	}
	if saved.OrgID != orgID {
		t.Errorf("saved.OrgID=%q want %q", saved.OrgID, orgID)
	}
	if saved.LegalName != "Acme Pty Ltd" {
		t.Errorf("LegalName=%q", saved.LegalName)
	}
	if saved.VATNumber == nil || *saved.VATNumber != vatNum {
		t.Errorf("VATNumber: got %v want %q", saved.VATNumber, vatNum)
	}
	if saved.VATRatePercent == nil || *saved.VATRatePercent != vatRate {
		t.Errorf("VATRatePercent: got %v want %v", saved.VATRatePercent, vatRate)
	}
	if saved.CompanyNumber == nil || *saved.CompanyNumber != compNum {
		t.Errorf("CompanyNumber: got %v", saved.CompanyNumber)
	}
	if saved.ContactEmail == nil || *saved.ContactEmail != email {
		t.Errorf("ContactEmail: got %v", saved.ContactEmail)
	}
	if saved.ContactPhone == nil || *saved.ContactPhone != phone {
		t.Errorf("ContactPhone: got %v", saved.ContactPhone)
	}

	// --- 1b. Get confirms the row is visible under the same org scope ---
	got, err := store.GetTaxProfile(ctx1)
	if err != nil {
		t.Fatalf("GetTaxProfile: %v", err)
	}
	if got.OrgID != orgID {
		t.Errorf("GetTaxProfile OrgID=%q want %q", got.OrgID, orgID)
	}
	if got.LegalName != "Acme Pty Ltd" {
		t.Errorf("GetTaxProfile LegalName=%q", got.LegalName)
	}

	// --- 1c. Update (upsert) clears optional nullable fields ---
	inputNulls := TaxProfile{
		LegalName:         "Acme Pty Ltd Updated",
		RegisteredAddress: "2 New St, Joburg",
		Country:           "ZA",
		VATNumber:         nil,
		VATRatePercent:    nil,
		CompanyNumber:     nil,
		ContactEmail:      nil,
		ContactPhone:      nil,
	}
	updated, err := store.UpsertTaxProfile(ctx1, inputNulls)
	if err != nil {
		t.Fatalf("UpsertTaxProfile (update): %v", err)
	}
	if updated.VATNumber != nil {
		t.Errorf("expected VATNumber=nil after clearing, got %v", updated.VATNumber)
	}
	if updated.VATRatePercent != nil {
		t.Errorf("expected VATRatePercent=nil after clearing, got %v", updated.VATRatePercent)
	}
	if updated.LegalName != "Acme Pty Ltd Updated" {
		t.Errorf("LegalName not updated: %q", updated.LegalName)
	}

	// --- 1d. GetTaxProfile from a DIFFERENT org returns ErrNotFound (RLS) ---
	otherOrgID := seedOrg(t, ctx, integrationPool, "TaxProfile Other Org")
	otherCtx := orgCtx(ctx, otherOrgID)
	_, err = store.GetTaxProfile(otherCtx)
	if !errors.Is(err, ErrNotFound) {
		t.Errorf("GetTaxProfile for other org: want ErrNotFound, got %v", err)
	}
}

// ---------------------------------------------------------------------------
// 2. CreateInvoice — with and without VAT
// ---------------------------------------------------------------------------

func TestIntegration_CreateInvoice_WithVAT(t *testing.T) {
	ctx := context.Background()
	orgID := seedOrg(t, ctx, integrationPool, "CreateInvoice VAT Org")
	store := NewStore(integrationPool)
	ctx1 := orgCtx(ctx, orgID)

	req := CreateInvoiceReq{
		Issuer:           "platform",
		RecipientName:    "Customer Corp",
		RecipientAddress: "10 Customer Rd",
		Currency:         "ZAR",
		Lines: []LineReq{
			{Description: "Software licence", Qty: 2, UnitCents: 5000}, // 10000
			{Description: "Support fee", Qty: 1, UnitCents: 10000},     // 10000
		},
		VATRatePct: 15.0,
	}
	// issuer has a VAT number → VAT applied
	vatNumber := "ZA9999999"
	vatRate := 15.0

	inv, err := store.CreateInvoice(ctx1, req, vatNumber, vatRate)
	if err != nil {
		t.Fatalf("CreateInvoice: %v", err)
	}

	if !inv.VATApplied {
		t.Error("VATApplied should be true when vatNumber is set")
	}
	if inv.SubtotalCents != 20000 {
		t.Errorf("SubtotalCents want 20000 got %d", inv.SubtotalCents)
	}
	// 15% of 20000 = 3000
	if inv.VATCents != 3000 {
		t.Errorf("VATCents want 3000 got %d", inv.VATCents)
	}
	if inv.TotalCents != 23000 {
		t.Errorf("TotalCents want 23000 got %d", inv.TotalCents)
	}
	if inv.VATRatePercent == nil || *inv.VATRatePercent != 15.0 {
		t.Errorf("VATRatePercent want 15.0 got %v", inv.VATRatePercent)
	}
	if inv.InvoiceNumber == "" {
		t.Error("InvoiceNumber should be populated")
	}
	if inv.Status != "draft" {
		t.Errorf("Status want draft got %q", inv.Status)
	}
	if len(inv.Lines) != 2 {
		t.Errorf("Lines want 2 got %d", len(inv.Lines))
	}
	if inv.Lines[0].LineTotalCents != 10000 {
		t.Errorf("Line[0].LineTotalCents want 10000 got %d", inv.Lines[0].LineTotalCents)
	}
	if inv.Lines[1].LineTotalCents != 10000 {
		t.Errorf("Line[1].LineTotalCents want 10000 got %d", inv.Lines[1].LineTotalCents)
	}
	if inv.IssuerOrgID == nil || *inv.IssuerOrgID != orgID {
		t.Errorf("IssuerOrgID want %q got %v", orgID, inv.IssuerOrgID)
	}
	if inv.Currency != "ZAR" {
		t.Errorf("Currency want ZAR got %q", inv.Currency)
	}
}

func TestIntegration_CreateInvoice_NoVAT(t *testing.T) {
	ctx := context.Background()
	orgID := seedOrg(t, ctx, integrationPool, "CreateInvoice NoVAT Org")
	store := NewStore(integrationPool)
	ctx1 := orgCtx(ctx, orgID)

	req := CreateInvoiceReq{
		Issuer:           "platform",
		RecipientName:    "No VAT Customer",
		RecipientAddress: "99 Free St",
		Currency:         "ZAR",
		Lines: []LineReq{
			{Description: "Basic plan", Qty: 3, UnitCents: 1000}, // 3000
		},
		VATRatePct: 15.0, // rate provided but vatNumber empty → ignored
	}

	inv, err := store.CreateInvoice(ctx1, req, "", 15.0)
	if err != nil {
		t.Fatalf("CreateInvoice (no VAT): %v", err)
	}

	if inv.VATApplied {
		t.Error("VATApplied should be false when vatNumber is empty")
	}
	if inv.VATCents != 0 {
		t.Errorf("VATCents want 0 got %d", inv.VATCents)
	}
	if inv.VATRatePercent != nil {
		t.Errorf("VATRatePercent want nil got %v", inv.VATRatePercent)
	}
	if inv.SubtotalCents != 3000 {
		t.Errorf("SubtotalCents want 3000 got %d", inv.SubtotalCents)
	}
	if inv.TotalCents != 3000 {
		t.Errorf("TotalCents want 3000 (no VAT) got %d", inv.TotalCents)
	}
	if inv.InvoiceNumber == "" {
		t.Error("InvoiceNumber should always be populated")
	}
}

// ---------------------------------------------------------------------------
// 3. Status transitions
// ---------------------------------------------------------------------------

func TestIntegration_StatusTransitions(t *testing.T) {
	ctx := context.Background()
	orgID := seedOrg(t, ctx, integrationPool, "Status Transitions Org")
	store := NewStore(integrationPool)
	ctx1 := orgCtx(ctx, orgID)

	createReq := CreateInvoiceReq{
		Issuer:           "platform",
		RecipientName:    "Transition Corp",
		RecipientAddress: "5 State Machine Rd",
		Currency:         "ZAR",
		Lines:            []LineReq{{Description: "Item", Qty: 1, UnitCents: 1000}},
	}

	// --- 3a. draft → sent (IssueInvoice) ---
	inv, err := store.CreateInvoice(ctx1, createReq, "", 0)
	if err != nil {
		t.Fatalf("CreateInvoice: %v", err)
	}
	if inv.Status != "draft" {
		t.Fatalf("initial status want draft got %q", inv.Status)
	}

	issued, err := store.IssueInvoice(ctx1, inv.ID)
	if err != nil {
		t.Fatalf("IssueInvoice: %v", err)
	}
	if issued.Status != "sent" {
		t.Errorf("after IssueInvoice: want sent got %q", issued.Status)
	}
	if issued.IssuedAt == nil {
		t.Error("IssuedAt should be set after IssueInvoice")
	}

	// --- 3b. sent → paid (MarkPaid) ---
	paid, err := store.MarkPaid(ctx1, inv.ID)
	if err != nil {
		t.Fatalf("MarkPaid: %v", err)
	}
	if paid.Status != "paid" {
		t.Errorf("after MarkPaid: want paid got %q", paid.Status)
	}

	// --- 3c. Illegal transition: MarkPaid on already-paid → ErrInvoiceNotIssued ---
	_, err = store.MarkPaid(ctx1, inv.ID)
	if !errors.Is(err, ErrInvoiceNotIssued) {
		t.Errorf("double MarkPaid: want ErrInvoiceNotIssued got %v", err)
	}

	// --- 3d. VoidInvoice on a draft ---
	inv2, err := store.CreateInvoice(ctx1, createReq, "", 0)
	if err != nil {
		t.Fatalf("CreateInvoice (for void): %v", err)
	}
	voided, err := store.VoidInvoice(ctx1, inv2.ID)
	if err != nil {
		t.Fatalf("VoidInvoice (draft): %v", err)
	}
	if voided.Status != "void" {
		t.Errorf("after VoidInvoice: want void got %q", voided.Status)
	}

	// --- 3e. IssueInvoice on non-draft (sent) → ErrInvoiceNotDraft ---
	inv3, err := store.CreateInvoice(ctx1, createReq, "", 0)
	if err != nil {
		t.Fatalf("CreateInvoice (for illegal issue): %v", err)
	}
	if _, err = store.IssueInvoice(ctx1, inv3.ID); err != nil {
		t.Fatalf("IssueInvoice: %v", err)
	}
	// Try to issue again (now sent) → should fail
	_, err = store.IssueInvoice(ctx1, inv3.ID)
	if !errors.Is(err, ErrInvoiceNotDraft) {
		t.Errorf("IssueInvoice on sent invoice: want ErrInvoiceNotDraft got %v", err)
	}

	// --- 3f. VoidInvoice on a paid invoice → ErrInvoiceNotDraft ---
	inv4, err := store.CreateInvoice(ctx1, createReq, "", 0)
	if err != nil {
		t.Fatalf("CreateInvoice (for void-paid): %v", err)
	}
	if _, err = store.IssueInvoice(ctx1, inv4.ID); err != nil {
		t.Fatalf("IssueInvoice: %v", err)
	}
	if _, err = store.MarkPaid(ctx1, inv4.ID); err != nil {
		t.Fatalf("MarkPaid: %v", err)
	}
	_, err = store.VoidInvoice(ctx1, inv4.ID)
	if !errors.Is(err, ErrInvoiceNotDraft) {
		t.Errorf("VoidInvoice on paid: want ErrInvoiceNotDraft got %v", err)
	}
}

// ---------------------------------------------------------------------------
// 4. ListInvoices — RLS isolation between two distinct orgs
// ---------------------------------------------------------------------------

func TestIntegration_ListInvoices_RLSIsolation(t *testing.T) {
	ctx := context.Background()
	orgA := seedOrg(t, ctx, integrationPool, "ListInvoices OrgA")
	orgB := seedOrg(t, ctx, integrationPool, "ListInvoices OrgB")
	store := NewStore(integrationPool)

	ctxA := orgCtx(ctx, orgA)
	ctxB := orgCtx(ctx, orgB)

	req := CreateInvoiceReq{
		Issuer:           "platform",
		RecipientName:    "Anyone",
		RecipientAddress: "Anywhere",
		Currency:         "ZAR",
		Lines:            []LineReq{{Description: "Widget", Qty: 1, UnitCents: 500}},
	}

	// Create one invoice under org-A
	invA, err := store.CreateInvoice(ctxA, req, "", 0)
	if err != nil {
		t.Fatalf("CreateInvoice (orgA): %v", err)
	}

	// List under org-A should include the invoice
	listA, err := store.ListInvoices(ctxA)
	if err != nil {
		t.Fatalf("ListInvoices (orgA): %v", err)
	}
	foundA := false
	for _, inv := range listA {
		if inv.ID == invA.ID {
			foundA = true
			break
		}
	}
	if !foundA {
		t.Errorf("org-A invoice %q not visible in org-A listing", invA.ID)
	}

	// List under org-B must NOT return the org-A invoice (RLS isolation)
	listB, err := store.ListInvoices(ctxB)
	if err != nil {
		t.Fatalf("ListInvoices (orgB): %v", err)
	}
	for _, inv := range listB {
		if inv.ID == invA.ID {
			t.Errorf("org-A invoice %q leaked into org-B listing — RLS violation", invA.ID)
		}
	}

	// Sanity: GetInvoice under org-B must return ErrNotFound
	_, err = store.GetInvoice(ctxB, invA.ID)
	if !errors.Is(err, ErrNotFound) {
		t.Errorf("GetInvoice (orgB on orgA invoice): want ErrNotFound got %v", err)
	}
}

// ---------------------------------------------------------------------------
// 5. CreateInvoice — tenant issuer with recipient_org_id (the fixed path)
//
// Before the fix, CreateInvoice never set recipient_org_id or
// recipient_customer_id, so any tenant-issued invoice violated the
// invoices_has_recipient CHECK constraint and the INSERT always failed.
// This test confirms the fix: a tenant invoice with a recipient_org_id now
// succeeds and the returned row carries the correct recipient ID.
// ---------------------------------------------------------------------------

func TestIntegration_CreateInvoice_TenantWithRecipientOrg(t *testing.T) {
	ctx := context.Background()
	// Seed two orgs: issuer and a B2B customer (recipient).
	issuerOrgID := seedOrg(t, ctx, integrationPool, "Tenant Issuer Org")
	recipientOrgID := seedOrg(t, ctx, integrationPool, "Recipient B2B Org")
	store := NewStore(integrationPool)
	ctx1 := orgCtx(ctx, issuerOrgID)

	req := CreateInvoiceReq{
		Issuer:           "tenant",
		RecipientOrgID:   &recipientOrgID,
		RecipientName:    "Recipient B2B Org",
		RecipientAddress: "1 Recipient Ave, Cape Town",
		Currency:         "ZAR",
		Lines: []LineReq{
			{Description: "B2B service", Qty: 1, UnitCents: 25000},
		},
	}

	// This must NOT return ErrMissingRecipient and must not hit the DB CHECK.
	inv, err := store.CreateInvoice(ctx1, req, "", 0)
	if err != nil {
		t.Fatalf("CreateInvoice tenant+recipient: %v", err)
	}

	if inv.Issuer != "tenant" {
		t.Errorf("Issuer want tenant got %q", inv.Issuer)
	}
	if inv.RecipientOrgID == nil || *inv.RecipientOrgID != recipientOrgID {
		t.Errorf("RecipientOrgID want %q got %v", recipientOrgID, inv.RecipientOrgID)
	}
	if inv.RecipientCustomerID != nil {
		t.Errorf("RecipientCustomerID should be nil, got %v", inv.RecipientCustomerID)
	}
	if inv.SubtotalCents != 25000 {
		t.Errorf("SubtotalCents want 25000 got %d", inv.SubtotalCents)
	}
	if inv.TotalCents != 25000 {
		t.Errorf("TotalCents want 25000 (no VAT) got %d", inv.TotalCents)
	}
	if inv.Status != "draft" {
		t.Errorf("Status want draft got %q", inv.Status)
	}

	// --- Validation: missing recipient returns ErrMissingRecipient (not a DB error) ---
	badReq := CreateInvoiceReq{
		Issuer:   "tenant",
		Currency: "ZAR",
		Lines:    []LineReq{{Description: "item", Qty: 1, UnitCents: 100}},
	}
	_, err = store.CreateInvoice(ctx1, badReq, "", 0)
	if !errors.Is(err, ErrMissingRecipient) {
		t.Errorf("missing recipient: want ErrMissingRecipient got %v", err)
	}
}
