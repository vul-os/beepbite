// use-barcode-scanner.js — keyboard-wedge barcode scanner hook (Wave 29 / Now-19)
//
// A keyboard-wedge barcode scanner emits a rapid sequence of keydown events
// ending with Enter. This hook captures that sequence, debounces it, and
// fires an onScan callback with the accumulated barcode string.
//
// Usage:
//   import { useBarcodeScanner } from '@/pages/pos/hooks/use-barcode-scanner';
//
//   // In your POS component:
//   useBarcodeScanner({
//     onScan: async (barcode) => {
//       const item = await lookupBySku(barcode);
//       if (item) addToCart(item);
//     },
//     enabled: !modalOpen,   // pause while a modal is open
//     minLength: 3,
//     intervalMs: 50,        // max ms between keystrokes for scanner detection
//   });
//
// Detection algorithm:
//   1. Listen for keydown events on window.
//   2. A scanner keystroke arrives within intervalMs of the previous one.
//      Human typing is slower (~150-300ms between keys).
//   3. When Enter arrives and the buffer length ≥ minLength, fire onScan and clear.
//   4. If intervalMs elapses without Enter, the buffer is discarded (false alarm).
//
// The hook automatically pauses when a text input/textarea has focus so that
// manual barcode entry in forms is not hijacked.

import { useCallback, useEffect, useRef } from 'react';

const DEFAULT_INTERVAL_MS = 50;
const DEFAULT_MIN_LENGTH = 3;

/**
 * @param {object} opts
 * @param {(barcode: string) => void} opts.onScan   — called with the scanned barcode string
 * @param {boolean}  [opts.enabled=true]             — set false to disable (e.g. while modal open)
 * @param {number}   [opts.minLength=3]              — minimum barcode length to fire
 * @param {number}   [opts.intervalMs=50]            — max ms between keystrokes to detect scanner
 */
export function useBarcodeScanner({
  onScan,
  enabled = true,
  minLength = DEFAULT_MIN_LENGTH,
  intervalMs = DEFAULT_INTERVAL_MS,
}) {
  const bufferRef = useRef('');
  const lastKeyTimeRef = useRef(0);
  const timeoutRef = useRef(null);

  const clear = useCallback(() => {
    bufferRef.current = '';
    lastKeyTimeRef.current = 0;
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;

    function onKeyDown(ev) {
      // Ignore when a text input or textarea has focus (manual typing).
      const tag = document.activeElement?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || document.activeElement?.isContentEditable) {
        return;
      }

      const now = Date.now();
      const delta = now - lastKeyTimeRef.current;

      // If too slow, this is human typing — reset.
      if (lastKeyTimeRef.current > 0 && delta > intervalMs) {
        clear();
      }

      if (ev.key === 'Enter') {
        const barcode = bufferRef.current.trim();
        if (barcode.length >= minLength) {
          try {
            onScan(barcode);
          } catch (err) {
            console.error('[useBarcodeScanner] onScan error:', err);
          }
        }
        clear();
        return;
      }

      // Only accumulate printable single characters.
      if (ev.key.length === 1) {
        bufferRef.current += ev.key;
        lastKeyTimeRef.current = now;

        // Auto-clear after intervalMs in case Enter never arrives.
        if (timeoutRef.current) clearTimeout(timeoutRef.current);
        timeoutRef.current = setTimeout(clear, intervalMs * 5);
      }
    }

    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      clear();
    };
  }, [enabled, minLength, intervalMs, onScan, clear]);
}

export default useBarcodeScanner;
