import React, { useState } from 'react';
import { X, Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatPrice } from '@/lib/currency';

/**
 * Simple required-modifier prompt for a single item.
 * Shows each required variation group and lets the user pick one option per group.
 * Optional groups are also shown but not enforced.
 * Tapping "Add to Order" confirms.
 */
const KioskModifierPrompt = ({ item, currency, onConfirm, onCancel }) => {
  const variations = item?.item_variations || [];
  const [selections, setSelections] = useState(() => {
    // Pre-select default options
    const init = {};
    for (const v of variations) {
      const def = v.item_variation_options?.find(o => o.is_default);
      if (def) init[v.id] = def.id;
    }
    return init;
  });

  const requiredUnmet = variations
    .filter(v => v.is_required)
    .some(v => !selections[v.id]);

  const handleConfirm = () => {
    if (requiredUnmet) return;
    onConfirm(selections);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm p-0 sm:p-4">
      <div className="bg-white rounded-t-3xl sm:rounded-3xl shadow-2xl w-full sm:max-w-md flex flex-col max-h-[85vh] overflow-hidden animate-in slide-in-from-bottom-4 sm:zoom-in-95 duration-200">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 shrink-0">
          <div>
            <h2 className="text-xl font-bold text-gray-900">{item.name}</h2>
            <p className="text-orange-500 font-semibold">
              {formatPrice(parseFloat(item.price || 0) * 100, currency)}
            </p>
          </div>
          <button
            onClick={onCancel}
            className="w-10 h-10 rounded-full bg-gray-100 flex items-center justify-center hover:bg-gray-200 transition-colors shrink-0"
          >
            <X className="w-5 h-5 text-gray-600" />
          </button>
        </div>

        {/* Options */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-5">
          {variations.map(variation => (
            <div key={variation.id}>
              <div className="flex items-center gap-2 mb-2">
                <h3 className="text-base font-semibold text-gray-900">{variation.name}</h3>
                {variation.is_required && (
                  <span className="text-xs font-medium text-white bg-red-500 px-2 py-0.5 rounded-full">
                    Required
                  </span>
                )}
              </div>
              <div className="grid grid-cols-1 gap-2">
                {variation.item_variation_options?.map(option => {
                  const selected = selections[variation.id] === option.id;
                  return (
                    <button
                      key={option.id}
                      onClick={() => setSelections(prev => ({ ...prev, [variation.id]: option.id }))}
                      className={cn(
                        'flex items-center justify-between h-14 px-4 rounded-2xl border-2 text-left transition-colors',
                        selected
                          ? 'border-orange-500 bg-orange-50 text-orange-700'
                          : 'border-gray-200 text-gray-900 hover:border-orange-300 hover:bg-orange-50'
                      )}
                    >
                      <span className="text-base font-medium">{option.name}</span>
                      <div className="flex items-center gap-2">
                        {option.price_modifier !== 0 && (
                          <span className="text-sm text-orange-600 font-medium">
                            {option.price_modifier > 0 ? '+' : ''}
                            {formatPrice(parseFloat(option.price_modifier || 0) * 100, currency)}
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
          ))}
        </div>

        {/* CTA */}
        <div className="px-6 pb-6 pt-2 shrink-0 border-t border-gray-100">
          <button
            onClick={handleConfirm}
            disabled={requiredUnmet}
            className={cn(
              'w-full h-14 rounded-2xl text-lg font-bold transition-colors',
              !requiredUnmet
                ? 'bg-orange-500 hover:bg-orange-600 active:bg-orange-700 text-white shadow-md'
                : 'bg-gray-200 text-gray-400 cursor-not-allowed'
            )}
          >
            Add to Order
          </button>
        </div>
      </div>
    </div>
  );
};

export default KioskModifierPrompt;
