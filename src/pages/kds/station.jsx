// station.jsx — per-station Kitchen Display Screen, mounted at /kds/:stationId.
//
// Responsibilities:
//   1. Initial fetch: GET /kds/stations/{stationId}/tickets.
//   2. Live feed:    SSE GET /kds/stations/{stationId}/stream — apply events
//      (fired/bumped/recalled/re_fired/rushed/cancelled) to the local list.
//   3. Optimistic mutations: bump/recall/refire/rush. POST endpoints. On error,
//      roll back the local state.
//   4. Live "fired XX:XX ago" + color tier via one shared 1Hz ticker.
//   5. Bump-bar keyboard hotkeys via useHotkeys (Wave 12):
//      1-9 bump Nth ticket, Space bump focused, r recall, ? toggle help overlay.

/* eslint-disable react/prop-types */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { AlertCircle, Keyboard, Loader2, RefreshCw, RotateCcw, Wifi, WifiOff, X } from 'lucide-react';

import { api } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { TicketCard } from './components/ticket-card';
import { useSSE } from './hooks/use-sse';
import { useTick } from './hooks/use-tick';
import { useTicketDetails } from './hooks/use-ticket-details';
import { useHotkeys } from './hooks/use-hotkeys';

const RECALL_WINDOW_MS = 30_000;

export default function StationPage() {
  const { stationId } = useParams();
  const [tickets, setTickets] = useState([]); // active tickets only
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState(null);
  const [actionError, setActionError] = useState(null);

  // Track the last-bumped ticket so we can show a Recall button briefly.
  // { ticket, snapshot, bumpedAtMs } — snapshot is the pre-bump row for rollback.
  const [lastBump, setLastBump] = useState(null);

  // Stash of tickets we've optimistically removed; used to rollback bumps that fail.
  const removedCacheRef = useRef(new Map()); // ticket_id -> ticket
  const inFlightRef = useRef(new Set());

  const now = useTick();

  // -------- initial + recovery fetch --------
  const refetch = useCallback(async () => {
    setFetchError(null);
    const { data, error } = await api.request('GET', `/kds/stations/${encodeURIComponent(stationId)}/tickets`);
    if (error) {
      setFetchError(error.message || 'Failed to load tickets');
      setLoading(false);
      return;
    }
    const list = Array.isArray(data) ? data : [];
    // Keep only active statuses; the backend already filters but be defensive.
    setTickets(list.filter((t) => t.status === 'fired' || t.status === 'in_progress' || t.status === 'ready'));
    setLoading(false);
  }, [stationId]);

  useEffect(() => {
    if (!stationId) return;
    setLoading(true);
    refetch();
  }, [stationId, refetch]);

  // -------- SSE handler --------
  const handleSSE = useCallback((evt) => {
    if (!evt || typeof evt !== 'object') return;
    const { ticket_id, event_type } = evt;
    if (!ticket_id) return;

    switch (event_type) {
      case 'bumped':
      case 'cancelled':
        setTickets((prev) => prev.filter((t) => t.id !== ticket_id));
        return;
      case 'rushed':
        setTickets((prev) => prev.map((t) =>
          t.id === ticket_id ? { ...t, priority: (t.priority || 0) + 1 } : t
        ));
        return;
      case 'fired':
      case 're_fired':
      case 'recalled':
      case 'started':
      case 'ready':
      default:
        // We don't have full ticket payload over SSE — refetch to get items.
        // Skip refetch if this ticket is one we just locally mutated (we already
        // have the up-to-date row from the POST response).
        if (inFlightRef.current.has(ticket_id)) return;
        refetch();
        return;
    }
  }, [refetch]);

  const ssePath = stationId
    ? `/kds/stations/${encodeURIComponent(stationId)}/stream`
    : null;

  const { status: sseStatus } = useSSE(ssePath, {
    onMessage: handleSSE,
    enabled: !!stationId,
  });

  // -------- mutation helpers --------
  const doAction = useCallback(async (action, ticket, { optimistic } = {}) => {
    inFlightRef.current.add(ticket.id);
    setActionError(null);

    // Apply optimistic UI before the request.
    optimistic?.apply();

    const { data, error } = await api.request(
      'POST',
      `/kds/tickets/${encodeURIComponent(ticket.id)}/${action}`,
      { body: {} }
    );

    inFlightRef.current.delete(ticket.id);

    if (error) {
      setActionError(`${action} failed: ${error.message || 'unknown error'}`);
      optimistic?.rollback();
      return null;
    }
    optimistic?.commit?.(data);
    return data;
  }, []);

  const onBump = useCallback((ticket) => {
    const snapshot = ticket;
    doAction('bump', ticket, {
      optimistic: {
        apply: () => {
          removedCacheRef.current.set(ticket.id, snapshot);
          setTickets((prev) => prev.filter((t) => t.id !== ticket.id));
          setLastBump({ ticket: snapshot, bumpedAtMs: Date.now() });
        },
        rollback: () => {
          removedCacheRef.current.delete(ticket.id);
          setTickets((prev) => {
            if (prev.some((t) => t.id === ticket.id)) return prev;
            return [...prev, snapshot];
          });
          setLastBump((b) => (b?.ticket?.id === ticket.id ? null : b));
        },
        commit: () => {
          removedCacheRef.current.delete(ticket.id);
        },
      },
    });
  }, [doAction]);

  const onRecall = useCallback((ticket) => {
    // Re-insert the cached snapshot back into the list as 'fired'.
    const cached = removedCacheRef.current.get(ticket.id) || ticket;
    const restored = { ...cached, status: 'fired', bumped_at: null };
    doAction('recall', ticket, {
      optimistic: {
        apply: () => {
          setTickets((prev) => prev.some((t) => t.id === ticket.id) ? prev : [...prev, restored]);
          setLastBump(null);
        },
        rollback: () => {
          setTickets((prev) => prev.filter((t) => t.id !== ticket.id));
        },
      },
    });
  }, [doAction]);

  const onRefire = useCallback((ticket) => {
    doAction('refire', ticket, {
      optimistic: {
        apply: () => setTickets((prev) => prev.map((t) =>
          t.id === ticket.id ? { ...t, status: 'fired', bumped_at: null } : t
        )),
        rollback: () => setTickets((prev) => prev.map((t) =>
          t.id === ticket.id ? ticket : t
        )),
      },
    });
  }, [doAction]);

  const onRush = useCallback((ticket) => {
    doAction('rush', ticket, {
      optimistic: {
        apply: () => setTickets((prev) => prev.map((t) =>
          t.id === ticket.id ? { ...t, priority: (t.priority || 0) + 1 } : t
        )),
        rollback: () => setTickets((prev) => prev.map((t) =>
          t.id === ticket.id ? ticket : t
        )),
      },
    });
  }, [doAction]);

  // -------- recall window timing --------
  const recallVisible = useMemo(() => {
    if (!lastBump) return false;
    return now - lastBump.bumpedAtMs < RECALL_WINDOW_MS;
  }, [lastBump, now]);

  // Drop the recall pointer when its window expires.
  useEffect(() => {
    if (lastBump && !recallVisible) setLastBump(null);
  }, [lastBump, recallVisible]);

  // -------- sort: priority desc, then fired_at asc --------
  const sorted = useMemo(() => {
    return [...tickets].sort((a, b) => {
      const pa = a.priority || 0, pb = b.priority || 0;
      if (pa !== pb) return pb - pa;
      return Date.parse(a.fired_at || 0) - Date.parse(b.fired_at || 0);
    });
  }, [tickets]);

  // -------- per-ticket detail (ingredients, prep steps) --------
  // Stable list of ids so the details hook's effect only fires when membership
  // actually changes, not on every priority-sort reshuffle.
  const ticketIds = useMemo(
    () => sorted.map((t) => t.id).filter(Boolean),
    [sorted],
  );
  const { getDetails, isLoading: detailsLoading } = useTicketDetails(ticketIds);

  // -------- bump-bar hotkeys --------
  const {
    focusedIndex,
    setFocusedIndex,
    overlayOpen,
    setOverlayOpen,
  } = useHotkeys({
    tickets: sorted,
    onBump,
    onRecall,
    lastBump,
    recallVisible,
  });

  // Derive whether the SSE connection is degraded for the banner.
  const sseOffline = sseStatus === 'error' || sseStatus === 'closed';
  const sseReconnecting = sseStatus === 'reconnecting';

  // -------- render --------
  return (
    <div className="flex h-screen flex-col bg-gray-950 text-gray-50">
      {/* ------------------------------------------------------------------ */}
      {/* SSE disconnection banner — sits above the header so it's impossible */}
      {/* to miss on a wall-mounted screen.                                   */}
      {/* ------------------------------------------------------------------ */}
      {(sseOffline || sseReconnecting) && (
        <div
          role="alert"
          aria-live="assertive"
          className={cn(
            'flex items-center justify-center gap-3 px-4 py-2.5 text-sm font-semibold',
            sseOffline
              ? 'bg-red-700 text-white'
              : 'bg-amber-500 text-amber-950',
          )}
        >
          <WifiOff className="size-4 shrink-0" />
          {sseOffline
            ? 'Live feed disconnected — tickets may be stale. Attempting to reconnect…'
            : 'Reconnecting to live feed…'}
          <button
            type="button"
            className="ml-2 rounded-md border border-current/40 px-2.5 py-0.5 text-xs font-bold transition-colors hover:bg-white/10"
            onClick={refetch}
          >
            Refresh now
          </button>
        </div>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* Header                                                              */}
      {/* ------------------------------------------------------------------ */}
      <header className="flex items-center justify-between border-b border-gray-800 bg-gray-900 px-5 py-3">
        <div className="flex items-center gap-4">
          {/* Orange left accent */}
          <div className="h-8 w-1.5 rounded-full bg-orange-500" aria-hidden="true" />
          <div className="flex flex-col leading-tight">
            <h1 className="text-xl font-extrabold tracking-tight text-white">
              Kitchen Display
            </h1>
            <span className="font-mono text-xs uppercase tracking-wider text-gray-400">
              station {stationId?.slice(0, 8) || '—'}
            </span>
          </div>
          {/* Ticket count pill */}
          {!loading && sorted.length > 0 && (
            <span className="rounded-full bg-orange-500 px-2.5 py-0.5 text-sm font-bold tabular-nums text-white">
              {sorted.length}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          {/* Quiet connection indicator when connected */}
          {!sseOffline && !sseReconnecting && (
            <ConnectionPill status={sseStatus} />
          )}

          <Button
            size="sm"
            variant="ghost"
            onClick={() => setOverlayOpen((v) => !v)}
            title="Keyboard shortcuts (?)"
            aria-label="Toggle hotkey help"
            className="text-gray-300 hover:bg-gray-800 hover:text-white"
          >
            <Keyboard className="size-4" />
          </Button>

          <Button
            size="sm"
            variant="ghost"
            onClick={refetch}
            disabled={loading}
            className="text-gray-300 hover:bg-gray-800 hover:text-white"
          >
            <RefreshCw className={loading ? 'size-4 animate-spin' : 'size-4'} />
          </Button>

          {recallVisible && lastBump && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => onRecall(lastBump.ticket)}
              className="gap-1.5 border-amber-500 bg-amber-500/10 text-amber-300 hover:bg-amber-500/20 hover:text-amber-200"
            >
              <RotateCcw className="size-3.5" />
              Recall #{lastBump.ticket.ticket_number}
              <RecallCountdown bumpedAtMs={lastBump.bumpedAtMs} now={now} totalMs={RECALL_WINDOW_MS} />
            </Button>
          )}
        </div>
      </header>

      {/* Action error toast */}
      {actionError && (
        <div
          role="alert"
          className="mx-4 mt-3 flex items-center gap-3 rounded-lg border border-red-700 bg-red-950 px-4 py-3 text-sm text-red-300"
        >
          <AlertCircle className="size-4 shrink-0 text-red-400" />
          <span className="flex-1">{actionError}</span>
          <button
            type="button"
            onClick={() => setActionError(null)}
            className="rounded p-0.5 transition-colors hover:bg-red-900"
            aria-label="Dismiss error"
          >
            <X className="size-3.5" />
          </button>
        </div>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* Main ticket grid                                                    */}
      {/* ------------------------------------------------------------------ */}
      <main className="flex-1 overflow-auto p-4">
        {loading ? (
          <LoadingState />
        ) : fetchError ? (
          <ErrorState error={fetchError} onRetry={refetch} />
        ) : sorted.length === 0 ? (
          <EmptyState />
        ) : (
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
            {sorted.map((t, i) => (
              <div
                key={t.id}
                className={cn(
                  'relative rounded-xl transition-all duration-150',
                  i === focusedIndex
                    ? 'ring-4 ring-orange-500 ring-offset-2 ring-offset-gray-950'
                    : 'ring-0',
                )}
                onClick={() => setFocusedIndex(i)}
              >
                {/* Slot number badge — shown so bump-bar operators know which key to press */}
                {sorted.length > 1 && (
                  <span
                    aria-hidden="true"
                    className={cn(
                      'absolute -top-2.5 -left-2.5 z-10 flex size-6 items-center justify-center rounded-full text-xs font-extrabold tabular-nums ring-2 ring-gray-950',
                      i === focusedIndex
                        ? 'bg-orange-500 text-white'
                        : 'bg-gray-700 text-gray-300',
                    )}
                  >
                    {i < 9 ? i + 1 : '…'}
                  </span>
                )}
                <TicketCard
                  ticket={t}
                  details={getDetails(t.id)}
                  detailsLoading={detailsLoading(t.id)}
                  now={now}
                  onBump={onBump}
                  onRush={onRush}
                  onRefire={onRefire}
                  showRecall={false}
                />
              </div>
            ))}
          </div>
        )}
      </main>

      {/* Hotkey help overlay */}
      {overlayOpen && <HotkeyOverlay onClose={() => setOverlayOpen(false)} />}
    </div>
  );
}

// ---- RecallCountdown ----
// Small countdown bar showing how many seconds remain in the recall window.

function RecallCountdown({ bumpedAtMs, now, totalMs }) {
  const remaining = Math.max(0, totalMs - (now - bumpedAtMs));
  const pct = Math.round((remaining / totalMs) * 100);
  const secs = Math.ceil(remaining / 1000);
  return (
    <span
      className="flex items-center gap-1 text-xs tabular-nums text-amber-400"
      aria-label={`${secs}s to recall`}
    >
      ({secs}s)
    </span>
  );
}

// ---- ConnectionPill ----

function ConnectionPill({ status }) {
  const map = {
    open:         { icon: Wifi,    label: 'Live',         cls: 'text-emerald-400' },
    connecting:   { icon: Loader2, label: 'Connecting',   cls: 'text-gray-400 animate-pulse' },
    reconnecting: { icon: Loader2, label: 'Reconnecting', cls: 'text-amber-400 animate-pulse' },
    error:        { icon: WifiOff, label: 'Offline',      cls: 'text-red-400' },
    closed:       { icon: WifiOff, label: 'Closed',       cls: 'text-gray-500' },
    idle:         { icon: WifiOff, label: 'Idle',         cls: 'text-gray-500' },
  };
  const m = map[status] || map.idle;
  const Icon = m.icon;
  return (
    <span className={`flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium ${m.cls}`}>
      <Icon className={status === 'connecting' || status === 'reconnecting' ? 'size-3 animate-spin' : 'size-3'} />
      {m.label}
    </span>
  );
}

// ---- Loading / Empty / Error states ----

function LoadingState() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 text-gray-400">
      <Loader2 className="size-10 animate-spin text-orange-500" />
      <p className="text-lg font-medium">Loading tickets…</p>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
      {/* Big check: nothing to cook */}
      <div className="flex size-20 items-center justify-center rounded-full bg-emerald-900/40">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          className="size-10 text-emerald-400"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
          aria-hidden="true"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
        </svg>
      </div>
      <p className="text-2xl font-bold text-gray-200">All clear!</p>
      <p className="max-w-xs text-base text-gray-400">
        No active tickets on this station. New orders will appear here in real time.
      </p>
    </div>
  );
}

function ErrorState({ error, onRetry }) {
  return (
    <div className="mx-auto mt-12 flex max-w-md flex-col items-center gap-4 rounded-xl border border-red-800 bg-red-950/60 p-8 text-center">
      <AlertCircle className="size-10 text-red-400" aria-hidden="true" />
      <div>
        <p className="text-lg font-bold text-red-300">Could not load station</p>
        <p className="mt-1 text-sm text-red-400">{error}</p>
      </div>
      <Button
        variant="outline"
        onClick={onRetry}
        className="border-red-700 text-red-300 hover:bg-red-900"
      >
        <RefreshCw className="mr-2 size-4" /> Retry
      </Button>
    </div>
  );
}

// ---- HotkeyOverlay ----
//
// A centered modal-style card listing all bump-bar shortcuts. Dismissed by
// pressing Escape, clicking the close button, or clicking the backdrop.

const HOTKEYS = [
  { keys: ['1', '–', '9'], desc: 'Bump the Nth visible ticket' },
  { keys: ['Space'],        desc: 'Bump the focused ticket' },
  { keys: ['r'],            desc: 'Recall the last bumped ticket' },
  { keys: ['←', '→'],      desc: 'Move focus left / right' },
  { keys: ['↑', '↓'],      desc: 'Move focus up / down' },
  { keys: ['?'],            desc: 'Toggle this help overlay' },
  { keys: ['Esc'],          desc: 'Close this overlay' },
];

function HotkeyOverlay({ onClose }) {
  return (
    /* backdrop */
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Keyboard shortcuts"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="relative w-full max-w-sm rounded-2xl border border-gray-700 bg-gray-900 p-6 shadow-2xl">
        {/* header */}
        <div className="mb-5 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="flex size-8 items-center justify-center rounded-lg bg-orange-500/20">
              <Keyboard className="size-4 text-orange-400" />
            </div>
            <h2 className="text-lg font-bold text-white">Keyboard shortcuts</h2>
          </div>
          <Button
            size="icon"
            variant="ghost"
            onClick={onClose}
            aria-label="Close"
            className="text-gray-400 hover:bg-gray-800 hover:text-white"
          >
            <X className="size-4" />
          </Button>
        </div>

        {/* shortcut rows */}
        <ul className="space-y-3">
          {HOTKEYS.map(({ keys, desc }) => (
            <li key={desc} className="flex items-center justify-between gap-4">
              <span className="text-sm text-gray-300">{desc}</span>
              <span className="flex shrink-0 items-center gap-1">
                {keys.map((k) => (
                  <kbd
                    key={k}
                    className="inline-flex items-center justify-center rounded-md border border-gray-600 bg-gray-800 px-2.5 py-1 font-mono text-xs font-bold text-gray-100 shadow-sm"
                  >
                    {k}
                  </kbd>
                ))}
              </span>
            </li>
          ))}
        </ul>

        <p className="mt-6 text-center text-xs text-gray-500">
          Shortcuts are inactive while an input field is focused.
        </p>
      </div>
    </div>
  );
}
