package main

import (
	"bytes"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/beepbite/backend/internal/config"
)

// Runner tracks per-test pass/fail and per-suite aggregates. Tests call
// r.Check / r.CheckEq / r.Fatal to report results.

type Runner struct {
	base    string
	verbose bool
	http    *http.Client
	cfg     *config.Config // env-loaded config (for integration tests needing test keys)

	token     string // bearer for authenticated calls
	refresh   string // current refresh token (for explicit tests)
	userID    string
	userEmail string
	userPass  string

	// per-suite counters
	curSuite string
	cases    int
	passed   int
	failed   int
	errs     []string

	// Shared state across suites (so --all is chainable).
	orgID      string
	locationID string
	categoryID string
	itemID     string
}

func newRunner(base string, verbose bool) *Runner {
	return &Runner{
		base:    strings.TrimRight(base, "/"),
		verbose: verbose,
		http:    &http.Client{Timeout: 20 * time.Second},
	}
}

type suiteFn func(r *Runner)

func (r *Runner) Suite(name string, fn suiteFn) {
	r.curSuite = name
	fmt.Printf("▶ %s\n", name)
	defer func() {
		if rec := recover(); rec != nil {
			r.fail(fmt.Sprintf("panic in %s: %v", name, rec))
		}
		fmt.Println()
	}()
	fn(r)
}

// --- reporting ---

func (r *Runner) Report() {
	fmt.Println("────────────────")
	fmt.Printf("cases: %d   passed: %d   failed: %d\n", r.cases, r.passed, r.failed)
	if len(r.errs) > 0 {
		fmt.Println("failures:")
		for _, e := range r.errs {
			fmt.Println("  ✗", e)
		}
	}
}

func (r *Runner) pass(label string) {
	r.cases++
	r.passed++
	fmt.Printf("  ✓ %s\n", label)
}

func (r *Runner) fail(label string) {
	r.cases++
	r.failed++
	r.errs = append(r.errs, r.curSuite+": "+label)
	fmt.Printf("  ✗ %s\n", label)
}

// Check records a boolean assertion.
func (r *Runner) Check(ok bool, label string) bool {
	if ok {
		r.pass(label)
	} else {
		r.fail(label)
	}
	return ok
}

// CheckEq asserts a == b with a short message on failure.
func (r *Runner) CheckEq(got, want any, label string) bool {
	if fmt.Sprintf("%v", got) == fmt.Sprintf("%v", want) {
		r.pass(label)
		return true
	}
	r.fail(fmt.Sprintf("%s (got %v, want %v)", label, got, want))
	return false
}

// CheckStatus asserts the HTTP status matches.
func (r *Runner) CheckStatus(got, want int, label string) bool {
	return r.CheckEq(got, want, label)
}

// --- HTTP helpers ---

type response struct {
	status int
	body   []byte
	header http.Header
}

func (resp *response) JSON(v any) error {
	if len(resp.body) == 0 {
		return fmt.Errorf("empty body")
	}
	return json.Unmarshal(resp.body, v)
}

func (resp *response) String() string {
	if len(resp.body) > 500 {
		return string(resp.body[:500]) + "…"
	}
	return string(resp.body)
}

// do is the low-level helper. Pass nil body for GET/DELETE.
func (r *Runner) do(method, path string, body any, opts ...reqOpt) (*response, error) {
	var reader io.Reader
	if body != nil {
		b, err := json.Marshal(body)
		if err != nil {
			return nil, err
		}
		reader = bytes.NewReader(b)
	}
	req, err := http.NewRequest(method, r.base+path, reader)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	for _, o := range opts {
		o(req)
	}
	resp, err := r.http.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	b, _ := io.ReadAll(resp.Body)
	if r.verbose {
		fmt.Printf("    %s %s → %d %s\n", method, path, resp.StatusCode, truncate(string(b), 160))
	}
	return &response{status: resp.StatusCode, body: b, header: resp.Header}, nil
}

type reqOpt func(*http.Request)

func withBearer(tok string) reqOpt {
	return func(req *http.Request) {
		if tok != "" {
			req.Header.Set("Authorization", "Bearer "+tok)
		}
	}
}

func withHeader(k, v string) reqOpt {
	return func(req *http.Request) { req.Header.Set(k, v) }
}

// Convenience wrappers used by suites.

func (r *Runner) GET(path string, opts ...reqOpt) *response {
	resp, err := r.do("GET", path, nil, opts...)
	if err != nil {
		r.fail(fmt.Sprintf("GET %s: %v", path, err))
		return &response{status: 0}
	}
	return resp
}

func (r *Runner) POST(path string, body any, opts ...reqOpt) *response {
	resp, err := r.do("POST", path, body, opts...)
	if err != nil {
		r.fail(fmt.Sprintf("POST %s: %v", path, err))
		return &response{status: 0}
	}
	return resp
}

func (r *Runner) PATCH(path string, body any, opts ...reqOpt) *response {
	resp, err := r.do("PATCH", path, body, opts...)
	if err != nil {
		r.fail(fmt.Sprintf("PATCH %s: %v", path, err))
		return &response{status: 0}
	}
	return resp
}

func (r *Runner) DELETE(path string, opts ...reqOpt) *response {
	resp, err := r.do("DELETE", path, nil, opts...)
	if err != nil {
		r.fail(fmt.Sprintf("DELETE %s: %v", path, err))
		return &response{status: 0}
	}
	return resp
}

// --- utilities ---

func randomEmail() string {
	b := make([]byte, 6)
	_, _ = rand.Read(b)
	return fmt.Sprintf("test_%s@example.test", hex.EncodeToString(b))
}

func randomString(n int) string {
	b := make([]byte, n/2+1)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)[:n]
}

func truncate(s string, n int) string {
	s = strings.ReplaceAll(s, "\n", " ")
	if len(s) > n {
		return s[:n] + "…"
	}
	return s
}
