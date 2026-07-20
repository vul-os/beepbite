import { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Calendar, Clock, Users, Phone, Mail, ChevronDown, ChevronUp } from 'lucide-react';
import { api } from '@/lib/api-client';
import { RESERVATION_STATUS_COLORS as STATUS_COLORS } from '@/lib/status-colors';

function formatTime(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

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
                {formatTime(reservation.reservation_at)}
              </span>
              <span className="flex items-center gap-1">
                <Users className="h-3.5 w-3.5" />
                {reservation.party_size} guests
              </span>
              {reservation.duration_minutes && (
                <span>{reservation.duration_minutes} min</span>
              )}
            </div>
          </div>
          <Badge className={STATUS_COLORS[status] || 'bg-muted text-foreground'}>
            {status.replace('_', ' ')}
          </Badge>
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
            <Button size="sm" disabled={busy} onClick={() => act('seat')}>
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
