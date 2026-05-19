import { useState, useEffect, useCallback } from 'react';
import { api } from '@/lib/api-client';

export function useDeliveryZones(locationId) {
  const [zones, setZones] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const fetchZones = useCallback(async () => {
    if (!locationId) { setZones([]); return; }
    setLoading(true);
    setError(null);
    try {
      const { data, error: err } = await api.request('GET', `/delivery-zones?location_id=${locationId}`);
      if (err) throw new Error(err.message);
      setZones(data || []);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [locationId]);

  useEffect(() => { fetchZones(); }, [fetchZones]);

  const createZone = useCallback(async (body) => {
    const { data, error: err } = await api.request('POST', '/delivery-zones', { body });
    if (err) throw new Error(err.message);
    await fetchZones();
    return data;
  }, [fetchZones]);

  const updateZone = useCallback(async (id, body) => {
    const { data, error: err } = await api.request('PATCH', `/delivery-zones/${id}`, { body });
    if (err) throw new Error(err.message);
    await fetchZones();
    return data;
  }, [fetchZones]);

  const deleteZone = useCallback(async (id) => {
    const { error: err } = await api.request('DELETE', `/delivery-zones/${id}`);
    if (err) throw new Error(err.message);
    await fetchZones();
  }, [fetchZones]);

  const toggleActive = useCallback(async (zone) => {
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
