// recipe-section.jsx — collapsible per-item "Recipe" panel for the KDS.
//
// Shown beneath each item on a ticket card. Two columns:
//   left  — Ingredients with quantity + unit
//   right — Prep steps the cook can tick off (checkbox state is local-only;
//           we don't (yet) persist progress to the backend)
//
// Open/closed state is local to each instance but defaults true on freshly-
// fired tickets and stays true once at least one step has been ticked, so a
// cook who's mid-recipe never loses their place if the parent re-renders.

/* eslint-disable react/prop-types */
import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronUp, ListOrdered, Soup } from 'lucide-react';
import { Checkbox } from '@/components/ui/checkbox';
import { cn } from '@/lib/utils';

function fmtIngredientQty(qty, unit) {
  const n = Number(qty);
  if (!Number.isFinite(n) || n <= 0) return unit || '';
  const display = Number.isInteger(n) ? n.toString() : n.toFixed(2).replace(/\.?0+$/, '');
  return unit ? `${display} ${unit}` : display;
}

export function RecipeSection({
  item,
  defaultOpen = true,
  storageKey,
}) {
  const ingredients = Array.isArray(item?.ingredients) ? item.ingredients : [];
  const steps = Array.isArray(item?.prep_steps) ? item.prep_steps : [];
  const hasContent = ingredients.length > 0 || steps.length > 0;

  // Local "is open" + checked-step state. Keyed by storageKey if provided so
  // a remount (e.g. cache update from SSE) preserves the cook's progress.
  const [open, setOpen] = useState(defaultOpen);
  const [checked, setChecked] = useState(() => new Set());

  // If the caller passes a new defaultOpen (e.g. ticket status flipped from
  // fired → in_progress externally), respect it — but never auto-close once
  // the cook has ticked something.
  useEffect(() => {
    if (checked.size === 0) setOpen(defaultOpen);
  }, [defaultOpen, checked.size]);

  const toggleStep = (n) => {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(n)) next.delete(n); else next.add(n);
      return next;
    });
    // Once they start, keep the panel open.
    setOpen(true);
  };

  const progressLabel = useMemo(() => {
    if (steps.length === 0) return null;
    return `${checked.size}/${steps.length}`;
  }, [checked.size, steps.length]);

  const allDone = steps.length > 0 && checked.size === steps.length;

  if (!hasContent) {
    return (
      <div className="rounded-lg border border-dashed border-gray-600/50 bg-gray-800/30 px-3 py-2 text-xs italic text-gray-500">
        No recipe defined
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-lg border border-gray-700 bg-gray-800/40">
      {/* Toggle button */}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={cn(
          'flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left',
          'transition-colors hover:bg-gray-700/60',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-400 focus-visible:ring-inset',
          allDone ? 'bg-emerald-900/30' : '',
        )}
        aria-expanded={open}
        aria-controls={storageKey ? `${storageKey}-body` : undefined}
      >
        <span className="flex items-center gap-2">
          <ListOrdered className={cn('size-4', allDone ? 'text-emerald-400' : 'text-gray-400')} aria-hidden="true" />
          <span className={cn('text-sm font-semibold', allDone ? 'text-emerald-300' : 'text-gray-200')}>
            Recipe
          </span>
          {progressLabel && (
            <span
              className={cn(
                'rounded-full px-2 py-0.5 font-mono text-xs font-bold tabular-nums',
                allDone
                  ? 'bg-emerald-700 text-emerald-100'
                  : 'bg-gray-700 text-gray-300',
              )}
            >
              {progressLabel}
            </span>
          )}
        </span>
        {open
          ? <ChevronUp   className="size-4 text-gray-500 shrink-0" aria-hidden="true" />
          : <ChevronDown className="size-4 text-gray-500 shrink-0" aria-hidden="true" />}
      </button>

      {open && (
        <div
          id={storageKey ? `${storageKey}-body` : undefined}
          className="grid grid-cols-1 gap-4 px-3 pb-4 pt-2 md:grid-cols-2"
        >
          {/* Ingredients column */}
          <div className="space-y-2">
            <div className="flex items-center gap-1.5 text-xs font-extrabold uppercase tracking-widest text-gray-500">
              <Soup className="size-3.5" aria-hidden="true" />
              Ingredients
            </div>
            {ingredients.length === 0 ? (
              <p className="text-xs italic text-gray-600">None listed</p>
            ) : (
              <ul className="space-y-1.5">
                {ingredients.map((ing, idx) => (
                  <li key={`${ing.name || idx}-${idx}`} className="flex items-baseline gap-2 text-sm">
                    <span className="min-w-[3.5rem] font-mono text-xs tabular-nums text-gray-500">
                      {fmtIngredientQty(ing.quantity, ing.unit)}
                    </span>
                    <span className="font-medium leading-tight text-gray-200">
                      {ing.name || 'ingredient'}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Steps column */}
          <div className="space-y-2">
            <div className="flex items-center gap-1.5 text-xs font-extrabold uppercase tracking-widest text-gray-500">
              <ListOrdered className="size-3.5" aria-hidden="true" />
              Steps
            </div>
            {steps.length === 0 ? (
              <p className="text-xs italic text-gray-600">None listed</p>
            ) : (
              <ol className="space-y-2">
                {steps.map((step, idx) => {
                  const n = Number(step.step_number ?? idx + 1);
                  const isChecked = checked.has(n);
                  return (
                    <li key={`${n}-${idx}`} className="flex items-start gap-2.5">
                      <Checkbox
                        id={storageKey ? `${storageKey}-step-${n}` : undefined}
                        checked={isChecked}
                        onCheckedChange={() => toggleStep(n)}
                        className={cn(
                          'mt-0.5 size-5 shrink-0 rounded',
                          isChecked
                            ? 'border-emerald-500 bg-emerald-600 text-emerald-50'
                            : 'border-gray-600 bg-gray-700',
                        )}
                      />
                      <label
                        htmlFor={storageKey ? `${storageKey}-step-${n}` : undefined}
                        className={cn(
                          'flex-1 cursor-pointer text-sm leading-snug',
                          isChecked
                            ? 'text-gray-500 line-through decoration-gray-600'
                            : 'text-gray-200',
                        )}
                      >
                        <span className="mr-1.5 font-mono text-xs tabular-nums text-gray-600">
                          {n}.
                        </span>
                        {step.instruction || step.text || ''}
                      </label>
                    </li>
                  );
                })}
              </ol>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default RecipeSection;
