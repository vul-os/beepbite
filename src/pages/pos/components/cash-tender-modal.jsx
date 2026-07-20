/* eslint-disable react/prop-types */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Banknote, CheckCircle2, Delete, Loader2 } from 'lucide-react';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { useMoney } from '@/context/locale-context';
import { quickTenderValues } from '@/lib/denominations';

// ---------------------------------------------------------------------------
// Money helpers — all arithmetic stays in integer minor units to avoid float
// drift. Display-only conversion happens at the render boundary.
// ---------------------------------------------------------------------------

// Round up `cents` to the nearest multiple of `denom`.
const roundUpTo = (cents, denom) => Math.ceil(cents / denom) * denom;

const NUMPAD_KEYS = ['7','8','9','4','5','6','1','2','3','.','0','⌫'];

// ---------------------------------------------------------------------------
export default function CashTenderModal({
  open,
  onOpenChange,
  amountDueCents,
  submitting = false,
  errorMessage,
  onConfirm,
}) {
  // Raw string that drives both Input and numpad so they stay in sync.
  const [rawInput, setRawInput] = useState('');
  const [confirmed, setConfirmed] = useState(false);

  const { format, parse, currency, symbol, scale, decimals } = useMoney();

  // The raw string is an <input type="number"> value, so it stays a plain
  // '.'-separated decimal rather than localised text. A zero-decimal currency
  // (JPY) shows '1000', not '1000.00'.
  const toInput = useCallback(
    (minor) => (minor / scale).toFixed(decimals),
    [scale, decimals],
  );

  // Reset every time the modal opens.
  useEffect(() => {
    if (open) {
      setRawInput(toInput(amountDueCents));
      setConfirmed(false);
    }
  }, [open, amountDueCents, toInput]);

  // Parsed against the currency: '1000' tendered in a JPY store is ¥1000, which
  // a literal ×100 would read as ¥100 000 and hand back the difference.
  const parsed = parse(rawInput);
  const tenderedCents = parsed && parsed > 0 ? parsed : 0;
  const changeCents   = tenderedCents - amountDueCents;
  const canConfirm    = tenderedCents >= amountDueCents && !submitting;

  // Quick-tender chips are the currency's own notes; the "Exact" sentinel stays
  // first. Labels are rendered, never stored — that is how 'R 200' got baked in.
  const chips = useMemo(
    () => [
      { label: 'Exact', value: null },
      ...quickTenderValues(currency).map((minor) => ({
        label: format(minor),
        value: minor,
      })),
    ],
    [currency, format],
  );

  // ------------------------------------------------------------------
  // Numpad handler — builds the raw string character by character.
  // ------------------------------------------------------------------
  const handleNumpad = useCallback((key) => {
    if (key === '⌫') {
      setRawInput((prev) => (prev.length > 1 ? prev.slice(0, -1) : '0'));
      return;
    }
    setRawInput((prev) => {
      // A zero-decimal currency (JPY, KRW) has no fractional part to type.
      if (key === '.' && decimals === 0) return prev;
      // Prevent multiple decimal points.
      if (key === '.' && prev.includes('.')) return prev;
      // Limit to the currency's own number of decimal places.
      const dotIdx = prev.indexOf('.');
      if (dotIdx !== -1 && prev.length - dotIdx > decimals) return prev;
      // Replace leading lone zero (unless we're adding a decimal).
      if (prev === '0' && key !== '.') return key;
      return prev + key;
    });
  }, [decimals]);

  // ------------------------------------------------------------------
  // Quick-cash chip handler.
  // ------------------------------------------------------------------
  const handleChip = useCallback((chip) => {
    if (chip.value === null) {
      // "Exact" — pre-fill exact amount due.
      setRawInput(toInput(amountDueCents));
      return;
    }
    // Round up the amount due to the nearest multiple of this denomination.
    const rounded = roundUpTo(amountDueCents, chip.value);
    setRawInput(toInput(rounded));
  }, [amountDueCents, toInput]);

  // ------------------------------------------------------------------
  const handleConfirm = () => {
    if (!canConfirm) return;
    setConfirmed(true);
    onConfirm({ tenderedCents, changeCents });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm w-full p-0 overflow-hidden">
        <DialogHeader className="px-6 pt-6 pb-3 border-b">
          <DialogTitle className="flex items-center gap-2 text-xl">
            <Banknote className="text-orange-500 shrink-0" size={22} />
            Cash Payment
          </DialogTitle>
          <DialogDescription className="sr-only">
            Enter the cash amount tendered by the customer.
          </DialogDescription>
        </DialogHeader>

        <div className="px-6 py-4 space-y-4">
          {/* Amount due */}
          <div className="text-center">
            <p className="text-xs uppercase tracking-widest text-muted-foreground mb-0.5">
              Amount due
            </p>
            <p className="text-4xl font-bold tabular-nums tracking-tight">
              {format(Math.abs(amountDueCents))}
            </p>
          </div>

          {/* Tendered input */}
          <div>
            <label className="text-xs uppercase tracking-widest text-muted-foreground block mb-1">
              Amount tendered
            </label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground font-medium">
                {symbol}
              </span>
              <Input
                type="number"
                min="0"
                step={String(1 / scale)}
                className="pl-7 text-lg font-semibold tabular-nums h-11"
                value={rawInput}
                onChange={(e) => setRawInput(e.target.value)}
              />
            </div>
          </div>

          {/* Quick-cash chips */}
          <div className="flex flex-wrap gap-1.5">
            {chips.map((chip) => (
              <button
                key={chip.label}
                type="button"
                onClick={() => handleChip(chip)}
                className={cn(
                  'px-3 py-1 rounded-full text-sm font-medium border transition-colors',
                  'border-orange-300 text-orange-700 bg-orange-50',
                  'hover:bg-orange-500 hover:text-white hover:border-orange-500',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-400',
                )}
              >
                {chip.label}
              </button>
            ))}
          </div>

          {/* Change due */}
          <div className="text-center py-2 rounded-lg bg-muted/40">
            <p className="text-xs uppercase tracking-widest text-muted-foreground mb-0.5">
              Change due
            </p>
            <p
              className={cn(
                'text-3xl font-bold tabular-nums tracking-tight',
                changeCents >= 0 ? 'text-green-600' : 'text-red-500',
              )}
            >
              {changeCents >= 0
                ? format(changeCents)
                : `- ${format(Math.abs(changeCents))}`}
            </p>
          </div>

          {/* Numpad — 3×4, thumb-friendly (≥52px rows on mobile) */}
          <div className="grid grid-cols-3 gap-2">
            {NUMPAD_KEYS.map((key) => (
              <button
                key={key}
                type="button"
                onClick={() => handleNumpad(key)}
                aria-label={key === '⌫' ? 'backspace' : key}
                className={cn(
                  'h-14 rounded-xl text-xl font-semibold border-2 transition-colors select-none',
                  'bg-white border-gray-200 hover:bg-orange-50 hover:border-orange-300 active:bg-orange-100 active:scale-95',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-400',
                  key === '⌫' && 'text-muted-foreground',
                )}
              >
                {key === '⌫' ? <Delete className="mx-auto" size={20} /> : key}
              </button>
            ))}
          </div>
        </div>

        {/* Error alert */}
        {errorMessage && (
          <div className="px-6 pb-2">
            <Alert variant="destructive">
              <AlertDescription>{errorMessage}</AlertDescription>
            </Alert>
          </div>
        )}

        {/* Success flash — parent controls the actual close via onOpenChange */}
        {confirmed && !submitting && !errorMessage && (
          <div className="px-6 pb-2">
            <div className="flex items-center gap-2 text-green-600 text-sm font-medium">
              <CheckCircle2 size={16} />
              Payment recorded — drawer opening…
            </div>
          </div>
        )}

        <DialogFooter className="px-6 pb-6 pt-2 gap-2 sm:gap-2">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
            aria-label="Cancel cash payment"
            className="flex-1 h-12 focus-visible:ring-2 focus-visible:ring-gray-400"
          >
            Cancel
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={!canConfirm}
            aria-label={submitting ? 'Processing payment' : 'Confirm cash payment'}
            aria-busy={submitting}
            className={cn(
              'flex-1 h-12 font-bold text-base bg-orange-500 hover:bg-orange-600 active:bg-orange-700 text-white',
              'focus-visible:ring-2 focus-visible:ring-orange-400 focus-visible:ring-offset-1',
              'disabled:bg-orange-200 disabled:text-orange-400 disabled:cursor-not-allowed',
              'transition-all',
            )}
          >
            {submitting ? (
              <span className="flex items-center gap-1.5">
                <Loader2 className="animate-spin" size={18} aria-hidden="true" />
                Processing…
              </span>
            ) : (
              'Confirm Cash Payment'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
