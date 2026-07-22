import { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Clock, Users, Phone, Mail, ChevronDown, ChevronUp, AlertTriangle } from 'lucide-react';
import { api } from '@/lib/api-client';

function formatTime(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

// Status → Ticket Rail token map, local to this card rather than the shared
// lib/status-colors.js (that file is consumed by several other in-flight
// pages outside this slice). "Confirmed" and "seated" are deliberately both
// success-family so a host reads "this guest will/does have a table" at a
// glance, but seated is the solid/definitive form ("they're here now") while
// confirmed is a soft tint ("booked, not arrived yet") so the two states
// stay visually distinguishable next to each other.
const STATUS_STYLES = {
  pending:   'bg-warning/15 text-warning border-warning/30',
  confirmed: 'bg-primary/10 text-primary border-primary/25',
  seated:    'bg-success text-success-foreground border-transparent',
  completed: 'bg-muted text-muted-foreground border-transparent',
  cancelled: 'bg-destructive/10 text-destructive border-destructive/30',
  no_show:   'bg-destructive/10 text-destructive border-destructive/30',
};

// A confirmed/pending reservation whose time has passed is a no-show risk —
// reversible (they may still walk in), so it gets the warning signal, never
// the destructive one.
const LATE_THRESHOLD_MIN = 15;

export default function ReservationCard({ reservation, onRefresh }) {
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const act = async (path) => {
    setBusy(true);
    try {
      const { error } = await api.request('POST', `/reservations/${reservation.id}/${path}`, { body: {} });
      if (error) throw new Error(error.message);
      if (onRefresh) onRefresh();
    } finally {
      setBusy(false);
    }
  };

  const { status } = reservation;
  const canConfirm = status === 'pending';
  const canSeat    = status === 'confirmed' || status === 'pending';
  const canCancel  = status !== 'cancelled' && status !== 'completed' && status !== 'seated';

  const minutesPast = reservation.reservation_at
    ? Math.floor((Date.now() - new Date(reservation.reservation_at).getTime()) / 60000)
    : null;
  const isRunningLate =
    (status === 'pending' || status === 'confirmed') &&
    minutesPast !== null &&
    minutesPast > LATE_THRESHOLD_MIN;

  return (
    <Card className="hover:shadow-md transition-shadow">
      <CardContent className="p-4 space-y-3">
        {/* Header row */}
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="font-semibold text-foreground">{reservation.customer_name}</p>
            <div className="flex items-center gap-3 text-sm text-muted-foreground mt-0.5">
              <span className="flex items-center gap-1">
                <Clock className="h-3.5 w-3.5" />
                <span className="tabular-nums">{formatTime(reservation.reservation_at)}</span>
              </span>
              <span className="flex items-center gap-1">
                <Users className="h-3.5 w-3.5" />
                <span className="tabular-nums">{reservation.party_size}</span> guests
              </span>
              {reservation.duration_minutes && (
                <span className="tabular-nums">{reservation.duration_minutes} min</span>
              )}
            </div>
          </div>
          <div className="flex flex-col items-end gap-1">
            <Badge className={STATUS_STYLES[status] || 'bg-muted text-muted-foreground border-transparent'}>
              {status.replace('_', ' ')}
            </Badge>
            {isRunningLate && (
              <Badge className="bg-warning/15 text-warning border-warning/30">
                <AlertTriangle className="h-3 w-3" />
                Running late
              </Badge>
            )}
          </div>
        </div>

        {/* Contact info */}
        <div className="flex flex-wrap gap-3 text-sm text-muted-foreground">
          {reservation.customer_phone && (
            <span className="flex items-center gap-1">
              <Phone className="h-3.5 w-3.5" />
              {reservation.customer_phone}
            </span>
          )}
          {reservation.customer_email && (
            <span className="flex items-center gap-1">
              <Mail className="h-3.5 w-3.5" />
              {reservation.customer_email}
            </span>
          )}
        </div>

        {/* Expandable details */}
        {(reservation.special_requests || reservation.table_id) && (
          <button
            onClick={() => setExpanded((e) => !e)}
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
            {expanded ? 'Less' : 'Details'}
          </button>
        )}
        {expanded && (
          <div className="text-sm text-muted-foreground space-y-1 bg-muted rounded-md p-2">
            {reservation.special_requests && (
              <p><span className="font-medium">Requests:</span> {reservation.special_requests}</p>
            )}
            {reservation.table_id && (
              <p><span className="font-medium">Table ID:</span> {reservation.table_id}</p>
            )}
          </div>
        )}

        {/* Actions */}
        <div className="flex flex-wrap gap-2 pt-1">
          {canConfirm && (
            <Button size="sm" variant="outline" disabled={busy} onClick={() => act('confirm')}>
              Confirm
            </Button>
          )}
          {canSeat && (
            <Button size="sm" variant="success" disabled={busy} onClick={() => act('seat')}>
              Seat
            </Button>
          )}
          {canCancel && (
            <Button size="sm" variant="destructive" disabled={busy} onClick={() => act('cancel')}>
              Cancel
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
