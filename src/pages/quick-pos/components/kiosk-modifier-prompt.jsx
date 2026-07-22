import { useState, useMemo } from 'react';
import { X, Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatPrice } from '@/lib/currency';

/**
 * Modifier prompt for the Quick POS kiosk, using the modifier_groups / modifiers model.
 *
 * Props:
 *   item      — menu item with `modifier_groups: [{ id, name, is_required, min_select,
 *                 max_select, modifiers: [{ id, name, price_delta_cents, is_default }] }]`
 *   currency  — currency code string for formatPrice
 *   onConfirm — (selectedModifiers: Modifier[]) => void
 *   onCancel  — () => void
 */
const KioskModifierPrompt = ({ item, currency, onConfirm, onCancel }) => {
  const groups = item?.modifier_groups || [];

  // selections: { [groupId]: Set<modifierId> }
  const [selections, setSelections] = useState(() => {
    const init = {};
    for (const g of groups) {
      const defaults = (g.modifiers || []).filter(m => m.is_default);
      if (defaults.length > 0) {
        init[g.id] = new Set(defaults.map(m => m.id));
      }
    }
    return init;
  });

  const toggle = (group, modifier) => {
    setSelections(prev => {
      const existing = new Set(prev[group.id] || []);
      if (existing.has(modifier.id)) {
        existing.delete(modifier.id);
      } else {
        const maxSelect = group.max_select || 1;
        if (existing.size >= maxSelect) {
          if (maxSelect === 1) {
            // radio-style: replace
            existing.clear();
          } else {
            // at max — don't add
            return prev;
          }
        }
        existing.add(modifier.id);
      }
      return { ...prev, [group.id]: existing };
    });
  };

  // Validation: every required group must have >= min_select selections
  const requiredUnmet = groups
    .filter(g => g.is_required)
    .some(g => (selections[g.id] || new Set()).size < (g.min_select || 1));

  // Flatten selected modifier objects + compute price delta
  const { selectedModifiers, extraCents } = useMemo(() => {
    const mods = [];
    let extra = 0;
    for (const g of groups) {
      const sel = selections[g.id] || new Set();
      for (const m of (g.modifiers || [])) {
        if (sel.has(m.id)) {
          mods.push(m);
          extra += m.price_delta_cents || 0;
        }
      }
    }
    return { selectedModifiers: mods, extraCents: extra };
  }, [groups, selections]);

  const basePrice = parseFloat(item?.price || 0);
  const linePriceCents = Math.round(basePrice * 100) + extraCents;

  const handleConfirm = () => {
    if (requiredUnmet) return;
    onConfirm(selectedModifiers);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm p-0 sm:p-4">
      <div className="bg-card rounded-t-2xl sm:rounded-2xl shadow-2xl w-full sm:max-w-md flex flex-col max-h-[85vh] overflow-hidden animate-in slide-in-from-bottom-4 sm:zoom-in-95 duration-200">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border shrink-0">
          <div className="min-w-0 mr-3">
            <h2 className="text-xl font-bold text-foreground truncate">{item.name}</h2>
            <p className="text-primary font-semibold tabular-nums">
              {formatPrice(linePriceCents, currency)}
            </p>
          </div>
          <button
            onClick={onCancel}
            aria-label="Close customisation options"
            className="w-11 h-11 rounded-full bg-muted flex items-center justify-center hover:bg-muted/70 active:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring transition-colors shrink-0"
          >
            <X className="w-5 h-5 text-muted-foreground" aria-hidden="true" />
          </button>
        </div>

        {/* Groups */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-5">
          {groups.length === 0 ? (
            <p className="text-center text-muted-foreground py-6 text-sm">No customisation options.</p>
          ) : (
            groups.map(group => {
              const sel = selections[group.id] || new Set();
              const maxSelect = group.max_select || 1;
              return (
                <div key={group.id}>
                  <div className="flex items-center gap-2 mb-2">
                    <h3 className="text-base font-semibold text-foreground">{group.name}</h3>
                    {group.is_required && (
                      <span className="text-xs font-medium text-destructive-foreground bg-destructive px-2 py-0.5 rounded-full">
                        Required
                      </span>
                    )}
                    <span className="ml-auto text-xs text-muted-foreground">
                      {maxSelect === 1 ? 'Choose 1' : `Up to ${maxSelect}`}
                    </span>
                  </div>
                  <div className="grid grid-cols-1 gap-2">
                    {(group.modifiers || []).map(modifier => {
                      const selected = sel.has(modifier.id);
                      const atMax = !selected && sel.size >= maxSelect;
                      return (
                        <button
                          key={modifier.id}
                          onClick={() => !atMax && toggle(group, modifier)}
                          disabled={atMax}
                          className={cn(
                            'flex items-center justify-between h-14 px-4 rounded-2xl border-2 text-left transition-colors',
                            selected
                              ? 'border-primary bg-primary/10 text-primary'
                              : atMax
                                ? 'border-border text-muted-foreground opacity-50 cursor-not-allowed'
                                : 'border-border text-foreground hover:border-primary/40 hover:bg-primary/5'
                          )}
                        >
                          <span className="text-base font-medium">{modifier.name}</span>
                          <div className="flex items-center gap-2">
                            {modifier.price_delta_cents !== 0 && (
                              <span className="text-sm text-primary font-medium">
                                {modifier.price_delta_cents > 0 ? '+' : ''}
                                {formatPrice(modifier.price_delta_cents, currency)}
                              </span>
                            )}
                            {selected && (
                              <span className="w-6 h-6 rounded-full bg-primary flex items-center justify-center">
                                <Check className="w-4 h-4 text-white" strokeWidth={3} />
                              </span>
                            )}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* CTA */}
        <div className="px-6 pb-6 pt-3 shrink-0 border-t border-border">
          {requiredUnmet && (
            <p className="text-xs text-center text-destructive font-medium mb-2" role="alert">
              Please select all required options above
            </p>
          )}
          <button
            onClick={handleConfirm}
            disabled={requiredUnmet}
            aria-label={requiredUnmet ? 'Select required options to continue' : `Add to order — ${formatPrice(linePriceCents, currency)}`}
            aria-disabled={requiredUnmet}
            className={cn(
              'w-full h-14 rounded-2xl text-lg font-bold transition-all',
              'focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-ring focus-visible:ring-offset-2',
              !requiredUnmet
                ? 'bg-primary hover:bg-primary/90 active:bg-primary/95 active:scale-[0.98] text-primary-foreground shadow-md'
                : 'bg-muted text-muted-foreground cursor-not-allowed',
            )}
          >
            Add to Order — {formatPrice(linePriceCents, currency)}
          </button>
        </div>
      </div>
    </div>
  );
};

export default KioskModifierPrompt;
