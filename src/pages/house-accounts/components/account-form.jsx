import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Plus, Loader2 } from 'lucide-react';

const EMPTY = {
  name: '',
  credit_limit: '',
  net_terms_days: '30',
  contact_name: '',
  contact_email: '',
};

export function AccountFormDialog({ open, onOpenChange, orgId, onCreate }) {
  const [form, setForm] = useState(EMPTY);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState(null);

  function set(field) {
    return (e) => setForm((f) => ({ ...f, [field]: e.target.value }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!form.name.trim()) { setErr('Name is required'); return; }
    setSaving(true);
    setErr(null);
    try {
      const body = {
        org_id: orgId,
        name: form.name.trim(),
        net_terms_days: form.net_terms_days ? parseInt(form.net_terms_days, 10) : undefined,
        credit_limit_cents: form.credit_limit
          ? Math.round(parseFloat(form.credit_limit) * 100)
          : undefined,
        contact_name: form.contact_name.trim() || undefined,
        contact_email: form.contact_email.trim() || undefined,
      };
      await onCreate(body);
      setForm(EMPTY);
      onOpenChange(false);
    } catch (e) {
      setErr(e.message || 'Failed to create account');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Plus className="h-4 w-4" />
            New House Account
          </DialogTitle>
          <DialogDescription>
            Create a corporate billing account for a customer organisation.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 mt-2">
          <div className="space-y-1">
            <Label htmlFor="ha-name">Account name *</Label>
            <Input id="ha-name" value={form.name} onChange={set('name')} placeholder="Acme Corp" required />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="ha-limit">Credit limit ($)</Label>
              <Input
                id="ha-limit"
                type="number"
                min="0"
                step="0.01"
                value={form.credit_limit}
                onChange={set('credit_limit')}
                placeholder="5000.00"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="ha-terms">Net terms (days)</Label>
              <Input
                id="ha-terms"
                type="number"
                min="0"
                value={form.net_terms_days}
                onChange={set('net_terms_days')}
                placeholder="30"
              />
            </div>
          </div>

          <div className="space-y-1">
            <Label htmlFor="ha-contact-name">Primary contact name</Label>
            <Input
              id="ha-contact-name"
              value={form.contact_name}
              onChange={set('contact_name')}
              placeholder="Jane Smith"
            />
          </div>

          <div className="space-y-1">
            <Label htmlFor="ha-contact-email">Primary contact email</Label>
            <Input
              id="ha-contact-email"
              type="email"
              value={form.contact_email}
              onChange={set('contact_email')}
              placeholder="jane@acme.com"
            />
          </div>

          {err && (
            <p className="text-sm text-destructive">{err}</p>
          )}

          <DialogFooter className="gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Plus className="h-4 w-4 mr-2" />}
              Create account
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
