// use-tick.js — single 1Hz ticker shared by every KDS card.
//
// Why: each ticket card needs to display "fired XX:XX ago" updating every
// second, but we DO NOT want one setInterval per card or one setState per
// card per second (would re-render the whole grid for every tick).
//
// One module-level interval drives a counter; every subscribing component
// receives the same `now` value and re-renders in lockstep. The interval is
// torn down when the last subscriber unmounts.

import { useEffect, useState } from 'react';

const subscribers = new Set();
let intervalId = null;
let lastNow = Date.now();

function start() {
  if (intervalId != null) return;
  intervalId = setInterval(() => {
    lastNow = Date.now();
    for (const cb of subscribers) {
      try { cb(lastNow); } catch (e) { console.error('useTick subscriber threw', e); }
    }
  }, 1000);
}

function stop() {
  if (intervalId == null) return;
  clearInterval(intervalId);
  intervalId = null;
}

/**
 * useTick — returns the current epoch ms, ticking once per second.
 * All consumers share a single interval and re-render together.
 */
export function useTick() {
  const [now, setNow] = useState(lastNow);

  useEffect(() => {
    subscribers.add(setNow);
    start();
    // Sync immediately so a new subscriber doesn't wait up to ~1s for its
    // first value (matters if the page was hidden then re-shown).
    setNow(Date.now());
    return () => {
      subscribers.delete(setNow);
      if (subscribers.size === 0) stop();
    };
  }, []);

  return now;
}

export default useTick;
