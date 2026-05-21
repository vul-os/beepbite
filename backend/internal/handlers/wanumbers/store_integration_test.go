// Package wanumbers_test contains DB-backed integration tests for the
// wanumbers Store and the warouting package (Resolve / PickOutbound).
//
// Run:
//
//	cd backend && go test ./internal/handlers/wanumbers/ -run Integration -v
package wanumbers_test

import (
	"context"
	"errors"
	"fmt"
	"log"
	"math/rand"
	"os"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/beepbite/backend/cmd/tests/testenv"
	"github.com/beepbite/backend/internal/handlers/wanumbers"
	"github.com/beepbite/backend/internal/warouting"
)

// ---------------------------------------------------------------------------
// Package-level pool, initialised by TestMain.
// ---------------------------------------------------------------------------

var testPool *pgxpool.Pool

func TestMain(m *testing.M) {
	ctx := context.Background()
	pool, cleanup, err := testenv.StartPostgres(ctx)
	if errors.Is(err, testenv.ErrSkip) {
		fmt.Println("skipping integration tests:", err)
		os.Exit(0)
	}
	if err != nil {
		log.Fatal("testenv.StartPostgres:", err)
	}
	defer cleanup()
	testPool = pool
	os.Exit(m.Run())
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// uniqueMetaID generates a unique meta_phone_number_id per test invocation so
// parallel or sequential runs never collide on the UNIQUE constraint.
func uniqueMetaID() string {
	return fmt.Sprintf("TEST-%d-%d", os.Getpid(), rand.Int63())
}

// ptr returns a pointer to the supplied value (generic helper).
func ptr[T any](v T) *T { return &v }

// ---------------------------------------------------------------------------
// §1  Store CRUD
// ---------------------------------------------------------------------------

// TestIntegrationStore_CreateListGetUpdateDeactivate exercises the full
// lifecycle of a whatsapp_phone_numbers row via the wanumbers.Store.
func TestIntegrationStore_CreateListGetUpdateDeactivate(t *testing.T) {
	ctx := context.Background()
	store := wanumbers.NewStore(testPool)

	metaID := uniqueMetaID()

	// --- Create ---
	created, err := store.Create(ctx, wanumbers.CreateReq{
		MetaPhoneNumberID: metaID,
		DisplayPhone:      "+27 82 111 0001",
		Country:           "ZA",
		Regions:           []string{"gauteng"},
	})
	if err != nil {
		t.Fatalf("Create: %v", err)
	}
	if created.ID == "" {
		t.Fatal("Create: expected non-empty ID")
	}
	if created.MetaPhoneNumberID != metaID {
		t.Errorf("Create: MetaPhoneNumberID = %q, want %q", created.MetaPhoneNumberID, metaID)
	}
	if !created.Active {
		t.Error("Create: expected active=true by default")
	}
	t.Logf("Created row id=%s", created.ID)

	// --- List(activeOnly=true) includes the new number ---
	list, err := store.List(ctx, true)
	if err != nil {
		t.Fatalf("List(activeOnly=true): %v", err)
	}
	found := false
	for _, n := range list {
		if n.ID == created.ID {
			found = true
			break
		}
	}
	if !found {
		t.Error("List(activeOnly=true): newly created number not found in result")
	}

	// --- Get by ID ---
	got, err := store.Get(ctx, created.ID)
	if err != nil {
		t.Fatalf("Get: %v", err)
	}
	if got.ID != created.ID {
		t.Errorf("Get: ID = %q, want %q", got.ID, created.ID)
	}
	if got.Country != "ZA" {
		t.Errorf("Get: Country = %q, want ZA", got.Country)
	}

	// --- Update (partial patch) ---
	updated, err := store.Update(ctx, created.ID, wanumbers.UpdateReq{
		DisplayPhone: ptr("+27 82 999 0001"),
		Country:      ptr("NG"),
	})
	if err != nil {
		t.Fatalf("Update: %v", err)
	}
	if updated.DisplayPhone != "+27 82 999 0001" {
		t.Errorf("Update: DisplayPhone = %q, want +27 82 999 0001", updated.DisplayPhone)
	}
	if updated.Country != "NG" {
		t.Errorf("Update: Country = %q, want NG", updated.Country)
	}
	// Fields not in the patch must be unchanged.
	if len(updated.Regions) != 1 || updated.Regions[0] != "gauteng" {
		t.Errorf("Update: Regions = %v, want [gauteng]", updated.Regions)
	}

	// --- Deactivate ---
	if err := store.Deactivate(ctx, created.ID); err != nil {
		t.Fatalf("Deactivate: %v", err)
	}

	// Confirm active=false via Get.
	after, err := store.Get(ctx, created.ID)
	if err != nil {
		t.Fatalf("Get after Deactivate: %v", err)
	}
	if after.Active {
		t.Error("Deactivate: expected active=false after Deactivate")
	}

	// List(activeOnly=true) must exclude it.
	list2, err := store.List(ctx, true)
	if err != nil {
		t.Fatalf("List after Deactivate: %v", err)
	}
	for _, n := range list2 {
		if n.ID == created.ID {
			t.Error("List(activeOnly=true): deactivated number still appears in list")
		}
	}

	// List(activeOnly=false) must still include it.
	listAll, err := store.List(ctx, false)
	if err != nil {
		t.Fatalf("List(activeOnly=false) after Deactivate: %v", err)
	}
	foundInAll := false
	for _, n := range listAll {
		if n.ID == created.ID {
			foundInAll = true
			break
		}
	}
	if !foundInAll {
		t.Error("List(activeOnly=false): deactivated number missing from full list")
	}
}

// TestIntegrationStore_DuplicateMetaID verifies the UNIQUE constraint guard.
func TestIntegrationStore_DuplicateMetaID(t *testing.T) {
	ctx := context.Background()
	store := wanumbers.NewStore(testPool)
	metaID := uniqueMetaID()

	_, err := store.Create(ctx, wanumbers.CreateReq{
		MetaPhoneNumberID: metaID,
		DisplayPhone:      "+27 82 111 0002",
		Country:           "ZA",
	})
	if err != nil {
		t.Fatalf("first Create: %v", err)
	}

	_, err = store.Create(ctx, wanumbers.CreateReq{
		MetaPhoneNumberID: metaID,
		DisplayPhone:      "+27 82 111 0003",
		Country:           "ZA",
	})
	if !errors.Is(err, wanumbers.ErrDuplicatePhoneNumberID) {
		t.Errorf("second Create: want ErrDuplicatePhoneNumberID, got %v", err)
	}
}

// TestIntegrationStore_GetNotFound verifies ErrNotFound for an unknown ID.
func TestIntegrationStore_GetNotFound(t *testing.T) {
	ctx := context.Background()
	store := wanumbers.NewStore(testPool)

	_, err := store.Get(ctx, "00000000-0000-0000-0000-000000000000")
	if !errors.Is(err, wanumbers.ErrNotFound) {
		t.Errorf("Get unknown id: want ErrNotFound, got %v", err)
	}
}

// TestIntegrationStore_DeactivateNotFound verifies ErrNotFound from Deactivate.
func TestIntegrationStore_DeactivateNotFound(t *testing.T) {
	ctx := context.Background()
	store := wanumbers.NewStore(testPool)

	err := store.Deactivate(ctx, "00000000-0000-0000-0000-000000000001")
	if !errors.Is(err, wanumbers.ErrNotFound) {
		t.Errorf("Deactivate unknown id: want ErrNotFound, got %v", err)
	}
}

// ---------------------------------------------------------------------------
// §2  warouting.Resolve
// ---------------------------------------------------------------------------

// TestIntegrationResolve_ActiveNumber verifies that Resolve returns the row
// for a known active meta_phone_number_id.
func TestIntegrationResolve_ActiveNumber(t *testing.T) {
	ctx := context.Background()
	store := wanumbers.NewStore(testPool)
	metaID := uniqueMetaID()

	created, err := store.Create(ctx, wanumbers.CreateReq{
		MetaPhoneNumberID: metaID,
		DisplayPhone:      "+27 82 222 0001",
		Country:           "ZA",
	})
	if err != nil {
		t.Fatalf("Create: %v", err)
	}

	n, err := warouting.Resolve(ctx, testPool, metaID)
	if err != nil {
		t.Fatalf("Resolve: %v", err)
	}
	if n.ID != created.ID {
		t.Errorf("Resolve: ID = %q, want %q", n.ID, created.ID)
	}
	if n.MetaPhoneNumberID != metaID {
		t.Errorf("Resolve: MetaPhoneNumberID = %q, want %q", n.MetaPhoneNumberID, metaID)
	}
	if !n.Active {
		t.Error("Resolve: expected active=true")
	}
}

// TestIntegrationResolve_InactiveNumber verifies that Resolve returns
// ErrNotFound when the row exists but is inactive.
func TestIntegrationResolve_InactiveNumber(t *testing.T) {
	ctx := context.Background()
	store := wanumbers.NewStore(testPool)
	metaID := uniqueMetaID()

	created, err := store.Create(ctx, wanumbers.CreateReq{
		MetaPhoneNumberID: metaID,
		DisplayPhone:      "+27 82 222 0002",
		Country:           "ZA",
	})
	if err != nil {
		t.Fatalf("Create: %v", err)
	}
	if err := store.Deactivate(ctx, created.ID); err != nil {
		t.Fatalf("Deactivate: %v", err)
	}

	_, err = warouting.Resolve(ctx, testPool, metaID)
	if !errors.Is(err, warouting.ErrNotFound) {
		t.Errorf("Resolve inactive: want ErrNotFound, got %v", err)
	}
}

// TestIntegrationResolve_UnknownID verifies ErrNotFound for a completely
// unknown meta_phone_number_id.
func TestIntegrationResolve_UnknownID(t *testing.T) {
	ctx := context.Background()
	_, err := warouting.Resolve(ctx, testPool, "UNKNOWN-META-ID-XYZ")
	if !errors.Is(err, warouting.ErrNotFound) {
		t.Errorf("Resolve unknown: want ErrNotFound, got %v", err)
	}
}

// ---------------------------------------------------------------------------
// §3  warouting.PickOutbound
// ---------------------------------------------------------------------------

// TestIntegrationPickOutbound_LastNumberActive verifies that PickOutbound
// returns the last-used number when it is still active.
func TestIntegrationPickOutbound_LastNumberActive(t *testing.T) {
	ctx := context.Background()
	store := wanumbers.NewStore(testPool)

	// Use a unique country code to avoid interference with other test rows.
	country := fmt.Sprintf("T%d", rand.Intn(9000)+1000) // e.g. T4237

	metaID := uniqueMetaID()
	created, err := store.Create(ctx, wanumbers.CreateReq{
		MetaPhoneNumberID: metaID,
		DisplayPhone:      "+27 82 333 0001",
		Country:           country,
	})
	if err != nil {
		t.Fatalf("Create: %v", err)
	}

	n, err := warouting.PickOutbound(ctx, testPool, metaID, country)
	if err != nil {
		t.Fatalf("PickOutbound(lastID=%s): %v", metaID, err)
	}
	if n.ID != created.ID {
		t.Errorf("PickOutbound: ID = %q, want %q", n.ID, created.ID)
	}
}

// TestIntegrationPickOutbound_EmptyLastID verifies the country-primary fallback
// (oldest active number for the country) when no last-used ID is supplied.
func TestIntegrationPickOutbound_EmptyLastID(t *testing.T) {
	ctx := context.Background()
	store := wanumbers.NewStore(testPool)

	// Unique country so we own all rows in it.
	country := fmt.Sprintf("U%d", rand.Intn(9000)+1000)

	// Insert two numbers; the first inserted will be the oldest (configured_at ASC).
	first, err := store.Create(ctx, wanumbers.CreateReq{
		MetaPhoneNumberID: uniqueMetaID(),
		DisplayPhone:      "+27 82 444 0001",
		Country:           country,
	})
	if err != nil {
		t.Fatalf("Create first: %v", err)
	}
	_, err = store.Create(ctx, wanumbers.CreateReq{
		MetaPhoneNumberID: uniqueMetaID(),
		DisplayPhone:      "+27 82 444 0002",
		Country:           country,
	})
	if err != nil {
		t.Fatalf("Create second: %v", err)
	}

	n, err := warouting.PickOutbound(ctx, testPool, "", country)
	if err != nil {
		t.Fatalf("PickOutbound(empty lastID): %v", err)
	}
	// Must return the country-primary (oldest) row.
	if n.ID != first.ID {
		t.Errorf("PickOutbound country-primary: ID = %q, want %q (oldest)", n.ID, first.ID)
	}
}

// TestIntegrationPickOutbound_NoNumberForCountry verifies ErrNoNumberForCountry
// when there are no active numbers for the requested country.
func TestIntegrationPickOutbound_NoNumberForCountry(t *testing.T) {
	ctx := context.Background()

	_, err := warouting.PickOutbound(ctx, testPool, "", "XX") // highly unlikely to exist
	if !errors.Is(err, warouting.ErrNoNumberForCountry) {
		t.Errorf("PickOutbound no-country: want ErrNoNumberForCountry, got %v", err)
	}
}

// TestIntegrationPickOutbound_LastNumberInactive falls back to the
// country-primary when the last-used number has been deactivated.
func TestIntegrationPickOutbound_LastNumberInactive(t *testing.T) {
	ctx := context.Background()
	store := wanumbers.NewStore(testPool)

	country := fmt.Sprintf("V%d", rand.Intn(9000)+1000)

	// "Last used" number — active first, then deactivated.
	lastMetaID := uniqueMetaID()
	lastRow, err := store.Create(ctx, wanumbers.CreateReq{
		MetaPhoneNumberID: lastMetaID,
		DisplayPhone:      "+27 82 555 0001",
		Country:           country,
	})
	if err != nil {
		t.Fatalf("Create last: %v", err)
	}

	// Country-primary number (also active).
	primaryMetaID := uniqueMetaID()
	primary, err := store.Create(ctx, wanumbers.CreateReq{
		MetaPhoneNumberID: primaryMetaID,
		DisplayPhone:      "+27 82 555 0002",
		Country:           country,
	})
	if err != nil {
		t.Fatalf("Create primary: %v", err)
	}

	// Deactivate the last-used number.
	if err := store.Deactivate(ctx, lastRow.ID); err != nil {
		t.Fatalf("Deactivate: %v", err)
	}

	// PickOutbound should fall through to the country-primary.
	n, err := warouting.PickOutbound(ctx, testPool, lastMetaID, country)
	if err != nil {
		t.Fatalf("PickOutbound(inactive lastID): %v", err)
	}
	if n.ID != primary.ID {
		t.Errorf("PickOutbound fallback: ID = %q, want primary %q", n.ID, primary.ID)
	}
}
