import { useState, useEffect, useCallback } from 'react';
import { api } from '@/lib/api-client';

export function usePromotions(locationId) {
  const [promotions, setPromotions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

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
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [locationId]);

  useEffect(() => { fetchPromotions(); }, [fetchPromotions]);

  const createPromotion = useCallback(async (body) => {
    const { data, error: err } = await api.from('promotions').insert(body);
    if (err) throw new Error(err.message);
    await fetchPromotions();
    return data;
  }, [fetchPromotions]);

  const updatePromotion = useCallback(async (id, body) => {
    const { data, error: err } = await api
      .from('promotions')
      .update(body)
      .eq('id', id);
    if (err) throw new Error(err.message);
    await fetchPromotions();
    return data;
  }, [fetchPromotions]);

  const deletePromotion = useCallback(async (id) => {
    const { error: err } = await api.from('promotions').delete().eq('id', id);
    if (err) throw new Error(err.message);
    await fetchPromotions();
  }, [fetchPromotions]);

  const toggleActive = useCallback(async (promotion) => {
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

export function useCouponCodes(promotionId) {
  const [codes, setCodes] = useState([]);
  const [loading, setLoading] = useState(false);

  const fetchCodes = useCallback(async () => {
    if (!promotionId) { setCodes([]); return; }
    setLoading(true);
    try {
      const { data, error: err } = await api
        .from('coupon_codes')
        .select('*')
        .eq('promotion_id', promotionId)
        .order('created_at', { ascending: false });
      if (err) throw new Error(err.message);
      setCodes(data || []);
    } finally {
      setLoading(false);
    }
  }, [promotionId]);

  useEffect(() => { fetchCodes(); }, [fetchCodes]);

  const addCode = useCallback(async (body) => {
    const { data, error: err } = await api.from('coupon_codes').insert({
      ...body,
      promotion_id: promotionId,
    });
    if (err) throw new Error(err.message);
    await fetchCodes();
    return data;
  }, [promotionId, fetchCodes]);

  const deleteCode = useCallback(async (id) => {
    const { error: err } = await api.from('coupon_codes').delete().eq('id', id);
    if (err) throw new Error(err.message);
    await fetchCodes();
  }, [fetchCodes]);

  return { codes, loading, addCode, deleteCode, refresh: fetchCodes };
}
