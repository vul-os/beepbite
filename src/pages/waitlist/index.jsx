// /waitlist — live waitlist queue for the active location.
//
// - Auto-refreshes every 30s.
// - Shows active entries sorted by arrival time (oldest first).
// - "Add to Waitlist" form inline at the top.

import { useState, useEffect, useCallback } from 'react';
import { ListOrdered, Plus, RefreshCw, AlertCircle, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAuth } from '@/context/auth-context';
import { api } from '@/lib/api-client';
import WaitlistEntry from './components/waitlist-entry';

const POLL_MS = 30_000;

const DEFAULT_ADD = { customer_name: '', customer_phone: '', party_size: 2, quoted_wait_minutes: '', notes: '' };

export default function WaitlistPage() {
  const { activeLocation } = useAuth();
  const locationId = activeLocation?.id;

  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const [showAdd, setShowAdd] = useState(false);
  const [addForm, setAddForm] = useState(DEFAULT_ADD);
  const [addBusy, setAddBusy] = useState(false);
  const [addError, setAddError] = useState('');

  const load = useCallback(async () => {
    if (!locationId) return;
    setLoading(true);
    setError('');
    try {
      const { data, error: apiErr } = await api.request(
        'GET',
        `/waitlist?location_id=${locationId}`
      );
      if (apiErr) throw new Error(apiErr.message);
      setEntries(Array.isArray(data) ? data : []);
    } catch (e) {
      setError(e.message || 'Failed to load waitlist');
    } finally {
      setLoading(false);
    }
  }, [locationId]);

  // Initial load + poll
  useEffect(() => {
    load();
    const id = setInterval(load, POLL_MS);
    return () => clearInterval(id);
  }, [load]);

  const handleAddChange = (field) => (e) => {
    setAddForm((prev) => ({ ...prev, [field]: e.target.value }));
  };

  const handleAddSubmit = async (e) => {
    e.preventDefault();
    setAddError('');
    if (!addForm.customer_name.trim()) { setAddError('Name required'); return; }
    if (Number(addForm.party_size) < 1) { setAddError('Party size must be at least 1'); return; }

    setAddBusy(true);
    try {
      const { error: apiErr } = await api.request('POST', '/waitlist', {
        body: {
          organization_id: activeLocation?.organization_id,
          location_id: locationId,
          customer_name: addForm.customer_name.trim(),
          customer_phone: addForm.customer_phone || undefined,
          party_size: Number(addForm.party_size),
          quoted_wait_minutes: addForm.quoted_wait_minutes ? Number(addForm.quoted_wait_minutes) : undefined,
          notes: addForm.notes || undefined,
        },
      });
      if (apiErr) throw new Error(apiErr.message);
      setAddForm(DEFAULT_ADD);
      setShowAdd(false);
      load();
    } catch (err) {
      setAddError(err.message || 'Failed to add to waitlist');
    } finally {
      setAddBusy(false);
    }
  };

  if (!activeLocation) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-3">
        <AlertCircle className="h-10 w-10 text-gray-400" />
        <p className="text-gray-600">Select a location to view the waitlist.</p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <ListOrdered className="h-6 w-6 text-purple-500" />
          <h1 className="text-2xl font-bold text-gray-900">Waitlist</h1>
          {entries.length > 0 && (
            <span className="ml-1 text-sm text-gray-500">({entries.length} waiting)</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={load} disabled={loading}>
            <RefreshCw className={`h-4 w-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
          <Button size="sm" onClick={() => setShowAdd((v) => !v)}>
            <Plus className="h-4 w-4 mr-2" />
            Add Guest
          </Button>
        </div>
      </div>

      {/* Add form */}
      {showAdd && (
        <Card>
          <CardContent className="p-4">
            <h2 className="font-semibold text-gray-800 mb-3">Add to Waitlist</h2>
            <form onSubmit={handleAddSubmit} className="space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label htmlFor="wl-name">Name *</Label>
                  <Input
                    id="wl-name"
                    value={addForm.customer_name}
                    onChange={handleAddChange('customer_name')}
                    placeholder="Guest name"
                    required
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="wl-phone">Phone</Label>
                  <Input
                    id="wl-phone"
                    value={addForm.customer_phone}
                    onChange={handleAddChange('customer_phone')}
                    placeholder="+1 555 000 0000"
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="wl-party">Party Size *</Label>
                  <Input
                    id="wl-party"
                    type="number"
                    min={1}
                    value={addForm.party_size}
                    onChange={handleAddChange('party_size')}
                    required
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="wl-wait">Quoted Wait (min)</Label>
                  <Input
                    id="wl-wait"
                    type="number"
                    min={0}
                    value={addForm.quoted_wait_minutes}
                    onChange={handleAddChange('quoted_wait_minutes')}
                    placeholder="e.g. 20"
                  />
                </div>
              </div>
              <div className="space-y-1">
                <Label htmlFor="wl-notes">Notes</Label>
                <Input
                  id="wl-notes"
                  value={addForm.notes}
                  onChange={handleAddChange('notes')}
                  placeholder="High chair needed, etc."
                />
              </div>
              {addError && <p className="text-sm text-rose-600">{addError}</p>}
              <div className="flex gap-2 justify-end">
                <Button type="button" variant="outline" onClick={() => setShowAdd(false)} disabled={addBusy}>
                  Cancel
                </Button>
                <Button type="submit" disabled={addBusy}>
                  {addBusy ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
                  Add to Waitlist
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {/* Error */}
      {error && (
        <div className="flex items-center gap-2 text-sm text-rose-600">
          <AlertCircle className="h-4 w-4 flex-shrink-0" />
          {error}
        </div>
      )}

      {/* Loading */}
      {loading && entries.length === 0 && (
        <Card>
          <CardContent className="p-10 text-center text-gray-500">
            <Loader2 className="h-6 w-6 animate-spin mx-auto mb-2" />
            Loading waitlist…
          </CardContent>
        </Card>
      )}

      {/* Empty */}
      {!loading && !error && entries.length === 0 && (
        <Card>
          <CardContent className="p-10 text-center">
            <ListOrdered className="h-10 w-10 text-gray-300 mx-auto mb-3" />
            <p className="text-gray-600 text-sm">Waitlist is empty.</p>
          </CardContent>
        </Card>
      )}

      {/* Entries */}
      {entries.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {entries.map((entry) => (
            <WaitlistEntry key={entry.id} entry={entry} onRefresh={load} />
          ))}
        </div>
      )}

      <p className="text-xs text-gray-400 text-right">
        Auto-refreshes every {POLL_MS / 1000}s
      </p>
    </div>
  );
}
