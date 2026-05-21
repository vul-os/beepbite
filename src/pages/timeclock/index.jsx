// src/pages/timeclock/index.jsx
// Route: /timeclock
//
// Two-panel timeclock page:
//   • Left  — staff clock-in / clock-out via PIN selection from a list.
//   • Right — manager view: full entry list with inline edit capability
//             (requires can_manage_staff capability).
//
// The page uses the api-client's actor-overlay mechanism, so X-Actor-Token is
// attached automatically when a staff PIN overlay is active.

import React, { useEffect, useState, useCallback } from 'react';
import { Clock, LogIn, LogOut, Coffee, RefreshCw, Edit2, X, Check, AlertCircle } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

import { useAuth } from '@/context/auth-context';
import {
  clockIn,
  clockOut,
  listEntries,
  editEntry,
  formatTimestamp,
  entryTypeLabel,
} from '@/services/timeclock';
import { supabase } from '@/services/supabase-client';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function badgeVariant(type) {
  return type === 'clock_in'
    ? 'default'
    : type === 'clock_out'
    ? 'secondary'
    : 'outline';
}

// ---------------------------------------------------------------------------
// Edit entry dialog (manager)
// ---------------------------------------------------------------------------
function EditEntryDialog({ entry, onClose, onSaved }) {
  const [entryType, setEntryType] = useState(entry.entry_type);
  const [timestamp, setTimestamp] = useState(
    entry.timestamp ? entry.timestamp.slice(0, 16) : ''
  );
  const [notes, setNotes] = useState(entry.notes || '');
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    const result = await editEntry(entry.id, {
      entryType: entryType !== entry.entry_type ? entryType : undefined,
      timestamp: timestamp ? new Date(timestamp).toISOString() : undefined,
      notes,
      reason,
    });
    setSaving(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    onSaved(result.data);
    onClose();
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Edit Time Entry</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 pt-2">
          <div>
            <label className="block text-sm font-medium mb-1">Entry type</label>
            <Select value={entryType} onValueChange={setEntryType}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="clock_in">Clock In</SelectItem>
                <SelectItem value="clock_out">Clock Out</SelectItem>
                <SelectItem value="break_start">Break Start</SelectItem>
                <SelectItem value="break_end">Break End</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Timestamp</label>
            <Input
              type="datetime-local"
              value={timestamp}
              onChange={(e) => setTimestamp(e.target.value)}
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Notes</label>
            <Input
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Optional notes"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Reason for edit</label>
            <Input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Corrected missed clock-out"
            />
          </div>
          {error && (
            <div className="flex items-center gap-2 text-red-600 text-sm">
              <AlertCircle className="h-4 w-4 shrink-0" />
              {error}
            </div>
          )}
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={onClose} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? 'Saving…' : 'Save changes'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Clock action panel
// ---------------------------------------------------------------------------
function ClockPanel({ staff, onAction }) {
  const [selectedId, setSelectedId] = useState('');
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(null); // 'in' | 'out' | null
  const [message, setMessage] = useState(null); // { ok, text }

  const doAction = async (action) => {
    if (!selectedId) return;
    setLoading(action);
    setMessage(null);

    const fn = action === 'in' ? clockIn : clockOut;
    const result = await fn(selectedId, notes);

    setLoading(null);
    if (!result.ok) {
      setMessage({ ok: false, text: result.error });
      return;
    }
    const member = staff.find((s) => s.id === selectedId);
    const label = member ? `${member.first_name} ${member.last_name}` : selectedId;
    const verb = action === 'in' ? 'clocked in' : 'clocked out';
    setMessage({ ok: true, text: `${label} ${verb} successfully.` });
    setNotes('');
    onAction(result.data);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Clock className="h-5 w-5" /> Clock In / Out
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <label className="block text-sm font-medium mb-1">Staff member</label>
          <Select value={selectedId} onValueChange={setSelectedId}>
            <SelectTrigger>
              <SelectValue placeholder="Select staff…" />
            </SelectTrigger>
            <SelectContent>
              {staff.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.first_name} {s.last_name}
                  {s.role ? ` (${s.role})` : ''}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Notes (optional)</label>
          <Input
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Any notes for this entry"
          />
        </div>
        <div className="flex gap-3">
          <Button
            className="flex-1"
            onClick={() => doAction('in')}
            disabled={!selectedId || !!loading}
          >
            <LogIn className="h-4 w-4 mr-2" />
            {loading === 'in' ? 'Clocking in…' : 'Clock In'}
          </Button>
          <Button
            variant="outline"
            className="flex-1"
            onClick={() => doAction('out')}
            disabled={!selectedId || !!loading}
          >
            <LogOut className="h-4 w-4 mr-2" />
            {loading === 'out' ? 'Clocking out…' : 'Clock Out'}
          </Button>
        </div>
        {message && (
          <div
            className={`flex items-center gap-2 text-sm rounded-md p-2 ${
              message.ok
                ? 'bg-green-50 text-green-700 dark:bg-green-950 dark:text-green-300'
                : 'bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300'
            }`}
          >
            {message.ok ? (
              <Check className="h-4 w-4 shrink-0" />
            ) : (
              <AlertCircle className="h-4 w-4 shrink-0" />
            )}
            {message.text}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Entries list (manager)
// ---------------------------------------------------------------------------
function EntriesPanel({ entries, isManager, onRefresh, onEntryEdited }) {
  const [editingEntry, setEditingEntry] = useState(null);
  const [filterStaffId, setFilterStaffId] = useState('');

  const filtered = filterStaffId
    ? entries.filter((e) => e.staff_id === filterStaffId)
    : entries;

  const staffIds = [...new Set(entries.map((e) => e.staff_id))];

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-3">
        <CardTitle className="flex items-center gap-2">
          <Coffee className="h-5 w-5" /> Time Entries
        </CardTitle>
        <Button variant="ghost" size="sm" onClick={onRefresh} aria-label="Refresh entries">
          <RefreshCw className="h-4 w-4" />
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        {isManager && staffIds.length > 1 && (
          <Select value={filterStaffId} onValueChange={setFilterStaffId}>
            <SelectTrigger className="h-8 text-xs">
              <SelectValue placeholder="Filter by staff…" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="">All staff</SelectItem>
              {staffIds.map((id) => (
                <SelectItem key={id} value={id}>
                  {id.slice(0, 8)}…
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        {filtered.length === 0 ? (
          <p className="text-sm text-gray-500 text-center py-6">No entries yet.</p>
        ) : (
          <div className="divide-y divide-gray-100 dark:divide-gray-800 max-h-[28rem] overflow-y-auto">
            {filtered.map((entry) => (
              <div
                key={entry.id}
                className="flex items-center justify-between py-2 gap-2"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge variant={badgeVariant(entry.entry_type)} className="text-xs shrink-0">
                      {entryTypeLabel(entry.entry_type)}
                    </Badge>
                    <span className="text-xs text-gray-500 truncate">
                      {formatTimestamp(entry.timestamp)}
                    </span>
                  </div>
                  {entry.notes && (
                    <p className="text-xs text-gray-400 mt-0.5 truncate">{entry.notes}</p>
                  )}
                </div>
                {isManager && (
                  <button
                    type="button"
                    onClick={() => setEditingEntry(entry)}
                    className="shrink-0 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                    aria-label="Edit entry"
                  >
                    <Edit2 className="h-4 w-4" />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>

      {editingEntry && (
        <EditEntryDialog
          entry={editingEntry}
          onClose={() => setEditingEntry(null)}
          onSaved={(updated) => {
            onEntryEdited(updated);
            setEditingEntry(null);
          }}
        />
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Page root
// ---------------------------------------------------------------------------
export default function TimeClockPage() {
  const { activeLocation } = useAuth();
  const [staff, setStaff] = useState([]);
  const [entries, setEntries] = useState([]);
  const [loadingStaff, setLoadingStaff] = useState(true);
  const [loadingEntries, setLoadingEntries] = useState(true);
  const [isManager, setIsManager] = useState(false);

  // Detect manager capability from the active session.
  useEffect(() => {
    const raw = localStorage.getItem('bb.auth');
    if (!raw) {
      // Supabase session → owner/admin → treat as manager.
      setIsManager(true);
      return;
    }
    try {
      const session = JSON.parse(raw);
      const caps = session.capabilities || session.staff?.capabilities || [];
      setIsManager(Array.isArray(caps) && caps.includes('can_manage_staff'));
    } catch {
      setIsManager(false);
    }
  }, []);

  // Load staff list from Supabase (uses existing Supabase client for staff listing —
  // the timeclock actions themselves go through the Go backend via api-client).
  const loadStaff = useCallback(async () => {
    if (!activeLocation) return;
    setLoadingStaff(true);
    const { data } = await supabase
      .from('staff')
      .select('id, first_name, last_name, role, is_active')
      .eq('location_id', activeLocation.id)
      .eq('is_active', true)
      .order('first_name');
    setStaff(data || []);
    setLoadingStaff(false);
  }, [activeLocation]);

  const loadEntries = useCallback(async () => {
    setLoadingEntries(true);
    const result = await listEntries({ limit: 100 });
    if (result.ok) setEntries(result.data);
    setLoadingEntries(false);
  }, []);

  useEffect(() => { loadStaff(); }, [loadStaff]);
  useEffect(() => { loadEntries(); }, [loadEntries]);

  const handleAction = (newEntry) => {
    setEntries((prev) => [newEntry, ...prev]);
  };

  const handleEntryEdited = (updated) => {
    setEntries((prev) => prev.map((e) => (e.id === updated.id ? updated : e)));
  };

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Time Clock</h1>
        <p className="text-sm text-gray-500 mt-1">
          Record staff clock-ins and clock-outs.
          {isManager && ' Manager edit is enabled for your account.'}
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div>
          {loadingStaff ? (
            <Card>
              <CardContent className="py-12 text-center text-sm text-gray-500">
                Loading staff…
              </CardContent>
            </Card>
          ) : (
            <ClockPanel staff={staff} onAction={handleAction} />
          )}
        </div>
        <div>
          {loadingEntries ? (
            <Card>
              <CardContent className="py-12 text-center text-sm text-gray-500">
                Loading entries…
              </CardContent>
            </Card>
          ) : (
            <EntriesPanel
              entries={entries}
              isManager={isManager}
              onRefresh={loadEntries}
              onEntryEdited={handleEntryEdited}
            />
          )}
        </div>
      </div>
    </div>
  );
}
