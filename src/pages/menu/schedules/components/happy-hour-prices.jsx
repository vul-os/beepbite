// happy-hour-prices.jsx — table of items with their regular price and an editable
// happy-hour override. Each row saves independently with a 500ms debounce.

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AlertCircle, Check, Loader2, DollarSign, Utensils } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';

const DEBOUNCE_MS = 500;

const ZAR = new Intl.NumberFormat('en-ZA', { style: 'currency', currency: 'ZAR' });

function PriceRow({ item, priceRow, onSave, onDelete }) {
  // priceRow may be undefined (no override yet)
  const initial = priceRow ? String(priceRow.price) : '';
  const [value, setValue] = useState(initial);
  const [status, setStatus] = useState('idle'); // 'idle' | 'saving' | 'saved' | 'error'
  const [errorMsg, setErrorMsg] = useState('');
  const timerRef = useRef(null);
  const prevRowId = useRef(priceRow?.id);

  // If the priceRow changes externally (e.g. after first save returns a new id), sync
  useEffect(() => {
    if (priceRow?.id !== prevRowId.current) {
      prevRowId.current = priceRow?.id;
    }
  }, [priceRow?.id]);

  const scheduleAutosave = useCallback((newVal) => {
    clearTimeout(timerRef.current);
    if (newVal === '' || newVal === null || newVal === undefined) {
      // empty → delete override if one exists
      if (priceRow?.id) {
        timerRef.current = setTimeout(async () => {
          setStatus('saving');
          try {
            await onDelete(priceRow.id);
            setStatus('saved');
            setTimeout(() => setStatus('idle'), 1200);
          } catch (e) {
            setStatus('error');
            setErrorMsg(e.message || 'Save failed');
          }
        }, DEBOUNCE_MS);
      }
      return;
    }
    const parsed = parseFloat(newVal);
    if (isNaN(parsed) || parsed < 0) return;
    timerRef.current = setTimeout(async () => {
      setStatus('saving');
      setErrorMsg('');
      try {
        await onSave({
          itemId: item.id,
          price: parsed,
          existingId: priceRow?.id,
        });
        setStatus('saved');
        setTimeout(() => setStatus('idle'), 1200);
      } catch (e) {
        setStatus('error');
        setErrorMsg(e.message || 'Save failed');
      }
    }, DEBOUNCE_MS);
  }, [item.id, priceRow, onSave, onDelete]);

  const handleChange = (e) => {
    setValue(e.target.value);
    scheduleAutosave(e.target.value);
  };

  // Cleanup on unmount
  useEffect(() => () => clearTimeout(timerRef.current), []);

  const hasOverride = value !== '' && !isNaN(parseFloat(value));

  return (
    <tr className="border-b last:border-0 hover:bg-gray-50 transition-colors">
      <td className="py-3 pr-4">
        <span className="text-sm font-medium text-gray-800">{item.name}</span>
      </td>
      <td className="py-3 pr-4 tabular-nums text-sm text-gray-600">
        {item.price != null ? ZAR.format(item.price) : '—'}
      </td>
      <td className="py-3 pr-4">
        <div className="relative w-36">
          <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 text-sm">R</span>
          <Input
            type="number"
            min="0"
            step="0.01"
            value={value}
            onChange={handleChange}
            placeholder="—"
            className={`pl-6 h-8 text-sm ${hasOverride ? 'border-orange-300 focus-visible:ring-orange-400' : ''}`}
          />
        </div>
      </td>
      <td className="py-3 w-8">
        {status === 'saving' && (
          <Loader2 className="h-4 w-4 animate-spin text-gray-400" />
        )}
        {status === 'saved' && (
          <Check className="h-4 w-4 text-green-500" />
        )}
        {status === 'error' && (
          <div title={errorMsg}>
            <AlertCircle className="h-4 w-4 text-red-500" />
          </div>
        )}
      </td>
      <td className="py-3">
        {hasOverride && item.price != null && (() => {
          const override = parseFloat(value);
          const diff = item.price - override;
          if (diff === 0) return null;
          return (
            <Badge
              variant="outline"
              className={`text-xs ${diff > 0 ? 'text-green-600 border-green-200' : 'text-red-500 border-red-200'}`}
            >
              {diff > 0 ? `−${ZAR.format(diff)}` : `+${ZAR.format(Math.abs(diff))}`}
            </Badge>
          );
        })()}
      </td>
    </tr>
  );
}

export default function HappyHourPrices({
  schedule,
  fetchItems,
  fetchPriceSchedules,
  upsertPriceSchedule,
  deletePriceSchedule,
}) {
  const [items, setItems] = useState([]);
  const [priceRows, setPriceRows] = useState([]); // item_price_schedules for this schedule
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [allItems, existingPrices] = await Promise.all([
        fetchItems(),
        fetchPriceSchedules(schedule.id),
      ]);
      setItems(allItems);
      setPriceRows(existingPrices);
    } catch (e) {
      setError(e.message || 'Failed to load data');
    } finally {
      setLoading(false);
    }
  }, [schedule.id, fetchItems, fetchPriceSchedules]);

  useEffect(() => { load(); }, [load]);

  const handleSave = useCallback(async ({ itemId, price, existingId }) => {
    const result = await upsertPriceSchedule({
      itemId,
      menuScheduleId: schedule.id,
      price,
      existingId,
    });
    // Update local priceRows so the row gets the new id
    const newRow = Array.isArray(result) ? result[0] : result;
    if (newRow) {
      setPriceRows((prev) => {
        const without = prev.filter((r) => r.item_id !== itemId);
        return [...without, newRow];
      });
    }
  }, [schedule.id, upsertPriceSchedule]);

  const handleDelete = useCallback(async (id) => {
    await deletePriceSchedule(id);
    setPriceRows((prev) => prev.filter((r) => r.id !== id));
  }, [deletePriceSchedule]);

  if (loading) {
    return (
      <div className="space-y-2 py-4">
        {[...Array(5)].map((_, i) => (
          <div key={i} className="flex gap-4 items-center">
            <Skeleton className="h-5 w-40" />
            <Skeleton className="h-5 w-20" />
            <Skeleton className="h-8 w-32" />
          </div>
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center gap-2 text-sm text-red-600 py-4">
        <AlertCircle className="h-4 w-4" />
        {error}
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="text-center text-sm text-gray-400 py-12">
        <Utensils className="h-8 w-8 mx-auto mb-2 text-gray-300" />
        No items found for this location.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-gray-500">
        Enter an override price for items during this schedule window. Leave blank to use the
        regular price. Changes are saved automatically after 500 ms.
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b">
              <th className="text-left py-2 pr-4 font-medium text-gray-600">Item</th>
              <th className="text-left py-2 pr-4 font-medium text-gray-600">Regular Price</th>
              <th className="text-left py-2 pr-4 font-medium text-gray-600">
                <span className="flex items-center gap-1">
                  <DollarSign className="h-3.5 w-3.5 text-orange-500" />
                  Happy-Hour Price
                </span>
              </th>
              <th className="w-8" />
              <th className="text-left py-2 font-medium text-gray-600">Discount</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => {
              const priceRow = priceRows.find((r) => r.item_id === item.id);
              return (
                <PriceRow
                  key={item.id}
                  item={item}
                  priceRow={priceRow}
                  onSave={handleSave}
                  onDelete={handleDelete}
                />
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
