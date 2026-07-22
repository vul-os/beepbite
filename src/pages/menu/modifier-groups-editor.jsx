// modifier-groups-editor.jsx — CRUD UI for modifier_groups + modifiers on a menu item.
// Designed to be dropped inside the Recipe modal's tab set (or as a standalone dialog).
/* eslint-disable react/prop-types */
import { useEffect, useState } from 'react';
import { ChevronDown, ChevronRight, Loader2, Plus, Trash2, Edit, Check, X, ToggleLeft, ToggleRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { supabase } from '@/services/supabase-client';
import { useMoney } from '@/context/locale-context';

const emptyGroup = () => ({
  name: '',
  min_select: 0,
  max_select: 1,
  is_required: false,
  sort_order: 0,
});

const emptyModifier = () => ({
  name: '',
  price_delta_cents: 0,
  is_default: false,
  is_active: true,
  sort_order: 0,
});

// ---------------------------------------------------------------------------
// Inline editable row for a single modifier
// ---------------------------------------------------------------------------
function ModifierRow({ mod, onSave, onDelete, onToggleActive }) {
  const { format: formatMoneyValue, symbol } = useMoney();
  const fmtDelta = (cents) => {
    if (!cents) return '';
    return (cents > 0 ? '+' : '-') + formatMoneyValue(Math.abs(cents));
  };
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ ...mod });
  const [saving, setSaving] = useState(false);

  const commit = async () => {
    setSaving(true);
    await onSave(form);
    setSaving(false);
    setEditing(false);
  };

  const cancel = () => {
    setForm({ ...mod });
    setEditing(false);
  };

  if (editing) {
    return (
      <div className="flex items-center gap-2 py-1.5 px-2 rounded-lg bg-primary/10 border border-primary/20">
        <Input
          className="h-7 text-sm flex-1"
          value={form.name}
          onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
          placeholder="Option name"
          autoFocus
        />
        <Input
          className="h-7 text-sm w-24 tabular-nums"
          type="number"
          step="1"
          value={form.price_delta_cents}
          onChange={(e) => setForm((f) => ({ ...f, price_delta_cents: parseInt(e.target.value) || 0 }))}
          placeholder="Delta cents"
          title={`Price delta in cents (e.g. 50 = +${symbol}0.50)`}
        />
        <div className="flex items-center gap-1 text-xs text-muted-foreground">
          <Switch
            id={`def-${mod.id || 'new'}`}
            checked={form.is_default}
            onCheckedChange={(v) => setForm((f) => ({ ...f, is_default: v }))}
          />
          <span>Default</span>
        </div>
        <Button size="icon" variant="ghost" className="h-7 w-7 text-success hover:bg-success/10" onClick={commit} disabled={saving || !form.name.trim()}>
          {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
        </Button>
        <Button size="icon" variant="ghost" className="h-7 w-7 text-muted-foreground hover:bg-muted" onClick={cancel}>
          <X className="w-3.5 h-3.5" />
        </Button>
      </div>
    );
  }

  return (
    <div className={cn(
      'flex items-center gap-2 py-1.5 px-2 rounded-lg border',
      mod.is_active ? 'bg-card border-border' : 'bg-muted border-dashed border-border opacity-60',
    )}>
      <span className="flex-1 text-sm font-medium text-foreground truncate">{mod.name}</span>
      {mod.price_delta_cents !== 0 && (
        <span className={cn('text-xs font-semibold tabular-nums', mod.price_delta_cents > 0 ? 'text-primary' : 'text-success')}>
          {fmtDelta(mod.price_delta_cents)}
        </span>
      )}
      {mod.is_default && <Badge variant="outline" className="text-[10px] py-0 h-5 bg-primary/10 text-primary border-primary/25">default</Badge>}
      <Button size="icon" variant="ghost" className="h-6 w-6 text-muted-foreground hover:text-foreground" onClick={() => setEditing(true)} title="Edit">
        <Edit className="w-3 h-3" />
      </Button>
      <Button size="icon" variant="ghost" className="h-6 w-6 text-muted-foreground hover:text-warning" onClick={() => onToggleActive(mod)} title={mod.is_active ? '86 this option' : 'Re-enable'}>
        {mod.is_active ? <ToggleRight className="w-3.5 h-3.5 text-success" /> : <ToggleLeft className="w-3.5 h-3.5" />}
      </Button>
      <Button size="icon" variant="ghost" className="h-6 w-6 text-muted-foreground hover:text-destructive" onClick={() => onDelete(mod)} title="Delete">
        <Trash2 className="w-3 h-3" />
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Single modifier-group section (collapsible)
// ---------------------------------------------------------------------------
function GroupSection({ group, onUpdateGroup, onDeleteGroup, onRefresh }) {
  const [open, setOpen] = useState(true);
  const [editingGroup, setEditingGroup] = useState(false);
  const [groupForm, setGroupForm] = useState({ ...group });
  const [modifiers, setModifiers] = useState([]);
  const [loadingMods, setLoadingMods] = useState(false);
  const [addingMod, setAddingMod] = useState(false);
  const [newMod, setNewMod] = useState(emptyModifier());
  const [savingGroup, setSavingGroup] = useState(false);

  // Fetch modifiers for this group
  const fetchMods = async () => {
    setLoadingMods(true);
    try {
      const { data, error } = await supabase
        .from('modifiers')
        .select('*')
        .eq('modifier_group_id', group.id)
        .order('sort_order', { ascending: true })
        .order('name', { ascending: true });
      if (error) throw error;
      setModifiers(data || []);
    } catch (err) {
      console.error('Failed to load modifiers:', err);
    } finally {
      setLoadingMods(false);
    }
  };

  useEffect(() => { fetchMods(); }, [group.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const saveGroup = async () => {
    setSavingGroup(true);
    try {
      const { error } = await supabase
        .from('modifier_groups')
        .update({
          name: groupForm.name,
          min_select: parseInt(groupForm.min_select) || 0,
          max_select: Math.max(1, parseInt(groupForm.max_select) || 1),
          is_required: groupForm.is_required,
          sort_order: parseInt(groupForm.sort_order) || 0,
        })
        .eq('id', group.id);
      if (error) throw error;
      await onUpdateGroup();
      setEditingGroup(false);
    } catch (err) {
      console.error('Failed to save group:', err);
      alert(err.message || 'Failed to save group');
    } finally {
      setSavingGroup(false);
    }
  };

  const saveMod = async (form) => {
    try {
      if (form.id) {
        const { error } = await supabase
          .from('modifiers')
          .update({
            name: form.name,
            price_delta_cents: parseInt(form.price_delta_cents) || 0,
            is_default: form.is_default,
            sort_order: parseInt(form.sort_order) || 0,
          })
          .eq('id', form.id);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from('modifiers')
          .insert({
            modifier_group_id: group.id,
            name: form.name,
            price_delta_cents: parseInt(form.price_delta_cents) || 0,
            is_default: form.is_default,
            is_active: true,
            sort_order: parseInt(form.sort_order) || 0,
          });
        if (error) throw error;
      }
      await fetchMods();
    } catch (err) {
      console.error('Failed to save modifier:', err);
      alert(err.message || 'Failed to save modifier');
    }
  };

  const deleteMod = async (mod) => {
    if (!confirm(`Delete "${mod.name}"?`)) return;
    try {
      const { error } = await supabase.from('modifiers').delete().eq('id', mod.id);
      if (error) throw error;
      await fetchMods();
    } catch (err) {
      alert(err.message || 'Delete failed');
    }
  };

  const toggleActive = async (mod) => {
    try {
      const { error } = await supabase
        .from('modifiers')
        .update({ is_active: !mod.is_active })
        .eq('id', mod.id);
      if (error) throw error;
      await fetchMods();
    } catch (err) {
      alert(err.message || 'Update failed');
    }
  };

  const addNewMod = async () => {
    if (!newMod.name.trim()) return;
    await saveMod({ ...newMod });
    setNewMod(emptyModifier());
    setAddingMod(false);
  };

  return (
    <div className="rounded-xl border border-border overflow-hidden shadow-sm">
      {/* Group header */}
      <div className="flex items-center gap-2 px-3 py-2.5 bg-muted border-b border-border">
        <button type="button" onClick={() => setOpen((o) => !o)} className="flex items-center gap-1 flex-1 min-w-0 text-left">
          {open ? <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" /> : <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />}
          {editingGroup ? (
            <Input
              className="h-7 text-sm font-semibold flex-1"
              value={groupForm.name}
              onChange={(e) => setGroupForm((f) => ({ ...f, name: e.target.value }))}
              onClick={(e) => e.stopPropagation()}
              autoFocus
            />
          ) : (
            <span className="text-sm font-semibold text-foreground truncate">{group.name}</span>
          )}
        </button>

        <div className="flex items-center gap-1.5 shrink-0">
          {editingGroup ? (
            <>
              {/* min / max inline */}
              <div className="flex items-center gap-1 text-xs text-muted-foreground">
                <span>Min</span>
                <Input
                  className="h-6 w-12 text-xs text-center px-1"
                  type="number" min="0"
                  value={groupForm.min_select}
                  onChange={(e) => setGroupForm((f) => ({ ...f, min_select: e.target.value }))}
                  onClick={(e) => e.stopPropagation()}
                />
                <span>Max</span>
                <Input
                  className="h-6 w-12 text-xs text-center px-1"
                  type="number" min="1"
                  value={groupForm.max_select}
                  onChange={(e) => setGroupForm((f) => ({ ...f, max_select: e.target.value }))}
                  onClick={(e) => e.stopPropagation()}
                />
              </div>
              <div className="flex items-center gap-1 text-xs">
                <Switch checked={groupForm.is_required} onCheckedChange={(v) => setGroupForm((f) => ({ ...f, is_required: v }))} />
                <span className="text-muted-foreground">Required</span>
              </div>
              <Button size="icon" variant="ghost" className="h-6 w-6 text-success" onClick={saveGroup} disabled={savingGroup}>
                {savingGroup ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
              </Button>
              <Button size="icon" variant="ghost" className="h-6 w-6 text-muted-foreground" onClick={() => { setGroupForm({ ...group }); setEditingGroup(false); }}>
                <X className="w-3.5 h-3.5" />
              </Button>
            </>
          ) : (
            <>
              <Badge variant="outline" className="text-[10px] py-0 h-5">
                {group.min_select}–{group.max_select}
              </Badge>
              {group.is_required && <Badge variant="outline" className="text-[10px] py-0 h-5 bg-primary/10 text-primary border-primary/25">required</Badge>}
              <Button size="icon" variant="ghost" className="h-6 w-6 text-muted-foreground hover:text-foreground" onClick={() => setEditingGroup(true)}>
                <Edit className="w-3 h-3" />
              </Button>
              <Button size="icon" variant="ghost" className="h-6 w-6 text-muted-foreground hover:text-destructive" onClick={() => onDeleteGroup(group)}>
                <Trash2 className="w-3 h-3" />
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Modifiers list */}
      {open && (
        <div className="px-3 py-2 space-y-1.5 bg-card">
          {loadingMods ? (
            <div className="flex justify-center py-3"><Loader2 className="w-4 h-4 animate-spin text-muted-foreground" /></div>
          ) : modifiers.length === 0 ? (
            <p className="text-xs text-muted-foreground italic text-center py-2">No options yet — add one below.</p>
          ) : (
            modifiers.map((m) => (
              <ModifierRow
                key={m.id}
                mod={m}
                onSave={saveMod}
                onDelete={deleteMod}
                onToggleActive={toggleActive}
              />
            ))
          )}

          {/* Inline add-modifier row */}
          {addingMod ? (
            <div className="flex items-center gap-2 py-1.5 px-2 rounded-lg bg-primary/10 border border-primary/20 mt-1">
              <Input
                className="h-7 text-sm flex-1"
                value={newMod.name}
                onChange={(e) => setNewMod((f) => ({ ...f, name: e.target.value }))}
                placeholder="Option name"
                autoFocus
                onKeyDown={(e) => { if (e.key === 'Enter') addNewMod(); if (e.key === 'Escape') setAddingMod(false); }}
              />
              <Input
                className="h-7 text-sm w-28 tabular-nums"
                type="number"
                step="1"
                value={newMod.price_delta_cents}
                onChange={(e) => setNewMod((f) => ({ ...f, price_delta_cents: parseInt(e.target.value) || 0 }))}
                placeholder="Delta (cents)"
                title={`e.g. 50 = +${symbol}0.50, -100 = -${symbol}1.00`}
              />
              <div className="flex items-center gap-1 text-xs text-muted-foreground">
                <Switch checked={newMod.is_default} onCheckedChange={(v) => setNewMod((f) => ({ ...f, is_default: v }))} />
                <span>Default</span>
              </div>
              <Button size="icon" variant="ghost" className="h-7 w-7 text-success" onClick={addNewMod} disabled={!newMod.name.trim()}>
                <Check className="w-3.5 h-3.5" />
              </Button>
              <Button size="icon" variant="ghost" className="h-7 w-7 text-muted-foreground" onClick={() => { setAddingMod(false); setNewMod(emptyModifier()); }}>
                <X className="w-3.5 h-3.5" />
              </Button>
            </div>
          ) : (
            <Button size="sm" variant="ghost"
              className="h-7 text-xs text-primary hover:text-primary hover:bg-primary/10 w-full justify-start pl-2 mt-0.5"
              onClick={() => setAddingMod(true)}>
              <Plus className="w-3.5 h-3.5 mr-1" /> Add option
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------
export default function ModifierGroupsEditor({ itemId }) {
  const [groups, setGroups] = useState([]);
  const [loading, setLoading] = useState(false);
  const [addingGroup, setAddingGroup] = useState(false);
  const [newGroup, setNewGroup] = useState(emptyGroup());
  const [savingGroup, setSavingGroup] = useState(false);

  const fetchGroups = async () => {
    if (!itemId) return;
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('modifier_groups')
        .select('*')
        .eq('item_id', itemId)
        .order('sort_order', { ascending: true })
        .order('name', { ascending: true });
      if (error) throw error;
      setGroups(data || []);
    } catch (err) {
      console.error('Failed to load modifier groups:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchGroups(); }, [itemId]); // eslint-disable-line react-hooks/exhaustive-deps

  const addGroup = async () => {
    if (!newGroup.name.trim() || !itemId) return;
    setSavingGroup(true);
    try {
      const { error } = await supabase.from('modifier_groups').insert({
        item_id: itemId,
        name: newGroup.name.trim(),
        min_select: parseInt(newGroup.min_select) || 0,
        max_select: Math.max(1, parseInt(newGroup.max_select) || 1),
        is_required: newGroup.is_required,
        sort_order: parseInt(newGroup.sort_order) || 0,
      });
      if (error) throw error;
      setNewGroup(emptyGroup());
      setAddingGroup(false);
      await fetchGroups();
    } catch (err) {
      console.error('Failed to add group:', err);
      alert(err.message || 'Failed to add modifier group');
    } finally {
      setSavingGroup(false);
    }
  };

  const deleteGroup = async (group) => {
    if (!confirm(`Delete group "${group.name}" and all its options?`)) return;
    try {
      const { error } = await supabase.from('modifier_groups').delete().eq('id', group.id);
      if (error) throw error;
      await fetchGroups();
    } catch (err) {
      alert(err.message || 'Delete failed');
    }
  };

  if (!itemId) {
    return (
      <div className="text-center py-6 text-muted-foreground text-sm">
        Save the item first, then add modifier groups.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium text-foreground">Modifier Groups</p>
          <p className="text-xs text-muted-foreground">Define choices the cashier or customer must / can make (e.g. "Choose a size", "Extra toppings").</p>
        </div>
        {!addingGroup && (
          <Button size="sm" onClick={() => setAddingGroup(true)} className="h-8">
            <Plus className="w-3.5 h-3.5 mr-1" /> Add Group
          </Button>
        )}
      </div>

      {/* New group form */}
      {addingGroup && (
        <div className="rounded-xl border border-primary/20 bg-primary/5 p-3 space-y-3">
          <p className="text-xs font-semibold text-primary uppercase tracking-wide">New Modifier Group</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <Label className="text-xs" htmlFor="ng-name">Group name *</Label>
              <Input
                id="ng-name"
                className="h-8 text-sm mt-0.5"
                value={newGroup.name}
                onChange={(e) => setNewGroup((f) => ({ ...f, name: e.target.value }))}
                placeholder="e.g. Choose a size"
                autoFocus
              />
            </div>
            <div className="flex items-center gap-3">
              <div>
                <Label className="text-xs" htmlFor="ng-min">Min select</Label>
                <Input
                  id="ng-min" type="number" min="0"
                  className="h-8 text-sm w-20 mt-0.5"
                  value={newGroup.min_select}
                  onChange={(e) => setNewGroup((f) => ({ ...f, min_select: e.target.value }))}
                />
              </div>
              <div>
                <Label className="text-xs" htmlFor="ng-max">Max select</Label>
                <Input
                  id="ng-max" type="number" min="1"
                  className="h-8 text-sm w-20 mt-0.5"
                  value={newGroup.max_select}
                  onChange={(e) => setNewGroup((f) => ({ ...f, max_select: e.target.value }))}
                />
              </div>
              <div className="flex items-center gap-1.5 self-end pb-0.5">
                <Switch
                  id="ng-req"
                  checked={newGroup.is_required}
                  onCheckedChange={(v) => setNewGroup((f) => ({ ...f, is_required: v }))}
                />
                <Label htmlFor="ng-req" className="text-xs text-muted-foreground cursor-pointer">Required</Label>
              </div>
            </div>
          </div>
          <div className="flex gap-2">
            <Button size="sm" onClick={addGroup} disabled={savingGroup || !newGroup.name.trim()} className="h-8">
              {savingGroup ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> : <Check className="w-3.5 h-3.5 mr-1" />}
              Save Group
            </Button>
            <Button size="sm" variant="outline" onClick={() => { setAddingGroup(false); setNewGroup(emptyGroup()); }} className="h-8">
              Cancel
            </Button>
          </div>
        </div>
      )}

      {/* Existing groups */}
      {loading ? (
        <div className="flex justify-center py-6"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
      ) : groups.length === 0 && !addingGroup ? (
        <div className="text-center py-6 border border-dashed border-border rounded-xl">
          <p className="text-sm text-muted-foreground">No modifier groups yet.</p>
          <p className="text-xs text-muted-foreground mt-0.5">Click "Add Group" to create one.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {groups.map((g) => (
            <GroupSection
              key={g.id}
              group={g}
              onUpdateGroup={fetchGroups}
              onDeleteGroup={deleteGroup}
              onRefresh={fetchGroups}
            />
          ))}
        </div>
      )}
    </div>
  );
}
