import React from 'react';
import { Input } from '@/components/ui/input';

// South African denominations: notes then coins
const DENOMINATIONS = [
  { key: 'R200', label: 'R200', cents: 20000 },
  { key: 'R100', label: 'R100', cents: 10000 },
  { key: 'R50',  label: 'R50',  cents: 5000 },
  { key: 'R20',  label: 'R20',  cents: 2000 },
  { key: 'R10',  label: 'R10',  cents: 1000 },
  { key: 'R5',   label: 'R5',   cents: 500  },
  { key: 'R2',   label: 'R2',   cents: 200  },
  { key: 'R1',   label: 'R1',   cents: 100  },
  { key: 'c50',  label: '50c',  cents: 50   },
  { key: 'c20',  label: '20c',  cents: 20   },
  { key: 'c10',  label: '10c',  cents: 10   },
  { key: 'c5',   label: '5c',   cents: 5    },
];

/**
 * DenominationGrid
 *
 * Props:
 *   counts: Record<string, number>  — e.g. { R200: 2, R100: 5, ... }
 *   onChange: (counts, totalCents) => void
 *   readOnly?: boolean
 */
export function DenominationGrid({ counts = {}, onChange, readOnly = false }) {
  const handleChange = (key, rawValue) => {
    const n = Math.max(0, parseInt(rawValue, 10) || 0);
    const next = { ...counts, [key]: n };
    const totalCents = DENOMINATIONS.reduce(
      (sum, d) => sum + (next[d.key] || 0) * d.cents,
      0,
    );
    onChange?.(next, totalCents);
  };

  const totalCents = DENOMINATIONS.reduce(
    (sum, d) => sum + (counts[d.key] || 0) * d.cents,
    0,
  );

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
        {DENOMINATIONS.map((d) => {
          const count = counts[d.key] || 0;
          const subtotal = count * d.cents;
          return (
            <div
              key={d.key}
              className="flex flex-col gap-1 rounded-md border border-input bg-background p-2"
            >
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">{d.label}</span>
                {subtotal > 0 && (
                  <span className="text-xs text-muted-foreground">
                    = R{(subtotal / 100).toFixed(2)}
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
        <span className="text-sm font-semibold">R{(totalCents / 100).toFixed(2)}</span>
      </div>
    </div>
  );
}

export { DENOMINATIONS };
