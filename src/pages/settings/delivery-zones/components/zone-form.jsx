import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import PolygonEditor from './polygon-editor';

function field(label, children) {
  return (
    <div className="space-y-1">
      <Label className="text-sm font-medium">{label}</Label>
      {children}
    </div>
  );
}

export default function ZoneForm({ initial, organizationId, locationId, location, onSubmit, onCancel, saving }) {
  const [name, setName] = useState(initial?.name ?? '');
  const [deliveryFeeCents, setDeliveryFeeCents] = useState(initial?.delivery_fee_cents ?? 0);
  const [minOrderCents, setMinOrderCents] = useState(initial?.min_order_cents ?? 0);
  const [etaMinutes, setEtaMinutes] = useState(initial?.estimated_eta_minutes ?? 30);
  const [priority, setPriority] = useState(initial?.priority ?? 0);
  const [isActive, setIsActive] = useState(initial?.is_active ?? true);
  const [polygon, setPolygon] = useState(initial?.polygon ?? null);
  const [polygonError, setPolygonError] = useState('');

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!name.trim()) return;
    if (!polygon || !polygon.coordinates?.[0]?.length) {
      setPolygonError('A polygon with at least 3 vertices is required.');
      return;
    }
    setPolygonError('');
    onSubmit({
      organization_id: organizationId,
      location_id: locationId,
      name: name.trim(),
      polygon,
      delivery_fee_cents: Number(deliveryFeeCents),
      min_order_cents: Number(minOrderCents),
      estimated_eta_minutes: Number(etaMinutes),
      priority: Number(priority),
      is_active: isActive,
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {field('Zone name *',
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Inner city"
          required
        />
      )}

      <div className="grid grid-cols-2 gap-3">
        {field('Delivery fee (cents)',
          <Input
            type="number"
            min="0"
            value={deliveryFeeCents}
            onChange={(e) => setDeliveryFeeCents(e.target.value)}
          />
        )}
        {field('Min order (cents)',
          <Input
            type="number"
            min="0"
            value={minOrderCents}
            onChange={(e) => setMinOrderCents(e.target.value)}
          />
        )}
        {field('ETA (minutes)',
          <Input
            type="number"
            min="1"
            value={etaMinutes}
            onChange={(e) => setEtaMinutes(e.target.value)}
          />
        )}
        {field('Priority',
          <Input
            type="number"
            value={priority}
            onChange={(e) => setPriority(e.target.value)}
            title="Higher priority zones win when polygons overlap"
          />
        )}
      </div>

      <div className="flex items-center gap-3">
        <Switch checked={isActive} onCheckedChange={setIsActive} id="zone-active" />
        <Label htmlFor="zone-active" className="cursor-pointer">Active</Label>
      </div>

      <div className="space-y-1">
        <Label className="text-sm font-medium">Delivery polygon *</Label>
        <PolygonEditor
          value={polygon}
          onChange={setPolygon}
          center={
            location?.latitude && location?.longitude
              ? [Number(location.latitude), Number(location.longitude)]
              : undefined
          }
        />
        {polygonError && (
          <p className="text-xs text-destructive mt-1">{polygonError}</p>
        )}
      </div>

      <div className="flex gap-2 pt-2">
        <Button type="submit" disabled={saving} className="flex-1">
          {saving ? 'Saving…' : (initial ? 'Save changes' : 'Create zone')}
        </Button>
        <Button type="button" variant="outline" onClick={onCancel} disabled={saving}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
