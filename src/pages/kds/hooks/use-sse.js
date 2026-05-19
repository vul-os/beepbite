// use-sse.js — generic Server-Sent Events hook with reconnect + backoff.
//
// The browser's native EventSource cannot set arbitrary headers, so we cannot
// forward a `Authorization: Bearer …` header. The backend SSE handler is
// mounted inside an authenticated chi.Router group; the two viable auth paths
// are:
//   1) cookie-based auth (browser auto-attaches cookies because we pass
//      `withCredentials: true`)  — preferred.
//   2) query-param token (`?token=…`)                                  — fallback.
//
// We optimistically try (1). If the EventSource errors out before EVER
// receiving an event (likely a 401), we retry once with (2). After that the
// usual exponential backoff (1s → 2s → 4s → 8s → 16s → 30s max) applies.
//
// Usage:
//   useSSE(`/kds/stations/${stationId}/stream`, {
//     onMessage: (ev) => …,
//     onOpen:    () => …,
//     onError:   (err) => …,
//   });

import { useEffect, useRef, useState } from 'react';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8080';
const AUTH_KEY = 'bb.auth';

function readToken() {
  try {
    const raw = localStorage.getItem(AUTH_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed?.access_token || null;
  } catch {
    return null;
  }
}

const BACKOFF_STEPS_MS = [1000, 2000, 4000, 8000, 16000, 30000];

/**
 * useSSE — open and maintain an EventSource against `path` (relative to API_URL).
 *
 * Returns `{ status }` where status is one of:
 *   'idle' | 'connecting' | 'open' | 'reconnecting' | 'closed' | 'error'
 *
 * Callbacks are read from a ref so changing them doesn't tear down the stream.
 */
export function useSSE(path, { onMessage, onOpen, onError, enabled = true } = {}) {
  const [status, setStatus] = useState('idle');
  const cbsRef = useRef({ onMessage, onOpen, onError });
  cbsRef.current = { onMessage, onOpen, onError };

  useEffect(() => {
    if (!enabled || !path) {
      setStatus('idle');
      return undefined;
    }

    let cancelled = false;
    let es = null;
    let retryTimer = null;
    let attempt = 0;
    // Track whether we've ever opened cleanly with cookie auth. If a connection
    // dies before we received `onopen`, we suspect 401 and switch to ?token=.
    let everOpened = false;
    let useTokenFallback = false;

    function scheduleReconnect() {
      const delay = BACKOFF_STEPS_MS[Math.min(attempt, BACKOFF_STEPS_MS.length - 1)];
      attempt += 1;
      setStatus('reconnecting');
      retryTimer = setTimeout(connect, delay);
    }

    function connect() {
      if (cancelled) return;
      retryTimer = null;
      setStatus(attempt === 0 ? 'connecting' : 'reconnecting');

      let url = `${API_URL}${path}`;
      const opts = {};
      if (useTokenFallback) {
        const tok = readToken();
        if (tok) {
          const sep = url.includes('?') ? '&' : '?';
          url = `${url}${sep}token=${encodeURIComponent(tok)}`;
        }
      } else {
        opts.withCredentials = true;
      }

      try {
        es = new EventSource(url, opts);
      } catch (err) {
        cbsRef.current.onError?.(err);
        setStatus('error');
        scheduleReconnect();
        return;
      }

      es.onopen = () => {
        if (cancelled) return;
        everOpened = true;
        attempt = 0;
        setStatus('open');
        cbsRef.current.onOpen?.();
      };

      es.onmessage = (ev) => {
        if (cancelled) return;
        let payload = ev.data;
        try { payload = JSON.parse(ev.data); } catch { /* keep raw */ }
        cbsRef.current.onMessage?.(payload, ev);
      };

      es.onerror = (err) => {
        if (cancelled) return;
        cbsRef.current.onError?.(err);
        const wasOpen = es?.readyState === EventSource.OPEN;
        es?.close();
        es = null;
        // First error with cookie auth and we never received `onopen`
        // anywhere on this stream — probably an auth rejection. Switch.
        if (!everOpened && !useTokenFallback && !wasOpen) {
          useTokenFallback = true;
        }
        setStatus('error');
        scheduleReconnect();
      };
    }

    connect();

    return () => {
      cancelled = true;
      if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
      if (es) { es.close(); es = null; }
      setStatus('closed');
    };
  }, [path, enabled]);

  return { status };
}

export default useSSE;
