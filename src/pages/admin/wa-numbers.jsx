import React, { useState, useEffect, useCallback } from 'react';
import {
  Phone,
  Plus,
  Loader2,
  AlertTriangle,
  RefreshCw,
  Pencil,
  PowerOff,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';

import {
  listWANumbers,
  createWANumber,
  updateWANumber,
  deactivateWANumber,
} from '@/services/wanumbers.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function ActiveBadge({ active }) {
  return active ? (
    <Badge className="bg-green-100 text-green-800 border-green-200 hover:bg-green-100">Active</Badge>
  ) : (
    <Badge variant="secondary" className="bg-gray-100 text-gray-600 border-gray-200 hover:bg-gray-100">Inactive</Badge>
  );
}

// ---------------------------------------------------------------------------
// Create / Edit Dialog
// ---------------------------------------------------------------------------

const EMPTY_FORM = { meta_phone_number_id: '', display_phone: '', country: '', regions: '' };

function NumberFormDialog({ open, onOpenChange, existing, onSuccess }) {
  const isEdit = Boolean(existing);
  const [form, setForm] = useState(EMPTY_FORM);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // Populate form when editing
  useEffect(() => {
    if (open) {
      if (existing) {
        setForm({
          meta_phone_number_id: existing.meta_phone_number_id,
          display_phone: existing.display_phone,
          country: existing.country,
          regions: (existing.regions || []).join(', '),
        });
      } else {
        setForm(EMPTY_FORM);
      }
      setError(null);
    }
  }, [open, existing]);

  function handleChange(e) {
    setForm((f) => ({ ...f, [e.target.name]: e.target.value }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!form.display_phone.trim()) { setError('Display phone is required.'); return; }
    if (!form.country.trim()) { setError('Country is required.'); return; }

    const regions = form.regions
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

    setLoading(true);
    setError(null);

    let result;
    if (isEdit) {
      result = await updateWANumber(existing.id, {
        display_phone: form.display_phone.trim(),
        country: form.country.trim().toUpperCase(),
        regions,
      });
    } else {
      if (!form.meta_phone_number_id.trim()) { setLoading(false); setError('Meta phone number ID is required.'); return; }
      result = await createWANumber({
        meta_phone_number_id: form.meta_phone_number_id.trim(),
        display_phone: form.display_phone.trim(),
        country: form.country.trim().toUpperCase(),
        regions,
      });
    }

    setLoading(false);
    if (result.error) {
      setError(result.error.message || 'An error occurred.');
      return;
    }
    onOpenChange(false);
    onSuccess?.();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Phone className="h-4 w-4 text-orange-500" />
            {isEdit ? 'Edit WhatsApp Number' : 'Register WhatsApp Number'}
          </DialogTitle>
          <DialogDescription>
            {isEdit
              ? 'Update the display details for this number.'
              : 'Register a new Meta Business API phone number.'}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 py-2">
          {/* Meta Phone Number ID — only for create */}
          {!isEdit && (
            <div className="space-y-1.5">
              <Label htmlFor="meta_phone_number_id">Meta Phone Number ID</Label>
              <Input
                id="meta_phone_number_id"
                name="meta_phone_number_id"
                placeholder="e.g. 123456789012345"
                value={form.meta_phone_number_id}
                onChange={handleChange}
              />
              <p className="text-xs text-muted-foreground">
                The phone_number_id from the Meta Business API / webhook payload.
              </p>
            </div>
          )}

          {/* Display Phone */}
          <div className="space-y-1.5">
            <Label htmlFor="display_phone">Display Phone</Label>
            <Input
              id="display_phone"
              name="display_phone"
              placeholder="e.g. +27 82 123 4567"
              value={form.display_phone}
              onChange={handleChange}
            />
          </div>

          {/* Country */}
          <div className="space-y-1.5">
            <Label htmlFor="country">Country (ISO 3166-1 alpha-2)</Label>
            <Input
              id="country"
              name="country"
              placeholder="e.g. ZA"
              maxLength={2}
              value={form.country}
              onChange={handleChange}
            />
          </div>

          {/* Regions */}
          <div className="space-y-1.5">
            <Label htmlFor="regions">Regions (comma-separated, optional)</Label>
            <Input
              id="regions"
              name="regions"
              placeholder="e.g. gauteng, western-cape"
              value={form.regions}
              onChange={handleChange}
            />
          </div>

          {error && (
            <p className="text-sm text-destructive flex items-center gap-1.5">
              <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0" />
              {error}
            </p>
          )}

          <DialogFooter className="gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={loading}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={loading}
              className="bg-orange-500 hover:bg-orange-600 text-white"
            >
              {loading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {isEdit ? 'Save Changes' : 'Register Number'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Deactivate Confirm Dialog
// ---------------------------------------------------------------------------

function DeactivateDialog({ open, onOpenChange, number, onSuccess }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  async function handleConfirm() {
    setLoading(true);
    setError(null);
    const { error: apiErr } = await deactivateWANumber(number.id);
    setLoading(false);
    if (apiErr) { setError(apiErr.message || 'Failed to deactivate number.'); return; }
    onOpenChange(false);
    onSuccess?.();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Deactivate this number?</DialogTitle>
          <DialogDescription>
            <strong>{number?.display_phone}</strong> will be marked inactive and
            excluded from outbound routing. This is a soft-delete — the row is
            retained for history.
          </DialogDescription>
        </DialogHeader>
        {error && (
          <p className="text-sm text-destructive px-1">{error}</p>
        )}
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={handleConfirm} disabled={loading}>
            {loading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Deactivate
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Main Page
// ---------------------------------------------------------------------------

export default function WANumbersPage() {
  const [numbers, setNumbers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showInactive, setShowInactive] = useState(false);

  const [createOpen, setCreateOpen] = useState(false);
  const [editTarget, setEditTarget] = useState(null); // NumberRow | null
  const [deactivateTarget, setDeactivateTarget] = useState(null); // NumberRow | null

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data, error: apiErr } = await listWANumbers({ activeOnly: !showInactive });
    setLoading(false);
    if (apiErr) { setError(apiErr.message || 'Failed to load numbers.'); return; }
    setNumbers(Array.isArray(data) ? data : []);
  }, [showInactive]);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="max-w-5xl mx-auto px-4 py-6 space-y-6">
      {/* Page Header */}
      <div className="flex items-center justify-between gap-3 border-b border-border pb-5 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl bg-orange-500 flex items-center justify-center shadow-sm">
            <Phone className="h-5 w-5 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-foreground">
              WhatsApp Numbers
            </h1>
            <p className="text-sm text-muted-foreground">
              Manage Meta Business API phone numbers and routing.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowInactive((v) => !v)}
            className="gap-1 text-xs"
          >
            {showInactive ? 'Hide inactive' : 'Show inactive'}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={load}
            className="gap-1"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Refresh
          </Button>
          <Button
            size="sm"
            onClick={() => setCreateOpen(true)}
            className="gap-1 bg-orange-500 hover:bg-orange-600 text-white"
          >
            <Plus className="h-4 w-4" />
            Register Number
          </Button>
        </div>
      </div>

      {/* Table Card */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Registered Numbers</CardTitle>
          {!loading && !error && (
            <CardDescription>
              {numbers.length} number{numbers.length !== 1 ? 's' : ''}{' '}
              {showInactive ? '(all)' : '(active only)'}
            </CardDescription>
          )}
        </CardHeader>

        <CardContent className="p-0">
          {/* Loading */}
          {loading && (
            <div className="flex items-center justify-center gap-2 py-16 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin text-orange-500" />
              <span className="text-sm">Loading numbers…</span>
            </div>
          )}

          {/* Error */}
          {!loading && error && (
            <div className="p-4 m-4 rounded-lg border border-destructive/30 bg-destructive/5 flex items-start gap-3">
              <AlertTriangle className="h-4 w-4 text-destructive mt-0.5 flex-shrink-0" />
              <div>
                <p className="text-sm font-medium text-destructive">Error loading numbers</p>
                <p className="text-xs text-destructive/80 mt-0.5">{error}</p>
              </div>
            </div>
          )}

          {/* Empty */}
          {!loading && !error && numbers.length === 0 && (
            <div className="flex flex-col items-center justify-center py-16 text-muted-foreground gap-2">
              <Phone className="h-8 w-8 opacity-30" />
              <p className="text-sm">No WhatsApp numbers registered yet.</p>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setCreateOpen(true)}
                className="mt-2 gap-1"
              >
                <Plus className="h-4 w-4" />
                Register first number
              </Button>
            </div>
          )}

          {/* Results Table */}
          {!loading && !error && numbers.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Display Phone</TableHead>
                  <TableHead>Meta ID</TableHead>
                  <TableHead>Country</TableHead>
                  <TableHead>Regions</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Configured</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {numbers.map((n) => (
                  <TableRow key={n.id} className={!n.active ? 'opacity-50' : ''}>
                    <TableCell className="font-medium">{n.display_phone}</TableCell>
                    <TableCell>
                      <span className="font-mono text-xs bg-muted px-1.5 py-0.5 rounded">
                        {n.meta_phone_number_id}
                      </span>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-xs uppercase">
                        {n.country}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground text-xs">
                      {(n.regions || []).length > 0
                        ? n.regions.join(', ')
                        : <span className="italic">—</span>}
                    </TableCell>
                    <TableCell>
                      <ActiveBadge active={n.active} />
                    </TableCell>
                    <TableCell className="text-muted-foreground text-xs">
                      {formatDate(n.configured_at)}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-muted-foreground hover:text-foreground"
                          title="Edit"
                          onClick={() => setEditTarget(n)}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        {n.active && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-muted-foreground hover:text-destructive"
                            title="Deactivate"
                            onClick={() => setDeactivateTarget(n)}
                          >
                            <PowerOff className="h-3.5 w-3.5" />
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Create Dialog */}
      <NumberFormDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        existing={null}
        onSuccess={load}
      />

      {/* Edit Dialog */}
      <NumberFormDialog
        open={Boolean(editTarget)}
        onOpenChange={(v) => { if (!v) setEditTarget(null); }}
        existing={editTarget}
        onSuccess={load}
      />

      {/* Deactivate Confirm Dialog */}
      {deactivateTarget && (
        <DeactivateDialog
          open={Boolean(deactivateTarget)}
          onOpenChange={(v) => { if (!v) setDeactivateTarget(null); }}
          number={deactivateTarget}
          onSuccess={load}
        />
      )}
    </div>
  );
}
