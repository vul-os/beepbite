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
import { AlertCircle, Keyboard, Loader2, RefreshCw, Wifi, WifiOff, X } from 'lucide-react';

import { api } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
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

  // -------- render --------
  return (
    <div className="flex h-screen flex-col bg-background text-[17px]">
      <header className="flex items-center justify-between border-b px-5 py-3">
        <div className="flex items-baseline gap-3">
          <h1 className="text-2xl font-bold tracking-tight">Kitchen Display</h1>
          <span className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
            station {stationId?.slice(0, 8) || '—'}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <ConnectionPill status={sseStatus} />
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setOverlayOpen((v) => !v)}
            title="Keyboard shortcuts (?)"
            aria-label="Toggle hotkey help"
          >
            <Keyboard className="size-4" />
          </Button>
          <Button size="sm" variant="ghost" onClick={refetch} disabled={loading}>
            <RefreshCw className={loading ? 'size-4 animate-spin' : 'size-4'} />
          </Button>
          {recallVisible && lastBump && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => onRecall(lastBump.ticket)}
            >
              Recall #{lastBump.ticket.ticket_number}
            </Button>
          )}
        </div>
      </header>

      {actionError && (
        <Alert variant="destructive" className="mx-4 mt-3">
          <AlertCircle className="size-4" />
          <AlertTitle>Action failed</AlertTitle>
          <AlertDescription>{actionError}</AlertDescription>
        </Alert>
      )}

      <main className="flex-1 overflow-auto p-3">
        {loading ? (
          <div className="flex h-full items-center justify-center gap-2 text-muted-foreground">
            <Loader2 className="size-5 animate-spin" />
            Loading tickets…
          </div>
        ) : fetchError ? (
          <Alert variant="destructive" className="mx-auto max-w-md">
            <AlertCircle className="size-4" />
            <AlertTitle>Could not load station</AlertTitle>
            <AlertDescription className="flex flex-col gap-2">
              <span>{fetchError}</span>
              <Button size="sm" variant="outline" onClick={refetch}>Retry</Button>
            </AlertDescription>
          </Alert>
        ) : sorted.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center text-center text-muted-foreground">
            <p className="text-lg">No active tickets.</p>
            <p className="text-sm">New orders will appear here in real time.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {sorted.map((t, i) => (
              <div
                key={t.id}
                className={cn(
                  'rounded-lg transition-all',
                  i === focusedIndex && 'ring-2 ring-orange-500 ring-offset-2 ring-offset-background',
                )}
                onClick={() => setFocusedIndex(i)}
              >
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

// ---- ConnectionPill ----

function ConnectionPill({ status }) {
  const map = {
    open:         { icon: Wifi,    label: 'live',         cls: 'text-emerald-600' },
    connecting:   { icon: Loader2, label: 'connecting',   cls: 'text-muted-foreground animate-pulse' },
    reconnecting: { icon: Loader2, label: 'reconnecting', cls: 'text-amber-600 animate-pulse' },
    error:        { icon: WifiOff, label: 'offline',      cls: 'text-red-600' },
    closed:       { icon: WifiOff, label: 'closed',       cls: 'text-muted-foreground' },
    idle:         { icon: WifiOff, label: 'idle',         cls: 'text-muted-foreground' },
  };
  const m = map[status] || map.idle;
  const Icon = m.icon;
  return (
    <span className={`flex items-center gap-1 text-xs ${m.cls}`}>
      <Icon className="size-3" />
      {m.label}
    </span>
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
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="relative w-full max-w-sm rounded-xl border bg-background p-6 shadow-2xl">
        {/* header */}
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Keyboard className="size-5 text-orange-500" />
            <h2 className="text-lg font-bold">Keyboard shortcuts</h2>
          </div>
          <Button size="icon" variant="ghost" onClick={onClose} aria-label="Close">
            <X className="size-4" />
          </Button>
        </div>

        {/* shortcut rows */}
        <ul className="space-y-2.5">
          {HOTKEYS.map(({ keys, desc }) => (
            <li key={desc} className="flex items-center justify-between gap-4">
              <span className="text-sm text-muted-foreground">{desc}</span>
              <span className="flex shrink-0 items-center gap-1">
                {keys.map((k) => (
                  <kbd
                    key={k}
                    className="inline-flex items-center justify-center rounded border border-border bg-muted px-2 py-0.5 font-mono text-xs font-semibold text-foreground"
                  >
                    {k}
                  </kbd>
                ))}
              </span>
            </li>
          ))}
        </ul>

        <p className="mt-5 text-center text-xs text-muted-foreground">
          Shortcuts are inactive while an input field is focused.
        </p>
      </div>
    </div>
  );
}
