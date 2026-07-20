//go:build embed_frontend

package main

// Embedded build: the marketing/docs site travels inside the binary.
//
// This is what makes "copy one binary" a complete install alongside the app.
// The build script copies the repo-root site/ next to this file before
// compiling; a plain `go build ./...` uses site_dev.go instead and serves
// from disk, so developers do not need the copy step to run the server.

import (
	"embed"
	"io/fs"
	"log"
	"net/http"
)

//go:embed all:site
var siteFS embed.FS

// newSiteHandler serves the embedded site, or nil if it is unavailable.
func newSiteHandler() http.Handler {
	sub, err := fs.Sub(siteFS, "site")
	if err != nil {
		log.Printf("beepbite: embedded site not found: %v", err)
		return nil
	}
	return http.FileServer(http.FS(sub))
}
