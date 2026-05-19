// items-picker.jsx — checkbox list of all location items; toggling links/unlinks
// an item to the selected menu schedule via item_menu_schedules.

import React, { useCallback, useEffect, useState } from 'react';
import { Search, AlertCircle, Utensils } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';

export default function ItemsPicker({
  schedule,
  fetchItems,
  fetchItemSchedules,
  addItemSchedule,
  deleteItemSchedule,
}) {
  const [items, setItems] = useState([]);
  const [linked, setLinked] = useState([]); // item_menu_schedules rows for this schedule
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [toggling, setToggling] = useState(null); // item id being toggled

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [allItems, schedLinks] = await Promise.all([
        fetchItems(),
        fetchItemSchedules(schedule.id),
      ]);
      setItems(allItems);
      setLinked(schedLinks);
    } catch (e) {
      setError(e.message || 'Failed to load items');
    } finally {
      setLoading(false);
    }
  }, [schedule.id, fetchItems, fetchItemSchedules]);

  useEffect(() => { load(); }, [load]);

  const linkedSet = new Set(linked.map((l) => l.item_id));

  const handleToggle = useCallback(async (item) => {
    setToggling(item.id);
    try {
      if (linkedSet.has(item.id)) {
        const row = linked.find((l) => l.item_id === item.id);
        await deleteItemSchedule(row.id);
        setLinked((prev) => prev.filter((l) => l.item_id !== item.id));
      } else {
        const created = await addItemSchedule({ itemId: item.id, menuScheduleId: schedule.id });
        const newRow = Array.isArray(created) ? created[0] : created;
        if (newRow) {
          setLinked((prev) => [...prev, newRow]);
        } else {
          // fallback: optimistic local update
          setLinked((prev) => [...prev, { item_id: item.id, menu_schedule_id: schedule.id }]);
        }
      }
    } catch (e) {
      alert(e.message || 'Failed to update item schedule');
    } finally {
      setToggling(null);
    }
  }, [linked, linkedSet, schedule.id, addItemSchedule, deleteItemSchedule]);

  const filtered = items.filter((item) =>
    item.name.toLowerCase().includes(search.toLowerCase()),
  );

  if (loading) {
    return (
      <div className="space-y-3 py-4">
        {[...Array(5)].map((_, i) => (
          <div key={i} className="flex items-center gap-3">
            <Skeleton className="h-4 w-4 rounded" />
            <Skeleton className="h-4 w-48" />
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

  return (
    <div className="space-y-4">
      {/* search */}
      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
        <Input
          placeholder="Search items…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9"
        />
      </div>

      {/* count summary */}
      <p className="text-xs text-gray-500">
        {linked.length} of {items.length} items linked to this schedule.
        {items.length === 0 && ' Items not linked to any schedule are available at all times.'}
      </p>

      {/* list */}
      {filtered.length === 0 ? (
        <div className="text-center text-sm text-gray-400 py-8">
          <Utensils className="h-8 w-8 mx-auto mb-2 text-gray-300" />
          {search ? 'No items match your search.' : 'No items found for this location.'}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
          {filtered.map((item) => {
            const isLinked = linkedSet.has(item.id);
            const isToggling = toggling === item.id;
            const checkId = `item-check-${item.id}`;
            return (
              <div
                key={item.id}
                className={`flex items-center gap-3 p-3 rounded-lg border transition-colors cursor-pointer ${
                  isLinked ? 'border-orange-300 bg-orange-50' : 'border-gray-200 hover:border-gray-300'
                }`}
                onClick={() => !isToggling && handleToggle(item)}
              >
                <Checkbox
                  id={checkId}
                  checked={isLinked}
                  disabled={isToggling}
                  onCheckedChange={() => handleToggle(item)}
                  className="shrink-0"
                />
                <div className="min-w-0 flex-1">
                  <Label htmlFor={checkId} className="text-sm font-medium cursor-pointer truncate block">
                    {item.name}
                  </Label>
                  {item.price != null && (
                    <span className="text-xs text-gray-500">
                      {new Intl.NumberFormat('en-ZA', { style: 'currency', currency: 'ZAR' }).format(item.price)}
                    </span>
                  )}
                </div>
                {isToggling && (
                  <div className="h-3 w-3 rounded-full border-2 border-orange-500 border-t-transparent animate-spin shrink-0" />
                )}
                {isLinked && !isToggling && (
                  <Badge className="text-xs bg-orange-500 text-white shrink-0">On</Badge>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
