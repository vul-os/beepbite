// /floor/edit — drag-to-arrange editor for dine-in tables.
//
// - Drag tiles around a snap-to-grid canvas; PATCH /tables/{id} is debounced
//   500ms per table so a continuous drag flurry collapses into one write.
// - Section tabs filter which tables show. Switching sections does NOT
//   reassign tables; assigning a table to a section is currently done via
//   the "Add table" dialog (uses the currently selected section).
// - Add Table dialog (shadcn) → POST /tables. New rows land at (32, 32).
// - Undo last move: in-memory stack of {id, prev}. Pops one position back.
//   Backend redo is not implemented (intentional).

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertCircle,
  ArrowLeft,
  Eye,
  LayoutGrid,
  Loader2,
  Plus,
  Sparkles,
  Undo2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useAuth } from '@/context/auth-context';
import { api } from '@/lib/api-client';
import { useTables } from './hooks/use-tables';
import SectionTabs from './components/section-tabs';
import FloorCanvas from './components/floor-canvas';
import AIFloorModal from './components/ai-floor-modal';

const PATCH_DEBOUNCE_MS = 500;
const DEFAULT_DROP = { pos_x: 32, pos_y: 32 };

export default function FloorEditor() {
  const { activeLocation } = useAuth();
  const locationId = activeLocation?.id;

  const {
    sections,
    tables,
    loading,
    error,
    refresh,
    patchTableLocal,
    addTableLocal,
  } = useTables(locationId);

  const [activeSection, setActiveSection] = useState('all');
  const [undoStack, setUndoStack] = useState([]); // [{id, prev:{pos_x,pos_y}}]
  const [savingIds, setSavingIds] = useState(() => new Set());
  const [flash, setFlash] = useState(null);
  const [addOpen, setAddOpen] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);

  // Per-table debounce timers for PATCH calls.
  const patchTimers = useRef(new Map());

  useEffect(() => () => {
    for (const t of patchTimers.current.values()) clearTimeout(t);
    patchTimers.current.clear();
  }, []);

  const visibleTables = useMemo(() => {
    if (activeSection === 'all') return tables;
    return tables.filter((t) => t.section_id === activeSection);
  }, [tables, activeSection]);

  const counts = useMemo(() => {
    const c = { all: tables.length };
    for (const s of sections) c[s.id] = 0;
    for (const t of tables) if (t.section_id && c[t.section_id] != null) c[t.section_id]++;
    return c;
  }, [tables, sections]);

  const markSaving = (id, on) => {
    setSavingIds((prev) => {
      const next = new Set(prev);
      if (on) next.add(id); else next.delete(id);
      return next;
    });
  };

  const persistPatch = useCallback(async (id, body) => {
    markSaving(id, true);
    try {
      const { error: err } = await api.request('PATCH', `/tables/${id}`, { body });
      if (err) throw new Error(err.message || 'PATCH failed');
    } catch (e) {
      setFlash({ type: 'err', message: `Save failed: ${e.message}` });
    } finally {
      markSaving(id, false);
    }
  }, []);

  const queuePatch = useCallback((id, body) => {
    const existing = patchTimers.current.get(id);
    if (existing) clearTimeout(existing);
    const t = setTimeout(() => {
      patchTimers.current.delete(id);
      persistPatch(id, body);
    }, PATCH_DEBOUNCE_MS);
    patchTimers.current.set(id, t);
  }, [persistPatch]);

  const handleDragPersist = useCallback((table, next) => {
    const prev = { pos_x: Number(table.pos_x) || 0, pos_y: Number(table.pos_y) || 0 };
    if (prev.pos_x === next.pos_x && prev.pos_y === next.pos_y) return;
    setUndoStack((s) => [...s, { id: table.id, prev }]);
    patchTableLocal(table.id, next);
    queuePatch(table.id, next);
  }, [patchTableLocal, queuePatch]);

  const handleUndo = useCallback(() => {
    setUndoStack((stack) => {
      if (!stack.length) return stack;
      const last = stack[stack.length - 1];
      patchTableLocal(last.id, last.prev);
      queuePatch(last.id, last.prev);
      return stack.slice(0, -1);
    });
  }, [patchTableLocal, queuePatch]);

  if (!activeLocation) {
    return (
      <div className="flex flex-col items-center justify-center py-16">
        <AlertCircle className="w-12 h-12 text-muted-foreground mb-3" />
        <h2 className="text-xl font-semibold">No location selected</h2>
        <p className="text-muted-foreground mt-1">Pick a location to edit its floor layout.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Button asChild variant="ghost" size="icon">
            <Link to="/floor" aria-label="Back to live floor">
              <ArrowLeft className="h-5 w-5" />
            </Link>
          </Button>
          <div>
            <h1 className="font-display text-3xl font-extrabold flex items-center gap-2">
              <LayoutGrid className="w-7 h-7 text-primary" />
              Floor Editor
            </h1>
            <p className="text-muted-foreground mt-1 text-sm">
              Drag to reposition; changes save automatically. Snap is 16px.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={handleUndo} disabled={!undoStack.length}>
            <Undo2 className="h-4 w-4 mr-2" />
            Undo {undoStack.length ? `(${undoStack.length})` : ''}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setAiOpen(true)}
            className="border-primary/30 text-primary hover:bg-primary/10 hover:border-primary/50 hover:text-primary"
          >
            <Sparkles className="h-4 w-4 mr-2" />
            AI floor plan
          </Button>
          <Button
            size="sm"
            onClick={() => setAddOpen(true)}
            disabled={sections.length === 0}
            title={sections.length === 0 ? 'Create a section first' : ''}
          >
            <Plus className="h-4 w-4 mr-2" />
            Add Table
          </Button>
          <Button asChild variant="ghost" size="sm">
            <Link to="/floor">
              <Eye className="h-4 w-4 mr-2" />
              Live view
            </Link>
          </Button>
        </div>
      </div>

      {flash && (
        <div
          className={`rounded-md border px-3 py-2 text-sm ${
            flash.type === 'ok'
              ? 'border-success/30 bg-success/10 text-success'
              : 'border-destructive/30 bg-destructive/10 text-destructive'
          }`}
        >
          {flash.message}
        </div>
      )}

      {error && !loading ? (
        <Card>
          <CardContent className="p-6 text-center">
            <AlertCircle className="h-8 w-8 text-destructive mx-auto mb-2" />
            <h3 className="font-medium text-foreground mb-1">Couldn&apos;t load floor</h3>
            <p className="text-sm text-muted-foreground mb-4">{error}</p>
            <Button size="sm" variant="outline" onClick={refresh}>Try again</Button>
          </CardContent>
        </Card>
      ) : (
        <>
          <SectionTabs
            sections={sections}
            value={activeSection}
            onValueChange={setActiveSection}
            counts={counts}
          />

          {loading && tables.length === 0 ? (
            <Card>
              <CardContent className="p-12 text-center text-muted-foreground">
                <Loader2 className="h-5 w-5 animate-spin mx-auto mb-2" />
                Loading…
              </CardContent>
            </Card>
          ) : sections.length === 0 ? (
            <Card>
              <CardContent className="p-10 text-center">
                <LayoutGrid className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
                <h3 className="font-medium text-foreground mb-1">No sections yet</h3>
                <p className="text-sm text-muted-foreground">
                  Create a floor section (e.g. &quot;Main Room&quot;, &quot;Patio&quot;) before adding tables.
                  Section management lives in Settings.
                </p>
              </CardContent>
            </Card>
          ) : visibleTables.length === 0 ? (
            <Card>
              <CardContent className="p-8 text-center text-muted-foreground text-sm">
                No tables in this section yet. Click &quot;Add Table&quot; to drop one in.
              </CardContent>
            </Card>
          ) : (
            <FloorCanvas
              tables={visibleTables}
              editable
              onDragPersist={handleDragPersist}
              busyIds={savingIds}
            />
          )}
        </>
      )}

      <AddTableDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        sections={sections}
        defaultSectionId={activeSection !== 'all' ? activeSection : sections[0]?.id}
        locationId={locationId}
        onCreated={(row) => {
          addTableLocal(row);
          setFlash({ type: 'ok', message: `Added ${row.label}` });
        }}
      />

      <AIFloorModal
        open={aiOpen}
        onOpenChange={setAiOpen}
        locationId={locationId}
        onApplied={() => {
          refresh();
          setFlash({ type: 'ok', message: 'AI floor plan applied — new sections & tables added.' });
        }}
      />
    </div>
  );
}

function AddTableDialog({ open, onOpenChange, sections, defaultSectionId, locationId, onCreated }) {
  const [label, setLabel] = useState('');
  const [capacity, setCapacity] = useState(4);
  const [sectionId, setSectionId] = useState(defaultSectionId || '');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState(null);

  useEffect(() => {
    if (open) {
      setLabel('');
      setCapacity(4);
      setSectionId(defaultSectionId || '');
      setErr(null);
    }
  }, [open, defaultSectionId]);

  const submit = async () => {
    setErr(null);
    if (!label.trim()) return setErr('Label is required');
    const cap = parseInt(capacity, 10);
    if (!cap || cap < 1) return setErr('Capacity must be at least 1');
    if (!sectionId) return setErr('Pick a section');
    setSaving(true);
    try {
      const body = {
        location_id: locationId,
        section_id: sectionId,
        label: label.trim(),
        capacity: cap,
        status: 'available',
        pos_x: DEFAULT_DROP.pos_x,
        pos_y: DEFAULT_DROP.pos_y,
      };
      const { data, error } = await api.request('POST', '/data/tables', { body });
      if (error) throw new Error(error.message || 'create failed');
      const row = Array.isArray(data) ? data[0] : data;
      if (row) onCreated(row);
      onOpenChange(false);
    } catch (e) {
      setErr(e.message || String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Plus className="h-5 w-5 text-primary" />
            Add Table
          </DialogTitle>
          <DialogDescription>
            New tables drop at the top-left of the canvas — drag to reposition.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div>
            <Label htmlFor="tbl-label">Label *</Label>
            <Input
              id="tbl-label"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="e.g. T1, Booth 3"
            />
          </div>
          <div>
            <Label htmlFor="tbl-cap">Capacity *</Label>
            <Input
              id="tbl-cap"
              type="number"
              min={1}
              value={capacity}
              onChange={(e) => setCapacity(e.target.value)}
            />
          </div>
          <div>
            <Label>Section *</Label>
            <Select value={sectionId} onValueChange={setSectionId}>
              <SelectTrigger>
                <SelectValue placeholder="Pick a section" />
              </SelectTrigger>
              <SelectContent>
                {sections.map((s) => (
                  <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {err && <p className="text-sm text-destructive">{err}</p>}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Plus className="h-4 w-4 mr-2" />}
            Add
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
