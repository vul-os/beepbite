import { useState } from 'react';
import { MapPin, Store, DollarSign, CheckCircle, Package, Truck, XCircle, Loader2 } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useMoney } from '@/context/locale-context';

// Map statuses to human-readable labels and badge colours. `offered` uses the
// warning tone (needs the driver's attention, still reversible); `delivered`
// uses success; the two in-between working states share the primary tone
// rather than borrowing a fourth arbitrary hue — they're both just "this is
// in motion", not signals a driver needs to act differently on.
const STATUS_META = {
  offered:    { label: 'Offered',     colour: 'bg-warning/15 text-warning border-warning/30' },
  accepted:   { label: 'Accepted',    colour: 'bg-primary/10 text-primary border-primary/25' },
  picked_up:  { label: 'Picked up',   colour: 'bg-primary/15 text-primary border-primary/30' },
  delivered:  { label: 'Delivered',   colour: 'bg-success/15 text-success border-success/30' },
  cancelled:  { label: 'Cancelled',   colour: 'bg-muted text-muted-foreground border-border' },
};

// Which action button to show for each status
const NEXT_ACTION = {
  offered:   { action: 'accept',  label: 'Accept',     Icon: CheckCircle,  variant: 'default' },
  accepted:  { action: 'pickup',  label: 'Picked up',  Icon: Package,      variant: 'default' },
  picked_up: { action: 'deliver', label: 'Delivered',  Icon: Truck,        variant: 'default' },
};

export default function AssignmentCard({ assignment, onAction }) {
  const { format: formatMoneyValue } = useMoney();
  const formatCurrency = (cents) => (cents == null ? '—' : formatMoneyValue(cents));
  const [busy, setBusy] = useState(false);
  const [cancelBusy, setCancelBusy] = useState(false);

  const { status, store_name, customer_address, total_cents, id } = assignment;
  const statusMeta = STATUS_META[status] ?? { label: status, colour: 'bg-muted text-muted-foreground border-border' };
  const next = NEXT_ACTION[status];

  async function handleAction(action, setBusyFn) {
    setBusyFn(true);
    try {
      await onAction(id, action);
    } finally {
      setBusyFn(false);
    }
  }

  return (
    <Card className="border-border/70 shadow-sm">
      <CardContent className="p-4 space-y-3">
        {/* Header: store name + status badge */}
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <Store className="w-4 h-4 text-primary flex-shrink-0" />
            <span className="font-semibold text-foreground text-sm truncate">
              {store_name || 'Restaurant'}
            </span>
          </div>
          <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold flex-shrink-0 ${statusMeta.colour}`}>
            {statusMeta.label}
          </span>
        </div>

        {/* Delivery address */}
        <div className="flex items-start gap-2 text-sm text-muted-foreground">
          <MapPin className="w-4 h-4 text-primary/60 flex-shrink-0 mt-0.5" />
          <span className="leading-snug">{customer_address || 'Address not provided'}</span>
        </div>

        {/* Order total */}
        <div className="flex items-center gap-2 text-sm text-foreground/90">
          <DollarSign className="w-4 h-4 text-primary/60 flex-shrink-0" />
          <span className="font-medium tabular-nums">{formatCurrency(total_cents)}</span>
        </div>

        {/* Action buttons */}
        {next && (
          <div className="flex gap-2 pt-1">
            <Button
              size="sm"
              disabled={busy || cancelBusy}
              onClick={() => handleAction(next.action, setBusy)}
              className="flex-1"
            >
              {busy
                ? <Loader2 className="w-4 h-4 animate-spin" />
                : <next.Icon className="w-4 h-4" />
              }
              {next.label}
            </Button>

            {/* Cancel is available on offered + accepted — reversible at this
                stage (nothing picked up yet), so it stays an outline button
                in the destructive hue rather than the irreversible-void
                treatment reserved for post-pickup cancellations. */}
            {(status === 'offered' || status === 'accepted') && (
              <Button
                size="sm"
                variant="outline"
                className="border-destructive/30 text-destructive hover:bg-destructive/10"
                disabled={busy || cancelBusy}
                onClick={() => handleAction('cancel', setCancelBusy)}
              >
                {cancelBusy
                  ? <Loader2 className="w-4 h-4 animate-spin" />
                  : <XCircle className="w-4 h-4" />
                }
                Cancel
              </Button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
