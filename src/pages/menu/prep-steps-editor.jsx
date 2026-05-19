import React, { useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import {
  Plus,
  Trash2,
  ArrowUp,
  ArrowDown,
  GripVertical,
  Save,
  Loader2,
  ListOrdered,
  AlertCircle,
  CheckCircle2,
} from 'lucide-react';
import { supabase } from '@/services/supabase-client';
import { cn } from '@/lib/utils';

let _localIdCounter = 0;
const newLocalId = () => `local-${++_localIdCounter}`;

// Phase 2 hook: add a `station_id` field per step, populated from a
// kitchen_stations select filtered by the item's location_id.

const PrepStepsEditor = ({ itemId, onSaved, defaultOpen = true }) => {
  const [steps, setSteps] = useState([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [savedFlash, setSavedFlash] = useState(false);
  const [open, setOpen] = useState(defaultOpen);

  // ── Load ────────────────────────────────────────────────────────────────────
  const loadSteps = useCallback(async () => {
    if (!itemId) return;
    setLoading(true);
    setError('');
    try {
      const { data, error: fetchError } = await supabase
        .from('item_prep_steps')
        .select('id, step_number, instruction')
        .eq('item_id', itemId)
        .order('step_number');
      if (fetchError) throw fetchError;
      setSteps(
        (data || []).map((s) => ({ ...s, _localId: newLocalId() }))
      );
    } catch (err) {
      setError(err.message || 'Failed to load prep steps.');
    } finally {
      setLoading(false);
    }
  }, [itemId]);

  useEffect(() => {
    if (itemId) loadSteps();
    else setSteps([]);
  }, [itemId, loadSteps]);

  // ── Mutations ────────────────────────────────────────────────────────────────
  const addStep = () => {
    setSteps((prev) => [
      ...prev,
      {
        _localId: newLocalId(),
        step_number: prev.length + 1,
        instruction: '',
      },
    ]);
  };

  const updateInstruction = (localId, value) => {
    if (value.length > 500) return;
    setSteps((prev) =>
      prev.map((s) => (s._localId === localId ? { ...s, instruction: value } : s))
    );
  };

  const removeStep = (localId) => {
    setSteps((prev) => prev.filter((s) => s._localId !== localId));
  };

  const moveStep = (localId, direction) => {
    setSteps((prev) => {
      const idx = prev.findIndex((s) => s._localId === localId);
      if (idx < 0) return prev;
      const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
      if (swapIdx < 0 || swapIdx >= prev.length) return prev;
      const next = [...prev];
      [next[idx], next[swapIdx]] = [next[swapIdx], next[idx]];
      return next;
    });
  };

  // ── Save ─────────────────────────────────────────────────────────────────────
  const handleSave = async () => {
    setError('');
    // Filter blank instructions; warn rather than hard-block so a user can
    // clear all steps intentionally (the delete still runs below).
    const validSteps = steps.filter((s) => s.instruction.trim() !== '');

    if (steps.length > 0 && validSteps.length === 0) {
      setError('All step instructions are empty. Fill in at least one step or remove them all.');
      return;
    }

    setSaving(true);
    try {
      // Delete-then-insert is idempotent and sidesteps UNIQUE(item_id, step_number)
      // collision pain when reordering — same pattern as recipe-builder.jsx.
      const { error: deleteError } = await supabase
        .from('item_prep_steps')
        .delete()
        .eq('item_id', itemId);
      if (deleteError) throw deleteError;

      if (validSteps.length > 0) {
        const { error: insertError } = await supabase
          .from('item_prep_steps')
          .insert(
            validSteps.map((s, i) => ({
              item_id: itemId,
              step_number: i + 1,
              instruction: s.instruction.trim(),
            }))
          );
        if (insertError) throw insertError;
      }

      // Reflect renumbered steps in local state so UI stays consistent
      setSteps(
        validSteps.map((s, i) => ({ ...s, step_number: i + 1 }))
      );
      onSaved?.();
      setSavedFlash(true);
      setTimeout(() => setSavedFlash(false), 2000);
    } catch (err) {
      setError(err.message || 'Failed to save prep steps.');
    } finally {
      setSaving(false);
    }
  };

  // ── Early exits ──────────────────────────────────────────────────────────────
  if (!itemId) {
    return (
      <div className="rounded-lg border border-dashed border-gray-200 bg-gray-50 p-6 text-center text-sm text-gray-500">
        <ListOrdered className="mx-auto mb-2 h-6 w-6 text-gray-400" />
        Save the item first to add prep steps.
      </div>
    );
  }

  // ── Render ───────────────────────────────────────────────────────────────────
  return (
    <div className="rounded-xl border border-gray-200 bg-white shadow-sm">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex items-center gap-2 text-sm font-semibold text-gray-800 hover:text-orange-600 transition-colors"
        >
          <ListOrdered className="h-4 w-4 text-orange-500" />
          Prep Steps
          <Badge
            variant="outline"
            className="ml-1 border-orange-200 bg-orange-50 text-orange-700 text-xs"
          >
            {steps.length}
          </Badge>
        </button>

        {open && (
          <Button
            size="sm"
            onClick={handleSave}
            disabled={saving || loading}
            className="gap-1.5 bg-orange-500 text-white hover:bg-orange-600 disabled:opacity-60"
          >
            {saving ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Save className="h-3.5 w-3.5" />
            )}
            Save steps
          </Button>
        )}
      </div>

      {open && (
        <div className="p-4 space-y-3">
          {/* Feedback banners */}
          {savedFlash && (
            <Alert className="border-green-200 bg-green-50 text-green-800">
              <CheckCircle2 className="h-4 w-4 text-green-600" />
              <AlertTitle className="text-green-800">Saved</AlertTitle>
              <AlertDescription>Prep steps updated successfully.</AlertDescription>
            </Alert>
          )}

          {error && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>Error</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {/* Loading skeleton */}
          {loading && (
            <div className="flex items-center gap-2 text-sm text-gray-500 py-4">
              <Loader2 className="h-4 w-4 animate-spin text-orange-500" />
              Loading steps…
            </div>
          )}

          {/* Empty state */}
          {!loading && steps.length === 0 && (
            <div className="rounded-lg border border-dashed border-gray-200 bg-gray-50 py-8 text-center text-sm text-gray-500">
              <ListOrdered className="mx-auto mb-2 h-6 w-6 text-gray-300" />
              No steps yet — add the first one to guide your kitchen.
            </div>
          )}

          {/* Step rows */}
          {!loading && steps.map((step, idx) => {
            const charCount = step.instruction.length;
            const isFirst = idx === 0;
            const isLast = idx === steps.length - 1;

            return (
              <div
                key={step._localId}
                className={cn(
                  'group flex gap-2 rounded-lg border border-gray-200 bg-gray-50 p-3 transition-colors',
                  'hover:border-orange-200 hover:bg-orange-50/30'
                )}
              >
                {/* Drag handle — decorative; v2 will wire up dnd-kit */}
                <div className="mt-2.5 cursor-grab text-gray-300 group-hover:text-orange-300">
                  <GripVertical className="h-4 w-4" />
                </div>

                {/* Step number badge */}
                <div className="mt-2.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-orange-500 text-[10px] font-bold text-white">
                  {idx + 1}
                </div>

                {/* Textarea */}
                <div className="flex-1 space-y-1">
                  <Textarea
                    value={step.instruction}
                    onChange={(e) => updateInstruction(step._localId, e.target.value)}
                    placeholder={`Describe step ${idx + 1}…`}
                    rows={2}
                    className="resize-none text-sm focus:border-orange-400 focus:ring-orange-400"
                  />
                  <p
                    className={cn(
                      'text-right text-[11px]',
                      charCount > 450 ? 'text-orange-500' : 'text-gray-400'
                    )}
                  >
                    {charCount}/500
                  </p>
                </div>

                {/* Controls */}
                <div className="flex flex-col gap-1">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-gray-400 hover:text-orange-600"
                    disabled={isFirst}
                    onClick={() => moveStep(step._localId, 'up')}
                    title="Move up"
                  >
                    <ArrowUp className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-gray-400 hover:text-orange-600"
                    disabled={isLast}
                    onClick={() => moveStep(step._localId, 'down')}
                    title="Move down"
                  >
                    <ArrowDown className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-gray-400 hover:text-red-500"
                    onClick={() => removeStep(step._localId)}
                    title="Remove step"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            );
          })}

          {/* Add step */}
          {!loading && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={addStep}
              className="w-full gap-1.5 border-dashed border-orange-300 text-orange-600 hover:bg-orange-50 hover:text-orange-700"
            >
              <Plus className="h-4 w-4" />
              Add step
            </Button>
          )}
        </div>
      )}
    </div>
  );
};

export default PrepStepsEditor;
