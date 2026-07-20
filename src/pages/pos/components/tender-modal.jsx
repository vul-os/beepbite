// tender-modal.jsx — Split tender modal for POS checkout.
//
// Supports paying one ticket (one or many orders) across multiple payment
// methods: cash, card, gift card, house account. Each line is a partial
// amount. The "remaining" balance tracks to zero before the cashier can
// confirm. On confirmation the parent receives an array of payment legs:
//   [{ method, amountCents, reference?, changeCents? }, ...]
//
// Usage:
//   <TenderModal
//     open={bool}
//     onOpenChange={fn}
//     totalCents={number}          // full amount due
//     submitting={bool}
//     errorMessage={string}
//     onConfirm={legs => ...}      // called with array of TenderLeg
//   />
/* eslint-disable react/prop-types */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Banknote,
  Building2,
  CheckCircle2,
  CreditCard,
  Gift,
  Loader2,
  Plus,
  Trash2,
  X,
} from 'lucide-react';

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

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const METHODS = [
  { code: 'cash',          label: 'Cash',          icon: Banknote,  color: 'green' },
  { code: 'card_in_person',label: 'Card',          icon: CreditCard, color: 'blue' },
  { code: 'gift_card',     label: 'Gift Card',     icon: Gift,       color: 'purple' },
  { code: 'house_account', label: 'House Account', icon: Building2,  color: 'amber' },
];

const COLOR_MAP = {
  green:  { bg: 'bg-green-50',  border: 'border-green-200',  text: 'text-green-700',  active: 'bg-green-500' },
  blue:   { bg: 'bg-blue-50',   border: 'border-blue-200',   text: 'text-blue-700',   active: 'bg-blue-500' },
  purple: { bg: 'bg-purple-50', border: 'border-purple-200', text: 'text-purple-700', active: 'bg-purple-500' },
  amber:  { bg: 'bg-amber-50',  border: 'border-amber-200',  text: 'text-amber-700',  active: 'bg-amber-500' },
};

// ---------------------------------------------------------------------------
// Sub-component: a single payment leg row
// ---------------------------------------------------------------------------

function LegRow({ leg, onChange, onRemove, canRemove, remainingCents }) {
  const method = METHODS.find((m) => m.code === leg.method) || METHODS[0];
  const colors = COLOR_MAP[method.color];
  const Icon = method.icon;
  const { symbol, scale, decimals } = useMoney();

  // The <input type="number"> value is machine-readable, not display text: it
  // must stay a plain '.'-separated decimal whatever the reader's locale is, so
  // it is built from scale/decimals rather than from format(). A zero-decimal
  // currency (JPY) gets '1000', not '1000.00', and a whole-unit step.
  const toInput = (minor) => (minor / scale).toFixed(decimals);
  const step = String(1 / scale);

  return (
    <div className={cn('flex items-center gap-2 p-2 rounded-lg border', colors.border, colors.bg)}>
      <Icon className={cn('w-5 h-5 shrink-0', colors.text)} />
      <span className={cn('text-xs font-semibold w-20 shrink-0', colors.text)}>{method.label}</span>
      <div className="relative flex-1">
        <span className="absolute left-2 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">{symbol}</span>
        <Input
          type="number"
          min="0"
          step={step}
          value={leg.rawInput}
          onChange={(e) => onChange(leg.id, 'rawInput', e.target.value)}
          onBlur={() => {
            // Snap to remaining if no amount entered and there's still a balance
            if (leg.rawInput === '' || leg.rawInput === '0' || leg.rawInput === toInput(0)) {
              if (remainingCents > 0) {
                onChange(leg.id, 'rawInput', toInput(remainingCents));
              }
            }
          }}
          className="pl-6 h-9 text-sm tabular-nums"
          placeholder={toInput(remainingCents)}
        />
      </div>
      {leg.method === 'card_in_person' && (
        <Input
          className="h-9 w-28 text-xs"
          placeholder="Terminal ref"
          maxLength={40}
          value={leg.reference}
          onChange={(e) => onChange(leg.id, 'reference', e.target.value)}
        />
      )}
      {canRemove && (
        <button
          type="button"
          onClick={() => onRemove(leg.id)}
          aria-label="Remove this payment method"
          className="w-9 h-9 flex items-center justify-center rounded-full text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive"
        >
          <Trash2 className="w-4 h-4" />
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Method picker row (add another payment type)
// ---------------------------------------------------------------------------

function MethodPicker({ usedCodes, onAdd }) {
  const available = METHODS.filter((m) => !usedCodes.includes(m.code));
  if (available.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1.5 pt-1">
      {available.map((m) => {
        const colors = COLOR_MAP[m.color];
        const Icon = m.icon;
        return (
          <button
            key={m.code}
            type="button"
            onClick={() => onAdd(m.code)}
            className={cn(
              'flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium border transition',
              colors.border, colors.text, colors.bg,
              `hover:${colors.active} hover:text-white`,
            )}
          >
            <Icon className="w-3.5 h-3.5" />
            <Plus className="w-3 h-3" />
            {m.label}
          </button>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

let _legId = 0;
const nextLegId = () => `leg-${++_legId}`;

export default function TenderModal({
  open,
  onOpenChange,
  totalCents = 0,
  submitting = false,
  errorMessage,
  onConfirm,
}) {
  const [legs, setLegs] = useState([]);
  const { format, parse, scale, decimals } = useMoney();

  const toInput = useCallback(
    (minor) => (minor / scale).toFixed(decimals),
    [scale, decimals],
  );

  // Typed amounts are parsed against the currency, not against a hardcoded 100:
  // '1000' in a JPY store is ¥1000, and '12.345' in a 2-decimal one is a typo
  // that must not become a charge.
  const parseAmount = useCallback(
    (str) => {
      const n = parse(str);
      return n && n > 0 ? n : 0;
    },
    [parse],
  );

  // Reset when modal opens
  useEffect(() => {
    if (open) {
      setLegs([
        { id: nextLegId(), method: 'cash', rawInput: toInput(totalCents), reference: '' },
      ]);
    }
  }, [open, totalCents, toInput]);

  // ---------------------------------------------------------------------------
  // Derived
  // ---------------------------------------------------------------------------

  const allocatedCents = useMemo(
    () => legs.reduce((sum, l) => sum + parseAmount(l.rawInput), 0),
    [legs, parseAmount],
  );
  const remainingCents = totalCents - allocatedCents;
  const isFullyTendered = remainingCents <= 0;
  const canConfirm = isFullyTendered && !submitting;

  // Cash change (only for legs with method=cash)
  const cashLeg = legs.find((l) => l.method === 'cash');
  const cashCents = cashLeg ? parseAmount(cashLeg.rawInput) : 0;
  const nonCashCents = legs
    .filter((l) => l.method !== 'cash')
    .reduce((s, l) => s + parseAmount(l.rawInput), 0);
  const changeCents = Math.max(0, cashCents - Math.max(0, totalCents - nonCashCents));

  // ---------------------------------------------------------------------------
  // Handlers
  // ---------------------------------------------------------------------------

  const handleChangeLeg = useCallback((legId, field, value) => {
    setLegs((prev) =>
      prev.map((l) => (l.id === legId ? { ...l, [field]: value } : l)),
    );
  }, []);

  const handleRemoveLeg = useCallback((legId) => {
    setLegs((prev) => prev.filter((l) => l.id !== legId));
  }, []);

  const handleAddMethod = useCallback((code) => {
    const remaining = totalCents - legs.reduce((s, l) => s + parseAmount(l.rawInput), 0);
    setLegs((prev) => [
      ...prev,
      {
        id: nextLegId(),
        method: code,
        rawInput: toInput(remaining > 0 ? remaining : 0),
        reference: '',
      },
    ]);
  }, [legs, totalCents, parseAmount, toInput]);

  const handleConfirm = useCallback(() => {
    if (!canConfirm) return;
    const result = legs
      .filter((l) => parseAmount(l.rawInput) > 0)
      .map((l) => ({
        method: l.method,
        amountCents: parseAmount(l.rawInput),
        reference: l.reference || undefined,
        changeCents: l.method === 'cash' ? changeCents : undefined,
      }));
    onConfirm(result);
  }, [canConfirm, legs, changeCents, onConfirm, parseAmount]);

  // ---------------------------------------------------------------------------
  const usedCodes = legs.map((l) => l.method);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md w-full p-0 overflow-hidden">
        <DialogHeader className="px-6 pt-6 pb-3 border-b">
          <DialogTitle className="flex items-center gap-2 text-xl">
            <CreditCard className="text-orange-500 shrink-0" size={22} />
            Split Tender
          </DialogTitle>
          <DialogDescription className="sr-only">
            Split payment across multiple methods.
          </DialogDescription>
        </DialogHeader>

        <div className="px-6 py-4 space-y-4">
          {/* Total due */}
          <div className="text-center">
            <p className="text-xs uppercase tracking-widest text-muted-foreground mb-0.5">Total due</p>
            <p className="text-4xl font-bold tabular-nums">{format(Math.abs(totalCents))}</p>
          </div>

          {/* Payment legs */}
          <div className="space-y-2">
            {legs.map((leg) => {
              const otherAllocated = legs
                .filter((l) => l.id !== leg.id)
                .reduce((s, l) => s + parseAmount(l.rawInput), 0);
              const localRemaining = Math.max(0, totalCents - otherAllocated);
              return (
                <LegRow
                  key={leg.id}
                  leg={leg}
                  onChange={handleChangeLeg}
                  onRemove={handleRemoveLeg}
                  canRemove={legs.length > 1}
                  remainingCents={localRemaining}
                />
              );
            })}
          </div>

          {/* Add another method */}
          <MethodPicker usedCodes={usedCodes} onAdd={handleAddMethod} />

          {/* Running balance */}
          <div
            className={cn(
              'rounded-lg px-4 py-3 text-center border transition-colors',
              isFullyTendered
                ? 'bg-green-50 border-green-200'
                : 'bg-destructive/10 border-destructive/30',
            )}
          >
            <p className="text-xs uppercase tracking-widest text-muted-foreground mb-0.5">
              {isFullyTendered ? 'Remaining' : 'Still needed'}
            </p>
            <p
              className={cn(
                'text-3xl font-bold tabular-nums',
                isFullyTendered ? 'text-green-600' : 'text-destructive',
              )}
            >
              {format(Math.abs(remainingCents))}
            </p>
            {isFullyTendered && changeCents > 0 && (
              <p className="text-xs text-green-600 mt-1">
                Cash change: <span className="font-semibold">{format(Math.abs(changeCents))}</span>
              </p>
            )}
          </div>

          {errorMessage && (
            <Alert variant="destructive">
              <AlertDescription>{errorMessage}</AlertDescription>
            </Alert>
          )}
        </div>

        <DialogFooter className="px-6 pb-6 pt-2 gap-2 sm:gap-2">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
            aria-label="Cancel payment"
            className="flex-1 h-12 focus-visible:ring-2 focus-visible:ring-gray-400"
          >
            <X className="w-4 h-4 mr-1" aria-hidden="true" /> Cancel
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={!canConfirm}
            aria-label={submitting ? 'Processing payment' : isFullyTendered ? 'Confirm payment' : 'Enter full amount to confirm'}
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
            ) : isFullyTendered ? (
              <span className="flex items-center gap-1.5">
                <CheckCircle2 className="w-5 h-5" aria-hidden="true" />
                Confirm Payment
              </span>
            ) : (
              'Enter Full Amount'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
