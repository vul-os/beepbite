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

export function useTicketDetails(ticketIds) {
  // Map<ticket_id, detailObj>
  const [cache, setCache] = useState(() => new Map());
  // Set<ticket_id>
  const [loading, setLoading] = useState(() => new Set());
  // Map<ticket_id, errMsg> — kept separately so we can decide to retry
  const [errors, setErrors] = useState(() => new Map());

  const inFlightRef = useRef(new Set());
  const mountedRef = useRef(true);

  useEffect(() => () => { mountedRef.current = false; }, []);

  const fetchOne = useCallback(async (ticketId, { force = false } = {}) => {
    if (!ticketId) return null;
    if (!force && inFlightRef.current.has(ticketId)) return null;
    inFlightRef.current.add(ticketId);
    setLoading((prev) => {
      if (prev.has(ticketId)) return prev;
      const next = new Set(prev);
      next.add(ticketId);
      return next;
    });

    const { data, error } = await api.request(
      'GET',
      `/kds/tickets/${encodeURIComponent(ticketId)}/details`,
    );

    inFlightRef.current.delete(ticketId);
    if (!mountedRef.current) return data;

    setLoading((prev) => {
      if (!prev.has(ticketId)) return prev;
      const next = new Set(prev);
      next.delete(ticketId);
      return next;
    });

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
    setCache((prev) => {
      const next = new Map(prev);
      next.set(ticketId, data);
      return next;
    });
    return data;
  }, []);

  // Auto-fetch any ticket we haven't seen yet. Stable on cache identity so we
  // don't re-run on every cache mutation.
  useEffect(() => {
    if (!Array.isArray(ticketIds)) return;
    for (const id of ticketIds) {
      if (!id) continue;
      if (cache.has(id)) continue;
      if (inFlightRef.current.has(id)) continue;
      fetchOne(id);
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
      const next = new Map();
      for (const [k, v] of prev) {
        if (live.has(k)) { next.set(k, v); } else { changed = true; }
      }
      return changed ? next : prev;
    });
  }, [ticketIds]);

  const getDetails = useCallback((id) => cache.get(id) || null, [cache]);
  const isLoading  = useCallback((id) => loading.has(id), [loading]);
  const getError   = useCallback((id) => errors.get(id) || null, [errors]);
  const refresh    = useCallback((id) => fetchOne(id, { force: true }), [fetchOne]);

  return { getDetails, isLoading, getError, refresh };
}

export default useTicketDetails;
