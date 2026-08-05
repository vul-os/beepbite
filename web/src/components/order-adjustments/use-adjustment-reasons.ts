import { useState, useEffect } from 'react';
import { api } from '@/lib/api-client';

// Mirrors backend/migrations/001_baseline.sql `adjustment_reasons` table.
export interface AdjustmentReason {
  id: string;
  location_id: string;
  code: string;
  label: string;
  adjustment_type: 'void' | 'comp' | 'price_override' | 'manager_discount' | 'refund';
  requires_manager_approval: boolean;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

/**
 * Fetches adjustment reasons for a given location from GET /adjustment-reasons?location_id=
 */
export function useAdjustmentReasons(locationId: string | null) {
  const [reasons, setReasons] = useState<AdjustmentReason[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!locationId) return;

    let cancelled = false;
    setLoading(true);
    setError(null);

    api
      .request<AdjustmentReason[]>('GET', `/adjustment-reasons?location_id=${encodeURIComponent(locationId)}`)
      .then(({ data, error: err }) => {
        if (cancelled) return;
        if (err) {
          setError(err.message || 'Failed to load adjustment reasons');
        } else {
          setReasons(Array.isArray(data) ? data : []);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load adjustment reasons');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [locationId]);

  return { reasons, loading, error };
}
