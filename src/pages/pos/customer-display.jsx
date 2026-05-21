// src/pages/pos/customer-display.jsx — Second-window customer display (Wave 29 / Now-19)
//
// Opens in a second browser window/tab via window.open from the POS workspace.
// Mirrors the current order's line items in real time via BroadcastChannel
// (primary) with localStorage as a fallback for browsers that partition
// BroadcastChannel across origins/windows.
//
// State shape broadcast by the POS workspace:
//   {
//     storeName:   string,
//     items:       [{ name, qty, unitCents }],
//     subtotal:    number,   // cents
//     tax:         number,   // cents
//     total:       number,   // cents
//     currency:    string,   // e.g. 'ZAR'
//     tipOptions?: number[], // cents, for the optional tip selector
//     selectedTip?: number,  // cents — last tip chosen by customer
//   }
//
// The tip selector (optional) lets the customer pick a preset tip amount.
// When they tap a tip button the display broadcasts back:
//   { type: 'tip_selected', amount: <cents> }
// via the same BroadcastChannel so the POS window can auto-apply it.
//
// Route: /pos/customer-display  (add to routes.jsx separately as instructed)
// No auth required — this window is opened by an already-authenticated POS.

/* eslint-disable react/prop-types */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Monitor, Receipt, TrendingUp } from 'lucide-react';
import { Button } from '@/components/ui/button';

const CHANNEL_NAME = 'bb_customer_display';
const STORAGE_KEY = 'bb.customer_display_state';

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

function formatCurrency(cents, currency = 'ZAR') {
  const symbol = currency === 'ZAR' ? 'R' : currency + ' ';
  return `${symbol}${(cents / 100).toFixed(2)}`;
}

// ---------------------------------------------------------------------------
// BroadcastChannel + localStorage sync
// ---------------------------------------------------------------------------

function useDisplayState() {
  const [state, setState] = useState(() => {
    // Bootstrap from localStorage so a page refresh stays in sync.
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  });

  const channelRef = useRef(null);

  useEffect(() => {
    // --- BroadcastChannel ---
    let ch = null;
    try {
      ch = new BroadcastChannel(CHANNEL_NAME);
      channelRef.current = ch;
      ch.onmessage = (ev) => {
        if (ev.data && ev.data.type !== 'tip_selected') {
          setState(ev.data);
          try { localStorage.setItem(STORAGE_KEY, JSON.stringify(ev.data)); } catch { /* noop */ }
        }
      };
    } catch {
      // BroadcastChannel not available (rare); fall through to storage-only mode.
    }

    // --- storage event (cross-tab fallback) ---
    function onStorage(ev) {
      if (ev.key === STORAGE_KEY && ev.newValue) {
        try {
          const next = JSON.parse(ev.newValue);
          if (next?.type !== 'tip_selected') setState(next);
        } catch { /* noop */ }
      }
    }
    window.addEventListener('storage', onStorage);

    return () => {
      if (ch) ch.close();
      window.removeEventListener('storage', onStorage);
    };
  }, []);

  // broadcastTip sends a tip_selected event back to the POS window.
  const broadcastTip = useCallback((amountCents) => {
    const msg = { type: 'tip_selected', amount: amountCents };
    try {
      if (channelRef.current) channelRef.current.postMessage(msg);
    } catch { /* noop */ }
    // Also write to localStorage for the POS window's storage listener.
    try { localStorage.setItem('bb.customer_display_tip', JSON.stringify(msg)); } catch { /* noop */ }
  }, []);

  return { state, broadcastTip };
}

// ---------------------------------------------------------------------------
// Root component
// ---------------------------------------------------------------------------

export default function CustomerDisplay() {
  const { state, broadcastTip } = useDisplayState();

  if (!state || !state.items || state.items.length === 0) {
    return <IdleScreen />;
  }

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Header */}
      <header className="bg-primary text-primary-foreground px-6 py-4 flex items-center gap-3">
        <Receipt className="h-6 w-6" />
        <span className="text-xl font-semibold">
          {state.storeName || 'Your Order'}
        </span>
      </header>

      <main className="flex-1 flex flex-col gap-6 p-6 max-w-xl mx-auto w-full">
        {/* Line items */}
        <section>
          <h2 className="text-lg font-semibold mb-3">Order Summary</h2>
          <div className="space-y-2">
            {state.items.map((item, i) => (
              <div key={i} className="flex items-center justify-between py-2 border-b last:border-b-0">
                <div>
                  <p className="font-medium">{item.name}</p>
                  <p className="text-sm text-muted-foreground">× {item.qty}</p>
                </div>
                <p className="font-medium tabular-nums">
                  {formatCurrency(item.unitCents * item.qty, state.currency)}
                </p>
              </div>
            ))}
          </div>
        </section>

        {/* Totals */}
        <section className="bg-muted rounded-lg p-4 space-y-2">
          <div className="flex justify-between text-sm">
            <span>Subtotal</span>
            <span className="tabular-nums">{formatCurrency(state.subtotal, state.currency)}</span>
          </div>
          {state.tax > 0 && (
            <div className="flex justify-between text-sm">
              <span>Tax</span>
              <span className="tabular-nums">{formatCurrency(state.tax, state.currency)}</span>
            </div>
          )}
          {state.selectedTip > 0 && (
            <div className="flex justify-between text-sm text-green-600">
              <span>Tip</span>
              <span className="tabular-nums">{formatCurrency(state.selectedTip, state.currency)}</span>
            </div>
          )}
          <div className="flex justify-between font-bold text-lg border-t pt-2 mt-2">
            <span>Total</span>
            <span className="tabular-nums">
              {formatCurrency(
                (state.total ?? 0) + (state.selectedTip ?? 0),
                state.currency,
              )}
            </span>
          </div>
        </section>

        {/* Tip selector (optional — only shown when tipOptions provided) */}
        {state.tipOptions && state.tipOptions.length > 0 && (
          <TipSelector
            options={state.tipOptions}
            selected={state.selectedTip ?? 0}
            currency={state.currency}
            onSelect={broadcastTip}
          />
        )}
      </main>

      <footer className="text-center text-xs text-muted-foreground py-4">
        Powered by BeepBite
      </footer>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Idle screen — shown when no order is active
// ---------------------------------------------------------------------------

function IdleScreen() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-4 bg-background text-muted-foreground">
      <Monitor className="h-16 w-16 opacity-20" />
      <p className="text-2xl font-light">Welcome</p>
      <p className="text-sm">Waiting for order…</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tip selector
// ---------------------------------------------------------------------------

function TipSelector({ options, selected, currency, onSelect }) {
  return (
    <section>
      <h2 className="text-lg font-semibold mb-3 flex items-center gap-2">
        <TrendingUp className="h-5 w-5 text-green-500" />
        Add a tip?
      </h2>
      <div className="grid grid-cols-3 gap-2">
        {options.map((amt) => (
          <Button
            key={amt}
            variant={selected === amt ? 'default' : 'outline'}
            className="h-14 text-base"
            onClick={() => onSelect(amt === selected ? 0 : amt)}
          >
            {formatCurrency(amt, currency)}
          </Button>
        ))}
        <Button
          variant={selected === 0 ? 'default' : 'outline'}
          className="h-14 text-base"
          onClick={() => onSelect(0)}
        >
          No tip
        </Button>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Broadcaster helper — call this from the POS workspace to push state.
// Import and call broadcastDisplayState(state) from workspace.jsx.
// ---------------------------------------------------------------------------

let _channel = null;

function getChannel() {
  if (!_channel) {
    try {
      _channel = new BroadcastChannel(CHANNEL_NAME);
    } catch {
      _channel = null;
    }
  }
  return _channel;
}

/**
 * Push display state to the customer-display window.
 * Call from the POS workspace whenever order state changes.
 *
 * @param {{ storeName?, items, subtotal, tax, total, currency, tipOptions? }} state
 */
export function broadcastDisplayState(state) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch { /* noop */ }
  const ch = getChannel();
  if (ch) {
    try { ch.postMessage(state); } catch { /* noop */ }
  }
}

/**
 * Subscribe to tip_selected events from the customer-display window.
 * Returns an unsubscribe function.
 *
 * @param {(amountCents: number) => void} callback
 * @returns {() => void}
 */
export function onTipSelected(callback) {
  const ch = getChannel();
  if (!ch) return () => {};

  function handler(ev) {
    if (ev.data?.type === 'tip_selected') {
      callback(ev.data.amount ?? 0);
    }
  }
  ch.addEventListener('message', handler);

  // Also listen via localStorage for cross-origin cases.
  function storageHandler(ev) {
    if (ev.key === 'bb.customer_display_tip' && ev.newValue) {
      try {
        const msg = JSON.parse(ev.newValue);
        if (msg?.type === 'tip_selected') callback(msg.amount ?? 0);
      } catch { /* noop */ }
    }
  }
  window.addEventListener('storage', storageHandler);

  return () => {
    ch.removeEventListener('message', handler);
    window.removeEventListener('storage', storageHandler);
  };
}
