// use-scale.js — WebSerial weight scale hook (Wave 29 / Now-19)
//
// Reads weight readings from a serial USB scale via the Web Serial API
// (navigator.serial). The hook returns the current weight in grams and
// a helper to compute the price from a per-gram price.
//
// Scale output format assumed: a byte stream where each reading is a
// fixed-width ASCII line such as:
//   "  125.3g\r\n"   (Dymo-style)
//   "ST,GS, 0125.3g\r\n"  (A&D / general stable format)
// The hook extracts the first decimal number from each line.
//
// Usage:
//   import { useScale } from '@/pages/pos/hooks/use-scale';
//
//   function WeightedItem({ pricePerGram }) {
//     const { weightGrams, priceForWeight, connect, disconnect, connected, error } = useScale();
//
//     return (
//       <>
//         <button onClick={connect}>Connect scale</button>
//         <p>Weight: {weightGrams.toFixed(1)}g</p>
//         <p>Price: R{priceForWeight(pricePerGram).toFixed(2)}</p>
//       </>
//     );
//   }
//
// Notes:
//   • Web Serial requires a secure context (HTTPS or localhost) and a user gesture
//     to call connect() — Chrome/Edge 89+ only.
//   • disconnect() closes the port; the hook cleans up on unmount.
//   • If the browser doesn't support Web Serial, connect() sets an error message.

import { useCallback, useEffect, useRef, useState } from 'react';

/** Extract the first numeric value (grams) from a scale output line. */
function parseWeightLine(line) {
  // Match patterns like "125.3", "0125.30", possibly preceded by letters/spaces.
  const m = line.match(/(\d+\.?\d*)\s*g/i);
  if (m) return parseFloat(m[1]);
  // Fallback: just look for any decimal number
  const m2 = line.match(/(\d+\.?\d*)/);
  if (m2) return parseFloat(m2[1]);
  return null;
}

/**
 * @returns {{
 *   connected: boolean,
 *   connecting: boolean,
 *   weightGrams: number,
 *   error: string|null,
 *   connect: () => Promise<void>,
 *   disconnect: () => Promise<void>,
 *   priceForWeight: (pricePerGram: number) => number,
 * }}
 */
export function useScale() {
  const [connected, setConnected] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [weightGrams, setWeightGrams] = useState(0);
  const [error, setError] = useState(null);

  const portRef = useRef(null);
  const readerRef = useRef(null);
  const readLoopActiveRef = useRef(false);

  const disconnect = useCallback(async () => {
    readLoopActiveRef.current = false;
    try {
      if (readerRef.current) {
        await readerRef.current.cancel();
        readerRef.current = null;
      }
    } catch { /* noop */ }
    try {
      if (portRef.current) {
        await portRef.current.close();
        portRef.current = null;
      }
    } catch { /* noop */ }
    setConnected(false);
    setWeightGrams(0);
  }, []);

  const connect = useCallback(async () => {
    if (!navigator.serial) {
      setError('Web Serial API is not supported in this browser. Use Chrome or Edge 89+.');
      return;
    }

    setError(null);
    setConnecting(true);

    try {
      // Prompt user to select a serial port (requires a user gesture).
      const port = await navigator.serial.requestPort();
      portRef.current = port;

      // Open at 9600 baud — common default for USB scales.
      // The POS operator may need to configure their scale to match.
      await port.open({ baudRate: 9600 });
      setConnected(true);

      // Start read loop.
      readLoopActiveRef.current = true;
      const decoder = new TextDecoderStream();
      port.readable.pipeTo(decoder.writable).catch(() => {});
      const reader = decoder.readable.getReader();
      readerRef.current = reader;

      let lineBuffer = '';

      // Run the loop without blocking (no await in component body).
      (async () => {
        try {
          while (readLoopActiveRef.current) {
            const { value, done } = await reader.read();
            if (done) break;
            if (!value) continue;

            lineBuffer += value;
            const lines = lineBuffer.split(/\r?\n/);
            lineBuffer = lines.pop() ?? ''; // keep partial last line

            for (const line of lines) {
              const weight = parseWeightLine(line);
              if (weight !== null && !Number.isNaN(weight)) {
                setWeightGrams(weight);
              }
            }
          }
        } catch (err) {
          if (readLoopActiveRef.current) {
            setError('Scale read error: ' + (err?.message ?? String(err)));
          }
        } finally {
          setConnected(false);
        }
      })();
    } catch (err) {
      setError(err?.message ?? 'Failed to connect to scale.');
    } finally {
      setConnecting(false);
    }
  }, []);

  // Cleanup on unmount.
  useEffect(() => {
    return () => { disconnect(); };
  }, [disconnect]);

  /**
   * Compute price for the current weight.
   * @param {number} pricePerGram - price per gram in the same currency unit
   * @returns {number} total price
   */
  const priceForWeight = useCallback(
    (pricePerGram) => weightGrams * pricePerGram,
    [weightGrams],
  );

  return {
    connected,
    connecting,
    weightGrams,
    error,
    connect,
    disconnect,
    priceForWeight,
  };
}

export default useScale;
