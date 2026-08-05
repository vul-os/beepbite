/**
 * sw.js — BeepBite offline service worker (Wave 13 / Now-24 Offline Tier 1).
 *
 * STRATEGY OVERVIEW
 * -----------------
 *   App shell (HTML/JS/CSS/images):
 *     Network-first on navigation requests; if the network fails serve from
 *     the shell cache.  On a successful network response the cache is updated.
 *
 *   Store-menu snapshots (GET /stores/<slug>):
 *     Stale-while-revalidate — serve the cached version immediately, then
 *     update the cache from the network in the background.  This makes the
 *     menu instantly available offline while keeping data fresh.
 *
 *   All other API requests (non-GET or non-menu GET):
 *     Network-first with NO cache fallback.  Mutations must not be replayed
 *     silently — the offline queue (src/offline/queue.js) handles those.
 *
 * CACHES
 * ------
 *   bb-shell-v1   — app shell assets listed in SHELL_ASSETS
 *   bb-menu-v1    — GET /stores/<slug> snapshots (stale-while-revalidate)
 *
 * NOTE: The service worker is served from /sw.js (public directory).  Vite
 * does NOT bundle files in public/ so this file must be plain JS with no
 * import statements.  The VITE_API_URL origin is not known at build time, so
 * we match API requests by pathname prefix (/stores/) and by the fact that
 * they are NOT same-origin (i.e. they go to a different host than the app).
 */

'use strict';

// ---- configuration ---------------------------------------------------------

const SHELL_CACHE = 'bb-shell-v1';
const MENU_CACHE  = 'bb-menu-v1';

// Assets to pre-cache on install.  Keep this list minimal — large lists slow
// down the install phase.  Add versioned asset manifests here once you have a
// build manifest available.
const SHELL_ASSETS = [
  '/',
  '/index.html',
];

// Regexp that matches the store-menu snapshot endpoint on the API server.
// The API lives on a different origin (VITE_API_URL), so we match by path
// pattern regardless of origin.
const MENU_PATH_RE = /\/stores\/[^/]+(?:\?.*)?$/;

// ---- install ---------------------------------------------------------------

self.addEventListener('install', (evt) => {
  evt.waitUntil(
    caches.open(SHELL_CACHE).then((cache) => cache.addAll(SHELL_ASSETS))
  );
  // Skip waiting so the new SW activates immediately without a page reload.
  self.skipWaiting();
});

// ---- activate --------------------------------------------------------------

self.addEventListener('activate', (evt) => {
  // Evict any old caches that don't belong to this version.
  const keep = new Set([SHELL_CACHE, MENU_CACHE]);
  evt.waitUntil(
    caches.keys().then((names) =>
      Promise.all(names.filter((n) => !keep.has(n)).map((n) => caches.delete(n)))
    ).then(() => self.clients.claim())
  );
});

// ---- fetch -----------------------------------------------------------------

self.addEventListener('fetch', (evt) => {
  const { request } = evt;
  const url = new URL(request.url);

  // Only intercept GET and navigation requests.
  // POST/PATCH/DELETE are left to the network (queue.js handles offline mutations).
  if (request.method !== 'GET') return;

  // --- Store-menu snapshots: stale-while-revalidate -------------------------
  if (MENU_PATH_RE.test(url.pathname)) {
    evt.respondWith(staleWhileRevalidate(request, MENU_CACHE));
    return;
  }

  // --- App shell navigation requests: network-first, shell cache fallback ---
  if (request.mode === 'navigate') {
    evt.respondWith(networkFirstShell(request));
    return;
  }

  // --- Other same-origin static assets (JS chunks, CSS, images) ------------
  if (url.origin === self.location.origin) {
    evt.respondWith(networkFirstShell(request));
    return;
  }

  // --- All other requests (API calls that are not menu snapshots) -----------
  // Let them pass through to the network unmodified.
});

// ---- strategy: stale-while-revalidate --------------------------------------

/**
 * Serve from cache immediately (if available) then update the cache in the
 * background from the network.  Falls back to the network if no cache entry
 * exists.
 */
async function staleWhileRevalidate(request, cacheName) {
  const cache   = await caches.open(cacheName);
  const cached  = await cache.match(request);

  // Kick off background refresh regardless of whether we have a cached copy.
  const networkFetch = fetch(request.clone())
    .then((res) => {
      if (res.ok) {
        cache.put(request, res.clone()).catch(() => { /* quota errors are silent */ });
      }
      return res;
    })
    .catch(() => null); // network failure is non-fatal when we have cache

  if (cached) {
    // Background update already started — return the cached version.
    return cached;
  }

  // No cache yet — wait for the network.
  const fresh = await networkFetch;
  if (fresh) return fresh;

  // Both cache and network failed.
  return new Response(JSON.stringify({ error: 'offline', cached: false }), {
    status:  503,
    headers: { 'Content-Type': 'application/json' },
  });
}

// ---- strategy: network-first with shell cache fallback ---------------------

/**
 * Try the network first.  On failure serve from the shell cache.  If neither
 * works, return a minimal offline page.
 */
async function networkFirstShell(request) {
  try {
    const res = await fetch(request.clone());
    if (res.ok || res.type === 'opaque') {
      const cache = await caches.open(SHELL_CACHE);
      cache.put(request, res.clone()).catch(() => { /* quota errors are silent */ });
    }
    return res;
  } catch {
    const cache  = await caches.open(SHELL_CACHE);
    // For navigations always return the root index.html so the SPA router works.
    const cached = await cache.match(request) || await cache.match('/') || await cache.match('/index.html');
    if (cached) return cached;

    return new Response(
      '<!DOCTYPE html><html><head><meta charset="utf-8"><title>Offline</title></head>' +
      '<body><p>You are offline. Please check your connection and try again.</p></body></html>',
      { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
    );
  }
}
