/**
 * sse-cursor.js — EventSource wrapper that tracks the last-seen event ID and
 * reconnects with `?since_event_id=<id>` so a reconnecting KDS client can
 * replay missed events without duplication.
 *
 * SERVER FOLLOW-UP NOTE
 * ---------------------
 * The `since_event_id` query param is sent on every reconnect attempt but the
 * server must be updated to honour it (i.e. replay events with id > since_event_id
 * from the event log).  Until that lands the parameter is a no-op on the server
 * and the client will simply re-receive events it has already seen — callers
 * should de-duplicate by the `id` field of each event.
 *
 * USAGE
 * -----
 *   import { SseCursor } from '@/offline/sse-cursor.js';
 *
 *   const cursor = new SseCursor('/kds/stations/42/stream', {
 *     onMessage(payload, rawEvent) { … },
 *     onOpen()   { … },
 *     onError(err) { … },
 *     // optional: provide a previously-persisted cursor to resume from:
 *     initialCursor: localStorage.getItem('kds_cursor') ?? undefined,
 *     withCredentials: true,
 *     token: null,       // if non-null, appended as ?token=… (cookie fallback)
 *   });
 *
 *   // later:
 *   cursor.close();
 *   console.log(cursor.lastEventId); // persist this for the next session
 *
 * The class is framework-free.  Wrap it in a React hook / effect as needed.
 */

const API_URL = (typeof import.meta !== 'undefined' && import.meta.env?.VITE_API_URL)
  ? import.meta.env.VITE_API_URL
  : 'http://localhost:8080';

const STORAGE_KEY = 'bb.auth';

const BACKOFF_MS = [1000, 2000, 4000, 8000, 16000, 30000];

function readToken() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw)?.access_token ?? null;
  } catch {
    return null;
  }
}

export class SseCursor {
  /**
   * @param {string} path  - Relative path, e.g. '/kds/stations/42/stream'
   * @param {{
   *   onMessage?:       (payload: any, rawEvent: MessageEvent) => void,
   *   onOpen?:          () => void,
   *   onError?:         (err: Event) => void,
   *   initialCursor?:   string | null,
   *   withCredentials?: boolean,
   *   token?:           string | null,
   * }} opts
   */
  constructor(path, opts = {}) {
    this._path            = path;
    this._onMessage       = opts.onMessage       ?? null;
    this._onOpen          = opts.onOpen          ?? null;
    this._onError         = opts.onError         ?? null;
    this._withCredentials = opts.withCredentials ?? true;
    this._explicitToken   = opts.token           ?? null;

    /** @type {string | null} Last received `event.lastEventId` (or `event.id`). */
    this.lastEventId = opts.initialCursor ?? null;

    this._closed     = false;
    this._es         = null;
    this._retryTimer = null;
    this._attempt    = 0;
    this._everOpened = false;
    this._useTokenFallback = Boolean(this._explicitToken);

    this._connect();
  }

  // ---- public ---------------------------------------------------------------

  /**
   * Permanently close the connection.  After calling close() the cursor will
   * not reconnect.
   */
  close() {
    this._closed = true;
    if (this._retryTimer) {
      clearTimeout(this._retryTimer);
      this._retryTimer = null;
    }
    if (this._es) {
      this._es.close();
      this._es = null;
    }
  }

  // ---- private --------------------------------------------------------------

  _buildUrl() {
    const base  = this._path.startsWith('http') ? this._path : `${API_URL}${this._path}`;
    const sep   = base.includes('?') ? '&' : '?';
    const parts = [];

    // Attach cursor so the server can replay missed events.
    if (this.lastEventId) {
      parts.push(`since_event_id=${encodeURIComponent(this.lastEventId)}`);
    }

    // Token fallback (when cookies are not viable).
    if (this._useTokenFallback) {
      const tok = this._explicitToken || readToken();
      if (tok) parts.push(`token=${encodeURIComponent(tok)}`);
    }

    return parts.length ? `${base}${sep}${parts.join('&')}` : base;
  }

  _scheduleReconnect() {
    const delay = BACKOFF_MS[Math.min(this._attempt, BACKOFF_MS.length - 1)];
    this._attempt += 1;
    this._retryTimer = setTimeout(() => this._connect(), delay);
  }

  _connect() {
    if (this._closed) return;
    this._retryTimer = null;

    const url  = this._buildUrl();
    const opts = this._withCredentials && !this._useTokenFallback
      ? { withCredentials: true }
      : {};

    let es;
    try {
      es = new EventSource(url, opts);
    } catch (err) {
      this._onError?.(err);
      this._scheduleReconnect();
      return;
    }

    this._es = es;

    es.onopen = () => {
      if (this._closed) return;
      this._everOpened = true;
      this._attempt    = 0;
      this._onOpen?.();
    };

    es.onmessage = (ev) => {
      if (this._closed) return;

      // Track the cursor using the standard `lastEventId` property which the
      // browser populates from the `id:` field of the SSE frame.
      if (ev.lastEventId) {
        this.lastEventId = ev.lastEventId;
      }

      let payload = ev.data;
      try { payload = JSON.parse(ev.data); } catch { /* keep raw string */ }

      this._onMessage?.(payload, ev);
    };

    // Also listen for named events (servers often emit typed events like
    // "ticket_update", "order_ready", etc.).
    // We cannot register these statically without knowing the names, so callers
    // who need named events should do:
    //   cursor._es?.addEventListener('ticket_update', handler);
    // after construction.  The cursor exposes _es for this purpose.

    es.onerror = (err) => {
      if (this._closed) return;

      const wasOpen = es.readyState === EventSource.OPEN;
      es.close();
      this._es = null;

      this._onError?.(err);

      // If we never opened and cookies were used, suspect auth rejection →
      // switch to token-based auth for subsequent attempts.
      if (!this._everOpened && !this._useTokenFallback && !wasOpen) {
        this._useTokenFallback = true;
      }

      this._scheduleReconnect();
    };
  }
}

export default SseCursor;
