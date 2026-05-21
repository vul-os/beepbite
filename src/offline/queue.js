/**
 * queue.js — IndexedDB-backed offline mutation queue with auto-flush on reconnect.
 *
 * OVERVIEW
 * --------
 * When a mutating API call fails because the device is offline (or on any
 * transient network error), callers enqueue the mutation here instead of
 * losing it.  On reconnect the queue flushes automatically, replaying each
 * mutation in insertion order with exponential back-off.
 *
 * The queue persists across page reloads via IndexedDB.  A single shared
 * database ("bb_offline_queue", store "mutations") is used; the primary key
 * is an auto-incremented integer so ordering is preserved.
 *
 * OPTIMISTIC UI
 * -------------
 * Callers may supply `onOptimisticApply` and `onRollback` callbacks when
 * enqueueing.  `onOptimisticApply` is called immediately (synchronously after
 * enqueueing) so the UI can reflect the pending change.  `onRollback` is
 * called if the mutation ultimately fails after all retries are exhausted.
 * Both callbacks are in-memory only and are NOT persisted across reloads — they
 * should be re-attached by the component that owns the optimistic state if it
 * remounts before the queue flushes.
 *
 * IDEMPOTENCY
 * -----------
 * Every enqueued mutation must carry an `idempotencyKey` (see idempotency.js).
 * The key is sent as the `Idempotency-Key` HTTP header so the server can
 * deduplicate retries transparently.
 *
 * FLUSH BEHAVIOUR
 * ---------------
 *   - Automatic flush on `navigator.onLine` becoming true ('online' event).
 *   - Initial flush on module import if already online.
 *   - Callers can trigger a manual flush with `flushQueue()`.
 *   - Retries use backoff: [2s, 4s, 8s, 16s, 30s] then repeats at 30s.
 *   - A mutation is dropped (and `onRollback` fired) after MAX_RETRIES failures.
 *
 * EXPORTED API
 * ------------
 *   enqueueMutation(mutation)     → Promise<number>  (stored IDB key)
 *   flushQueue()                  → Promise<void>
 *   onFlush(callback)             → unsubscribe fn   (called after each successful flush of one item)
 *   getPendingCount()             → Promise<number>
 *
 * MUTATION SHAPE
 * --------------
 * {
 *   url:             string,            // absolute or relative URL
 *   method:          string,            // 'POST' | 'PATCH' | 'DELETE' …
 *   body:            any,               // JSON-serialisable
 *   headers:         Record<string,string> (optional),
 *   idempotencyKey:  string,            // required — from idempotency.js
 *   // In-memory only (not persisted):
 *   onOptimisticApply?: () => void,
 *   onRollback?:        () => void,
 * }
 */

// ---- constants -------------------------------------------------------------

const DB_NAME    = 'bb_offline_queue';
const DB_VERSION = 1;
const STORE_NAME = 'mutations';
const MAX_RETRIES = 5;

const BACKOFF_MS = [2000, 4000, 8000, 16000, 30000];

const STORAGE_KEY = 'bb.auth'; // mirrors api-client.js

// ---- auth helper -----------------------------------------------------------

function readAccessToken() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw)?.access_token ?? null;
  } catch {
    return null;
  }
}

// ---- IndexedDB bootstrap ---------------------------------------------------

let _dbPromise = null;

function openDB() {
  if (_dbPromise) return _dbPromise;
  _dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = (evt) => {
      const db = evt.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, {
          keyPath:       'id',
          autoIncrement: true,
        });
        // Index on retryCount so we can filter by exhaustion in future.
        store.createIndex('retryCount', 'retryCount', { unique: false });
      }
    };

    req.onsuccess = (evt) => resolve(evt.target.result);
    req.onerror   = (evt) => reject(evt.target.error);
  });
  return _dbPromise;
}

// ---- IDB helpers -----------------------------------------------------------

async function idbGetAll() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx   = db.transaction(STORE_NAME, 'readonly');
    const req  = tx.objectStore(STORE_NAME).getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  });
}

async function idbAdd(record) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(STORE_NAME, 'readwrite');
    const req = tx.objectStore(STORE_NAME).add(record);
    req.onsuccess = () => resolve(req.result); // returns the generated key
    req.onerror   = () => reject(req.error);
  });
}

async function idbPut(record) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(STORE_NAME, 'readwrite');
    const req = tx.objectStore(STORE_NAME).put(record);
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  });
}

async function idbDelete(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(STORE_NAME, 'readwrite');
    const req = tx.objectStore(STORE_NAME).delete(id);
    req.onsuccess = () => resolve();
    req.onerror   = () => reject(req.error);
  });
}

// ---- In-memory callbacks (not persisted) -----------------------------------

// Map from IDB key → { onOptimisticApply, onRollback }
const _callbacks = new Map();

// Flush subscribers
const _flushListeners = new Set();

/**
 * Subscribe to successful single-item flush events.
 * @param {(mutation: object) => void} cb
 * @returns {() => void} unsubscribe
 */
export function onFlush(cb) {
  _flushListeners.add(cb);
  return () => _flushListeners.delete(cb);
}

function emitFlush(mutation) {
  for (const cb of _flushListeners) {
    try { cb(mutation); } catch (e) { console.error('[offline/queue] onFlush error', e); }
  }
}

// ---- Network request -------------------------------------------------------

const API_URL = (typeof import.meta !== 'undefined' && import.meta.env?.VITE_API_URL)
  ? import.meta.env.VITE_API_URL
  : 'http://localhost:8080';

async function executeRequest(record) {
  const { url, method, body, headers = {}, idempotencyKey } = record;

  const h = {
    'Content-Type': 'application/json',
    ...headers,
  };

  if (idempotencyKey) {
    h['Idempotency-Key'] = idempotencyKey;
  }

  const token = readAccessToken();
  if (token) {
    h['Authorization'] = `Bearer ${token}`;
  }

  const fullUrl = url.startsWith('http') ? url : `${API_URL}${url}`;

  const res = await fetch(fullUrl, {
    method,
    headers: h,
    body:    body !== undefined ? JSON.stringify(body) : undefined,
    credentials: 'include',
  });

  if (!res.ok) {
    // 4xx (except 409/idempotency conflict which we treat as success) are
    // terminal — don't retry.
    const terminal = res.status >= 400 && res.status < 500 && res.status !== 409;
    const err = new Error(`HTTP ${res.status}`);
    err.status   = res.status;
    err.terminal = terminal;
    throw err;
  }

  return res;
}

// ---- Flush logic -----------------------------------------------------------

let _flushing = false;

/**
 * Flush all queued mutations in insertion order.
 * Skips mutations whose retryCount exceeds MAX_RETRIES.
 */
export async function flushQueue() {
  if (_flushing) return;
  if (!navigator.onLine) return;

  _flushing = true;
  try {
    const records = await idbGetAll();

    for (const record of records) {
      if (!navigator.onLine) break;

      if (record.retryCount >= MAX_RETRIES) {
        // Exhausted — drop and rollback.
        console.warn('[offline/queue] dropping mutation after max retries', record);
        await idbDelete(record.id);
        const cbs = _callbacks.get(record.id);
        if (cbs?.onRollback) {
          try { cbs.onRollback(record); } catch { /* ignore */ }
        }
        _callbacks.delete(record.id);
        continue;
      }

      try {
        await executeRequest(record);
        await idbDelete(record.id);
        const cbs = _callbacks.get(record.id);
        _callbacks.delete(record.id);
        emitFlush({ ...record, _callbacks: cbs });
      } catch (err) {
        if (err.terminal) {
          console.error('[offline/queue] terminal error — dropping mutation', record, err);
          await idbDelete(record.id);
          const cbs = _callbacks.get(record.id);
          if (cbs?.onRollback) {
            try { cbs.onRollback(record, err); } catch { /* ignore */ }
          }
          _callbacks.delete(record.id);
        } else {
          // Transient — increment retry and wait with backoff before next.
          const nextRetry = (record.retryCount || 0) + 1;
          await idbPut({ ...record, retryCount: nextRetry });
          const delay = BACKOFF_MS[Math.min(nextRetry - 1, BACKOFF_MS.length - 1)];
          console.warn(`[offline/queue] retry ${nextRetry}/${MAX_RETRIES} in ${delay}ms`, record);
          // Stop processing further items; the 'online' event or a manual
          // flushQueue() call will resume after the backoff.
          await new Promise((r) => setTimeout(r, delay));
          break;
        }
      }
    }
  } finally {
    _flushing = false;
  }
}

// ---- Online listener -------------------------------------------------------

if (typeof window !== 'undefined') {
  window.addEventListener('online', () => {
    flushQueue().catch((e) =>
      console.error('[offline/queue] flush on reconnect failed', e)
    );
  });

  // Initial flush if already online (e.g. pending items from a previous session).
  if (navigator.onLine) {
    // Defer to next tick so callers can register onFlush before the first flush.
    Promise.resolve().then(() =>
      flushQueue().catch((e) =>
        console.error('[offline/queue] initial flush failed', e)
      )
    );
  }
}

// ---- Public API ------------------------------------------------------------

/**
 * Enqueue a mutation to be replayed when the device is back online.
 *
 * `onOptimisticApply` is invoked immediately (before this function resolves)
 * so the UI can apply an optimistic update.  `onRollback` is invoked if the
 * mutation is ultimately dropped after MAX_RETRIES failures.
 *
 * @param {{
 *   url: string,
 *   method: string,
 *   body?: any,
 *   headers?: Record<string,string>,
 *   idempotencyKey: string,
 *   onOptimisticApply?: () => void,
 *   onRollback?: (record: object, err?: Error) => void,
 * }} mutation
 * @returns {Promise<number>} IDB auto-generated key
 */
export async function enqueueMutation(mutation) {
  const { onOptimisticApply, onRollback, ...persistable } = mutation;

  const record = {
    ...persistable,
    retryCount: 0,
    enqueuedAt: Date.now(),
  };

  const id = await idbAdd(record);

  if (onOptimisticApply || onRollback) {
    _callbacks.set(id, { onOptimisticApply, onRollback });
  }

  if (onOptimisticApply) {
    try { onOptimisticApply(); } catch (e) {
      console.error('[offline/queue] onOptimisticApply error', e);
    }
  }

  return id;
}

/**
 * Return the number of pending mutations currently in the queue.
 * @returns {Promise<number>}
 */
export async function getPendingCount() {
  const records = await idbGetAll();
  return records.length;
}
