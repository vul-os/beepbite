import React, { useState, useMemo } from 'react';
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
      <div className="bg-white rounded-t-3xl sm:rounded-3xl shadow-2xl w-full sm:max-w-md flex flex-col max-h-[85vh] overflow-hidden animate-in slide-in-from-bottom-4 sm:zoom-in-95 duration-200">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 shrink-0">
          <div className="min-w-0 mr-3">
            <h2 className="text-xl font-bold text-gray-900 truncate">{item.name}</h2>
            <p className="text-orange-500 font-semibold tabular-nums">
              {formatPrice(linePriceCents, currency)}
            </p>
          </div>
          <button
            onClick={onCancel}
            aria-label="Close customisation options"
            className="w-11 h-11 rounded-full bg-gray-100 flex items-center justify-center hover:bg-gray-200 active:bg-gray-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-400 transition-colors shrink-0"
          >
            <X className="w-5 h-5 text-gray-600" aria-hidden="true" />
          </button>
        </div>

        {/* Groups */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-5">
          {groups.length === 0 ? (
            <p className="text-center text-gray-400 py-6 text-sm">No customisation options.</p>
          ) : (
            groups.map(group => {
              const sel = selections[group.id] || new Set();
              const maxSelect = group.max_select || 1;
              return (
                <div key={group.id}>
                  <div className="flex items-center gap-2 mb-2">
                    <h3 className="text-base font-semibold text-gray-900">{group.name}</h3>
                    {group.is_required && (
                      <span className="text-xs font-medium text-white bg-red-500 px-2 py-0.5 rounded-full">
                        Required
                      </span>
                    )}
                    <span className="ml-auto text-xs text-gray-400">
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
                              ? 'border-orange-500 bg-orange-50 text-orange-700'
                              : atMax
                                ? 'border-gray-200 text-gray-400 opacity-50 cursor-not-allowed'
                                : 'border-gray-200 text-gray-900 hover:border-orange-300 hover:bg-orange-50'
                          )}
                        >
                          <span className="text-base font-medium">{modifier.name}</span>
                          <div className="flex items-center gap-2">
                            {modifier.price_delta_cents !== 0 && (
                              <span className="text-sm text-orange-600 font-medium">
                                {modifier.price_delta_cents > 0 ? '+' : ''}
                                {formatPrice(modifier.price_delta_cents, currency)}
                              </span>
                            )}
                            {selected && (
                              <span className="w-6 h-6 rounded-full bg-orange-500 flex items-center justify-center">
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
        <div className="px-6 pb-6 pt-3 shrink-0 border-t border-gray-100">
          {requiredUnmet && (
            <p className="text-xs text-center text-red-500 font-medium mb-2" role="alert">
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
              'focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-orange-400 focus-visible:ring-offset-2',
              !requiredUnmet
                ? 'bg-orange-500 hover:bg-orange-600 active:bg-orange-700 active:scale-[0.98] text-white shadow-md'
                : 'bg-gray-200 text-gray-400 cursor-not-allowed',
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
