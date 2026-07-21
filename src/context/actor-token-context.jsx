// actor-token-context.jsx — in-memory staff PIN-overlay token management.
//
// Security rationale: the actor token is NEVER written to localStorage or
// sessionStorage. It lives only in React state (JS heap). An XSS payload or
// another browser tab on a shared device cannot read it. A hard page refresh
// intentionally clears the actor so the PIN overlay re-prompts — this is the
// desired behaviour for a shared POS terminal.
//
// Idle / expiry logic:
//   - The token has an absolute TTL of 15 min (ACTOR_TTL_MS) from the time
//     setActor() is called (server issues the token with that TTL; we mirror it
//     client-side as a UX gate).
//   - Any user activity inside the POS workspace (mousemove / keydown / click /
//     touchstart / scroll) resets a separate idle countdown (IDLE_TTL_MS, also
//     15 min). If the user leaves the POS open but untouched, the actor clears
//     after 15 min of inactivity even if the absolute TTL has not yet elapsed.
//   - Both timers are cleared / reset via clearActor() or when the component
//     unmounts.

import {
  useState,
  useRef,
  useCallback,
  useEffect,
  useMemo,
  useContext,
  createContext,
} from 'react';

const ACTOR_TTL_MS = 15 * 60 * 1000;  // 15 minutes absolute
const IDLE_TTL_MS  = 15 * 60 * 1000;  // 15 minutes idle

// Module-level singleton mirror so api-client.js can read the current actor
// token without importing React. Populated / cleared by the Provider.
// This is a plain object reference; it never touches storage.
export const _actorRef = { current: null };

const ActorTokenContext = createContext(undefined);

export function useActor() {
  const ctx = useContext(ActorTokenContext);
  if (ctx === undefined) {
    throw new Error('useActor must be used within an ActorTokenProvider');
  }
  return ctx;
}

export function ActorTokenProvider({ children }) {
  // actor shape: { member_id, staff_id, location_id, display_name, role,
  //               capabilities: string[], _token: string, _expiresAt: number }
  const [actor, setActorState] = useState(null);
  const [isExpired, setIsExpired] = useState(false);

  // Refs for timer handles so they survive re-renders without adding deps.
  const absoluteTimerRef = useRef(null);
  const idleTimerRef     = useRef(null);

  // ---- internal helpers -------------------------------------------------------

  const _clearTimers = useCallback(() => {
    if (absoluteTimerRef.current) {
      clearTimeout(absoluteTimerRef.current);
      absoluteTimerRef.current = null;
    }
    if (idleTimerRef.current) {
      clearTimeout(idleTimerRef.current);
      idleTimerRef.current = null;
    }
  }, []);

  const _expireActor = useCallback(() => {
    _clearTimers();
    _actorRef.current = null;
    setActorState(null);
    setIsExpired(true);
  }, [_clearTimers]);

  // Reset the idle countdown. Called on each tracked user-interaction event.
  const _resetIdleTimer = useCallback(() => {
    if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    idleTimerRef.current = setTimeout(_expireActor, IDLE_TTL_MS);
  }, [_expireActor]);

  // ---- public API -------------------------------------------------------------

  const setActor = useCallback((payload) => {
    if (!payload) return;
    // Accepts either shape:
    //   New overlay shape (POST /pos/pin-verify):
    //     { actor_token, expires_at, staff: {id, display_name, role}, capabilities, slug? }
    //   Legacy flat shape (POST /auth/staff/pin-login):
    //     { access_token, member_id, staff_id, location_id, display_name, role, capabilities }
    const isOverlay = Boolean(payload.actor_token);
    const staffRecord = isOverlay ? (payload.staff ?? {}) : payload;
    const rawToken = isOverlay ? payload.actor_token : (payload.access_token ?? payload.token ?? '');
    const msUntilExpiry = isOverlay && payload.expires_at
      ? Math.max(0, new Date(payload.expires_at).getTime() - Date.now())
      : ACTOR_TTL_MS;

    const next = {
      member_id:    payload.member_id    ?? null,
      staff_id:     isOverlay ? (staffRecord.id ?? null) : (payload.staff_id ?? null),
      location_id:  payload.location_id  ?? null,
      display_name: staffRecord.display_name ?? payload.display_name ?? '',
      role:         staffRecord.role         ?? payload.role         ?? '',
      capabilities: Array.isArray(payload.capabilities) ? payload.capabilities : [],
      slug:         payload.slug ?? null,
      _token:       rawToken,
      _expiresAt:   Date.now() + msUntilExpiry,
    };

    _clearTimers();
    _actorRef.current = next;
    setActorState(next);
    setIsExpired(false);

    // Absolute TTL timer — uses server's expires_at when available.
    absoluteTimerRef.current = setTimeout(_expireActor, msUntilExpiry);
    // Idle TTL timer (reset on each activity event; see effect below).
    idleTimerRef.current = setTimeout(_expireActor, IDLE_TTL_MS);
  }, [_clearTimers, _expireActor]);

  const clearActor = useCallback(() => {
    _clearTimers();
    _actorRef.current = null;
    setActorState(null);
    setIsExpired(false);
  }, [_clearTimers]);

  const hasCapability = useCallback((name) => {
    if (!actor || isExpired) return false;
    return actor.capabilities.includes(name);
  }, [actor, isExpired]);

  // Mutates a plain headers object (or Headers instance) in-place.
  const attachToRequest = useCallback((headers) => {
    if (!actor || isExpired || !actor._token) return;
    if (headers instanceof Headers) {
      headers.set('X-Actor-Token', actor._token);
    } else {
      headers['X-Actor-Token'] = actor._token;
    }
  }, [actor, isExpired]);

  // ---- idle-timer event listeners --------------------------------------------
  // Attach to window so any interaction anywhere in the SPA resets the countdown.
  // Using passive listeners keeps scroll performance unaffected.

  useEffect(() => {
    if (!actor) return; // only track when an actor is set

    const EVENTS = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll', 'click'];
    const handle = () => _resetIdleTimer();

    for (const ev of EVENTS) {
      window.addEventListener(ev, handle, { passive: true });
    }
    return () => {
      for (const ev of EVENTS) {
        window.removeEventListener(ev, handle, { passive: true });
      }
    };
  }, [actor, _resetIdleTimer]);

  // Cleanup on unmount.
  useEffect(() => () => {
    _clearTimers();
    _actorRef.current = null;
  }, [_clearTimers]);

  // ---- context value ----------------------------------------------------------

  // Expose the public actor fields only (strip internal _token / _expiresAt).
  const publicActor = useMemo(() => {
    if (!actor || isExpired) return null;
    const { _token: _t, _expiresAt: _e, ...pub } = actor; // eslint-disable-line no-unused-vars
    return pub;
  }, [actor, isExpired]);

  const value = useMemo(() => ({
    actor: publicActor,
    setActor,
    clearActor,
    hasCapability,
    isExpired,
    attachToRequest,
  }), [publicActor, setActor, clearActor, hasCapability, isExpired, attachToRequest]);

  return (
    <ActorTokenContext.Provider value={value}>
      {children}
    </ActorTokenContext.Provider>
  );
}

export default ActorTokenProvider;
