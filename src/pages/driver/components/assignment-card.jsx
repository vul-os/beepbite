import React, { useState } from 'react';
import { MapPin, Store, DollarSign, CheckCircle, Package, Truck, XCircle, Loader2 } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

// Map statuses to human-readable labels and badge colours
const STATUS_META = {
  offered:    { label: 'Offered',     colour: 'bg-amber-100 text-amber-800 border-amber-200' },
  accepted:   { label: 'Accepted',    colour: 'bg-blue-100 text-blue-800 border-blue-200' },
  picked_up:  { label: 'Picked up',   colour: 'bg-purple-100 text-purple-800 border-purple-200' },
  delivered:  { label: 'Delivered',   colour: 'bg-green-100 text-green-800 border-green-200' },
  cancelled:  { label: 'Cancelled',   colour: 'bg-gray-100 text-gray-500 border-gray-200' },
};

// Which action button to show for each status
const NEXT_ACTION = {
  offered:   { action: 'accept',  label: 'Accept',     Icon: CheckCircle,  variant: 'default' },
  accepted:  { action: 'pickup',  label: 'Picked up',  Icon: Package,      variant: 'default' },
  picked_up: { action: 'deliver', label: 'Delivered',  Icon: Truck,        variant: 'default' },
};

function formatCurrency(cents) {
  if (cents == null) return '—';
  return `$${(Number(cents) / 100).toFixed(2)}`;
}

export default function AssignmentCard({ assignment, onAction }) {
  const [busy, setBusy] = useState(false);
  const [cancelBusy, setCancelBusy] = useState(false);

  const { status, store_name, customer_address, total_cents, id } = assignment;
  const statusMeta = STATUS_META[status] ?? { label: status, colour: 'bg-gray-100 text-gray-600 border-gray-200' };
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
    <Card className="border border-orange-100 shadow-sm">
      <CardContent className="p-4 space-y-3">
        {/* Header: store name + status badge */}
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <Store className="w-4 h-4 text-orange-500 flex-shrink-0" />
            <span className="font-semibold text-gray-900 text-sm truncate">
              {store_name || 'Restaurant'}
            </span>
          </div>
          <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold flex-shrink-0 ${statusMeta.colour}`}>
            {statusMeta.label}
          </span>
        </div>

        {/* Delivery address */}
        <div className="flex items-start gap-2 text-sm text-gray-600">
          <MapPin className="w-4 h-4 text-orange-400 flex-shrink-0 mt-0.5" />
          <span className="leading-snug">{customer_address || 'Address not provided'}</span>
        </div>

        {/* Order total */}
        <div className="flex items-center gap-2 text-sm text-gray-700">
          <DollarSign className="w-4 h-4 text-orange-400 flex-shrink-0" />
          <span className="font-medium">{formatCurrency(total_cents)}</span>
        </div>

        {/* Action buttons */}
        {next && (
          <div className="flex gap-2 pt-1">
            <Button
              size="sm"
              className="flex-1 bg-orange-500 hover:bg-orange-600 text-white"
              disabled={busy || cancelBusy}
              onClick={() => handleAction(next.action, setBusy)}
            >
              {busy
                ? <Loader2 className="w-4 h-4 animate-spin" />
                : <next.Icon className="w-4 h-4" />
              }
              {next.label}
            </Button>

            {/* Cancel is available on offered + accepted */}
            {(status === 'offered' || status === 'accepted') && (
              <Button
                size="sm"
                variant="outline"
                className="border-red-200 text-red-600 hover:bg-red-50"
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
