import { useState, useEffect, useCallback } from 'react';
import { api } from '@/lib/api-client';

export function usePOs(locationId, statusFilter) {
  const [pos, setPOs] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const fetch = useCallback(async () => {
    if (!locationId) {
      setPOs([]);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      let q = api.from('purchase_orders')
        .select('*')
        .eq('location_id', locationId)
        .order('created_at', { ascending: false });
      if (statusFilter && statusFilter !== 'all') {
        q = q.eq('status', statusFilter);
      }
      const { data, error: err } = await q;
      if (err) throw new Error(err.message);
      setPOs(data || []);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [locationId, statusFilter]);

  useEffect(() => { fetch(); }, [fetch]);

  /**
   * createPO — hits POST /inventory/purchase-orders
   * payload must match CreatePOInput:
   *   location_id, supplier_id, po_number, lines[],
   *   optional: currency, expected_delivery_date, notes
   * Lines: { inventory_item_id, ordered_quantity, ordered_unit, ordered_unit_price_cents }
   */
  const createPO = useCallback(async (payload) => {
    const { data, error: err } = await api.request('POST', '/inventory/purchase-orders', {
      body: payload,
    });
    if (err) throw new Error(err.message);
    await fetch();
    return data;
  }, [fetch]);

  const submitPO = useCallback(async (poId, actorLabel) => {
    const { data, error: err } = await api.request(
      'POST',
      `/inventory/purchase-orders/${poId}/submit`,
      { body: actorLabel ? { actor_label: actorLabel } : {} }
    );
    if (err) throw new Error(err.message);
    await fetch();
    return data;
  }, [fetch]);

  return { pos, loading, error, refetch: fetch, createPO, submitPO };
}
