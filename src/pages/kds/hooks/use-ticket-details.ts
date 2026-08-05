// use-ticket-details.js — keeps a cache of detailed ticket payloads.
//
// The station SSE/list endpoint only carries ticket summaries: id, status,
// items, fired_at, etc. The richer per-ticket payload (ingredients, prep
// steps, item variations) comes from a separate endpoint:
//
//   GET /kds/tickets/{ticket_id}/details
//
// We fetch a ticket's details the first time it shows up on the station,
// memoize the result by ticket_id, and expose a `getDetails(ticketId)`
// helper plus a `loading` set for callers that want to show a skeleton.
//
// Re-fetching is opt-in (the `refresh(ticketId)` method) — the station's
// SSE stream sends "something changed" pings but the menu/recipe data
// underneath a ticket is effectively immutable for the life of the ticket,
// so we don't burn requests refetching on every event.

import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api-client';
import type { KdsTicketDetail } from '../types';

export function useTicketDetails(ticketIds: string[]) {
  // Map<ticket_id, detailObj>
  const [cache, setCache] = useState<Map<string, KdsTicketDetail>>(() => new Map());
  // Set<ticket_id>
  const [loading, setLoading] = useState<Set<string>>(() => new Set());
  // Map<ticket_id, errMsg> — kept separately so we can decide to retry
  const [errors, setErrors] = useState<Map<string, string>>(() => new Map());

  const inFlightRef = useRef<Set<string>>(new Set());
  const mountedRef = useRef(true);

  // Reset true on mount — React 18 StrictMode unmounts then remounts, and a
  // cleanup-only guard would stay false on remount (stuck loads / stale data).
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const fetchOne = useCallback(async (ticketId: string, { force = false }: { force?: boolean } = {}) => {
    if (!ticketId) return null;
    if (!force && inFlightRef.current.has(ticketId)) return null;
    inFlightRef.current.add(ticketId);
    setLoading((prev) => {
      if (prev.has(ticketId)) return prev;
      const next = new Set(prev);
      next.add(ticketId);
      return next;
    });

    // api.request() only wraps the API-error case in { data, error } — a
    // network-level failure (fetch() itself rejecting) throws instead.
    // Without this try/catch/finally, that skipped the inFlightRef.delete()
    // below, which permanently marked this ticket as in-flight (the guard
    // at the top of this function then refuses to ever retry it — see
    // "Re-fetching is opt-in" above) and left it stuck in `loading` with no
    // error surfaced.
    try {
      const { data, error } = await api.request<KdsTicketDetail>(
        'GET',
        `/kds/tickets/${encodeURIComponent(ticketId)}/details`,
      );

      if (!mountedRef.current) return data;

      if (error) {
        setErrors((prev) => {
          const next = new Map(prev);
          next.set(ticketId, error.message || 'failed to load recipe');
          return next;
        });
        return null;
      }

      setErrors((prev) => {
        if (!prev.has(ticketId)) return prev;
        const next = new Map(prev);
        next.delete(ticketId);
        return next;
      });
      if (data) {
        setCache((prev) => {
          const next = new Map(prev);
          next.set(ticketId, data);
          return next;
        });
      }
      return data;
    } catch (err) {
      console.error('Ticket detail fetch failed:', err);
      if (mountedRef.current) {
        setErrors((prev) => {
          const next = new Map(prev);
          next.set(ticketId, 'failed to load recipe');
          return next;
        });
      }
      return null;
    } finally {
      inFlightRef.current.delete(ticketId);
      if (mountedRef.current) {
        setLoading((prev) => {
          if (!prev.has(ticketId)) return prev;
          const next = new Set(prev);
          next.delete(ticketId);
          return next;
        });
      }
    }
  }, []);

  // Auto-fetch any ticket we haven't seen yet. Stable on cache identity so we
  // don't re-run on every cache mutation.
  useEffect(() => {
    if (!Array.isArray(ticketIds)) return;
    for (const id of ticketIds) {
      if (!id) continue;
      if (cache.has(id)) continue;
      if (inFlightRef.current.has(id)) continue;
      void fetchOne(id);
    }
    // We intentionally don't depend on `cache` — we only want to fetch when
    // a new id appears, not on every cache change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ticketIds, fetchOne]);

  // Evict cache entries for tickets that are no longer on the board, so the
  // memory footprint stays bounded over a long service.
  useEffect(() => {
    if (!Array.isArray(ticketIds)) return;
    const live = new Set(ticketIds.filter(Boolean));
    setCache((prev) => {
      let changed = false;
      const next = new Map<string, KdsTicketDetail>();
      for (const [k, v] of prev) {
        if (live.has(k)) { next.set(k, v); } else { changed = true; }
      }
      return changed ? next : prev;
    });
  }, [ticketIds]);

  const getDetails = useCallback((id: string) => cache.get(id) || null, [cache]);
  const isLoading  = useCallback((id: string) => loading.has(id), [loading]);
  const getError   = useCallback((id: string) => errors.get(id) || null, [errors]);
  const refresh    = useCallback((id: string) => fetchOne(id, { force: true }), [fetchOne]);

  return { getDetails, isLoading, getError, refresh };
}

export default useTicketDetails;
