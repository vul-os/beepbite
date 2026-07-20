import React from 'react';
import { Input } from '@/components/ui/input';
import { denominationRows } from '@/lib/denominations';
import { useMoney } from '@/context/locale-context';

/**
 * DenominationGrid
 *
 * Props:
 *   counts: Record<string, number>  — keyed by denomination key, e.g. { d20000: 2 }
 *   onChange: (counts, totalCents) => void
 *   readOnly?: boolean
 *
 * Requires LocaleProvider above it: the tiles ARE the currency's notes and
 * coins, so with no currency resolved there is nothing to count and the grid
 * renders empty rather than offering somebody else's banknotes.
 */
export function DenominationGrid({ counts = {}, onChange, readOnly = false }) {
  const { format, currency } = useMoney();
  const denominations = denominationRows(currency);

  const handleChange = (key, rawValue) => {
    const n = Math.max(0, parseInt(rawValue, 10) || 0);
    const next = { ...counts, [key]: n };
    const totalCents = denominations.reduce(
      (sum, d) => sum + (next[d.key] || 0) * d.minor,
      0,
    );
    onChange?.(next, totalCents);
  };

  const totalCents = denominations.reduce(
    (sum, d) => sum + (counts[d.key] || 0) * d.minor,
    0,
  );

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
        {denominations.map((d) => {
          const count = counts[d.key] || 0;
          const subtotal = count * d.minor;
          return (
            <div
              key={d.key}
              className="flex flex-col gap-1 rounded-md border border-input bg-background p-2"
            >
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">{format(d.minor)}</span>
                {subtotal > 0 && (
                  <span className="text-xs text-muted-foreground">
                    = {format(subtotal)}
                  </span>
                )}
              </div>
              {readOnly ? (
                <span className="text-sm">{count}</span>
              ) : (
                <Input
                  type="number"
                  min="0"
                  value={count === 0 ? '' : count}
                  placeholder="0"
                  onChange={(e) => handleChange(d.key, e.target.value)}
                  className="h-8 text-sm"
                />
              )}
            </div>
          );
        })}
      </div>
      <div className="flex justify-between items-center rounded-md bg-muted px-3 py-2">
        <span className="text-sm font-medium">Total counted</span>
        <span className="text-sm font-semibold">{format(totalCents)}</span>
      </div>
    </div>
  );
}
