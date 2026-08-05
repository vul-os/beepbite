import { useState, useEffect, useCallback } from 'react';
import { api } from '@/lib/api-client';

// GeoJSON Polygon, as produced/consumed by components/polygon-editor.tsx
// (coordinates: array of linear rings, each ring an array of [lng, lat]).
export interface GeoJSONPolygon {
  type: 'Polygon';
  coordinates: number[][][];
}

// Mirrors backend/migrations/001_baseline.sql `delivery_zones` table.
export interface DeliveryZone {
  id: string;
  organization_id: string;
  location_id: string;
  name: string;
  polygon: GeoJSONPolygon;
  delivery_fee_cents: number;
  min_order_cents: number;
  estimated_eta_minutes: number;
  is_active: boolean;
  priority: number;
  created_at: string;
  updated_at: string;
}

export function useDeliveryZones(locationId: string | undefined) {
  const [zones, setZones] = useState<DeliveryZone[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchZones = useCallback(async () => {
    if (!locationId) { setZones([]); return; }
    setLoading(true);
    setError(null);
    try {
      const { data, error: err } = await api.request<DeliveryZone[]>('GET', `/delivery-zones?location_id=${locationId}`);
      if (err) throw new Error(err.message);
      setZones(data || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load delivery zones');
    } finally {
      setLoading(false);
    }
  }, [locationId]);

  // fetchZones() is fully try/catch/finally-wrapped above.
  useEffect(() => { void fetchZones(); }, [fetchZones]);

  const createZone = useCallback(async (body: Partial<DeliveryZone>) => {
    const { data, error: err } = await api.request<DeliveryZone>('POST', '/delivery-zones', { body });
    if (err) throw new Error(err.message);
    await fetchZones();
    return data;
  }, [fetchZones]);

  const updateZone = useCallback(async (id: string, body: Partial<DeliveryZone>) => {
    const { data, error: err } = await api.request<DeliveryZone>('PATCH', `/delivery-zones/${id}`, { body });
    if (err) throw new Error(err.message);
    await fetchZones();
    return data;
  }, [fetchZones]);

  const deleteZone = useCallback(async (id: string) => {
    const { error: err } = await api.request('DELETE', `/delivery-zones/${id}`);
    if (err) throw new Error(err.message);
    await fetchZones();
  }, [fetchZones]);

  const toggleActive = useCallback(async (zone: DeliveryZone) => {
    return updateZone(zone.id, { is_active: !zone.is_active });
  }, [updateZone]);

  return {
    zones,
    loading,
    error,
    refresh: fetchZones,
    createZone,
    updateZone,
    deleteZone,
    toggleActive,
  };
}
