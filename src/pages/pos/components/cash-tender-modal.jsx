/* eslint-disable react/prop-types */
import React, { useCallback, useEffect, useState } from 'react';
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

// ---------------------------------------------------------------------------
// Money helpers — all arithmetic stays in integer cents to avoid float drift.
// Display-only conversion happens at the render boundary.
// ---------------------------------------------------------------------------
const centsToDisplay = (cents) => {
  const abs = Math.abs(cents);
  const rands = (abs / 100).toFixed(2);
  return `R ${rands}`;
};

const displayToCents = (str) => {
  const n = parseFloat(str);
  if (isNaN(n) || n < 0) return 0;
  return Math.round(n * 100);
};

// SA banknote denominations in cents.
const SA_NOTES = [
  { label: 'Exact', value: null },   // sentinel — handled specially
  { label: 'R 20',  value: 2000 },
  { label: 'R 50',  value: 5000 },
  { label: 'R 100', value: 10000 },
  { label: 'R 200', value: 20000 },
  { label: 'R 500', value: 50000 },
];

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

  // Reset every time the modal opens.
  useEffect(() => {
    if (open) {
      setRawInput((amountDueCents / 100).toFixed(2));
      setConfirmed(false);
    }
  }, [open, amountDueCents]);

  const tenderedCents = displayToCents(rawInput);
  const changeCents   = tenderedCents - amountDueCents;
  const canConfirm    = tenderedCents >= amountDueCents && !submitting;

  // ------------------------------------------------------------------
  // Numpad handler — builds the raw string character by character.
  // ------------------------------------------------------------------
  const handleNumpad = useCallback((key) => {
    if (key === '⌫') {
      setRawInput((prev) => (prev.length > 1 ? prev.slice(0, -1) : '0'));
      return;
    }
    setRawInput((prev) => {
      // Prevent multiple decimal points.
      if (key === '.' && prev.includes('.')) return prev;
      // Limit to 2 decimal places.
      const dotIdx = prev.indexOf('.');
      if (dotIdx !== -1 && prev.length - dotIdx > 2) return prev;
      // Replace leading lone zero (unless we're adding a decimal).
      if (prev === '0' && key !== '.') return key;
      return prev + key;
    });
  }, []);

  // ------------------------------------------------------------------
  // Quick-cash chip handler.
  // ------------------------------------------------------------------
  const handleChip = useCallback((chip) => {
    if (chip.value === null) {
      // "Exact" — pre-fill exact amount due.
      setRawInput((amountDueCents / 100).toFixed(2));
      return;
    }
    // Round up the amount due to the nearest multiple of this denomination.
    const rounded = roundUpTo(amountDueCents, chip.value);
    setRawInput((rounded / 100).toFixed(2));
  }, [amountDueCents]);

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
              {centsToDisplay(amountDueCents)}
            </p>
          </div>

          {/* Tendered input */}
          <div>
            <label className="text-xs uppercase tracking-widest text-muted-foreground block mb-1">
              Amount tendered
            </label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground font-medium">
                R
              </span>
              <Input
                type="number"
                min="0"
                step="0.01"
                className="pl-7 text-lg font-semibold tabular-nums h-11"
                value={rawInput}
                onChange={(e) => setRawInput(e.target.value)}
              />
            </div>
          </div>

          {/* Quick-cash chips */}
          <div className="flex flex-wrap gap-1.5">
            {SA_NOTES.map((chip) => (
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
                ? centsToDisplay(changeCents)
                : `- ${centsToDisplay(Math.abs(changeCents))}`}
            </p>
          </div>

          {/* Numpad — 3×4, touch-friendly (min 48px rows) */}
          <div className="grid grid-cols-3 gap-1.5">
            {NUMPAD_KEYS.map((key) => (
              <button
                key={key}
                type="button"
                onClick={() => handleNumpad(key)}
                className={cn(
                  'h-12 rounded-md text-lg font-semibold border transition-colors select-none',
                  'bg-background hover:bg-orange-50 hover:border-orange-300 active:bg-orange-100',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-400',
                  key === '⌫' && 'text-muted-foreground',
                )}
                aria-label={key === '⌫' ? 'backspace' : key}
              >
                {key === '⌫' ? <Delete className="mx-auto" size={18} /> : key}
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
            className="flex-1"
          >
            Cancel
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={!canConfirm}
            className={cn(
              'flex-1 bg-orange-500 hover:bg-orange-600 text-white',
              'disabled:bg-orange-200 disabled:text-orange-400',
            )}
          >
            {submitting ? (
              <>
                <Loader2 className="animate-spin mr-1" size={16} />
                Processing…
              </>
            ) : (
              'Confirm Cash Payment'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
