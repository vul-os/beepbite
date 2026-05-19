import { useState, useEffect } from 'react';
import { api } from '@/lib/api-client';

/**
 * Fetches adjustment reasons for a given location from GET /adjustment-reasons?location_id=
 *
 * @param {string|null} locationId - The location to scope reasons to.
 * @returns {{ reasons: Array, loading: boolean, error: string|null }}
 */
export function useAdjustmentReasons(locationId) {
  const [reasons, setReasons] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!locationId) return;

    let cancelled = false;
    setLoading(true);
    setError(null);

    api
      .request('GET', `/adjustment-reasons?location_id=${encodeURIComponent(locationId)}`)
      .then(({ data, error: err }) => {
        if (cancelled) return;
        if (err) {
          setError(err.message || 'Failed to load adjustment reasons');
        } else {
          setReasons(Array.isArray(data) ? data : []);
        }
      })
      .catch((err) => {
        if (!cancelled) setError(err.message || 'Failed to load adjustment reasons');
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
