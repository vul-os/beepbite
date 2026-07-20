import React, { useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { AlertCircle, Zap, ShoppingCart } from 'lucide-react';
import { useAuth } from '@/context/auth-context';
import { useMoney } from '@/context/locale-context';
import { api } from '@/lib/api-client';

export default function AutoSuggestionsPage() {
  const { activeLocation } = useAuth();
  // Suggestions are drafts for this location and carry no currency of their
  // own, so the location's currency is the right one.
  const { format: fmtCents } = useMoney();
  const [suggestions, setSuggestions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  // selected: Set of supplier_id keys (one PO per supplier)
  const [selected, setSelected] = useState(new Set());
  const [creating, setCreating] = useState(false);
  const [createResults, setCreateResults] = useState([]);

  const fetchSuggestions = useCallback(async () => {
    if (!activeLocation) return;
    setLoading(true);
    setError('');
    setCreateResults([]);
    try {
      const { data, error: err } = await api.request(
        'GET',
        `/inventory/auto-po-suggestions?location_id=${activeLocation.id}`
      );
      if (err) throw new Error(err.message);
      const list = data?.suggestions || [];
      setSuggestions(list);
      // Pre-select all
      setSelected(new Set(list.map((_, i) => i)));
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [activeLocation]);

  useEffect(() => { fetchSuggestions(); }, [fetchSuggestions]);

  function toggleSelect(idx) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  }

  async function createSelected() {
    const toCreate = suggestions.filter((_, i) => selected.has(i));
    if (toCreate.length === 0) return;
    setCreating(true);
    const results = [];
    for (const sug of toCreate) {
      const poNumber = `AUTO-${sug.supplier_id.slice(0, 6).toUpperCase()}-${Date.now()}`;
      try {
        const { data, error: err } = await api.request('POST', '/inventory/purchase-orders', {
          body: {
            location_id: sug.location_id,
            supplier_id: sug.supplier_id,
            po_number: poNumber,
            lines: sug.lines.map((l) => ({
              inventory_item_id: l.inventory_item_id,
              ordered_quantity: l.ordered_quantity,
              ordered_unit: l.ordered_unit,
              ordered_unit_price_cents: l.ordered_unit_price_cents,
            })),
          },
        });
        if (err) throw new Error(err.message);
        results.push({ supplier: sug.supplier_name, ok: true, po_number: data?.po_number });
      } catch (e) {
        results.push({ supplier: sug.supplier_name, ok: false, message: e.message });
      }
    }
    setCreateResults(results);
    setCreating(false);
    // Refresh suggestions — items may no longer be low-stock after the order
    await fetchSuggestions();
  }

  if (!activeLocation) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <AlertCircle className="w-12 h-12 text-gray-400 mb-4" />
        <p className="text-gray-600">Select a location to view auto-PO suggestions.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Zap className="w-6 h-6 text-orange-500" />
            Auto-PO Suggestions
          </h1>
          <p className="text-gray-500 text-sm mt-1">
            Low-stock items at {activeLocation.name} with a preferred supplier
          </p>
        </div>
        <Button
          onClick={createSelected}
          disabled={creating || selected.size === 0 || suggestions.length === 0}
          className="bg-orange-500 hover:bg-orange-600 text-white"
        >
          <ShoppingCart className="w-4 h-4 mr-2" />
          {creating ? 'Creating…' : `Create ${selected.size} selected PO${selected.size !== 1 ? 's' : ''}`}
        </Button>
      </div>

      {/* Create results */}
      {createResults.length > 0 && (
        <div className="space-y-1">
          {createResults.map((r, i) => (
            <div
              key={i}
              className={`flex items-center gap-2 rounded p-2 text-sm ${r.ok ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-700'}`}
            >
              {r.ok
                ? <span>Created PO <strong>{r.po_number}</strong> for {r.supplier}</span>
                : <span>Failed for {r.supplier}: {r.message}</span>}
            </div>
          ))}
        </div>
      )}

      {loading && (
        <div className="space-y-4">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="h-32 bg-gray-100 rounded-lg animate-pulse" />
          ))}
        </div>
      )}

      {!loading && error && (
        <div className="flex items-center gap-2 text-red-600 bg-red-50 border border-red-200 rounded p-3">
          <AlertCircle className="w-4 h-4" />
          <span>{error}</span>
        </div>
      )}

      {!loading && !error && suggestions.length === 0 && (
        <Card className="border-orange-100">
          <CardContent className="p-10 text-center">
            <Zap className="w-12 h-12 text-gray-300 mx-auto mb-3" />
            <p className="text-gray-500">No low-stock items with a preferred supplier found.</p>
          </CardContent>
        </Card>
      )}

      {!loading && !error && suggestions.length > 0 && (
        <div className="space-y-4">
          {suggestions.map((sug, idx) => (
            <Card key={idx} className={`border-2 transition-colors ${selected.has(idx) ? 'border-orange-400 bg-orange-50/20' : 'border-orange-100'}`}>
              <CardHeader className="pb-2">
                <div className="flex items-center gap-3">
                  <Checkbox
                    id={`sug-${idx}`}
                    checked={selected.has(idx)}
                    onCheckedChange={() => toggleSelect(idx)}
                  />
                  <label htmlFor={`sug-${idx}`} className="cursor-pointer flex-1">
                    <CardTitle className="text-base">{sug.supplier_name}</CardTitle>
                    <p className="text-xs text-gray-500 mt-0.5">
                      Estimated total: {fmtCents(sug.estimated_total_cents)} &middot; {sug.lines.length} line{sug.lines.length !== 1 ? 's' : ''}
                    </p>
                  </label>
                  <Badge className="bg-orange-100 text-orange-700">Draft</Badge>
                </div>
              </CardHeader>
              <CardContent>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-xs text-gray-500 border-b border-orange-100">
                      <th className="text-left py-1">Item ID</th>
                      <th className="text-right py-1">Qty</th>
                      <th className="text-left py-1 pl-2">Unit</th>
                      <th className="text-right py-1">Unit Price</th>
                      <th className="text-right py-1">Line Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sug.lines.map((line, li) => {
                      // Stay in minor units: quantity may be fractional (2.5 kg),
                      // so round to a whole minor unit rather than dividing first.
                      const lineTotal = Math.round(
                        line.ordered_quantity * (line.ordered_unit_price_cents ?? 0)
                      );
                      return (
                        <tr key={li} className="border-b border-orange-50 last:border-0">
                          <td className="py-1 text-gray-700 font-mono text-xs truncate max-w-[120px]">{line.inventory_item_id}</td>
                          <td className="py-1 text-right text-gray-700">{line.ordered_quantity}</td>
                          <td className="py-1 pl-2 text-gray-500">{line.ordered_unit}</td>
                          <td className="py-1 text-right text-gray-700">{fmtCents(line.ordered_unit_price_cents)}</td>
                          <td className="py-1 text-right font-medium">{fmtCents(lineTotal)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          ))}

          <div className="flex justify-end">
            <Button
              onClick={createSelected}
              disabled={creating || selected.size === 0}
              className="bg-orange-500 hover:bg-orange-600 text-white"
            >
              <ShoppingCart className="w-4 h-4 mr-2" />
              {creating ? 'Creating…' : `Create ${selected.size} selected PO${selected.size !== 1 ? 's' : ''}`}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
