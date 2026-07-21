import { useState, useEffect } from 'react';
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
import { api } from '@/lib/api-client';
import { Plus, Trash2 } from 'lucide-react';

const EMPTY_LINE = {
  inventory_item_id: '',
  ordered_quantity: '',
  ordered_unit: '',
  ordered_unit_price: '', // major units — converted to cents on submit
};

function centsToMajor(cents) {
  return cents != null ? (cents / 100).toFixed(2) : '';
}

function majorToCents(str) {
  const v = parseFloat(str);
  return isNaN(v) ? 0 : Math.round(v * 100);
}

export function POForm({ locationId, suppliers, onSubmit, onCancel, saving }) {
  const [supplierId, setSupplierId] = useState('');
  const [poNumber, setPoNumber] = useState('');
  const [expectedDate, setExpectedDate] = useState('');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState([{ ...EMPTY_LINE }]);
  const [inventoryItems, setInventoryItems] = useState([]);
  const [err, setErr] = useState('');

  useEffect(() => {
    if (!locationId) return;
    api.from('inventory_items')
      .select('id, name, unit')
      .eq('location_id', locationId)
      .order('name', { ascending: true })
      .then(({ data }) => setInventoryItems(data || []));
  }, [locationId]);

  function setLine(idx, field, value) {
    setLines((prev) => prev.map((l, i) => i === idx ? { ...l, [field]: value } : l));
  }

  function addLine() {
    setLines((prev) => [...prev, { ...EMPTY_LINE }]);
  }

  function removeLine(idx) {
    setLines((prev) => prev.filter((_, i) => i !== idx));
  }

  function lineTotal(line) {
    const qty = parseFloat(line.ordered_quantity) || 0;
    const price = parseFloat(line.ordered_unit_price) || 0;
    return (qty * price).toFixed(2);
  }

  function grandTotal() {
    return lines.reduce((sum, l) => {
      return sum + (parseFloat(l.ordered_quantity) || 0) * (parseFloat(l.ordered_unit_price) || 0);
    }, 0).toFixed(2);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!poNumber.trim()) { setErr('PO number is required'); return; }
    if (lines.length === 0) { setErr('At least one line item is required'); return; }
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      if (!l.inventory_item_id) { setErr(`Line ${i + 1}: select an inventory item`); return; }
      if (!l.ordered_quantity || parseFloat(l.ordered_quantity) <= 0) { setErr(`Line ${i + 1}: quantity must be > 0`); return; }
      if (!l.ordered_unit.trim()) { setErr(`Line ${i + 1}: unit is required`); return; }
    }
    setErr('');

    const payload = {
      location_id: locationId,
      supplier_id: supplierId || '',
      po_number: poNumber.trim(),
      expected_delivery_date: expectedDate || '',
      notes: notes.trim(),
      lines: lines.map((l) => ({
        inventory_item_id: l.inventory_item_id,
        ordered_quantity: parseFloat(l.ordered_quantity),
        ordered_unit: l.ordered_unit.trim(),
        ordered_unit_price_cents: majorToCents(l.ordered_unit_price),
      })),
    };

    await onSubmit(payload);
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {err && <p className="text-sm text-red-600">{err}</p>}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="space-y-1">
          <Label htmlFor="po_number">PO Number <span className="text-red-500">*</span></Label>
          <Input id="po_number" value={poNumber} onChange={(e) => setPoNumber(e.target.value)} placeholder="PO-2024-001" required />
        </div>
        <div className="space-y-1">
          <Label>Supplier</Label>
          <Select value={supplierId} onValueChange={setSupplierId}>
            <SelectTrigger>
              <SelectValue placeholder="Select supplier" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="">— None —</SelectItem>
              {suppliers.map((s) => (
                <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="space-y-1">
          <Label htmlFor="expected_date">Expected Delivery Date</Label>
          <Input id="expected_date" type="date" value={expectedDate} onChange={(e) => setExpectedDate(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="notes">Notes</Label>
          <Input id="notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>
      </div>

      {/* Line items */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label>Line Items</Label>
          <Button type="button" size="sm" variant="outline" onClick={addLine} className="border-orange-200 text-orange-700 hover:bg-orange-50">
            <Plus className="w-4 h-4 mr-1" /> Add Line
          </Button>
        </div>

        {lines.map((line, idx) => (
          <div key={idx} className="grid grid-cols-12 gap-2 items-end border border-orange-100 rounded p-2 bg-orange-50/30">
            <div className="col-span-4 space-y-1">
              <Label className="text-xs">Item</Label>
              <Select value={line.inventory_item_id} onValueChange={(v) => {
                const item = inventoryItems.find((i) => i.id === v);
                setLine(idx, 'inventory_item_id', v);
                if (item && !line.ordered_unit) setLine(idx, 'ordered_unit', item.unit);
              }}>
                <SelectTrigger className="h-8 text-sm">
                  <SelectValue placeholder="Select item" />
                </SelectTrigger>
                <SelectContent>
                  {inventoryItems.map((it) => (
                    <SelectItem key={it.id} value={it.id}>{it.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="col-span-2 space-y-1">
              <Label className="text-xs">Qty</Label>
              <Input className="h-8 text-sm" type="number" min="0.001" step="0.001" value={line.ordered_quantity} onChange={(e) => setLine(idx, 'ordered_quantity', e.target.value)} />
            </div>

            <div className="col-span-2 space-y-1">
              <Label className="text-xs">Unit</Label>
              <Input className="h-8 text-sm" value={line.ordered_unit} onChange={(e) => setLine(idx, 'ordered_unit', e.target.value)} placeholder="kg" />
            </div>

            <div className="col-span-2 space-y-1">
              <Label className="text-xs">Unit Cost</Label>
              <Input className="h-8 text-sm" type="number" min="0" step="0.01" value={line.ordered_unit_price} onChange={(e) => setLine(idx, 'ordered_unit_price', e.target.value)} placeholder="0.00" />
            </div>

            <div className="col-span-1 space-y-1">
              <Label className="text-xs">Total</Label>
              <p className="text-sm font-medium h-8 flex items-center">{lineTotal(line)}</p>
            </div>

            <div className="col-span-1 flex justify-end">
              <Button type="button" size="sm" variant="ghost" onClick={() => removeLine(idx)} className="h-8 w-8 p-0 text-red-500 hover:text-red-700 hover:bg-red-50" disabled={lines.length === 1}>
                <Trash2 className="w-4 h-4" />
              </Button>
            </div>
          </div>
        ))}

        <div className="flex justify-end text-sm font-semibold text-foreground pr-2">
          Grand Total: {grandTotal()}
        </div>
      </div>

      <div className="flex gap-3 pt-2">
        <Button type="button" variant="outline" onClick={onCancel} className="flex-1" disabled={saving}>
          Cancel
        </Button>
        <Button type="submit" className="flex-1 bg-orange-500 hover:bg-orange-600 text-white" disabled={saving}>
          {saving ? 'Creating…' : 'Create Purchase Order'}
        </Button>
      </div>
    </form>
  );
}
