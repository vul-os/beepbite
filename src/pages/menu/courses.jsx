// courses.jsx — CRUD UI for kitchen fire courses at the active location.
//
// Lives at /menu/courses (accessible from the main-layout app shell).
// Uses the generic REST data layer via `api.from('courses')`.
//
// Columns: id, location_id, name, sort_order, is_active,
//          fire_on_previous_course_bumped, created_at, updated_at.
//
// RLS on the `courses` table is location→org scoped so only members of the
// owning org can read / write.

/* eslint-disable react/prop-types */
import { useState, useEffect, useCallback } from 'react';
import {
  ChefHat,
  Plus,
  Pencil,
  Trash2,
  AlertCircle,
  Loader2,
  ToggleRight,
  ToggleLeft,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

import { useAuth } from '@/context/auth-context';
import { api } from '@/lib/api-client';
import { useToast } from '@/hooks/use-toast';
import { PageContainer, PageHeader } from '@/components/ui/page-header';

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

function useCourses(locationId) {
  const [courses, setCourses] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const fetch = useCallback(async () => {
    if (!locationId) { setCourses([]); return; }
    setLoading(true);
    setError(null);
    try {
      const { data, error: err } = await api
        .from('courses')
        .select('*')
        .eq('location_id', locationId)
        .order('sort_order', { ascending: true })
        .order('name', { ascending: true });
      if (err) throw new Error(err.message);
      setCourses(data || []);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [locationId]);

  useEffect(() => { fetch(); }, [fetch]);

  const create = useCallback(async (body) => {
    const { data, error: err } = await api.from('courses').insert(body);
    if (err) throw new Error(err.message);
    await fetch();
    return data;
  }, [fetch]);

  const update = useCallback(async (id, body) => {
    const { data, error: err } = await api
      .from('courses').update(body).eq('id', id);
    if (err) throw new Error(err.message);
    await fetch();
    return data;
  }, [fetch]);

  const remove = useCallback(async (id) => {
    const { error: err } = await api.from('courses').delete().eq('id', id);
    if (err) throw new Error(err.message);
    await fetch();
  }, [fetch]);

  return { courses, loading, error, refresh: fetch, create, update, remove };
}

// ---------------------------------------------------------------------------
// Form dialog
// ---------------------------------------------------------------------------

const EMPTY_FORM = {
  name: '',
  sort_order: 0,
  fire_on_previous_course_bumped: false,
  is_active: true,
};

function CourseFormDialog({ open, onClose, onSubmit, initial, submitting }) {
  const [form, setForm] = useState(EMPTY_FORM);

  useEffect(() => {
    if (open) setForm(initial ? { ...initial } : EMPTY_FORM);
  }, [open, initial]);

  const set = (key, value) => setForm((f) => ({ ...f, [key]: value }));

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!form.name.trim()) return;
    onSubmit({
      name: form.name.trim(),
      sort_order: parseInt(form.sort_order, 10) || 0,
      fire_on_previous_course_bumped: Boolean(form.fire_on_previous_course_bumped),
      is_active: Boolean(form.is_active),
    });
  };

  const isEdit = Boolean(initial?.id);

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Edit course' : 'New course'}</DialogTitle>
          <DialogDescription>
            Courses let you group and fire kitchen tickets in stages (Starter → Main → Dessert).
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 mt-2">
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-foreground">Name</label>
            <Input
              value={form.name}
              onChange={(e) => set('name', e.target.value)}
              placeholder="e.g. Starter, Main, Dessert"
              required
              autoFocus
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-medium text-foreground">Sort order</label>
            <Input
              type="number"
              value={form.sort_order}
              onChange={(e) => set('sort_order', e.target.value)}
              min={0}
              className="w-24"
            />
            <p className="text-xs text-muted-foreground">
              Lower numbers fire first. Starter = 1, Main = 2, Dessert = 3.
            </p>
          </div>

          <div className="flex items-center justify-between rounded-lg border border-border p-3">
            <div>
              <p className="text-sm font-medium text-foreground">Auto-fire when previous course is bumped</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                When the preceding course is marked done on the KDS, this course fires automatically.
              </p>
            </div>
            <Switch
              checked={Boolean(form.fire_on_previous_course_bumped)}
              onCheckedChange={(v) => set('fire_on_previous_course_bumped', v)}
            />
          </div>

          <div className="flex items-center justify-between rounded-lg border border-border p-3">
            <div>
              <p className="text-sm font-medium text-foreground">Active</p>
              <p className="text-xs text-muted-foreground mt-0.5">Inactive courses are hidden in the POS.</p>
            </div>
            <Switch
              checked={Boolean(form.is_active)}
              onCheckedChange={(v) => set('is_active', v)}
            />
          </div>

          <DialogFooter className="pt-2">
            <Button type="button" variant="outline" onClick={onClose} disabled={submitting}>
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={submitting || !form.name.trim()}
            >
              {submitting ? (
                <><Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> Saving…</>
              ) : (
                isEdit ? 'Save changes' : 'Create course'
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function CoursesPage() {
  const { activeLocation } = useAuth();
  const { toast } = useToast();
  const locationId = activeLocation?.id || null;

  const { courses, loading, error, create, update, remove } = useCourses(locationId);

  const [formOpen, setFormOpen] = useState(false);
  const [editTarget, setEditTarget] = useState(null);   // course row | null
  const [submitting, setSubmitting] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null); // course row | null

  const openCreate = () => { setEditTarget(null); setFormOpen(true); };
  const openEdit = (c) => { setEditTarget(c); setFormOpen(true); };

  const handleSubmit = async (values) => {
    setSubmitting(true);
    try {
      if (editTarget) {
        await update(editTarget.id, values);
        toast({ title: 'Course updated' });
      } else {
        await create({ ...values, location_id: locationId });
        toast({ title: 'Course created' });
      }
      setFormOpen(false);
      setEditTarget(null);
    } catch (e) {
      toast({ variant: 'destructive', title: 'Save failed', description: e.message });
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await remove(deleteTarget.id);
      toast({ title: `"${deleteTarget.name}" deleted` });
    } catch (e) {
      toast({ variant: 'destructive', title: 'Delete failed', description: e.message });
    } finally {
      setDeleteTarget(null);
    }
  };

  const handleToggleActive = async (c) => {
    try {
      await update(c.id, { is_active: !c.is_active });
    } catch (e) {
      toast({ variant: 'destructive', title: 'Update failed', description: e.message });
    }
  };

  return (
    <PageContainer className="max-w-3xl mx-auto">
      <PageHeader
        icon={ChefHat}
        title="Courses"
        description={`Manage kitchen fire courses for ${activeLocation?.name || 'this location'}.`}
        actions={
          <Button onClick={openCreate} disabled={!locationId}>
            <Plus className="w-4 h-4 mr-1.5" />
            Add course
          </Button>
        }
      />

      {/* Error */}
      {error && (
        <div className="flex items-center gap-2 rounded-lg border border-destructive/20 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          <AlertCircle className="w-4 h-4 shrink-0" />
          {error}
        </div>
      )}

      {!locationId && (
        <div className="rounded-lg border border-warning/20 bg-warning/10 px-4 py-3 text-sm text-warning">
          Select a location first.
        </div>
      )}

      {/* Table */}
      {loading ? (
        <div className="flex items-center justify-center py-12 text-muted-foreground">
          <Loader2 className="w-6 h-6 animate-spin mr-2" />
          Loading courses…
        </div>
      ) : courses.length === 0 && locationId ? (
        <div className="text-center py-16 text-muted-foreground">
          <ChefHat className="w-12 h-12 mx-auto mb-3 opacity-30" />
          <p className="text-sm font-medium">No courses yet</p>
          <p className="text-xs mt-1">Add Starter, Main and Dessert to enable staged kitchen firing.</p>
          <Button onClick={openCreate} variant="outline" className="mt-4 border-primary/25 text-primary">
            <Plus className="w-4 h-4 mr-1.5" /> Add first course
          </Button>
        </div>
      ) : courses.length > 0 ? (
        <div className="rounded-xl border border-border overflow-hidden">
          <Table>
            <TableHeader className="bg-muted">
              <TableRow>
                <TableHead className="w-10 text-center">#</TableHead>
                <TableHead>Name</TableHead>
                <TableHead className="text-center">Auto-fire</TableHead>
                <TableHead className="text-center">Status</TableHead>
                <TableHead className="w-24" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {courses.map((c) => (
                <TableRow key={c.id} className="hover:bg-primary/5">
                  <TableCell className="text-center text-sm text-muted-foreground tabular-nums font-medium">
                    {c.sort_order}
                  </TableCell>
                  <TableCell>
                    <span className="text-sm font-semibold text-foreground">{c.name}</span>
                  </TableCell>
                  <TableCell className="text-center">
                    {c.fire_on_previous_course_bumped ? (
                      <span className="inline-flex items-center gap-1 text-xs font-medium text-success">
                        <ToggleRight className="w-3.5 h-3.5" /> Yes
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                        <ToggleLeft className="w-3.5 h-3.5" /> No
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="text-center">
                    <button
                      type="button"
                      onClick={() => handleToggleActive(c)}
                      className="focus:outline-none"
                      title={c.is_active ? 'Click to deactivate' : 'Click to activate'}
                    >
                      {c.is_active ? (
                        <Badge variant="outline" className="bg-success/10 text-success border-success/25 cursor-pointer hover:bg-success/20">
                          Active
                        </Badge>
                      ) : (
                        <Badge variant="secondary" className="cursor-pointer hover:bg-muted">
                          Inactive
                        </Badge>
                      )}
                    </button>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1 justify-end">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => openEdit(c)}
                        className="h-7 w-7 p-0 text-muted-foreground hover:text-primary"
                        title="Edit"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setDeleteTarget(c)}
                        className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
                        title="Delete"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : null}

      {/* Form dialog */}
      <CourseFormDialog
        open={formOpen}
        onClose={() => { setFormOpen(false); setEditTarget(null); }}
        onSubmit={handleSubmit}
        initial={editTarget}
        submitting={submitting}
      />

      {/* Delete confirm */}
      <AlertDialog open={Boolean(deleteTarget)} onOpenChange={(o) => { if (!o) setDeleteTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete &quot;{deleteTarget?.name}&quot;?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently remove the course. Order items already assigned to it will retain
              their <code className="text-xs bg-muted px-1 rounded">course_number</code> for back-compat.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              variant="destructive"
            >
              Delete course
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </PageContainer>
  );
}
