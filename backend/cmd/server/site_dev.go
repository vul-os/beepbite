//go:build !embed_frontend

package main

// Development build: the marketing/docs site is served from disk if it
// happens to exist.
//
// Returning nil when there is no site/ directory is the point. A developer
// who has only checked out the backend, and the test suite in CI, must both
// be able to build and run the server — so a missing site degrades to "that
// route is not registered" rather than to a build failure or a startup error.

import (
	"net/http"
	"os"
	"path/filepath"
)

// newSiteHandler serves the repo-root site/ directory when present, else nil.
func newSiteHandler() http.Handler {
	dir := findSite()
	if dir == "" {
		return nil
	}
	return http.FileServer(http.Dir(dir))
}

// findSite walks up from the working directory looking for a site/
// directory, so the server runs the same from backend/, backend/cmd/server/
// or the repo root.
func findSite() string {
	dir, err := os.Getwd()
	if err != nil {
		return ""
	}
	for {
		candidate := filepath.Join(dir, "site")
		if info, err := os.Stat(candidate); err == nil && info.IsDir() {
			return candidate
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			return ""
		}
		dir = parent
	}
}
