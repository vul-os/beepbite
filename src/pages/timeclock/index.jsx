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

import { useEffect, useState, useCallback } from 'react';
import { Clock, LogIn, LogOut, Coffee, RefreshCw, Edit2, Check, AlertCircle, Circle } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { PageHeader, PageContainer } from '@/components/ui/page-header';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';

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
  if (type === 'clock_in') return 'success';
  if (type === 'break_start' || type === 'break_end') return 'warning';
  return 'outline';
}

// Derive "is this person currently clocked in, out, or on break" from their
// most recent entry. Entries are appended newest-first by the page (both the
// initial manager load and each fresh clock action), but this re-sorts by
// timestamp defensively rather than trusting array order.
function deriveClockStatus(entries, staffId) {
  if (!staffId) return null;
  const forStaff = entries.filter((e) => e.staff_id === staffId);
  if (forStaff.length === 0) return null;
  const [last] = [...forStaff].sort(
    (a, b) => new Date(b.timestamp) - new Date(a.timestamp)
  );
  if (last.entry_type === 'clock_in' || last.entry_type === 'break_end') return 'in';
  if (last.entry_type === 'break_start') return 'break';
  if (last.entry_type === 'clock_out') return 'out';
  return null;
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
            <div className="flex items-center gap-2 text-destructive text-sm">
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
function ClockPanel({ staff, onAction, entries = [] }) {
  const [selectedId, setSelectedId] = useState('');
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(null); // 'in' | 'out' | null
  const [message, setMessage] = useState(null); // { ok, text }

  const selectedMember = staff.find((s) => s.id === selectedId);
  const selectedName = selectedMember
    ? `${selectedMember.first_name} ${selectedMember.last_name}`
    : '';
  const clockStatus = deriveClockStatus(entries, selectedId);

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

        {/* Current status — unmistakable, persistent (not a toast that fades):
            a staff member picking themselves from this list must never be
            left guessing whether they're already clocked in. */}
        {selectedId && (
          <div
            role="status"
            aria-live="polite"
            className={cn(
              'flex items-center gap-2 rounded-md px-3 py-2 text-sm font-semibold',
              clockStatus === 'in' && 'bg-success/10 text-success',
              clockStatus === 'break' && 'bg-warning/10 text-warning',
              clockStatus === 'out' && 'bg-muted text-muted-foreground',
              !clockStatus && 'bg-muted text-muted-foreground'
            )}
          >
            <Circle
              className={cn(
                'h-2.5 w-2.5 flex-shrink-0',
                clockStatus === 'in' && 'fill-success text-success',
                clockStatus === 'break' && 'fill-warning text-warning',
                (clockStatus === 'out' || !clockStatus) && 'fill-muted-foreground/40 text-muted-foreground/40'
              )}
              aria-hidden="true"
            />
            {clockStatus === 'in' && `${selectedName} is currently clocked in`}
            {clockStatus === 'break' && `${selectedName} is currently on break`}
            {clockStatus === 'out' && `${selectedName} is currently clocked out`}
            {!clockStatus && `No clock history for ${selectedName} yet`}
          </div>
        )}

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
                ? 'bg-success/10 text-success'
                : 'bg-destructive/10 text-destructive'
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
          <p className="text-sm text-muted-foreground text-center py-6">No entries yet.</p>
        ) : (
          <div className="divide-y divide-border max-h-[28rem] overflow-y-auto">
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
                    <span className="text-xs text-muted-foreground truncate tabular-nums">
                      {formatTimestamp(entry.timestamp)}
                    </span>
                  </div>
                  {entry.notes && (
                    <p className="text-xs text-muted-foreground mt-0.5 truncate">{entry.notes}</p>
                  )}
                </div>
                {isManager && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => setEditingEntry(entry)}
                    className="shrink-0 h-7 w-7 text-muted-foreground hover:text-foreground"
                    aria-label="Edit entry"
                  >
                    <Edit2 className="h-4 w-4" />
                  </Button>
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
    // listEntries is a manager-only endpoint; non-managers get a silent 403.
    if (!isManager) return;
    setLoadingEntries(true);
    const result = await listEntries({ limit: 100 });
    if (result.ok) setEntries(result.data);
    setLoadingEntries(false);
  }, [isManager]);

  useEffect(() => { loadStaff(); }, [loadStaff]);
  // Only managers may list time entries — gate the fetch so non-managers
  // don't trigger a 403 on mount.
  useEffect(() => { if (isManager) loadEntries(); }, [isManager, loadEntries]);

  const handleAction = (newEntry) => {
    setEntries((prev) => [newEntry, ...prev]);
  };

  const handleEntryEdited = (updated) => {
    setEntries((prev) => prev.map((e) => (e.id === updated.id ? updated : e)));
  };

  return (
    <PageContainer className="max-w-5xl mx-auto">
      <PageHeader
        icon={Clock}
        title="Time Clock"
        description={`Record staff clock-ins and clock-outs.${isManager ? ' Manager edit is enabled for your account.' : ''}`}
      />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div>
          {loadingStaff ? (
            <Card>
              <CardContent className="py-12 text-center text-sm text-muted-foreground">
                Loading staff…
              </CardContent>
            </Card>
          ) : (
            <ClockPanel staff={staff} onAction={handleAction} entries={entries} />
          )}
        </div>
        {/* Time entries are manager-only; non-managers never see this panel. */}
        {isManager && (
          <div>
            {loadingEntries ? (
              <Card>
                <CardContent className="py-12 text-center text-sm text-muted-foreground">
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
        )}
      </div>
    </PageContainer>
  );
}
