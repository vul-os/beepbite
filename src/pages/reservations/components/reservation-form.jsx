import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { api } from '@/lib/api-client';

const DEFAULT_FORM = {
  customer_name: '',
  customer_phone: '',
  customer_email: '',
  party_size: 2,
  reservation_at: '',
  duration_minutes: 90,
  special_requests: '',
};

export default function ReservationForm({ open, onClose, onCreated, organizationId, locationId }) {
  const [form, setForm] = useState(DEFAULT_FORM);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const handleChange = (field) => (e) => {
    setForm((prev) => ({ ...prev, [field]: e.target.value }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (!form.customer_name.trim()) { setError('Customer name is required'); return; }
    if (!form.reservation_at) { setError('Reservation date/time is required'); return; }
    if (Number(form.party_size) < 1) { setError('Party size must be at least 1'); return; }

    setBusy(true);
    try {
      const { data, error: apiErr } = await api.request('POST', '/reservations', {
        body: {
          organization_id: organizationId,
          location_id: locationId,
          customer_name: form.customer_name.trim(),
          customer_phone: form.customer_phone || undefined,
          customer_email: form.customer_email || undefined,
          party_size: Number(form.party_size),
          reservation_at: form.reservation_at,
          duration_minutes: Number(form.duration_minutes) || 90,
          special_requests: form.special_requests || undefined,
        },
      });
      if (apiErr) throw new Error(apiErr.message);
      setForm(DEFAULT_FORM);
      if (onCreated) onCreated(data);
      onClose();
    } catch (err) {
      setError(err.message || 'Failed to create reservation');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>New Reservation</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1">
            <Label htmlFor="res-name">Customer Name *</Label>
            <Input
              id="res-name"
              value={form.customer_name}
              onChange={handleChange('customer_name')}
              placeholder="Jane Smith"
              required
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="res-phone">Phone</Label>
              <Input
                id="res-phone"
                value={form.customer_phone}
                onChange={handleChange('customer_phone')}
                placeholder="+1 555 000 0000"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="res-email">Email</Label>
              <Input
                id="res-email"
                type="email"
                value={form.customer_email}
                onChange={handleChange('customer_email')}
                placeholder="jane@example.com"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="res-party">Party Size *</Label>
              <Input
                id="res-party"
                type="number"
                min={1}
                value={form.party_size}
                onChange={handleChange('party_size')}
                required
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="res-duration">Duration (min)</Label>
              <Input
                id="res-duration"
                type="number"
                min={15}
                step={15}
                value={form.duration_minutes}
                onChange={handleChange('duration_minutes')}
              />
            </div>
          </div>

          <div className="space-y-1">
            <Label htmlFor="res-at">Date & Time *</Label>
            <Input
              id="res-at"
              type="datetime-local"
              value={form.reservation_at}
              onChange={handleChange('reservation_at')}
              required
            />
          </div>

          <div className="space-y-1">
            <Label htmlFor="res-requests">Special Requests</Label>
            <Textarea
              id="res-requests"
              value={form.special_requests}
              onChange={handleChange('special_requests')}
              placeholder="Allergies, seating preferences…"
              rows={2}
            />
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? 'Saving…' : 'Create Reservation'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
