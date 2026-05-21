import { useEffect, useRef, useCallback } from 'react';
import { sendPing } from '@/services/driver';

const PING_INTERVAL_MS = 8_000; // 8 seconds

/**
 * Fires a location ping every PING_INTERVAL_MS as long as:
 *   - active is true  (driver is online AND has an accepted/picked_up assignment)
 *
 * Handles geolocation permission denial gracefully by invoking onGeoError.
 * Cleans up the interval and watcher on unmount or when active flips false.
 *
 * @param {boolean}               active        - gate: ping only when true
 * @param {string|undefined}      assignmentId  - forwarded to the ping body
 * @param {{ onGeoError?: (msg:string) => void }} opts
 */
export function useLocationPing(active, assignmentId, { onGeoError } = {}) {
  const intervalRef = useRef(null);
  const geoWatchRef = useRef(null);
  const latestPositionRef = useRef(null); // store most-recent coords
  const onGeoErrorRef = useRef(onGeoError);
  onGeoErrorRef.current = onGeoError;

  const clearPingInterval = useCallback(() => {
    if (intervalRef.current !== null) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  const clearGeoWatch = useCallback(() => {
    if (geoWatchRef.current !== null && navigator.geolocation) {
      navigator.geolocation.clearWatch(geoWatchRef.current);
      geoWatchRef.current = null;
    }
    latestPositionRef.current = null;
  }, []);

  useEffect(() => {
    if (!active) {
      clearPingInterval();
      clearGeoWatch();
      return;
    }

    // Geo not available in this environment
    if (!navigator.geolocation) {
      onGeoErrorRef.current?.('Geolocation is not supported by this browser.');
      return;
    }

    // Start watching position so we always have a fresh coordinate to send.
    geoWatchRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        latestPositionRef.current = {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
        };
      },
      (err) => {
        if (err.code === err.PERMISSION_DENIED) {
          onGeoErrorRef.current?.(
            'Location permission denied. Enable location access to share your position.',
          );
          // Stop trying — no point retrying if the user denied permission.
          clearPingInterval();
          clearGeoWatch();
        }
        // TIMEOUT / POSITION_UNAVAILABLE are transient — keep watching.
      },
      { enableHighAccuracy: true, maximumAge: 10_000, timeout: 15_000 },
    );

    // Ping loop — fires every 8 s using the most-recently-seen coordinate.
    intervalRef.current = setInterval(async () => {
      const pos = latestPositionRef.current;
      if (!pos) return; // position not yet resolved or denied — skip this tick

      try {
        await sendPing({ ...pos, assignment_id: assignmentId });
      } catch (err) {
        // Swallow transient errors (network hiccup).  A 401 will never land
        // here because the api client already retried the refresh — if it still
        // fails the server will evict the shift anyway.
        console.warn('[driver ping]', err.message);
      }
    }, PING_INTERVAL_MS);

    return () => {
      clearPingInterval();
      clearGeoWatch();
    };
  }, [active, assignmentId, clearPingInterval, clearGeoWatch]);
}
