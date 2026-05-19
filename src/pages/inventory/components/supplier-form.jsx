import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

const EMPTY = {
  name: '',
  display_name: '',
  payment_terms_days: 30,
  website: '',
  notes: '',
  is_active: true,
  // Contact fields — stored via supplier_contacts.  We capture once here and
  // write to the contacts table on the server (handled by caller).
  contact_name: '',
  email: '',
  phone: '',
  // address: free-form JSON-serialisable object
  address_street: '',
  address_city: '',
  address_country: '',
};

function toPayload(form) {
  const address = {};
  if (form.address_street) address.street = form.address_street;
  if (form.address_city) address.city = form.address_city;
  if (form.address_country) address.country = form.address_country;

  return {
    name: form.name.trim(),
    display_name: form.display_name.trim() || null,
    payment_terms_days: Number(form.payment_terms_days) || 30,
    website: form.website.trim() || null,
    notes: form.notes.trim() || null,
    is_active: form.is_active,
    // address stored as JSON in notes or separate column — schema has no address
    // column directly on suppliers, so we fold it into the notes blob for now.
    // If the BE adds an address column this mapping should change.
    _contact: {
      name: form.contact_name.trim() || null,
      email: form.email.trim() || null,
      phone: form.phone.trim() || null,
    },
    _address: Object.keys(address).length ? address : null,
  };
}

export function SupplierForm({ initial, onSubmit, onCancel, saving }) {
  const [form, setForm] = useState({ ...EMPTY, ...flattenInitial(initial) });
  const [err, setErr] = useState('');

  function flattenInitial(sup) {
    if (!sup) return {};
    const pc = sup.primaryContact || null;
    return {
      name: sup.name || '',
      display_name: sup.display_name || '',
      payment_terms_days: sup.payment_terms_days ?? 30,
      website: sup.website || '',
      notes: sup.notes || '',
      is_active: sup.is_active ?? true,
      // Prefill contact fields from the primary supplier_contacts row (if any).
      contact_name: pc?.name || '',
      email: pc?.email || '',
      phone: pc?.phone || '',
      address_street: '',
      address_city: '',
      address_country: '',
    };
  }

  function set(field, value) {
    setForm((p) => ({ ...p, [field]: value }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!form.name.trim()) { setErr('Name is required'); return; }
    setErr('');
    await onSubmit(toPayload(form));
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {err && <p className="text-sm text-red-600">{err}</p>}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="space-y-1">
          <Label htmlFor="name">Name <span className="text-red-500">*</span></Label>
          <Input id="name" value={form.name} onChange={(e) => set('name', e.target.value)} required />
        </div>
        <div className="space-y-1">
          <Label htmlFor="display_name">Display Name</Label>
          <Input id="display_name" value={form.display_name} onChange={(e) => set('display_name', e.target.value)} />
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="space-y-1">
          <Label htmlFor="contact_name">Contact Name</Label>
          <Input id="contact_name" value={form.contact_name} onChange={(e) => set('contact_name', e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="email">Email</Label>
          <Input id="email" type="email" value={form.email} onChange={(e) => set('email', e.target.value)} />
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="space-y-1">
          <Label htmlFor="phone">Phone</Label>
          <Input id="phone" type="tel" value={form.phone} onChange={(e) => set('phone', e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="payment_terms_days">Payment Terms (days)</Label>
          <Input id="payment_terms_days" type="number" min={0} value={form.payment_terms_days} onChange={(e) => set('payment_terms_days', e.target.value)} />
        </div>
      </div>

      <div className="space-y-1">
        <Label>Address</Label>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          <Input placeholder="Street" value={form.address_street} onChange={(e) => set('address_street', e.target.value)} />
          <Input placeholder="City" value={form.address_city} onChange={(e) => set('address_city', e.target.value)} />
          <Input placeholder="Country" value={form.address_country} onChange={(e) => set('address_country', e.target.value)} />
        </div>
      </div>

      <div className="space-y-1">
        <Label htmlFor="website">Website</Label>
        <Input id="website" type="url" placeholder="https://" value={form.website} onChange={(e) => set('website', e.target.value)} />
      </div>

      <div className="space-y-1">
        <Label htmlFor="notes">Notes</Label>
        <Textarea id="notes" rows={3} value={form.notes} onChange={(e) => set('notes', e.target.value)} />
      </div>

      <div className="flex items-center gap-2">
        <input
          id="is_active"
          type="checkbox"
          checked={form.is_active}
          onChange={(e) => set('is_active', e.target.checked)}
          className="w-4 h-4"
        />
        <Label htmlFor="is_active">Active</Label>
      </div>

      <div className="flex gap-3 pt-2">
        <Button type="button" variant="outline" onClick={onCancel} className="flex-1" disabled={saving}>
          Cancel
        </Button>
        <Button type="submit" className="flex-1 bg-orange-500 hover:bg-orange-600 text-white" disabled={saving}>
          {saving ? 'Saving…' : initial ? 'Update Supplier' : 'Create Supplier'}
        </Button>
      </div>
    </form>
  );
}
