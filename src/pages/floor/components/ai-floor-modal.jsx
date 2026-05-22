// AI floor-plan modal — describe a space in plain English, preview the
// proposed sections/tables, then apply them to the floor.
//
// Flow:
//   1. Owner types a description → Generate → backend returns a plan.
//   2. We render a non-destructive PREVIEW (sections + per-section table
//      counts, plus totals) so they can review before committing.
//   3. Apply to floor → confirm the plan → onApplied() so the parent reloads.
//
// The backend only ADDS to the layout; the existing one is preserved. The
// copy makes that explicit so owners aren't afraid of losing work.

import { useEffect, useMemo, useState } from 'react';
import { AlertCircle, Loader2, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { generateFloor, applyFloor } from '@/services/ai-floor';

const PLACEHOLDER =
  '20 tables total: 8 for two, 8 for four, 4 for six; a bar with 6 stools; an outdoor patio with 4 tables';

function planTotals(plan) {
  const sections = Array.isArray(plan?.sections) ? plan.sections : [];
  let tables = 0;
  let seats = 0;
  for (const s of sections) {
    const ts = Array.isArray(s.tables) ? s.tables : [];
    tables += ts.length;
    for (const t of ts) seats += Number(t.capacity) || 0;
  }
  return { sectionCount: sections.length, tables, seats };
}

export default function AIFloorModal({ open, onOpenChange, locationId, onApplied }) {
  const [description, setDescription] = useState('');
  const [plan, setPlan] = useState(null);
  const [generating, setGenerating] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState(null);

  // Reset everything each time the dialog opens.
  useEffect(() => {
    if (open) {
      setDescription('');
      setPlan(null);
      setGenerating(false);
      setApplying(false);
      setError(null);
    }
  }, [open]);

  const totals = useMemo(() => (plan ? planTotals(plan) : null), [plan]);

  const handleGenerate = async () => {
    setError(null);
    if (!description.trim()) {
      setError('Describe your space first.');
      return;
    }
    setGenerating(true);
    try {
      const { plan: next } = await generateFloor(locationId, description.trim());
      setPlan(next || null);
      if (!next?.sections?.length) {
        setError('No sections were proposed. Try adding more detail to your description.');
      }
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setGenerating(false);
    }
  };

  const handleApply = async () => {
    setError(null);
    setApplying(true);
    try {
      await applyFloor(locationId, plan);
      onOpenChange(false);
      if (typeof onApplied === 'function') onApplied();
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setApplying(false);
    }
  };

  const busy = generating || applying;

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!busy) onOpenChange(v); }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-orange-500" />
            AI floor plan
          </DialogTitle>
          <DialogDescription>
            Describe your space and we&apos;ll draft sections &amp; tables. This only
            adds sections &amp; tables — your existing layout is kept.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div>
            <Label htmlFor="ai-floor-desc">Describe your space</Label>
            <Textarea
              id="ai-floor-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={PLACEHOLDER}
              rows={4}
              disabled={busy}
              aria-describedby="ai-floor-hint"
            />
            <p id="ai-floor-hint" className="mt-1 text-xs text-gray-500">
              Mention how many tables, their seat counts, and any areas like a bar or patio.
            </p>
          </div>

          {plan && totals && (
            <div
              className="rounded-md border border-orange-200 bg-orange-50/60 p-3"
              aria-live="polite"
            >
              <p className="text-sm font-medium text-gray-900 flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-orange-500" />
                Preview — {totals.sectionCount} section{totals.sectionCount === 1 ? '' : 's'},{' '}
                {totals.tables} table{totals.tables === 1 ? '' : 's'}, {totals.seats} seat
                {totals.seats === 1 ? '' : 's'}
              </p>
              <ul className="mt-2 space-y-1">
                {plan.sections.map((s, i) => {
                  const ts = Array.isArray(s.tables) ? s.tables : [];
                  const seats = ts.reduce((sum, t) => sum + (Number(t.capacity) || 0), 0);
                  return (
                    <li
                      key={`${s.name || 'section'}-${i}`}
                      className="flex items-center justify-between text-sm text-gray-700"
                    >
                      <span className="font-medium">{s.name || `Section ${i + 1}`}</span>
                      <span className="text-gray-500">
                        {ts.length} table{ts.length === 1 ? '' : 's'} · {seats} seat
                        {seats === 1 ? '' : 's'}
                      </span>
                    </li>
                  );
                })}
              </ul>
              <p className="mt-2 text-xs text-gray-500">
                Review the layout above, then apply it. Existing tables stay put.
              </p>
            </div>
          )}

          {error && (
            <p className="flex items-start gap-1.5 text-sm text-rose-600" role="alert">
              <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
              <span>{error}</span>
            </p>
          )}
        </div>

        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          {!plan ? (
            <Button
              onClick={handleGenerate}
              disabled={busy || !description.trim()}
              className="bg-orange-500 hover:bg-orange-600 text-white"
            >
              {generating ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Sparkles className="h-4 w-4 mr-2" />
              )}
              Generate
            </Button>
          ) : (
            <>
              <Button variant="outline" onClick={handleGenerate} disabled={busy}>
                {generating ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
                Regenerate
              </Button>
              <Button
                onClick={handleApply}
                disabled={busy}
                className="bg-orange-500 hover:bg-orange-600 text-white"
              >
                {applying ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
                Apply to floor
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
