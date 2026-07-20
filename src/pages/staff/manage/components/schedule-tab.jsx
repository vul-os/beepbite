import React, { useState, useEffect, useCallback } from 'react';
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
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { useDateTime } from '@/context/locale-context';
import { ChevronLeft, ChevronRight, Plus, Trash2, AlertTriangle } from 'lucide-react';

// ── date helpers ─────────────────────────────────────────────────────────────

function startOfWeek(date) {
  const d = new Date(date);
  const day = d.getDay(); // 0=Sun
  d.setDate(d.getDate() - day);
  return d;
}

function addDays(date, n) {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}

// `date` here was already moved onto the right calendar day by local
// getDate()/setDate() arithmetic above, so read that same local day back out
// directly. `date.toISOString().slice(0, 10)` would instead render the UTC
// date — for roughly half the globe that silently shifts every day in this
// week grid (and the shift_date sent to the API) by one.
function toISO(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function fmt(date) {
  return date.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

function fmtShort(date) {
  return date.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric' });
}

// ── shift cell ───────────────────────────────────────────────────────────────

function ShiftCell({ shift, onDelete, deleting }) {
  return (
    <div className="relative group flex flex-col gap-0.5 rounded-md bg-orange-50 border border-orange-200 px-2 py-1.5 text-xs">
      <span className="font-semibold text-orange-800 leading-tight">
        {shift.scheduled_start} – {shift.scheduled_end}
      </span>
      {shift.notes && (
        <span className="text-orange-600 truncate">{shift.notes}</span>
      )}
      <Badge
        variant="outline"
        className={cn(
          'absolute top-1 right-1 text-[9px] px-1 py-0 capitalize opacity-0 group-hover:opacity-100 transition-opacity',
          shift.status === 'completed' && 'bg-green-50 text-green-700 border-green-200',
          shift.status === 'scheduled' && 'bg-blue-50 text-blue-700 border-blue-200',
          shift.status === 'no_show'   && 'bg-red-50 text-red-600 border-red-200',
        )}
      >
        {shift.status}
      </Badge>
      <button
        type="button"
        onClick={() => onDelete(shift)}
        disabled={deleting}
        className="absolute bottom-1 right-1 opacity-0 group-hover:opacity-100 transition-opacity text-red-400 hover:text-red-600"
        aria-label="Delete shift"
      >
        <Trash2 className="w-3 h-3" />
      </button>
    </div>
  );
}

// ── create dialog ─────────────────────────────────────────────────────────────

function CreateShiftDialog({ open, onOpenChange, date, staff, locationId, onSubmit }) {
  const [form, setForm] = useState({ start: '09:00', end: '17:00', notes: '' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const set = (k, v) => setForm((p) => ({ ...p, [k]: v }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (form.start >= form.end) { setError('End time must be after start time.'); return; }
    setSaving(true);
    setError('');
    const payload = {
      staff_id: staff.id,
      location_id: locationId,
      shift_date: date,
      scheduled_start: form.start,
      scheduled_end: form.end,
      notes: form.notes || undefined,
      status: 'scheduled',
    };
    const { error: apiErr } = await onSubmit(payload);
    setSaving(false);
    if (apiErr) { setError(apiErr.message); return; }
    onOpenChange(false);
    setForm({ start: '09:00', end: '17:00', notes: '' });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm bg-white">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Plus className="w-4 h-4 text-orange-500" />
            Add shift
          </DialogTitle>
          <DialogDescription>
            Schedule a shift for {staff.first_name} on {date}.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 mt-2">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="start">Start</Label>
              <Input
                id="start"
                type="time"
                value={form.start}
                onChange={(e) => set('start', e.target.value)}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="end">End</Label>
              <Input
                id="end"
                type="time"
                value={form.end}
                onChange={(e) => set('end', e.target.value)}
                required
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="shift_notes">Notes (optional)</Label>
            <Input
              id="shift_notes"
              placeholder="e.g. Opening shift"
              value={form.notes}
              onChange={(e) => set('notes', e.target.value)}
            />
          </div>
          {error && (
            <p className="text-sm text-red-600 flex items-center gap-1">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
              {error}
            </p>
          )}
          <div className="flex gap-3 pt-1">
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
              {saving ? 'Saving…' : 'Add shift'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ── Tab ──────────────────────────────────────────────────────────────────────

export function ScheduleTab({ staff, locationId, shifts, loading, error, fetchShifts, createShift, deleteShift }) {
  const { today } = useDateTime();
  const [weekAnchor, setWeekAnchor] = useState(() => startOfWeek(new Date()));
  const [createDate, setCreateDate] = useState(null);
  const [deleting, setDeleting] = useState(null);

  const weekDays = Array.from({ length: 7 }, (_, i) => addDays(weekAnchor, i));
  const weekStart = toISO(weekAnchor);
  const weekEnd   = toISO(addDays(weekAnchor, 6));

  useEffect(() => {
    if (staff) fetchShifts(staff.id, weekStart, weekEnd);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [staff?.id, weekStart]);

  const shiftsByDate = shifts.reduce((acc, s) => {
    acc[s.shift_date] = acc[s.shift_date] ?? [];
    acc[s.shift_date].push(s);
    return acc;
  }, {});

  const handleDelete = async (shift) => {
    if (!confirm('Delete this shift?')) return;
    setDeleting(shift.id);
    await deleteShift(shift.id, staff.id, weekStart, weekEnd);
    setDeleting(null);
  };

  const prevWeek = () => setWeekAnchor((w) => addDays(w, -7));
  const nextWeek = () => setWeekAnchor((w) => addDays(w, 7));
  // The store's local trading date, not `new Date().toISOString().slice(0, 10)`.
  const todayStr = today();

  return (
    <div className="space-y-4">
      {/* week nav */}
      <div className="flex items-center justify-between">
        <Button variant="ghost" size="sm" onClick={prevWeek} className="text-gray-600">
          <ChevronLeft className="w-4 h-4" />
        </Button>
        <p className="text-sm font-semibold text-gray-800">
          {fmt(weekAnchor)} – {fmt(addDays(weekAnchor, 6))}
        </p>
        <Button variant="ghost" size="sm" onClick={nextWeek} className="text-gray-600">
          <ChevronRight className="w-4 h-4" />
        </Button>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      {/* week grid */}
      <div className="grid grid-cols-7 gap-1">
        {weekDays.map((day) => {
          const iso = toISO(day);
          const dayShifts = shiftsByDate[iso] ?? [];
          const isToday = iso === todayStr;
          return (
            <div key={iso} className="flex flex-col gap-1">
              {/* header */}
              <div
                className={cn(
                  'text-center text-xs font-medium py-1 rounded-t-md',
                  isToday ? 'bg-orange-500 text-white' : 'bg-gray-50 text-gray-500',
                )}
              >
                {fmtShort(day)}
              </div>

              {/* shifts */}
              <div className="flex-1 min-h-[80px] border border-gray-100 rounded-b-md p-1 space-y-1 bg-white relative">
                {loading ? (
                  <Skeleton className="h-10 rounded" />
                ) : (
                  dayShifts.map((s) => (
                    <ShiftCell
                      key={s.id}
                      shift={s}
                      onDelete={handleDelete}
                      deleting={deleting === s.id}
                    />
                  ))
                )}
                {/* add button on hover */}
                <button
                  type="button"
                  onClick={() => setCreateDate(iso)}
                  className="absolute inset-0 flex items-end justify-center pb-1 opacity-0 hover:opacity-100 transition-opacity"
                  aria-label={`Add shift on ${iso}`}
                >
                  <span className="w-5 h-5 rounded-full bg-orange-100 border border-orange-300 flex items-center justify-center text-orange-600">
                    <Plus className="w-3 h-3" />
                  </span>
                </button>
              </div>
            </div>
          );
        })}
      </div>

      <p className="text-xs text-gray-400 text-center">
        Click the + on any day cell to add a shift. Hover a shift to delete.
      </p>

      {createDate && (
        <CreateShiftDialog
          open={!!createDate}
          onOpenChange={(v) => { if (!v) setCreateDate(null); }}
          date={createDate}
          staff={staff}
          locationId={locationId}
          onSubmit={createShift}
        />
      )}
    </div>
  );
}
