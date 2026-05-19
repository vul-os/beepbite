import React, { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
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
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { Plus, TrendingUp, Clock } from 'lucide-react';

const RATE_TYPES = [
  { value: 'hourly',         label: 'Hourly' },
  { value: 'salary_monthly', label: 'Monthly salary' },
  { value: 'salary_annual',  label: 'Annual salary' },
  { value: 'commission',     label: 'Commission' },
  { value: 'per_shift',      label: 'Per shift' },
];

// cents → major-unit string e.g. 4500 → "45.00"
function centsToMajor(cents) {
  return (cents / 100).toFixed(2);
}

// major-unit string → cents integer
function majorToCents(str) {
  const n = parseFloat(str);
  if (isNaN(n)) return null;
  return Math.round(n * 100);
}

function RateCard({ rate }) {
  const label = RATE_TYPES.find((t) => t.value === rate.rate_type)?.label ?? rate.rate_type;
  const amount = `${rate.currency} ${centsToMajor(rate.amount_cents)}`;
  const effectiveRange =
    rate.effective_until
      ? `${rate.effective_from} → ${rate.effective_until}`
      : `From ${rate.effective_from} (current)`;

  return (
    <Card
      className={cn(
        'border transition-colors',
        rate.is_current
          ? 'border-orange-200 bg-orange-50/30'
          : 'border-gray-100 bg-white opacity-70',
      )}
    >
      <CardContent className="p-4 flex items-start justify-between gap-4">
        <div className="space-y-0.5 flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-gray-900">{label}</span>
            {rate.is_current && (
              <Badge className="text-[10px] bg-orange-100 text-orange-700 border-orange-200 px-1.5 py-0">
                Current
              </Badge>
            )}
          </div>
          <p className="text-lg font-bold text-gray-900">{amount}</p>
          <p className="text-xs text-gray-500 flex items-center gap-1">
            <Clock className="w-3 h-3" />
            {effectiveRange}
          </p>
          {rate.overtime_multiplier && rate.overtime_multiplier !== 1 && (
            <p className="text-xs text-gray-400">
              OT ×{rate.overtime_multiplier}
              {rate.overtime_threshold_hours_per_week
                ? ` after ${rate.overtime_threshold_hours_per_week}h/wk`
                : ''}
            </p>
          )}
          {rate.notes && (
            <p className="text-xs text-gray-400 italic truncate">{rate.notes}</p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function AddRateDialog({ staffId, open, onOpenChange, onSubmit }) {
  const [form, setForm] = useState({
    rate_type: 'hourly',
    amount: '',
    effective_from: new Date().toISOString().slice(0, 10),
    overtime_multiplier: '1.5',
    notes: '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const set = (k, v) => setForm((p) => ({ ...p, [k]: v }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    const cents = majorToCents(form.amount);
    if (cents === null || cents < 0) {
      setError('Enter a valid amount.');
      return;
    }
    setSaving(true);
    setError('');
    const payload = {
      rate_type: form.rate_type,
      rate_cents: cents,
      effective_from: form.effective_from || undefined,
      overtime_multiplier: parseFloat(form.overtime_multiplier) || undefined,
      notes: form.notes || undefined,
    };
    const { error: apiErr } = await onSubmit(staffId, payload);
    setSaving(false);
    if (apiErr) { setError(apiErr.message); return; }
    onOpenChange(false);
    setForm({
      rate_type: 'hourly',
      amount: '',
      effective_from: new Date().toISOString().slice(0, 10),
      overtime_multiplier: '1.5',
      notes: '',
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md bg-white">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-orange-500" />
            Add Pay Rate
          </DialogTitle>
          <DialogDescription>
            Creates a new effective-dated rate. Any existing current rate of the
            same type will be automatically retired.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 mt-2">
          <div className="space-y-1.5">
            <Label htmlFor="rate_type">Rate type</Label>
            <Select value={form.rate_type} onValueChange={(v) => set('rate_type', v)}>
              <SelectTrigger id="rate_type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {RATE_TYPES.map((t) => (
                  <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="amount">Amount (major units)</Label>
            <Input
              id="amount"
              type="number"
              min="0"
              step="0.01"
              placeholder="e.g. 45.00"
              value={form.amount}
              onChange={(e) => set('amount', e.target.value)}
              required
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="effective_from">Effective from</Label>
            <Input
              id="effective_from"
              type="date"
              value={form.effective_from}
              onChange={(e) => set('effective_from', e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="ot_mult">Overtime multiplier</Label>
            <Input
              id="ot_mult"
              type="number"
              min="1"
              step="0.1"
              value={form.overtime_multiplier}
              onChange={(e) => set('overtime_multiplier', e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="notes">Notes (optional)</Label>
            <Input
              id="notes"
              placeholder="e.g. Post-probation adjustment"
              value={form.notes}
              onChange={(e) => set('notes', e.target.value)}
            />
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}

          <div className="flex gap-3 pt-2">
            <Button
              type="button"
              variant="outline"
              className="flex-1 border-orange-200 text-orange-700 hover:bg-orange-50"
              onClick={() => onOpenChange(false)}
              disabled={saving}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={saving}
              className="flex-1 bg-orange-500 hover:bg-orange-600 text-white"
            >
              {saving ? 'Saving…' : 'Add rate'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function PayRatesTab({ staff, rates, loading, error, createRate }) {
  const [dialogOpen, setDialogOpen] = useState(false);

  const currentRates = rates.filter((r) => r.is_current);
  const historicalRates = rates.filter((r) => !r.is_current);

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-gray-900">Pay rates</h3>
          <p className="text-xs text-gray-500">
            Amounts displayed in major units; stored as cents.
          </p>
        </div>
        <Button
          size="sm"
          className="bg-orange-500 hover:bg-orange-600 text-white"
          onClick={() => setDialogOpen(true)}
        >
          <Plus className="w-3.5 h-3.5 mr-1" />
          Add rate
        </Button>
      </div>

      {loading && (
        <div className="space-y-2">
          {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-20 rounded-lg" />)}
        </div>
      )}

      {!loading && error && (
        <p className="text-sm text-red-600">{error}</p>
      )}

      {!loading && !error && rates.length === 0 && (
        <Card className="border-dashed border-gray-200">
          <CardContent className="p-8 text-center text-gray-400">
            <TrendingUp className="w-8 h-8 mx-auto mb-2 opacity-40" />
            <p className="text-sm">No pay rates on record.</p>
          </CardContent>
        </Card>
      )}

      {currentRates.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Current</p>
          {currentRates.map((r) => <RateCard key={r.id} rate={r} />)}
        </div>
      )}

      {historicalRates.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Historical</p>
          {historicalRates.map((r) => <RateCard key={r.id} rate={r} />)}
        </div>
      )}

      <AddRateDialog
        staffId={staff.id}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onSubmit={createRate}
      />
    </div>
  );
}
