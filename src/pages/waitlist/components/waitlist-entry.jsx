import { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Clock, Users, Phone } from 'lucide-react';
import { api } from '@/lib/api-client';

function minutesWaiting(addedAt) {
  const diff = Math.floor((Date.now() - new Date(addedAt).getTime()) / 60000);
  return diff;
}

export default function WaitlistEntry({ entry, onRefresh }) {
  const [busy, setBusy] = useState(false);

  const handleSeat = async () => {
    setBusy(true);
    try {
      const { error } = await api.request('POST', `/waitlist/${entry.id}/seat`, { body: {} });
      if (error) throw new Error(error.message);
      if (onRefresh) onRefresh();
    } finally {
      setBusy(false);
    }
  };

  const handleRemove = async (reason) => {
    setBusy(true);
    try {
      const { error } = await api.request('DELETE', `/waitlist/${entry.id}`, { body: { reason } });
      if (error) throw new Error(error.message);
      if (onRefresh) onRefresh();
    } finally {
      setBusy(false);
    }
  };

  const waited = minutesWaiting(entry.added_at);
  const overdue = entry.quoted_wait_minutes && waited > entry.quoted_wait_minutes;

  return (
    <Card className={overdue ? 'border-rose-300' : ''}>
      <CardContent className="p-4 space-y-2">
        {/* Name + wait badge */}
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="font-semibold text-foreground">{entry.customer_name}</p>
            <div className="flex items-center gap-3 text-sm text-muted-foreground mt-0.5">
              <span className="flex items-center gap-1">
                <Users className="h-3.5 w-3.5" />
                {entry.party_size} guests
              </span>
              {entry.customer_phone && (
                <span className="flex items-center gap-1">
                  <Phone className="h-3.5 w-3.5" />
                  {entry.customer_phone}
                </span>
              )}
            </div>
          </div>
          <Badge className={overdue ? 'bg-rose-100 text-rose-800' : 'bg-muted text-foreground'}>
            <Clock className="h-3 w-3 mr-1 inline" />
            {waited}m
          </Badge>
        </div>

        {/* Quoted wait */}
        {entry.quoted_wait_minutes && (
          <p className="text-xs text-muted-foreground">
            Quoted: {entry.quoted_wait_minutes} min
            {overdue && <span className="text-rose-600 font-medium ml-1">(overdue)</span>}
          </p>
        )}

        {/* Notes */}
        {entry.notes && (
          <p className="text-xs text-muted-foreground bg-muted rounded px-2 py-1">{entry.notes}</p>
        )}

        {/* Actions */}
        <div className="flex flex-wrap gap-2 pt-1">
          <Button size="sm" disabled={busy} onClick={handleSeat}>
            Seat Now
          </Button>
          <Button size="sm" variant="outline" disabled={busy} onClick={() => handleRemove('left')}>
            Left
          </Button>
          <Button size="sm" variant="outline" disabled={busy} onClick={() => handleRemove('no_show')}>
            No Show
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
