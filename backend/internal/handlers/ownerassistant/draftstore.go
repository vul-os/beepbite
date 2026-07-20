// draftstore.go — in-memory store for menu-import drafts.
//
// Drafts are produced by the import_menu_from_* tools and held in memory
// until the owner reviews them. On commit, the draft is handed back to the
// ai package confirm logic. Drafts are keyed by a short random token
// and expire after 30 minutes (GC on access).
//
// No persistence: a server restart clears all pending drafts. That is fine
// for the MVP — the owner can simply re-run the import.
package ownerassistant

import (
	"crypto/rand"
	"encoding/hex"
	"sync"
	"time"
)

// Draft holds a pending menu-import result waiting for owner review.
type Draft struct {
	ID         string      `json:"id"`
	LocationID string      `json:"location_id"`
	OrgID      string      `json:"org_id"`
	Categories interface{} `json:"categories"` // []ai.MenuCategory
	Items      interface{} `json:"items"`      // []ai.MenuItem
	CreatedAt  time.Time   `json:"created_at"`
}

type draftStore struct {
	mu     sync.Mutex
	drafts map[string]*Draft
}

var globalDraftStore = &draftStore{drafts: make(map[string]*Draft)}

// SaveDraft persists a draft and returns its ID.
func SaveDraft(d *Draft) string {
	b := make([]byte, 8)
	_, _ = rand.Read(b)
	id := hex.EncodeToString(b)
	d.ID = id
	d.CreatedAt = time.Now()

	globalDraftStore.mu.Lock()
	defer globalDraftStore.mu.Unlock()
	// GC: remove drafts older than 30 min.
	for k, v := range globalDraftStore.drafts {
		if time.Since(v.CreatedAt) > 30*time.Minute {
			delete(globalDraftStore.drafts, k)
		}
	}
	globalDraftStore.drafts[id] = d
	return id
}

// GetDraft retrieves a draft by ID. Returns nil when not found or expired.
func GetDraft(id string) *Draft {
	globalDraftStore.mu.Lock()
	defer globalDraftStore.mu.Unlock()
	d, ok := globalDraftStore.drafts[id]
	if !ok {
		return nil
	}
	if time.Since(d.CreatedAt) > 30*time.Minute {
		delete(globalDraftStore.drafts, id)
		return nil
	}
	return d
}

// DeleteDraft removes a draft after commit/discard.
func DeleteDraft(id string) {
	globalDraftStore.mu.Lock()
	defer globalDraftStore.mu.Unlock()
	delete(globalDraftStore.drafts, id)
}
