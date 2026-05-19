// schedule-list.jsx — left-rail list of menu schedules + "New schedule" dialog.

import React, { useState } from 'react';
import { Plus, Trash2, Clock, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';

export default function ScheduleList({ schedules, selectedId, onSelect, onDelete, onCreate, loading }) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ name: '', code: '', description: '' });
  const [formError, setFormError] = useState('');

  const handleOpen = () => {
    setForm({ name: '', code: '', description: '' });
    setFormError('');
    setOpen(true);
  };

  const handleNameChange = (e) => {
    const name = e.target.value;
    // auto-derive a slug from the name
    const code = name.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
    setForm((prev) => ({ ...prev, name, code }));
  };

  const handleCreate = async () => {
    if (!form.name.trim()) {
      setFormError('Name is required.');
      return;
    }
    if (!form.code.trim()) {
      setFormError('Code/slug is required.');
      return;
    }
    setSaving(true);
    setFormError('');
    try {
      await onCreate(form);
      setOpen(false);
    } catch (e) {
      setFormError(e.message || 'Failed to create schedule');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (e, id) => {
    e.stopPropagation();
    if (!confirm('Delete this schedule and all its slots?')) return;
    try {
      await onDelete(id);
    } catch (e) {
      alert(e.message || 'Failed to delete schedule');
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* header */}
      <div className="flex items-center justify-between px-4 py-3 border-b">
        <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">Schedules</h2>
        <Button size="sm" variant="ghost" onClick={handleOpen} className="h-7 w-7 p-0">
          <Plus className="h-4 w-4" />
        </Button>
      </div>

      {/* list */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="space-y-2 p-4">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="h-10 bg-gray-100 rounded animate-pulse" />
            ))}
          </div>
        ) : schedules.length === 0 ? (
          <div className="p-4 text-center text-sm text-gray-500">
            <Clock className="h-8 w-8 mx-auto mb-2 text-gray-300" />
            No schedules yet.
          </div>
        ) : (
          <ul className="py-1">
            {schedules.map((s) => (
              <li
                key={s.id}
                onClick={() => onSelect(s)}
                className={cn(
                  'group flex items-center justify-between px-4 py-2 cursor-pointer text-sm hover:bg-gray-50',
                  selectedId === s.id && 'bg-orange-50 border-r-2 border-orange-500 font-medium text-orange-700',
                )}
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span className="truncate">{s.name}</span>
                  {!s.is_active && (
                    <Badge variant="outline" className="text-xs text-gray-400 border-gray-200 shrink-0">
                      inactive
                    </Badge>
                  )}
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6 w-6 p-0 opacity-0 group-hover:opacity-100 text-red-400 hover:text-red-600 hover:bg-red-50 shrink-0"
                  onClick={(e) => handleDelete(e, s.id)}
                >
                  <Trash2 className="h-3 w-3" />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* new schedule dialog */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Plus className="h-4 w-4 text-orange-500" />
              New Schedule
            </DialogTitle>
            <DialogDescription>
              Create a named daypart (e.g. Breakfast, Happy Hour).
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 pt-2">
            <div>
              <Label htmlFor="sched-name">Name *</Label>
              <Input
                id="sched-name"
                value={form.name}
                onChange={handleNameChange}
                placeholder="e.g. Breakfast"
              />
            </div>

            <div>
              <Label htmlFor="sched-code">Code / Slug *</Label>
              <Input
                id="sched-code"
                value={form.code}
                onChange={(e) => setForm((p) => ({ ...p, code: e.target.value }))}
                placeholder="e.g. breakfast"
              />
              <p className="text-xs text-gray-400 mt-1">Lowercase letters, digits and underscores only. Must be unique per location.</p>
            </div>

            <div>
              <Label htmlFor="sched-desc">Description</Label>
              <Input
                id="sched-desc"
                value={form.description}
                onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))}
                placeholder="Optional description"
              />
            </div>

            {formError && (
              <div className="flex items-center gap-2 text-sm text-red-600">
                <AlertCircle className="h-4 w-4 shrink-0" />
                {formError}
              </div>
            )}

            <div className="flex gap-3 pt-2">
              <Button variant="outline" onClick={() => setOpen(false)} disabled={saving} className="flex-1">
                Cancel
              </Button>
              <Button onClick={handleCreate} disabled={saving} className="flex-1 bg-orange-500 hover:bg-orange-600 text-white">
                {saving ? 'Creating…' : 'Create'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
