// /reservations — calendar/list view of reservations by date.
//
// - Date picker to navigate days.
// - Optional section filter.
// - Reservation cards with inline confirm / seat / cancel actions.
// - "New Reservation" button opens a create form.

import { useState, useEffect, useCallback } from 'react';
import { CalendarDays, Plus, RefreshCw, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAuth } from '@/context/auth-context';
import { useDateTime } from '@/context/locale-context';
import { api } from '@/lib/api-client';
import ReservationCard from './components/reservation-card';
import ReservationForm from './components/reservation-form';
import { PageContainer, PageHeader } from '@/components/ui/page-header';

export default function ReservationsPage() {
  const { activeLocation } = useAuth();
  const { today } = useDateTime();
  const locationId = activeLocation?.id;

  // The store's local trading date, not `new Date().toISOString().slice(0, 10)`
  // (the UTC date — wrong for most of the day in most timezones).
  const [date, setDate] = useState(today());
  const [reservations, setReservations] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showForm, setShowForm] = useState(false);

  const load = useCallback(async () => {
    if (!locationId || !date) return;
    setLoading(true);
    setError('');
    try {
      const { data, error: apiErr } = await api.request(
        'GET',
        `/reservations?location_id=${locationId}&date=${date}`
      );
      if (apiErr) throw new Error(apiErr.message);
      setReservations(Array.isArray(data) ? data : []);
    } catch (e) {
      setError(e.message || 'Failed to load reservations');
    } finally {
      setLoading(false);
    }
  }, [locationId, date]);

  useEffect(() => { load(); }, [load]);

  if (!activeLocation) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-3">
        <AlertCircle className="h-10 w-10 text-muted-foreground" />
        <p className="text-muted-foreground">Select a location to view reservations.</p>
      </div>
    );
  }

  const grouped = {
    pending:   reservations.filter((r) => r.status === 'pending'),
    confirmed: reservations.filter((r) => r.status === 'confirmed'),
    seated:    reservations.filter((r) => r.status === 'seated'),
    other:     reservations.filter((r) => ['completed', 'cancelled', 'no_show'].includes(r.status)),
  };

  return (
    <PageContainer>
      <PageHeader
        icon={CalendarDays}
        title="Reservations"
        actions={
          <>
            <Button variant="outline" size="sm" onClick={load} disabled={loading}>
              <RefreshCw className={`h-4 w-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
              Refresh
            </Button>
            <Button size="sm" onClick={() => setShowForm(true)}>
              <Plus className="h-4 w-4 mr-2" />
              New Reservation
            </Button>
          </>
        }
      />

      {/* Date picker */}
      <div className="flex items-center gap-3 max-w-xs">
        <Label htmlFor="res-date">Date</Label>
        <Input
          id="res-date"
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="w-40"
        />
      </div>

      {/* Error */}
      {error && (
        <div className="flex items-center gap-2 text-sm text-destructive">
          <AlertCircle className="h-4 w-4 flex-shrink-0" />
          {error}
        </div>
      )}

      {/* Loading */}
      {loading && reservations.length === 0 && (
        <Card>
          <CardContent className="p-10 text-center text-muted-foreground">Loading…</CardContent>
        </Card>
      )}

      {/* Empty */}
      {!loading && !error && reservations.length === 0 && (
        <Card>
          <CardContent className="p-10 text-center">
            <CalendarDays className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
            <p className="text-muted-foreground text-sm">No reservations for this date.</p>
          </CardContent>
        </Card>
      )}

      {/* Groups */}
      {!error && reservations.length > 0 && (
        <div className="space-y-6">
          {[
            { label: 'Pending', key: 'pending', color: 'text-warning' },
            { label: 'Confirmed', key: 'confirmed', color: 'text-primary' },
            { label: 'Seated', key: 'seated', color: 'text-success' },
            { label: 'Past / Cancelled', key: 'other', color: 'text-muted-foreground' },
          ].map(({ label, key, color }) =>
            grouped[key].length > 0 ? (
              <section key={key}>
                <h2 className={`text-sm font-semibold uppercase tracking-wide mb-2 ${color}`}>
                  {label} ({grouped[key].length})
                </h2>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {grouped[key].map((r) => (
                    <ReservationCard key={r.id} reservation={r} onRefresh={load} />
                  ))}
                </div>
              </section>
            ) : null
          )}
        </div>
      )}

      {/* New reservation dialog */}
      <ReservationForm
        open={showForm}
        onClose={() => setShowForm(false)}
        onCreated={load}
        organizationId={activeLocation?.organization_id}
        locationId={locationId}
      />
    </PageContainer>
  );
}
