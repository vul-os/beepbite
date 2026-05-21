package hostresolve

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/beepbite/backend/internal/handlers/customdomains"
)

// ---------------------------------------------------------------------------
// Fake Resolver
// ---------------------------------------------------------------------------

// fakeResolver implements Resolver without any DB dependency.
// Each method looks up the key in the corresponding map; if absent it returns
// ErrNotFound. Callers may also inject an arbitrary non-not-found error by
// setting slugErr / customErr.
type fakeResolver struct {
	slugs   map[string]string // slug   → location_id
	customs map[string]string // hostname → location_id
	slugErr error             // non-nil overrides map lookup (generic error)
	custErr error             // non-nil overrides map lookup (generic error)
}

func (f *fakeResolver) ResolveSlug(_ context.Context, slug string) (string, error) {
	if f.slugErr != nil {
		return "", f.slugErr
	}
	if id, ok := f.slugs[slug]; ok {
		return id, nil
	}
	return "", customdomains.ErrNotFound
}

func (f *fakeResolver) ResolveCustomHostname(_ context.Context, hostname string) (string, error) {
	if f.custErr != nil {
		return "", f.custErr
	}
	if id, ok := f.customs[hostname]; ok {
		return id, nil
	}
	return "", customdomains.ErrNotFound
}

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

// runRequest builds a GET request with the given Host header, wraps it in the
// Middleware under test, and returns the captured location_id (from context)
// and the recorded HTTP status code.
func runRequest(t *testing.T, resolver Resolver, host string) (locationID string, statusCode int) {
	t.Helper()

	var capturedID string
	next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		capturedID = LocationIDFrom(r.Context())
		w.WriteHeader(http.StatusOK)
	})

	handler := Middleware(resolver)(next)

	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.Host = host
	rec := httptest.NewRecorder()

	handler.ServeHTTP(rec, req)
	return capturedID, rec.Code
}

// ---------------------------------------------------------------------------
// Context round-trip
// ---------------------------------------------------------------------------

func TestContextRoundTrip(t *testing.T) {
	ctx := context.Background()
	want := "loc-abc-123"
	ctx2 := ContextWithLocationID(ctx, want)

	if got := LocationIDFrom(ctx2); got != want {
		t.Fatalf("LocationIDFrom = %q; want %q", got, want)
	}
}

func TestLocationIDFromEmpty(t *testing.T) {
	if got := LocationIDFrom(context.Background()); got != "" {
		t.Fatalf("expected empty string from bare context, got %q", got)
	}
}

// ---------------------------------------------------------------------------
// Reserved subdomains — pass through WITHOUT setting location id
// ---------------------------------------------------------------------------

func TestReservedSubdomains(t *testing.T) {
	reserved := []string{
		"app.beepbite.io",
		"api.beepbite.io",
		"www.beepbite.io",
		"admin.beepbite.io",
	}

	// The resolver must NOT be called for reserved subdomains; use a resolver
	// that would return a non-empty id if called, so we can detect accidental calls.
	resolver := &fakeResolver{
		slugs: map[string]string{
			"app":   "should-not-be-returned",
			"api":   "should-not-be-returned",
			"www":   "should-not-be-returned",
			"admin": "should-not-be-returned",
		},
	}

	for _, host := range reserved {
		t.Run(host, func(t *testing.T) {
			id, code := runRequest(t, resolver, host)
			if code != http.StatusOK {
				t.Fatalf("host %q: expected 200, got %d", host, code)
			}
			if id != "" {
				t.Fatalf("host %q: expected no location_id, got %q", host, id)
			}
		})
	}
}

// TestApexPassthrough verifies that the bare beepbite.io domain passes through
// without location resolution.
func TestApexPassthrough(t *testing.T) {
	resolver := &fakeResolver{} // empty — would error if called
	id, code := runRequest(t, resolver, "beepbite.io")
	if code != http.StatusOK {
		t.Fatalf("expected 200, got %d", code)
	}
	if id != "" {
		t.Fatalf("expected no location_id for apex, got %q", id)
	}
}

// TestApexWithPort ensures port-stripping works for the apex domain.
func TestApexWithPort(t *testing.T) {
	resolver := &fakeResolver{}
	id, code := runRequest(t, resolver, "beepbite.io:8080")
	if code != http.StatusOK {
		t.Fatalf("expected 200, got %d", code)
	}
	if id != "" {
		t.Fatalf("expected no location_id for apex with port, got %q", id)
	}
}

// ---------------------------------------------------------------------------
// Slug resolution — <slug>.beepbite.io
// ---------------------------------------------------------------------------

func TestSlugResolution(t *testing.T) {
	const wantID = "loc-slug-999"
	resolver := &fakeResolver{
		slugs: map[string]string{"mystore": wantID},
	}

	id, code := runRequest(t, resolver, "mystore.beepbite.io")
	if code != http.StatusOK {
		t.Fatalf("expected 200, got %d", code)
	}
	if id != wantID {
		t.Fatalf("expected location_id %q, got %q", wantID, id)
	}
}

// TestSlugResolutionWithPort verifies port stripping before slug lookup.
func TestSlugResolutionWithPort(t *testing.T) {
	const wantID = "loc-slug-777"
	resolver := &fakeResolver{
		slugs: map[string]string{"mystore": wantID},
	}

	id, code := runRequest(t, resolver, "mystore.beepbite.io:443")
	if code != http.StatusOK {
		t.Fatalf("expected 200, got %d", code)
	}
	if id != wantID {
		t.Fatalf("expected location_id %q, got %q", wantID, id)
	}
}

// ---------------------------------------------------------------------------
// Custom hostname resolution
// ---------------------------------------------------------------------------

func TestCustomHostnameResolution(t *testing.T) {
	const wantID = "loc-custom-42"
	resolver := &fakeResolver{
		customs: map[string]string{"orders.mycafe.com": wantID},
	}

	id, code := runRequest(t, resolver, "orders.mycafe.com")
	if code != http.StatusOK {
		t.Fatalf("expected 200, got %d", code)
	}
	if id != wantID {
		t.Fatalf("expected location_id %q, got %q", wantID, id)
	}
}

// ---------------------------------------------------------------------------
// Not-found cases — resolver returns ErrNotFound
// ---------------------------------------------------------------------------

// TestSlugNotFound: unknown <slug>.beepbite.io passes through with no id and HTTP 200.
func TestSlugNotFound(t *testing.T) {
	resolver := &fakeResolver{slugs: map[string]string{}} // no entries → ErrNotFound

	id, code := runRequest(t, resolver, "unknownslug.beepbite.io")
	if code != http.StatusOK {
		t.Fatalf("expected 200 on not-found slug, got %d", code)
	}
	if id != "" {
		t.Fatalf("expected no location_id for not-found slug, got %q", id)
	}
}

// TestCustomHostnameNotFound: unknown custom hostname passes through with no id and HTTP 200.
func TestCustomHostnameNotFound(t *testing.T) {
	resolver := &fakeResolver{customs: map[string]string{}}

	id, code := runRequest(t, resolver, "unknown.example.com")
	if code != http.StatusOK {
		t.Fatalf("expected 200 on not-found custom hostname, got %d", code)
	}
	if id != "" {
		t.Fatalf("expected no location_id for not-found custom hostname, got %q", id)
	}
}

// ---------------------------------------------------------------------------
// Generic errors — resolver returns a non-not-found error
// ---------------------------------------------------------------------------

// TestSlugGenericError: a DB-style error on slug resolution must NOT 500 — the
// next handler still runs (HTTP 200) and no location_id is injected.
func TestSlugGenericError(t *testing.T) {
	resolver := &fakeResolver{
		slugErr: errors.New("connection refused"),
	}

	id, code := runRequest(t, resolver, "anyslug.beepbite.io")
	if code != http.StatusOK {
		t.Fatalf("expected 200 even on generic slug error, got %d", code)
	}
	if id != "" {
		t.Fatalf("expected no location_id when resolver errors, got %q", id)
	}
}

// TestCustomHostnameGenericError: a generic resolver error on custom hostname
// must NOT 500 — next handler still runs.
func TestCustomHostnameGenericError(t *testing.T) {
	resolver := &fakeResolver{
		custErr: errors.New("timeout"),
	}

	id, code := runRequest(t, resolver, "custom.domain.net")
	if code != http.StatusOK {
		t.Fatalf("expected 200 even on generic custom hostname error, got %d", code)
	}
	if id != "" {
		t.Fatalf("expected no location_id when resolver errors, got %q", id)
	}
}

// ---------------------------------------------------------------------------
// Empty Host header
// ---------------------------------------------------------------------------

func TestEmptyHost(t *testing.T) {
	resolver := &fakeResolver{}
	id, code := runRequest(t, resolver, "")
	if code != http.StatusOK {
		t.Fatalf("expected 200 for empty host, got %d", code)
	}
	if id != "" {
		t.Fatalf("expected no location_id for empty host, got %q", id)
	}
}

// ---------------------------------------------------------------------------
// canonicalHost unit tests (white-box; unexported but same package)
// ---------------------------------------------------------------------------

func TestCanonicalHost(t *testing.T) {
	cases := []struct {
		in   string
		want string
	}{
		{"beepbite.io", "beepbite.io"},
		{"beepbite.io:8080", "beepbite.io"},
		{"BEEPBITE.IO", "beepbite.io"},
		{"App.BeepBite.IO:443", "app.beepbite.io"},
		{"[::1]:8080", "[::1]:8080"}, // IPv6 literal: port NOT stripped
		{"", ""},
	}

	for _, tc := range cases {
		got := canonicalHost(tc.in)
		if got != tc.want {
			t.Errorf("canonicalHost(%q) = %q; want %q", tc.in, got, tc.want)
		}
	}
}
