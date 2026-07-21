// hours-grid.jsx — 7-row grid (Mon-Sun) of time-window slots per day.
// day_of_week follows ISO: 1=Monday … 7=Sunday (matches the DB CHECK constraint).

import { useCallback, useEffect, useState } from 'react';
import { Plus, Trash2, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';

const DAYS = [
  { label: 'Monday',    iso: 1 },
  { label: 'Tuesday',   iso: 2 },
  { label: 'Wednesday', iso: 3 },
  { label: 'Thursday',  iso: 4 },
  { label: 'Friday',    iso: 5 },
  { label: 'Saturday',  iso: 6 },
  { label: 'Sunday',    iso: 7 },
];

function SlotRow({ slot, onDelete, deleting }) {
  return (
    <div className="flex items-center gap-2 py-1">
      <span className="text-sm tabular-nums text-foreground w-20">{slot.start_time}</span>
      <span className="text-muted-foreground text-xs">–</span>
      <span className="text-sm tabular-nums text-foreground w-20">{slot.end_time}</span>
      {slot.end_time < slot.start_time && (
        <span className="text-xs text-amber-600 italic">+1 day</span>
      )}
      <Button
        size="sm"
        variant="ghost"
        onClick={() => onDelete(slot.id)}
        disabled={deleting === slot.id}
        className="h-6 w-6 p-0 text-red-400 hover:text-red-600 hover:bg-red-50"
      >
        <Trash2 className="h-3 w-3" />
      </Button>
    </div>
  );
}

function AddSlotInline({ dayIso, onAdd }) {
  const [open, setOpen] = useState(false);
  const [start, setStart] = useState('09:00');
  const [end, setEnd] = useState('11:00');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  const handleSave = async () => {
    if (!start || !end) { setErr('Both times are required.'); return; }
    setSaving(true);
    setErr('');
    try {
      await onAdd({ dayOfWeek: dayIso, startTime: start, endTime: end });
      setOpen(false);
    } catch (e) {
      setErr(e.message || 'Failed to add slot');
    } finally {
      setSaving(false);
    }
  };

  if (!open) {
    return (
      <Button
        size="sm"
        variant="ghost"
        onClick={() => setOpen(true)}
        className="h-6 text-xs text-muted-foreground hover:text-orange-600 px-1 gap-1"
      >
        <Plus className="h-3 w-3" />
        Add slot
      </Button>
    );
  }

  return (
    <div className="flex flex-col gap-1 mt-1 p-2 bg-muted rounded border border-border">
      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex items-center gap-1">
          <label className="text-xs text-muted-foreground w-10">From</label>
          <input
            type="time"
            value={start}
            onChange={(e) => setStart(e.target.value)}
            className="text-sm border border-border rounded px-1 py-0.5 focus:outline-none focus:ring-1 focus:ring-orange-400"
          />
        </div>
        <div className="flex items-center gap-1">
          <label className="text-xs text-muted-foreground w-10">To</label>
          <input
            type="time"
            value={end}
            onChange={(e) => setEnd(e.target.value)}
            className="text-sm border border-border rounded px-1 py-0.5 focus:outline-none focus:ring-1 focus:ring-orange-400"
          />
        </div>
        <div className="flex gap-1">
          <Button
            size="sm"
            onClick={handleSave}
            disabled={saving}
            className="h-6 text-xs bg-orange-500 hover:bg-orange-600 text-white px-2"
          >
            {saving ? '…' : 'Save'}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => { setOpen(false); setErr(''); }}
            className="h-6 text-xs px-2"
          >
            Cancel
          </Button>
        </div>
      </div>
      {err && (
        <p className="text-xs text-red-500 flex items-center gap-1">
          <AlertCircle className="h-3 w-3" />
          {err}
        </p>
      )}
    </div>
  );
}

export default function HoursGrid({ schedule, fetchSlots, addSlot, deleteSlot }) {
  const [slots, setSlots] = useState([]);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await fetchSlots(schedule.id);
      setSlots(data);
    } catch (e) {
      setError(e.message || 'Failed to load slots');
    } finally {
      setLoading(false);
    }
  }, [schedule.id, fetchSlots]);

  useEffect(() => { load(); }, [load]);

  const handleAdd = useCallback(async ({ dayOfWeek, startTime, endTime }) => {
    await addSlot({ menuScheduleId: schedule.id, dayOfWeek, startTime, endTime });
    await load();
  }, [schedule.id, addSlot, load]);

  const handleDelete = useCallback(async (id) => {
    setDeleting(id);
    try {
      await deleteSlot(id);
      setSlots((prev) => prev.filter((s) => s.id !== id));
    } catch (e) {
      alert(e.message || 'Failed to delete slot');
    } finally {
      setDeleting(null);
    }
  }, [deleteSlot]);

  if (loading) {
    return (
      <div className="space-y-3 py-4">
        {DAYS.map((d) => (
          <div key={d.iso} className="flex gap-4">
            <Skeleton className="h-6 w-24" />
            <Skeleton className="h-6 w-40" />
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

  const slotsByDay = DAYS.reduce((acc, d) => {
    acc[d.iso] = slots.filter((s) => s.day_of_week === d.iso);
    return acc;
  }, {});

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b">
            <th className="text-left py-2 pr-6 font-medium text-muted-foreground w-32">Day</th>
            <th className="text-left py-2 font-medium text-muted-foreground">Time Windows</th>
          </tr>
        </thead>
        <tbody>
          {DAYS.map((d) => (
            <tr key={d.iso} className="border-b last:border-0 align-top">
              <td className="py-3 pr-6 font-medium text-foreground">{d.label}</td>
              <td className="py-3">
                {slotsByDay[d.iso].length === 0 && (
                  <span className="text-xs text-muted-foreground italic">No windows</span>
                )}
                {slotsByDay[d.iso].map((slot) => (
                  <SlotRow key={slot.id} slot={slot} onDelete={handleDelete} deleting={deleting} />
                ))}
                <AddSlotInline dayIso={d.iso} onAdd={handleAdd} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
