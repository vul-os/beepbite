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

// Mirrors backend/migrations/001_baseline.sql `sections` table.
export interface FloorSection {
  id: string;
  location_id: string;
  name: string;
  sort_order: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export type TableStatus = 'available' | 'occupied' | 'reserved' | 'out_of_service';

// Mirrors backend/migrations/001_baseline.sql `tables` table.
export interface FloorTable {
  id: string;
  location_id: string;
  section_id: string | null;
  label: string;
  capacity: number;
  status: TableStatus;
  pos_x: number | null;
  pos_y: number | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  // Set once a table is occupied (see services/tables.ts, which already
  // declares this as `string`). Missing here meant it fell through the
  // index signature below as `unknown`, which floor/index.tsx's
  // handleActivate() then truthy-checked and interpolated into a URL
  // (`/pos?session=${table.table_session_id}`) — a real bug caught by
  // no-base-to-string/restrict-template-expressions: if that value were
  // ever a non-string object it would navigate to a literal
  // "/pos?session=[object Object]" URL.
  table_session_id?: string | null;
  [key: string]: unknown;
}

export function useTables(locationId: string | undefined, { pollMs = 0 }: { pollMs?: number } = {}) {
  const [sections, setSections] = useState<FloorSection[]>([]);
  const [tables, setTables] = useState<FloorTable[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
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
        api.request<FloorSection[]>('GET', `/data/sections?eq=location_id,${locationId}&order=sort_order.asc`),
        api.request<FloorTable[]>('GET', `/data/tables?eq=location_id,${locationId}&order=label.asc`),
      ]);
      if (!mounted.current) return;
      if (sRes.error) throw new Error(sRes.error.message || 'failed loading sections');
      if (tRes.error) throw new Error(tRes.error.message || 'failed loading tables');
      setSections(Array.isArray(sRes.data) ? sRes.data : []);
      setTables(Array.isArray(tRes.data) ? tRes.data : []);
      setError(null);
    } catch (e) {
      if (!mounted.current) return;
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, [locationId]);

  useEffect(() => {
    mounted.current = true;
    setLoading(true);
    void fetchAll();
    return () => { mounted.current = false; };
  }, [fetchAll]);

  // Optional polling for the live view. fetchAll() is fully try/catch/
  // finally-wrapped above — a genuinely safe fire-and-forget.
  useEffect(() => {
    if (!pollMs || !locationId) return undefined;
    const id = setInterval(() => { void fetchAll(); }, pollMs);
    return () => clearInterval(id);
  }, [pollMs, locationId, fetchAll]);

  const patchTableLocal = useCallback((id: string, changes: Partial<FloorTable>) => {
    setTables((prev) => prev.map((t) => (t.id === id ? { ...t, ...changes } : t)));
  }, []);

  const addTableLocal = useCallback((row: FloorTable) => {
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
