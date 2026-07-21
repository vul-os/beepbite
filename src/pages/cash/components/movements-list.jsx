import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useMoney } from '@/context/locale-context';

const TYPE_LABELS = {
  paid_in:    { label: 'Paid In',    color: 'bg-green-100 text-green-800 border-green-200' },
  paid_out:   { label: 'Paid Out',   color: 'bg-red-100 text-red-800 border-red-200' },
  petty_cash: { label: 'Petty Cash', color: 'bg-yellow-100 text-yellow-800 border-yellow-200' },
  tip_out:    { label: 'Tip Out',    color: 'bg-purple-100 text-purple-800 border-purple-200' },
  no_sale:    { label: 'No Sale',    color: 'bg-gray-100 text-gray-700 border-gray-200' },
  drop:       { label: 'Drop',       color: 'bg-blue-100 text-blue-800 border-blue-200' },
  pickup:     { label: 'Pickup',     color: 'bg-orange-100 text-orange-800 border-orange-200' },
};

const PAGE_SIZE = 10;

function fmtDate(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * MovementsList
 *
 * Props:
 *   movements: array of movement objects from the session detail
 *
 * Requires LocaleProvider above it.
 */
export function MovementsList({ movements = [] }) {
  const { format } = useMoney();
  const [page, setPage] = useState(1);

  // Explicit +/- prefix on an absolute amount: an inflow needs a visible '+',
  // which no currency format supplies.
  const fmtSigned = (cents) =>
    `${cents < 0 ? '-' : '+'}${format(Math.abs(cents))}`;

  if (movements.length === 0) {
    return (
      <p className="text-sm text-muted-foreground py-4 text-center">
        No movements recorded yet.
      </p>
    );
  }

  const totalPages = Math.ceil(movements.length / PAGE_SIZE);
  const slice = movements.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  return (
    <div className="space-y-2">
      {slice.map((m) => {
        const meta = TYPE_LABELS[m.movement_type] || { label: m.movement_type, color: 'bg-gray-100 text-gray-700' };
        const positive = m.amount_cents >= 0;
        return (
          <div
            key={m.id}
            className="flex items-center justify-between rounded-md border bg-background px-3 py-2 text-sm"
          >
            <div className="flex items-center gap-2 min-w-0">
              <Badge variant="outline" className={`shrink-0 text-xs ${meta.color}`}>
                {meta.label}
              </Badge>
              <span className="truncate text-muted-foreground">{m.reason || '—'}</span>
            </div>
            <div className="flex items-center gap-3 shrink-0 ml-2">
              <span className={`font-mono font-medium ${positive ? 'text-green-700' : 'text-red-700'}`}>
                {fmtSigned(m.amount_cents)}
              </span>
              <span className="text-xs text-muted-foreground">{fmtDate(m.created_at)}</span>
            </div>
          </div>
        );
      })}

      {totalPages > 1 && (
        <div className="flex items-center justify-between pt-2">
          <span className="text-xs text-muted-foreground">
            Page {page} of {totalPages}
          </span>
          <div className="flex gap-1">
            <Button
              variant="outline"
              size="icon"
              className="h-7 w-7"
              disabled={page === 1}
              onClick={() => setPage((p) => p - 1)}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="icon"
              className="h-7 w-7"
              disabled={page === totalPages}
              onClick={() => setPage((p) => p + 1)}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
