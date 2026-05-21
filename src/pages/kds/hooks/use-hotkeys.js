// use-hotkeys.js — bump-bar keyboard handler for the per-station KDS screen.
//
// Hotkey map (active whenever no <input>/<textarea>/<select> is focused):
//
//   1–9      Bump the Nth visible ticket (1 = leftmost/topmost in sorted order)
//   Space    Bump the currently focused ticket (wraps to first if none)
//   r / R    Recall the last bumped ticket (if still within the recall window)
//   ?        Toggle the hotkey-help overlay
//
// Focus ring: the hook owns a focusedIndex (0-based into the sorted ticket list).
// It does NOT manage DOM focus — the index is a logical concept so the station
// page can highlight the focused card and route Space-bar bumps correctly. The
// index advances automatically when tickets disappear (clamped to list length).
//
// Usage:
//   const { focusedIndex, setFocusedIndex, overlayOpen, setOverlayOpen } =
//     useHotkeys({ tickets, onBump, onRecall, lastBump, recallVisible });

import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * @param {object} opts
 * @param {Array}  opts.tickets       - The sorted, visible ticket list.
 * @param {function} opts.onBump      - Called with a ticket object to bump it.
 * @param {function} opts.onRecall    - Called with a ticket object to recall it.
 * @param {object|null} opts.lastBump - { ticket, bumpedAtMs } from station state.
 * @param {boolean} opts.recallVisible - Whether the recall window is still open.
 */
export function useHotkeys({ tickets, onBump, onRecall, lastBump, recallVisible }) {
  // Logical focus index into the visible ticket list (0-based).
  const [focusedIndex, setFocusedIndex] = useState(0);
  const [overlayOpen, setOverlayOpen] = useState(false);

  // Keep stable refs so the keydown handler closure doesn't go stale.
  const ticketsRef = useRef(tickets);
  const onBumpRef = useRef(onBump);
  const onRecallRef = useRef(onRecall);
  const lastBumpRef = useRef(lastBump);
  const recallVisibleRef = useRef(recallVisible);
  const focusedIndexRef = useRef(focusedIndex);

  useEffect(() => { ticketsRef.current = tickets; }, [tickets]);
  useEffect(() => { onBumpRef.current = onBump; }, [onBump]);
  useEffect(() => { onRecallRef.current = onRecall; }, [onRecall]);
  useEffect(() => { lastBumpRef.current = lastBump; }, [lastBump]);
  useEffect(() => { recallVisibleRef.current = recallVisible; }, [recallVisible]);
  useEffect(() => { focusedIndexRef.current = focusedIndex; }, [focusedIndex]);

  // Clamp focusedIndex when the ticket list shrinks (e.g. after a bump).
  useEffect(() => {
    if (tickets.length === 0) {
      setFocusedIndex(0);
      return;
    }
    setFocusedIndex((prev) => Math.min(prev, tickets.length - 1));
  }, [tickets.length]);

  const handleKeyDown = useCallback((e) => {
    // Ignore when the user is typing into an input field.
    const tag = e.target?.tagName?.toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
    // Ignore modifier combos (ctrl+r for refresh, etc.).
    if (e.ctrlKey || e.metaKey || e.altKey) return;

    const list = ticketsRef.current;
    const idx = focusedIndexRef.current;

    switch (e.key) {
      // ---- digit keys 1-9: bump the Nth ticket ----
      case '1': case '2': case '3': case '4': case '5':
      case '6': case '7': case '8': case '9': {
        const n = parseInt(e.key, 10) - 1; // 0-based
        if (n < list.length) {
          e.preventDefault();
          onBumpRef.current?.(list[n]);
          // Keep focus on the same slot (now occupied by next ticket).
          setFocusedIndex(Math.min(n, Math.max(0, list.length - 2)));
        }
        break;
      }

      // ---- Space: bump focused ticket ----
      case ' ': {
        e.preventDefault();
        const target = list[idx];
        if (target) {
          onBumpRef.current?.(target);
          setFocusedIndex((prev) => Math.min(prev, Math.max(0, list.length - 2)));
        }
        break;
      }

      // ---- r / R: recall last bumped ----
      case 'r':
      case 'R': {
        e.preventDefault();
        if (recallVisibleRef.current && lastBumpRef.current?.ticket) {
          onRecallRef.current?.(lastBumpRef.current.ticket);
        }
        break;
      }

      // ---- ?: toggle hotkey overlay ----
      case '?': {
        e.preventDefault();
        setOverlayOpen((prev) => !prev);
        break;
      }

      // ---- arrow keys: move focus ----
      case 'ArrowRight':
      case 'ArrowDown': {
        e.preventDefault();
        if (list.length > 0) {
          setFocusedIndex((prev) => Math.min(prev + 1, list.length - 1));
        }
        break;
      }
      case 'ArrowLeft':
      case 'ArrowUp': {
        e.preventDefault();
        if (list.length > 0) {
          setFocusedIndex((prev) => Math.max(prev - 1, 0));
        }
        break;
      }

      // ---- Escape: close overlay ----
      case 'Escape': {
        if (overlayOpen) {
          e.preventDefault();
          setOverlayOpen(false);
        }
        break;
      }

      default:
        break;
    }
  }, [overlayOpen]); // overlayOpen is read inside the Escape branch

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  return { focusedIndex, setFocusedIndex, overlayOpen, setOverlayOpen };
}

export default useHotkeys;
