// use-tables.js — fetch sections + tables for the active location, expose
// helpers for local cache updates (drag persistence, additions) without a
// full round-trip. Plain useEffect + useState; no react-query.
//
// Returns:
//   sections, tables, loading, error, refresh()
//   patchTableLocal(id, changes) — optimistic update of in-memory cache
//   addTableLocal(row)          — append a freshly created table

import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api-client';

export function useTables(locationId, { pollMs = 0 } = {}) {
  const [sections, setSections] = useState([]);
  const [tables, setTables] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const mounted = useRef(true);

  const fetchAll = useCallback(async () => {
    if (!locationId) {
      setSections([]);
      setTables([]);
      setLoading(false);
      return;
    }
    try {
      const [sRes, tRes] = await Promise.all([
        api.request('GET', `/data/sections?eq=location_id,${locationId}&order=sort_order.asc`),
        api.request('GET', `/data/tables?eq=location_id,${locationId}&order=label.asc`),
      ]);
      if (!mounted.current) return;
      if (sRes.error) throw new Error(sRes.error.message || 'failed loading sections');
      if (tRes.error) throw new Error(tRes.error.message || 'failed loading tables');
      setSections(Array.isArray(sRes.data) ? sRes.data : []);
      setTables(Array.isArray(tRes.data) ? tRes.data : []);
      setError(null);
    } catch (e) {
      if (!mounted.current) return;
      setError(e.message || String(e));
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, [locationId]);

  useEffect(() => {
    mounted.current = true;
    setLoading(true);
    fetchAll();
    return () => { mounted.current = false; };
  }, [fetchAll]);

  // Optional polling for the live view.
  useEffect(() => {
    if (!pollMs || !locationId) return undefined;
    const id = setInterval(() => { fetchAll(); }, pollMs);
    return () => clearInterval(id);
  }, [pollMs, locationId, fetchAll]);

  const patchTableLocal = useCallback((id, changes) => {
    setTables((prev) => prev.map((t) => (t.id === id ? { ...t, ...changes } : t)));
  }, []);

  const addTableLocal = useCallback((row) => {
    setTables((prev) => [...prev, row]);
  }, []);

  return {
    sections,
    tables,
    loading,
    error,
    refresh: fetchAll,
    patchTableLocal,
    addTableLocal,
  };
}

export default useTables;
