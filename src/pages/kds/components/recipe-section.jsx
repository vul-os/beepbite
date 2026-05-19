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

  if (!hasContent) {
    return (
      <div className="rounded-md border border-dashed border-muted-foreground/30 bg-muted/30 px-3 py-2 text-xs italic text-muted-foreground">
        No recipe defined
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-md border bg-muted/40">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={cn(
          'flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm font-semibold',
          'transition-colors hover:bg-muted/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        )}
        aria-expanded={open}
        aria-controls={storageKey ? `${storageKey}-body` : undefined}
      >
        <span className="flex items-center gap-2">
          <ListOrdered className="size-4 opacity-70" />
          Recipe
          {progressLabel && (
            <span className="rounded-full bg-background px-2 py-0.5 font-mono text-xs tabular-nums text-muted-foreground">
              {progressLabel}
            </span>
          )}
        </span>
        {open
          ? <ChevronUp   className="size-4 text-muted-foreground" />
          : <ChevronDown className="size-4 text-muted-foreground" />}
      </button>

      {open && (
        <div
          id={storageKey ? `${storageKey}-body` : undefined}
          className="grid grid-cols-1 gap-4 px-3 pb-3 pt-1 md:grid-cols-2"
        >
          {/* Ingredients */}
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              <Soup className="size-3.5" /> Ingredients
            </div>
            {ingredients.length === 0 ? (
              <p className="text-xs italic text-muted-foreground">None listed</p>
            ) : (
              <ul className="space-y-1 text-sm">
                {ingredients.map((ing, idx) => (
                  <li key={`${ing.name || idx}-${idx}`} className="flex items-baseline gap-2">
                    <span className="min-w-[3.5rem] font-mono text-xs tabular-nums text-muted-foreground">
                      {fmtIngredientQty(ing.quantity, ing.unit)}
                    </span>
                    <span className="leading-tight">{ing.name || 'ingredient'}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Steps */}
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              <ListOrdered className="size-3.5" /> Steps
            </div>
            {steps.length === 0 ? (
              <p className="text-xs italic text-muted-foreground">None listed</p>
            ) : (
              <ol className="space-y-1.5 text-sm">
                {steps.map((step, idx) => {
                  const n = Number(step.step_number ?? idx + 1);
                  const isChecked = checked.has(n);
                  return (
                    <li key={`${n}-${idx}`} className="flex items-start gap-2">
                      <Checkbox
                        id={storageKey ? `${storageKey}-step-${n}` : undefined}
                        checked={isChecked}
                        onCheckedChange={() => toggleStep(n)}
                        className="mt-1 size-4 shrink-0"
                      />
                      <label
                        htmlFor={storageKey ? `${storageKey}-step-${n}` : undefined}
                        className={cn(
                          'flex-1 cursor-pointer leading-snug',
                          isChecked && 'text-muted-foreground line-through decoration-muted-foreground/60',
                        )}
                      >
                        <span className="mr-1 font-mono text-xs tabular-nums text-muted-foreground">
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
