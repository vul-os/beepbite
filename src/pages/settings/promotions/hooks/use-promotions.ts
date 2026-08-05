import { useState, useEffect, useCallback } from 'react';
import { api } from '@/lib/api-client';

// Mirrors backend/migrations/001_baseline.sql `promotions` table.
export interface Promotion {
  id: string;
  organization_id: string;
  location_id?: string | null;
  name: string;
  description?: string | null;
  promo_type: string;
  scope: string;
  percent_off?: number | null;
  fixed_off_cents?: number | null;
  happy_hour_price_cents?: number | null;
  bogo_buy_qty: number;
  bogo_get_qty: number;
  bogo_get_discount_percent: number;
  free_item_id?: string | null;
  min_spend_cents: number;
  max_discount_cents?: number | null;
  stackable: boolean;
  requires_coupon_code: boolean;
  active_from?: string | null;
  active_until?: string | null;
  dayparts?: unknown;
  customer_segment?: string | null;
  usage_limit_total?: number | null;
  usage_limit_per_customer?: number | null;
  is_active: boolean;
  priority: number;
  created_by?: string | null;
  created_at: string;
  updated_at: string;
}

// Mirrors backend/migrations/001_baseline.sql `coupon_codes` table.
export interface CouponCode {
  id: string;
  promotion_id: string;
  code: string;
  max_uses: number;
  used_count: number;
  assigned_to_customer_id?: string | null;
  active_from?: string | null;
  active_until?: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export function usePromotions(locationId: string | undefined) {
  const [promotions, setPromotions] = useState<Promotion[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchPromotions = useCallback(async () => {
    if (!locationId) { setPromotions([]); return; }
    setLoading(true);
    setError(null);
    try {
      const { data, error: err } = await api
        .from('promotions')
        .select('*')
        .eq('location_id', locationId)
        .order('created_at', { ascending: false });
      if (err) throw new Error(err.message);
      setPromotions(data || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load promotions.');
    } finally {
      setLoading(false);
    }
  }, [locationId]);

  // fetchPromotions() is fully try/catch/finally-wrapped above.
  useEffect(() => { void fetchPromotions(); }, [fetchPromotions]);

  const createPromotion = useCallback(async (body: Partial<Promotion>) => {
    const { data, error: err } = await api.from('promotions').insert(body);
    if (err) throw new Error(err.message);
    await fetchPromotions();
    return data;
  }, [fetchPromotions]);

  const updatePromotion = useCallback(async (id: string, body: Partial<Promotion>) => {
    const { data, error: err } = await api
      .from('promotions')
      .update(body)
      .eq('id', id);
    if (err) throw new Error(err.message);
    await fetchPromotions();
    return data;
  }, [fetchPromotions]);

  const deletePromotion = useCallback(async (id: string) => {
    const { error: err } = await api.from('promotions').delete().eq('id', id);
    if (err) throw new Error(err.message);
    await fetchPromotions();
  }, [fetchPromotions]);

  const toggleActive = useCallback(async (promotion: Promotion) => {
    return updatePromotion(promotion.id, { is_active: !promotion.is_active });
  }, [updatePromotion]);

  return {
    promotions,
    loading,
    error,
    refresh: fetchPromotions,
    createPromotion,
    updatePromotion,
    deletePromotion,
    toggleActive,
  };
}

export function useCouponCodes(promotionId: string | undefined) {
  const [codes, setCodes] = useState<CouponCode[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchCodes = useCallback(async () => {
    if (!promotionId) { setCodes([]); return; }
    setLoading(true);
    // No `catch` here previously — an API-level `{ error }` response (via
    // the `if (err) throw` below) or a network-level rejection both
    // propagated straight out of this function uncaught. The `finally`
    // still cleaned up `loading`, but the failure itself was a genuinely
    // unhandled promise rejection with nothing logged anywhere (unlike the
    // sibling fetchPromotions() above, which surfaces a message via
    // `error`). This hook doesn't expose an `error` state to callers, so
    // matching fetchPromotions()'s UI-facing behavior is out of scope here
    // — at minimum, log it instead of leaving it silently uncaught.
    try {
      const { data, error: err } = await api
        .from('coupon_codes')
        .select('*')
        .eq('promotion_id', promotionId)
        .order('created_at', { ascending: false });
      if (err) throw new Error(err.message);
      setCodes(data || []);
    } catch (e) {
      console.error('Error fetching coupon codes:', e);
    } finally {
      setLoading(false);
    }
  }, [promotionId]);

  // fetchCodes() is now fully try/catch/finally-wrapped above.
  useEffect(() => { void fetchCodes(); }, [fetchCodes]);

  const addCode = useCallback(async (body: Partial<CouponCode>) => {
    const { data, error: err } = await api.from('coupon_codes').insert({
      ...body,
      promotion_id: promotionId,
    });
    if (err) throw new Error(err.message);
    await fetchCodes();
    return data;
  }, [promotionId, fetchCodes]);

  const deleteCode = useCallback(async (id: string) => {
    const { error: err } = await api.from('coupon_codes').delete().eq('id', id);
    if (err) throw new Error(err.message);
    await fetchCodes();
  }, [fetchCodes]);

  return { codes, loading, addCode, deleteCode, refresh: fetchCodes };
}
