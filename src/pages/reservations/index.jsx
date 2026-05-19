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
import { api } from '@/lib/api-client';
import ReservationCard from './components/reservation-card';
import ReservationForm from './components/reservation-form';

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

export default function ReservationsPage() {
  const { activeLocation } = useAuth();
  const locationId = activeLocation?.id;

  const [date, setDate] = useState(todayISO());
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
        <AlertCircle className="h-10 w-10 text-gray-400" />
        <p className="text-gray-600">Select a location to view reservations.</p>
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
    <div className="space-y-5">
      {/* Page header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <CalendarDays className="h-6 w-6 text-indigo-500" />
          <h1 className="text-2xl font-bold text-gray-900">Reservations</h1>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={load} disabled={loading}>
            <RefreshCw className={`h-4 w-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
          <Button size="sm" onClick={() => setShowForm(true)}>
            <Plus className="h-4 w-4 mr-2" />
            New Reservation
          </Button>
        </div>
      </div>

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
        <div className="flex items-center gap-2 text-sm text-rose-600">
          <AlertCircle className="h-4 w-4 flex-shrink-0" />
          {error}
        </div>
      )}

      {/* Loading */}
      {loading && reservations.length === 0 && (
        <Card>
          <CardContent className="p-10 text-center text-gray-500">Loading…</CardContent>
        </Card>
      )}

      {/* Empty */}
      {!loading && !error && reservations.length === 0 && (
        <Card>
          <CardContent className="p-10 text-center">
            <CalendarDays className="h-10 w-10 text-gray-300 mx-auto mb-3" />
            <p className="text-gray-600 text-sm">No reservations for this date.</p>
          </CardContent>
        </Card>
      )}

      {/* Groups */}
      {!error && reservations.length > 0 && (
        <div className="space-y-6">
          {[
            { label: 'Pending', key: 'pending', color: 'text-amber-700' },
            { label: 'Confirmed', key: 'confirmed', color: 'text-blue-700' },
            { label: 'Seated', key: 'seated', color: 'text-emerald-700' },
            { label: 'Past / Cancelled', key: 'other', color: 'text-gray-500' },
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
    </div>
  );
}
