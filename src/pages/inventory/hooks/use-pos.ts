import { useState, useEffect, useCallback } from 'react';
import { api } from '@/lib/api-client';

export type POStatus = 'draft' | 'sent' | 'partially_received' | 'received' | 'cancelled' | 'closed';

// Mirrors backend/migrations/001_baseline.sql `purchase_orders` table.
export interface PurchaseOrder {
  id: string;
  location_id: string;
  supplier_id: string | null;
  po_number: string;
  status: POStatus;
  ordered_by: string | null;
  ordered_at: string | null;
  expected_delivery_date: string | null;
  delivered_at: string | null;
  currency: string;
  subtotal_cents: number;
  tax_cents: number;
  shipping_cents: number;
  total_cents: number;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreatePOLine {
  inventory_item_id: string;
  ordered_quantity: number;
  ordered_unit: string;
  ordered_unit_price_cents: number;
}

export interface CreatePOInput {
  location_id: string;
  supplier_id: string;
  po_number: string;
  lines: CreatePOLine[];
  currency?: string;
  expected_delivery_date?: string;
  notes?: string;
}

export function usePOs(locationId: string | undefined, statusFilter: POStatus | 'all' | undefined) {
  const [pos, setPOs] = useState<PurchaseOrder[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
      setError(e instanceof Error ? e.message : 'Failed to load purchase orders');
    } finally {
      setLoading(false);
    }
  }, [locationId, statusFilter]);

  useEffect(() => { fetch(); }, [fetch]);

  /**
   * createPO — hits POST /inventory/purchase-orders
   */
  const createPO = useCallback(async (payload: CreatePOInput) => {
    const { data, error: err } = await api.request<PurchaseOrder>('POST', '/inventory/purchase-orders', {
      body: payload,
    });
    if (err) throw new Error(err.message);
    await fetch();
    return data;
  }, [fetch]);

  const submitPO = useCallback(async (poId: string, actorLabel?: string) => {
    const { data, error: err } = await api.request<PurchaseOrder>(
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
