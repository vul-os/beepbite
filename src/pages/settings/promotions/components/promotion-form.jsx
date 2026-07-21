import { useState, useEffect } from 'react';
import { CalendarIcon } from 'lucide-react';
import { format, parseISO } from 'date-fns';

import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  RadioGroup,
  RadioGroupItem,
} from '@/components/ui/radio-group';
import { cn } from '@/lib/utils';

const PROMO_TYPES = [
  { value: 'percent_off',       label: 'Percent off' },
  { value: 'fixed_off',         label: 'Fixed amount off' },
  { value: 'bogo',              label: 'Buy X get Y (BOGO)' },
  { value: 'free_item',         label: 'Free item' },
  { value: 'happy_hour_price',  label: 'Happy-hour price' },
  { value: 'free_delivery',     label: 'Free delivery' },
];

const SCOPES = [
  { value: 'order',            label: 'Entire order' },
  { value: 'item',             label: 'Specific items' },
  { value: 'category',         label: 'Category' },
  { value: 'delivery',         label: 'Delivery fee' },
  // 'customer_segment' is handled via the customer_segment column, not scope
];

const SEGMENTS = [
  { value: 'all',        label: 'All customers' },
  { value: 'first_time', label: 'First-time only' },
  { value: 'vip',        label: 'VIP' },
  { value: 'lapsed',     label: 'Lapsed' },
];

function buildEmpty() {
  return {
    name: '',
    description: '',
    promo_type: 'percent_off',
    scope: 'order',
    // discount value fields
    percent_off: '',
    fixed_off_dollars: '',     // converted to cents on submit
    happy_hour_price_dollars: '',
    // bogo
    bogo_buy_qty: 1,
    bogo_get_qty: 1,
    bogo_get_discount_percent: 100,
    // qualifications
    min_spend_dollars: '',
    max_discount_dollars: '',
    // targeting
    customer_segment: 'all',
    usage_limit_total: '',
    usage_limit_per_customer: 1,
    // validity
    active_from: null,
    active_until: null,
    // dayparts (raw JSON textarea)
    dayparts_raw: '',
    // flags
    stackable: false,
    requires_coupon_code: false,
    priority: 0,
    is_active: true,
  };
}

function populateFromRow(row) {
  return {
    name: row.name || '',
    description: row.description || '',
    promo_type: row.promo_type || 'percent_off',
    scope: row.scope || 'order',
    percent_off: row.percent_off != null ? String(row.percent_off) : '',
    fixed_off_dollars: row.fixed_off_cents != null
      ? String(row.fixed_off_cents / 100)
      : '',
    happy_hour_price_dollars: row.happy_hour_price_cents != null
      ? String(row.happy_hour_price_cents / 100)
      : '',
    bogo_buy_qty: row.bogo_buy_qty ?? 1,
    bogo_get_qty: row.bogo_get_qty ?? 1,
    bogo_get_discount_percent: row.bogo_get_discount_percent ?? 100,
    min_spend_dollars: row.min_spend_cents != null
      ? String(row.min_spend_cents / 100)
      : '',
    max_discount_dollars: row.max_discount_cents != null
      ? String(row.max_discount_cents / 100)
      : '',
    customer_segment: row.customer_segment || 'all',
    usage_limit_total: row.usage_limit_total != null
      ? String(row.usage_limit_total)
      : '',
    usage_limit_per_customer: row.usage_limit_per_customer != null
      ? String(row.usage_limit_per_customer)
      : 1,
    active_from: row.active_from ? parseISO(row.active_from) : null,
    active_until: row.active_until ? parseISO(row.active_until) : null,
    dayparts_raw: row.dayparts
      ? JSON.stringify(row.dayparts, null, 2)
      : '',
    stackable: row.stackable ?? false,
    requires_coupon_code: row.requires_coupon_code ?? false,
    priority: row.priority ?? 0,
    is_active: row.is_active ?? true,
  };
}

function buildPayload(form, locationId, organizationId) {
  const payload = {
    name: form.name.trim(),
    description: form.description.trim() || null,
    promo_type: form.promo_type,
    scope: form.scope,
    location_id: locationId,
    organization_id: organizationId,
    stackable: form.stackable,
    requires_coupon_code: form.requires_coupon_code,
    priority: parseInt(form.priority, 10) || 0,
    is_active: form.is_active,
    customer_segment: form.customer_segment || 'all',
    active_from: form.active_from ? form.active_from.toISOString() : null,
    active_until: form.active_until ? form.active_until.toISOString() : null,
    min_spend_cents: form.min_spend_dollars
      ? Math.round(parseFloat(form.min_spend_dollars) * 100)
      : 0,
    max_discount_cents: form.max_discount_dollars
      ? Math.round(parseFloat(form.max_discount_dollars) * 100)
      : null,
    usage_limit_total: form.usage_limit_total
      ? parseInt(form.usage_limit_total, 10)
      : null,
    usage_limit_per_customer: form.usage_limit_per_customer
      ? parseInt(form.usage_limit_per_customer, 10)
      : 1,
  };

  // Dayparts JSON
  if (form.dayparts_raw.trim()) {
    try {
      payload.dayparts = JSON.parse(form.dayparts_raw);
    } catch {
      // leave null — we surface validation before submit
    }
  } else {
    payload.dayparts = null;
  }

  // Type-specific discount fields
  switch (form.promo_type) {
    case 'percent_off':
      payload.percent_off = form.percent_off
        ? parseFloat(form.percent_off)
        : null;
      break;
    case 'fixed_off':
      payload.fixed_off_cents = form.fixed_off_dollars
        ? Math.round(parseFloat(form.fixed_off_dollars) * 100)
        : null;
      break;
    case 'happy_hour_price':
      payload.happy_hour_price_cents = form.happy_hour_price_dollars
        ? Math.round(parseFloat(form.happy_hour_price_dollars) * 100)
        : null;
      break;
    case 'bogo':
      payload.bogo_buy_qty = parseInt(form.bogo_buy_qty, 10) || 1;
      payload.bogo_get_qty = parseInt(form.bogo_get_qty, 10) || 1;
      payload.bogo_get_discount_percent =
        parseFloat(form.bogo_get_discount_percent) ?? 100;
      break;
    default:
      break;
  }

  return payload;
}

function DateField({ label, value, onChange }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <Label className="text-xs mb-1 block">{label}</Label>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            className={cn(
              'w-full justify-start text-left font-normal h-9 text-sm',
              !value && 'text-muted-foreground',
            )}
          >
            <CalendarIcon className="mr-2 h-4 w-4" />
            {value ? format(value, 'PPP') : 'Pick a date'}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <Calendar
            mode="single"
            selected={value}
            onSelect={(d) => { onChange(d || null); setOpen(false); }}
            initialFocus
          />
          {value && (
            <div className="p-2 border-t">
              <Button
                variant="ghost"
                size="sm"
                className="w-full text-xs"
                onClick={() => { onChange(null); setOpen(false); }}
              >
                Clear
              </Button>
            </div>
          )}
        </PopoverContent>
      </Popover>
    </div>
  );
}

export default function PromotionForm({
  initial,
  locationId,
  organizationId,
  onSubmit,
  onCancel,
  saving,
}) {
  const [form, setForm] = useState(() =>
    initial ? populateFromRow(initial) : buildEmpty(),
  );
  const [validationError, setValidationError] = useState('');

  useEffect(() => {
    setForm(initial ? populateFromRow(initial) : buildEmpty());
    setValidationError('');
  }, [initial]);

  const set = (field, value) =>
    setForm((prev) => ({ ...prev, [field]: value }));

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!form.name.trim()) { setValidationError('Name is required.'); return; }
    if (form.dayparts_raw.trim()) {
      try { JSON.parse(form.dayparts_raw); }
      catch { setValidationError('Dayparts must be valid JSON.'); return; }
    }
    setValidationError('');
    const payload = buildPayload(form, locationId, organizationId);
    onSubmit(payload);
  };

  const isEdit = Boolean(initial?.id);

  return (
    <form onSubmit={handleSubmit} className="space-y-5 overflow-y-auto max-h-[70vh] pr-1">

      {/* Basic info */}
      <div className="space-y-3">
        <div>
          <Label htmlFor="promo-name">Name *</Label>
          <Input
            id="promo-name"
            value={form.name}
            onChange={(e) => set('name', e.target.value)}
            placeholder="e.g. Happy Hour 20% off"
          />
        </div>
        <div>
          <Label htmlFor="promo-desc">Description</Label>
          <Textarea
            id="promo-desc"
            value={form.description}
            onChange={(e) => set('description', e.target.value)}
            rows={2}
            placeholder="Optional customer-facing description"
          />
        </div>
      </div>

      {/* Type */}
      <div>
        <Label className="mb-2 block">Promotion type *</Label>
        <RadioGroup
          value={form.promo_type}
          onValueChange={(v) => set('promo_type', v)}
          className="grid grid-cols-2 gap-2"
        >
          {PROMO_TYPES.map(({ value, label }) => (
            <div
              key={value}
              className={cn(
                'flex items-center gap-2 rounded-md border px-3 py-2 cursor-pointer transition-colors',
                form.promo_type === value
                  ? 'border-primary bg-primary/5'
                  : 'border-border',
              )}
            >
              <RadioGroupItem value={value} id={`type-${value}`} />
              <Label htmlFor={`type-${value}`} className="cursor-pointer text-sm font-normal">
                {label}
              </Label>
            </div>
          ))}
        </RadioGroup>
      </div>

      {/* Type-specific discount fields */}
      {form.promo_type === 'percent_off' && (
        <div>
          <Label htmlFor="pct-off">Percent off (0–100)</Label>
          <Input
            id="pct-off"
            type="number"
            min="0"
            max="100"
            step="0.01"
            value={form.percent_off}
            onChange={(e) => set('percent_off', e.target.value)}
            placeholder="e.g. 20"
          />
        </div>
      )}

      {form.promo_type === 'fixed_off' && (
        <div>
          <Label htmlFor="fixed-off">Discount amount ($)</Label>
          <Input
            id="fixed-off"
            type="number"
            min="0"
            step="0.01"
            value={form.fixed_off_dollars}
            onChange={(e) => set('fixed_off_dollars', e.target.value)}
            placeholder="e.g. 5.00"
          />
        </div>
      )}

      {form.promo_type === 'happy_hour_price' && (
        <div>
          <Label htmlFor="hh-price">Override price ($)</Label>
          <Input
            id="hh-price"
            type="number"
            min="0"
            step="0.01"
            value={form.happy_hour_price_dollars}
            onChange={(e) => set('happy_hour_price_dollars', e.target.value)}
            placeholder="e.g. 1.99"
          />
        </div>
      )}

      {form.promo_type === 'bogo' && (
        <div className="grid grid-cols-3 gap-3">
          <div>
            <Label htmlFor="bogo-buy">Buy qty</Label>
            <Input
              id="bogo-buy"
              type="number"
              min="1"
              value={form.bogo_buy_qty}
              onChange={(e) => set('bogo_buy_qty', e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="bogo-get">Get qty</Label>
            <Input
              id="bogo-get"
              type="number"
              min="1"
              value={form.bogo_get_qty}
              onChange={(e) => set('bogo_get_qty', e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="bogo-disc">Get % off</Label>
            <Input
              id="bogo-disc"
              type="number"
              min="0"
              max="100"
              value={form.bogo_get_discount_percent}
              onChange={(e) => set('bogo_get_discount_percent', e.target.value)}
            />
          </div>
        </div>
      )}

      {/* Scope */}
      <div>
        <Label className="mb-2 block">Scope *</Label>
        <RadioGroup
          value={form.scope}
          onValueChange={(v) => set('scope', v)}
          className="flex flex-wrap gap-2"
        >
          {SCOPES.map(({ value, label }) => (
            <div
              key={value}
              className={cn(
                'flex items-center gap-2 rounded-md border px-3 py-1.5 cursor-pointer',
                form.scope === value
                  ? 'border-primary bg-primary/5'
                  : 'border-border',
              )}
            >
              <RadioGroupItem value={value} id={`scope-${value}`} />
              <Label htmlFor={`scope-${value}`} className="cursor-pointer text-sm font-normal">
                {label}
              </Label>
            </div>
          ))}
        </RadioGroup>
      </div>

      {/* Qualifications */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label htmlFor="min-spend">Min spend ($)</Label>
          <Input
            id="min-spend"
            type="number"
            min="0"
            step="0.01"
            value={form.min_spend_dollars}
            onChange={(e) => set('min_spend_dollars', e.target.value)}
            placeholder="0.00"
          />
        </div>
        <div>
          <Label htmlFor="max-disc">Max discount ($)</Label>
          <Input
            id="max-disc"
            type="number"
            min="0"
            step="0.01"
            value={form.max_discount_dollars}
            onChange={(e) => set('max_discount_dollars', e.target.value)}
            placeholder="Unlimited"
          />
        </div>
      </div>

      {/* Validity window */}
      <div className="grid grid-cols-2 gap-3">
        <DateField
          label="Starts at"
          value={form.active_from}
          onChange={(d) => set('active_from', d)}
        />
        <DateField
          label="Ends at"
          value={form.active_until}
          onChange={(d) => set('active_until', d)}
        />
      </div>

      {/* Dayparts */}
      <div>
        <Label htmlFor="dayparts">
          Dayparts{' '}
          <span className="text-muted-foreground font-normal text-xs">
            (JSON array, e.g. [{`{"day":"mon","from":"15:00","until":"18:00"}`}])
          </span>
        </Label>
        <Textarea
          id="dayparts"
          value={form.dayparts_raw}
          onChange={(e) => set('dayparts_raw', e.target.value)}
          rows={3}
          placeholder='Leave blank for any time'
          className="font-mono text-xs"
        />
      </div>

      {/* Customer segment */}
      <div>
        <Label className="mb-2 block">Customer segment</Label>
        <div className="flex flex-wrap gap-2">
          {SEGMENTS.map(({ value, label }) => (
            <Badge
              key={value}
              variant={form.customer_segment === value ? 'default' : 'outline'}
              className="cursor-pointer select-none"
              onClick={() => set('customer_segment', value)}
            >
              {label}
            </Badge>
          ))}
        </div>
      </div>

      {/* Usage caps */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label htmlFor="usage-total">Total usage limit</Label>
          <Input
            id="usage-total"
            type="number"
            min="1"
            value={form.usage_limit_total}
            onChange={(e) => set('usage_limit_total', e.target.value)}
            placeholder="Unlimited"
          />
        </div>
        <div>
          <Label htmlFor="usage-per">Per-customer limit</Label>
          <Input
            id="usage-per"
            type="number"
            min="1"
            value={form.usage_limit_per_customer}
            onChange={(e) => set('usage_limit_per_customer', e.target.value)}
            placeholder="1"
          />
        </div>
      </div>

      {/* Priority */}
      <div>
        <Label htmlFor="priority">Priority (higher = wins when non-stackable)</Label>
        <Input
          id="priority"
          type="number"
          value={form.priority}
          onChange={(e) => set('priority', e.target.value)}
          placeholder="0"
        />
      </div>

      {/* Flags */}
      <div className="flex flex-wrap gap-6">
        <div className="flex items-center gap-2">
          <Switch
            id="is-active"
            checked={form.is_active}
            onCheckedChange={(v) => set('is_active', v)}
          />
          <Label htmlFor="is-active">Active</Label>
        </div>

        <div className="flex items-center gap-2">
          <Checkbox
            id="stackable"
            checked={form.stackable}
            onCheckedChange={(v) => set('stackable', !!v)}
          />
          <Label htmlFor="stackable">Stackable</Label>
        </div>

        <div className="flex items-center gap-2">
          <Checkbox
            id="requires-coupon"
            checked={form.requires_coupon_code}
            onCheckedChange={(v) => set('requires_coupon_code', !!v)}
          />
          <Label htmlFor="requires-coupon">Requires coupon code</Label>
        </div>
      </div>

      {validationError && (
        <p className="text-sm text-destructive">{validationError}</p>
      )}

      {/* Actions */}
      <div className="flex gap-3 pt-2 sticky bottom-0 bg-background pb-1">
        <Button
          type="button"
          variant="outline"
          onClick={onCancel}
          disabled={saving}
          className="flex-1"
        >
          Cancel
        </Button>
        <Button type="submit" disabled={saving} className="flex-1">
          {saving ? 'Saving…' : isEdit ? 'Update promotion' : 'Create promotion'}
        </Button>
      </div>
    </form>
  );
}
