import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useMoney } from '@/context/locale-context';

// Colour follows cash direction, not seven arbitrary hues: money coming into
// the drawer (paid_in, petty_cash, drop) reads success; money leaving
// (paid_out, tip_out, pickup) reads warning — worth a glance, not alarming,
// since outflows are routine till operations, not errors. `no_sale` moves no
// cash at all, so it stays neutral.
const TYPE_LABELS = {
  paid_in:    { label: 'Paid In',    color: 'bg-success/15 text-success border-success/30' },
  paid_out:   { label: 'Paid Out',   color: 'bg-warning/15 text-warning border-warning/30' },
  petty_cash: { label: 'Petty Cash', color: 'bg-success/15 text-success border-success/30' },
  tip_out:    { label: 'Tip Out',    color: 'bg-warning/15 text-warning border-warning/30' },
  no_sale:    { label: 'No Sale',    color: 'bg-muted text-muted-foreground border-border' },
  drop:       { label: 'Drop',       color: 'bg-success/15 text-success border-success/30' },
  pickup:     { label: 'Pickup',     color: 'bg-warning/15 text-warning border-warning/30' },
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
        const meta = TYPE_LABELS[m.movement_type] || { label: m.movement_type, color: 'bg-muted text-muted-foreground' };
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
              <span className={`font-mono font-medium tabular-nums ${positive ? 'text-success' : 'text-warning'}`}>
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
