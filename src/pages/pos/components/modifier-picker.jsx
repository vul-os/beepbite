// modifier-picker.jsx — Modal presented when a menu item with modifier_groups is tapped.
// Respects min_select / max_select / is_required per group.
// Returns { selectedModifiers, extraCents } via onConfirm.
/* eslint-disable react/prop-types */
import React, { useEffect, useMemo, useState } from 'react';
import {
  Check,
  Loader2,
  Minus,
  Plus,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { useMoney } from '@/context/locale-context';
import { supabase } from '@/services/supabase-client';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Signed price delta for a modifier, e.g. "+$1.50".
 *
 * Takes `format` rather than closing over one: the sign is ours but the amount
 * belongs to the active currency, and a module-level helper cannot call a hook.
 */
const fmtDelta = (cents, format) => {
  if (!cents) return null;
  return (cents > 0 ? '+' : '-') + format(Math.abs(cents));
};

// ---------------------------------------------------------------------------
// Hook: fetch groups + modifiers for an item
// ---------------------------------------------------------------------------
function useItemModifiers(itemId) {
  const [groups, setGroups] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!itemId) { setGroups([]); return; }
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        // Fetch groups
        const { data: gData, error: gErr } = await supabase
          .from('modifier_groups')
          .select('*')
          .eq('item_id', itemId)
          .order('sort_order', { ascending: true })
          .order('name', { ascending: true });
        if (gErr) throw gErr;
        if (!gData || gData.length === 0) { if (!cancelled) { setGroups([]); setLoading(false); } return; }

        // Fetch all modifiers for these groups in one shot
        const groupIds = gData.map((g) => g.id);
        const { data: mData, error: mErr } = await supabase
          .from('modifiers')
          .select('*')
          .in('modifier_group_id', groupIds)
          .eq('is_active', true)
          .order('sort_order', { ascending: true })
          .order('name', { ascending: true });
        if (mErr) throw mErr;

        const modsByGroup = {};
        (mData || []).forEach((m) => {
          if (!modsByGroup[m.modifier_group_id]) modsByGroup[m.modifier_group_id] = [];
          modsByGroup[m.modifier_group_id].push(m);
        });

        if (!cancelled) {
          setGroups(gData.map((g) => ({ ...g, modifiers: modsByGroup[g.id] || [] })));
          setLoading(false);
        }
      } catch (err) {
        console.error('Failed to load modifiers:', err);
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [itemId]);

  return { groups, loading };
}

// ---------------------------------------------------------------------------
// ModifierPicker — exported component
// ---------------------------------------------------------------------------
// Props:
//   open          boolean
//   onOpenChange  (open: boolean) => void
//   item          { id, name, price, ... }
//   onConfirm     ({ selectedModifiers: Modifier[], extraCents: number, linePriceCents: number }) => void
// ---------------------------------------------------------------------------
export default function ModifierPicker({ open, onOpenChange, item, onConfirm }) {
  const { groups, loading } = useItemModifiers(open ? item?.id : null);
  const { format, scale } = useMoney();

  // selections: Map<groupId, Set<modifierId>>
  const [selections, setSelections] = useState({});

  // Reset selections when the modal opens for a new item
  useEffect(() => {
    if (open) {
      // Pre-select defaults
      setSelections({});
    }
  }, [open, item?.id]);

  // Pre-fill defaults once groups are loaded
  useEffect(() => {
    if (!groups.length) return;
    const defaults = {};
    groups.forEach((g) => {
      const defaultMods = g.modifiers.filter((m) => m.is_default);
      if (defaultMods.length) {
        defaults[g.id] = new Set(defaultMods.map((m) => m.id));
      }
    });
    if (Object.keys(defaults).length) setSelections(defaults);
  }, [groups]);

  const toggle = (group, modifier) => {
    setSelections((prev) => {
      const existing = new Set(prev[group.id] || []);
      if (existing.has(modifier.id)) {
        // Allow deselect only if not required-and-this-is-the-last
        existing.delete(modifier.id);
      } else {
        if (existing.size >= group.max_select) {
          if (group.max_select === 1) {
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

  // Validation: each required group must have >= min_select selections
  const validation = useMemo(() => {
    return groups.map((g) => {
      const sel = (selections[g.id] || new Set()).size;
      const ok = !g.is_required || sel >= g.min_select;
      const missing = g.is_required ? Math.max(0, g.min_select - sel) : 0;
      return { groupId: g.id, ok, missing };
    });
  }, [groups, selections]);

  const isValid = validation.every((v) => v.ok);

  // Compute extras
  const { extraCents, selectedModifiers } = useMemo(() => {
    let extra = 0;
    const mods = [];
    groups.forEach((g) => {
      const sel = selections[g.id] || new Set();
      g.modifiers.forEach((m) => {
        if (sel.has(m.id)) {
          extra += m.price_delta_cents || 0;
          mods.push(m);
        }
      });
    });
    return { extraCents: extra, selectedModifiers: mods };
  }, [groups, selections]);

  // `item.price` is a major-unit decimal string; only the currency knows how
  // many minor units that is.
  const basePriceCents = Math.round((parseFloat(item?.price) || 0) * scale);
  const linePriceCents = basePriceCents + extraCents;

  const handleConfirm = () => {
    if (!isValid) return;
    onConfirm({ selectedModifiers, extraCents, linePriceCents });
    onOpenChange(false);
  };

  // If item has no modifier groups (detected when loading finished and groups is empty),
  // auto-confirm with no extras — caller handles this by skipping the modal.
  // (workspace.jsx checks groups.length before even opening the modal — see below)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[85vh] flex flex-col overflow-hidden p-0">
        <DialogHeader className="px-5 pt-5 pb-3 border-b border-orange-100 shrink-0">
          <DialogTitle className="text-base font-bold text-gray-900">
            Customise — {item?.name}
          </DialogTitle>
          <DialogDescription className="flex items-center gap-2 text-sm">
            <span>Base: <span className="font-semibold tabular-nums text-gray-900">{format(basePriceCents)}</span></span>
            {extraCents !== 0 && (
              <>
                <span className="text-gray-400">+</span>
                <span className={cn('font-semibold tabular-nums', extraCents > 0 ? 'text-orange-600' : 'text-green-600')}>
                  {fmtDelta(extraCents, format)}
                </span>
                <span className="text-gray-400">= Total</span>
                <span className="font-bold tabular-nums text-gray-900">{format(linePriceCents)}</span>
              </>
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
          {loading ? (
            <div className="flex justify-center py-10">
              <Loader2 className="w-6 h-6 animate-spin text-orange-500" />
            </div>
          ) : groups.length === 0 ? (
            <p className="text-center text-gray-400 py-8 text-sm">No customisation options for this item.</p>
          ) : (
            groups.map((g) => {
              const sel = selections[g.id] || new Set();
              const v = validation.find((x) => x.groupId === g.id);
              return (
                <div key={g.id}>
                  {/* Group header */}
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-sm font-semibold text-gray-800">{g.name}</span>
                    {g.is_required && (
                      <Badge className="text-[10px] h-4 px-1.5 bg-red-100 text-red-700 border-red-200">
                        required
                      </Badge>
                    )}
                    <span className="text-[11px] text-gray-400 ml-auto">
                      {g.min_select === g.max_select
                        ? `Choose ${g.min_select}`
                        : g.max_select === 1
                          ? 'Choose 1'
                          : `Choose ${g.min_select}–${g.max_select}`}
                    </span>
                    {v && !v.ok && (
                      <span className="text-[11px] text-red-500 font-medium">
                        Pick {v.missing} more
                      </span>
                    )}
                  </div>

                  {/* Options */}
                  <div className="grid grid-cols-1 gap-1.5">
                    {g.modifiers.map((m) => {
                      const isSelected = sel.has(m.id);
                      const atMax = !isSelected && sel.size >= g.max_select;
                      return (
                        <button
                          key={m.id}
                          type="button"
                          disabled={atMax}
                          onClick={() => toggle(g, m)}
                          className={cn(
                            'flex items-center gap-3 px-3 py-2.5 rounded-xl border-2 text-left transition-all',
                            isSelected
                              ? 'border-orange-400 bg-orange-50 shadow-sm'
                              : atMax
                                ? 'border-gray-200 bg-gray-50 opacity-50 cursor-not-allowed'
                                : 'border-gray-200 bg-white hover:border-orange-300 hover:bg-orange-50/50',
                          )}
                        >
                          {/* Checkbox / radio indicator */}
                          <span className={cn(
                            'w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 transition-all',
                            isSelected ? 'border-orange-500 bg-orange-500' : 'border-gray-300 bg-white',
                          )}>
                            {isSelected && <Check className="w-3 h-3 text-white" strokeWidth={3} />}
                          </span>
                          <span className="flex-1 text-sm font-medium text-gray-800">{m.name}</span>
                          {m.price_delta_cents !== 0 && (
                            <span className={cn(
                              'text-sm font-semibold tabular-nums shrink-0',
                              m.price_delta_cents > 0 ? 'text-orange-600' : 'text-green-600',
                            )}>
                              {fmtDelta(m.price_delta_cents, format)}
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-4 border-t border-gray-100 shrink-0 flex gap-3">
          <Button variant="outline" className="flex-1 h-11" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            className={cn(
              'flex-1 h-11 text-sm font-bold',
              isValid
                ? 'bg-orange-500 hover:bg-orange-600 text-white'
                : 'bg-gray-200 text-gray-400 cursor-not-allowed',
            )}
            disabled={!isValid || loading}
            onClick={handleConfirm}
          >
            Add to ticket — {format(linePriceCents)}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// useModifierGroups — lightweight hook workspace.jsx uses to check if an item
// has ANY modifier groups before deciding whether to open the picker.
// ---------------------------------------------------------------------------
export function useItemHasModifiers(itemId) {
  const [hasModifiers, setHasModifiers] = useState(null); // null = unknown
  const [groupsCache, setGroupsCache] = useState({}); // itemId → boolean

  const check = async (id) => {
    if (id in groupsCache) return groupsCache[id];
    try {
      const { count, error } = await supabase
        .from('modifier_groups')
        .select('id', { count: 'exact', head: true })
        .eq('item_id', id);
      if (error) throw error;
      const result = (count || 0) > 0;
      setGroupsCache((c) => ({ ...c, [id]: result }));
      return result;
    } catch {
      return false;
    }
  };

  return { check };
}
