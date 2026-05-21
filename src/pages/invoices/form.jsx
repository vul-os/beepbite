/**
 * Invoice create / edit form — Wave 34 / Now-26.
 *
 * Used for both creating a new invoice (/invoices/new) and editing
 * an existing draft (/invoices/:id/edit).
 *
 * Routes (wire externally in routes.jsx):
 *   /invoices/new        — create
 *   /invoices/:id/edit   — edit draft
 */

import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  ArrowLeft,
  Loader2,
  Plus,
  Trash2,
  Save,
  AlertCircle,
} from 'lucide-react';
import { getInvoice, createInvoice, updateInvoice } from '@/services/invoicing';

// ── Constants ─────────────────────────────────────────────────────────────────

const CURRENCIES = ['ZAR', 'USD', 'EUR', 'GBP', 'KES', 'NGN', 'GHS'];

const EMPTY_LINE = { description: '', qty: 1, unit_cents: 0 };

const EMPTY_FORM = {
  issuer:            'tenant',
  recipient_name:    '',
  recipient_address: '',
  currency:          'ZAR',
  vat_rate_pct:      0,
  lines:             [{ ...EMPTY_LINE }],
};

// ── Helpers ──────────────────────────────────────────────────────────────────

function centsFromInput(val) {
  const n = parseFloat(val);
  if (isNaN(n)) return 0;
  return Math.round(n * 100);
}

function inputFromCents(cents) {
  if (!cents) return '';
  return (cents / 100).toFixed(2);
}

function subtotal(lines) {
  return lines.reduce((acc, l) => acc + l.qty * l.unit_cents, 0);
}

function fmtCents(cents, currency) {
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: currency || 'ZAR',
    minimumFractionDigits: 2,
  }).format(cents / 100);
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function InvoiceFormPage() {
  const { id } = useParams(); // undefined on /invoices/new
  const navigate = useNavigate();
  const isEdit = !!id;

  const [form, setForm] = useState(EMPTY_FORM);
  const [loading, setLoading] = useState(isEdit);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  // ── Load existing invoice (edit mode) ────────────────────────────────────

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    const { data, error: err } = await getInvoice(id);
    if (err) {
      setError(err.message || 'Failed to load invoice.');
    } else if (data) {
      const existingLines = data.lines;
      setForm({
        issuer:            data.issuer            ?? 'tenant',
        recipient_name:    data.recipient_name    ?? '',
        recipient_address: data.recipient_address ?? '',
        currency:          data.currency          ?? 'ZAR',
        vat_rate_pct:      data.vat_rate_percent  ?? 0,
        lines: (existingLines && existingLines.length > 0)
          ? existingLines.map((l) => ({
              description: l.description,
              qty:         l.qty,
              unit_cents:  l.unit_cents,
            }))
          : [{ ...EMPTY_LINE }],
      });
    }
    setLoading(false);
  }, [id]);

  useEffect(() => { if (isEdit) load(); }, [isEdit, load]);

  // ── Field helpers ─────────────────────────────────────────────────────────

  function setField(name, value) {
    setForm((prev) => ({ ...prev, [name]: value }));
    setError(null);
  }

  function setLine(idx, field, value) {
    setForm((prev) => {
      const lines = [...prev.lines];
      lines[idx] = { ...lines[idx], [field]: value };
      return { ...prev, lines };
    });
  }

  function addLine() {
    setForm((prev) => ({ ...prev, lines: [...prev.lines, { ...EMPTY_LINE }] }));
  }

  function removeLine(idx) {
    setForm((prev) => ({
      ...prev,
      lines: prev.lines.filter((_, i) => i !== idx),
    }));
  }

  // ── Save ──────────────────────────────────────────────────────────────────

  async function handleSave(e) {
    e.preventDefault();
    if (form.lines.length === 0) {
      setError('Add at least one line item.');
      return;
    }
    setSaving(true);
    setError(null);

    const { lines, vat_rate_pct, ...rest } = form;
    const body = {
      ...rest,
      lines,
      vat_rate_pct: parseFloat(vat_rate_pct) || 0,
    };

    let result;
    if (isEdit) {
      result = await updateInvoice(id, body);
    } else {
      result = await createInvoice(body);
    }

    if (result.error) {
      setError(result.error.message || 'Failed to save invoice.');
      setSaving(false);
      return;
    }
    // Navigate to the detail page on success.
    navigate(`/invoices/${result.data.id}`);
  }

  // ── Computed ──────────────────────────────────────────────────────────────

  const sub = subtotal(form.lines);
  const vatCents = form.vat_rate_pct > 0
    ? Math.round(sub * parseFloat(form.vat_rate_pct) / 100)
    : 0;
  const totalCents = sub + vatCents;
  const currency = form.currency || 'ZAR';

  // ── Render ────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex items-center justify-center h-48">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-6 space-y-6">
      {/* Back + title */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => navigate('/invoices')}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <h1 className="text-xl font-semibold">
          {isEdit ? 'Edit invoice' : 'New invoice'}
        </h1>
      </div>

      {/* Error */}
      {error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <form onSubmit={handleSave} className="space-y-6">
        {/* Header fields */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Invoice details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Issuer */}
            <div className="space-y-1">
              <Label>Issuer</Label>
              <Select
                value={form.issuer}
                onValueChange={(v) => setField('issuer', v)}
                disabled={isEdit}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="tenant">My business (tenant)</SelectItem>
                  <SelectItem value="platform">BeepBite platform</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Choose "My business" to invoice your customers. VAT is applied
                automatically if your VAT number is set in Business Info.
              </p>
            </div>

            {/* Currency */}
            <div className="space-y-1">
              <Label>Currency</Label>
              <Select
                value={form.currency}
                onValueChange={(v) => setField('currency', v)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CURRENCIES.map((c) => (
                    <SelectItem key={c} value={c}>{c}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* VAT rate */}
            <div className="space-y-1">
              <Label htmlFor="vat_rate_pct">
                VAT rate %{' '}
                <span className="text-muted-foreground text-xs">
                  (applied automatically when VAT number is set in Business Info)
                </span>
              </Label>
              <Input
                id="vat_rate_pct"
                type="number"
                min="0"
                max="100"
                step="0.5"
                value={form.vat_rate_pct}
                onChange={(e) => setField('vat_rate_pct', e.target.value)}
                placeholder="15"
                className="max-w-[120px]"
              />
            </div>
          </CardContent>
        </Card>

        {/* Recipient */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Bill To</CardTitle>
            <CardDescription>Your customer's billing details.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1">
              <Label htmlFor="recipient_name">Recipient name</Label>
              <Input
                id="recipient_name"
                value={form.recipient_name}
                onChange={(e) => setField('recipient_name', e.target.value)}
                placeholder="Acme Corp"
                required
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="recipient_address">Recipient address</Label>
              <Input
                id="recipient_address"
                value={form.recipient_address}
                onChange={(e) => setField('recipient_address', e.target.value)}
                placeholder="456 Business Ave, Johannesburg, 2000"
              />
            </div>
          </CardContent>
        </Card>

        {/* Line items */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Line Items</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {/* Header row */}
            <div className="grid grid-cols-[1fr_80px_110px_32px] gap-2 text-xs text-muted-foreground">
              <span>Description</span>
              <span className="text-center">Qty</span>
              <span className="text-right">Unit price</span>
              <span />
            </div>

            {form.lines.map((line, idx) => (
              <div key={idx} className="grid grid-cols-[1fr_80px_110px_32px] gap-2 items-center">
                <Input
                  value={line.description}
                  onChange={(e) => setLine(idx, 'description', e.target.value)}
                  placeholder="Service description"
                  required
                />
                <Input
                  type="number"
                  min="1"
                  step="1"
                  value={line.qty}
                  onChange={(e) => setLine(idx, 'qty', parseInt(e.target.value) || 1)}
                  className="text-center"
                />
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  value={inputFromCents(line.unit_cents)}
                  onChange={(e) => setLine(idx, 'unit_cents', centsFromInput(e.target.value))}
                  placeholder="0.00"
                  className="text-right"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  disabled={form.lines.length === 1}
                  onClick={() => removeLine(idx)}
                  className="text-muted-foreground hover:text-destructive"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}

            <Button type="button" variant="outline" size="sm" onClick={addLine}>
              <Plus className="mr-1 h-4 w-4" />
              Add line
            </Button>

            {/* Totals summary */}
            <div className="border-t pt-3 space-y-1 text-sm">
              <div className="flex justify-between text-muted-foreground">
                <span>Subtotal</span>
                <span className="tabular-nums">{fmtCents(sub, currency)}</span>
              </div>
              {vatCents > 0 && (
                <div className="flex justify-between text-muted-foreground">
                  <span>VAT ({form.vat_rate_pct}%)</span>
                  <span className="tabular-nums">{fmtCents(vatCents, currency)}</span>
                </div>
              )}
              <div className="flex justify-between font-semibold text-base border-t pt-1">
                <span>Total</span>
                <span className="tabular-nums">{fmtCents(totalCents, currency)}</span>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Submit */}
        <div className="flex justify-end gap-3">
          <Button type="button" variant="outline" onClick={() => navigate('/invoices')}>
            Cancel
          </Button>
          <Button type="submit" disabled={saving}>
            {saving ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Saving…
              </>
            ) : (
              <>
                <Save className="mr-2 h-4 w-4" />
                {isEdit ? 'Save changes' : 'Create invoice'}
              </>
            )}
          </Button>
        </div>
      </form>
    </div>
  );
}
