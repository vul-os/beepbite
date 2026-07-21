// src/pages/settings/kitchen/index.jsx — Kitchen Routing Settings (Wave 12)
//
// Owner page for managing all kitchen-routing configuration for a location:
//
//   Tab 1 – Stations        : list / create / edit / delete kitchen_stations
//   Tab 2 – Category routes : bind menu categories → station
//   Tab 3 – Item routes     : bind individual items → station (item-level override)
//   Tab 4 – Display groups  : manage kds_display_groups (migration 031)
//                             name, station_ids[], display_order, auto_recall_seconds
//
// All data is read/written via src/services/kitchen-config.js which wraps the
// generic /data/{table} API (api.from(...) builder from @/lib/api-client.js).

/* eslint-disable react/prop-types */
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  ChefHat,
  Edit,
  Layers,
  Loader2,
  Plus,
  RotateCcw,
  Settings2,
  Tag,
  Trash2,
  Utensils,
} from 'lucide-react';

import { useAuth } from '@/context/auth-context';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

import {
  fetchStations,
  createStation,
  updateStation,
  deleteStation,
  fetchCategoryRoutings,
  setCategoryRouting,
  deleteCategoryRouting,
  fetchItemRoutings,
  setItemRouting,
  deleteItemRouting,
  fetchDisplayGroups,
  createDisplayGroup,
  updateDisplayGroup,
  deleteDisplayGroup,
  fetchCategories,
  fetchItems,
} from '@/services/kitchen-config';

// ============================================================
// Root page
// ============================================================

export default function KitchenSettingsPage() {
  const { activeLocation } = useAuth();

  if (!activeLocation) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <AlertCircle className="h-12 w-12 text-muted-foreground mb-4" />
        <h2 className="text-xl font-semibold mb-1">No location selected</h2>
        <p className="text-muted-foreground">
          Please select a location to manage kitchen settings.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* ---- header ---- */}
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <ChefHat className="h-6 w-6 text-orange-500" />
          Kitchen routing
        </h1>
        <p className="text-muted-foreground text-sm mt-0.5">
          Configure which station receives each category or item at{' '}
          <strong>{activeLocation.name}</strong>.
        </p>
      </div>

      {/* ---- tabs ---- */}
      <Tabs defaultValue="stations" className="space-y-4">
        <TabsList>
          <TabsTrigger value="stations" className="gap-1.5">
            <Settings2 className="h-4 w-4" />
            Stations
          </TabsTrigger>
          <TabsTrigger value="categories" className="gap-1.5">
            <Tag className="h-4 w-4" />
            Category routes
          </TabsTrigger>
          <TabsTrigger value="items" className="gap-1.5">
            <Utensils className="h-4 w-4" />
            Item routes
          </TabsTrigger>
          <TabsTrigger value="groups" className="gap-1.5">
            <Layers className="h-4 w-4" />
            Display groups
          </TabsTrigger>
        </TabsList>

        <TabsContent value="stations">
          <StationsTab locationId={activeLocation.id} />
        </TabsContent>
        <TabsContent value="categories">
          <CategoryRoutingTab locationId={activeLocation.id} />
        </TabsContent>
        <TabsContent value="items">
          <ItemRoutingTab locationId={activeLocation.id} />
        </TabsContent>
        <TabsContent value="groups">
          <DisplayGroupsTab locationId={activeLocation.id} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ============================================================
// Shared helpers
// ============================================================

function LoadingSkeleton({ rows = 3 }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="h-12 rounded-md bg-muted animate-pulse" />
      ))}
    </div>
  );
}

function ErrorBanner({ message }) {
  return (
    <div className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
      {message}
    </div>
  );
}

function EmptyState({ icon: Icon, label, action }) {
  return (
    <div className="rounded-lg border border-dashed p-10 text-center">
      <Icon className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
      <p className="font-medium">{label}</p>
      {action}
    </div>
  );
}

// ============================================================
// Tab 1 — Stations
// ============================================================

function StationsTab({ locationId }) {
  const [stations, setStations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [sheetOpen, setSheetOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [saving, setSaving] = useState(false);
  const [toDelete, setToDelete] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setStations(await fetchStations(locationId));
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [locationId]);

  useEffect(() => { load(); }, [load]);

  const openNew = () => { setEditing(null); setSheetOpen(true); };
  const openEdit = (s) => { setEditing(s); setSheetOpen(true); };
  const closeSheet = () => { setSheetOpen(false); setEditing(null); };

  const handleSubmit = async (payload) => {
    setSaving(true);
    try {
      if (editing?.id) {
        await updateStation(editing.id, payload);
      } else {
        await createStation({ ...payload, location_id: locationId });
      }
      await load();
      closeSheet();
    } catch (e) {
      alert(e.message);
    } finally {
      setSaving(false);
    }
  };

  const confirmDelete = async () => {
    if (!toDelete) return;
    try { await deleteStation(toDelete.id); await load(); }
    catch (e) { alert(e.message); }
    finally { setToDelete(null); }
  };

  const toggleActive = async (station) => {
    try {
      await updateStation(station.id, { is_active: !station.is_active });
      await load();
    } catch (e) { alert(e.message); }
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button onClick={openNew} className="gap-2">
          <Plus className="h-4 w-4" />
          New station
        </Button>
      </div>

      {error && <ErrorBanner message={error} />}
      {loading && <LoadingSkeleton />}

      {!loading && stations.length === 0 && (
        <EmptyState
          icon={Settings2}
          label="No stations yet"
          action={
            <Button variant="outline" onClick={openNew} className="mt-3 gap-2">
              <Plus className="h-4 w-4" /> New station
            </Button>
          }
        />
      )}

      {!loading && stations.length > 0 && (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Order</TableHead>
                <TableHead className="text-center">Active</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {stations.map((s) => (
                <TableRow key={s.id}>
                  <TableCell className="font-medium">{s.name}</TableCell>
                  <TableCell className="text-muted-foreground text-sm">{s.sort_order ?? '—'}</TableCell>
                  <TableCell className="text-center">
                    <Switch
                      checked={s.is_active ?? true}
                      onCheckedChange={() => toggleActive(s)}
                      aria-label="Toggle active"
                    />
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={() => openEdit(s)} title="Edit">
                        <Edit className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="sm" className="h-8 w-8 p-0 text-destructive hover:text-destructive" onClick={() => setToDelete(s)} title="Delete">
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Sheet */}
      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent side="right" className="sm:max-w-md overflow-y-auto">
          <SheetHeader className="mb-4">
            <SheetTitle>{editing ? 'Edit station' : 'New station'}</SheetTitle>
            <SheetDescription>
              {editing ? `Update "${editing.name}"` : 'Add a new KDS station for this location.'}
            </SheetDescription>
          </SheetHeader>
          <StationForm initial={editing} onSubmit={handleSubmit} onCancel={closeSheet} saving={saving} />
        </SheetContent>
      </Sheet>

      {/* Delete confirm */}
      <AlertDialog open={Boolean(toDelete)} onOpenChange={(v) => !v && setToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete station?</AlertDialogTitle>
            <AlertDialogDescription>
              "{toDelete?.name}" will be removed. Existing routing rules that reference this station will be orphaned.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function StationForm({ initial, onSubmit, onCancel, saving }) {
  const [name, setName] = useState(initial?.name ?? '');
  const [sortOrder, setSortOrder] = useState(initial?.sort_order ?? '');

  const handleSubmit = (e) => {
    e.preventDefault();
    onSubmit({
      name: name.trim(),
      sort_order: sortOrder !== '' ? Number(sortOrder) : null,
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="st-name">Station name</Label>
        <Input
          id="st-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Grill, Cold, Pizza"
          required
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="st-order">Display order</Label>
        <Input
          id="st-order"
          type="number"
          value={sortOrder}
          onChange={(e) => setSortOrder(e.target.value)}
          placeholder="0"
          min={0}
        />
      </div>
      <div className="flex gap-2 pt-2">
        <Button type="submit" disabled={saving || !name.trim()} className="flex-1">
          {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          {initial ? 'Save changes' : 'Create station'}
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel}>Cancel</Button>
      </div>
    </form>
  );
}

// ============================================================
// Tab 2 — Category routes
// ============================================================

function CategoryRoutingTab({ locationId }) {
  const [stations, setStations] = useState([]);
  const [categories, setCategories] = useState([]);
  const [routings, setRoutings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [sheetOpen, setSheetOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [saving, setSaving] = useState(false);
  const [toDelete, setToDelete] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [s, c, r] = await Promise.all([
        fetchStations(locationId),
        fetchCategories(locationId),
        fetchCategoryRoutings(locationId),
      ]);
      setStations(s);
      setCategories(c);
      setRoutings(r);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [locationId]);

  useEffect(() => { load(); }, [load]);

  const stationById = useMemo(() => Object.fromEntries(stations.map((s) => [s.id, s])), [stations]);
  const categoryById = useMemo(() => Object.fromEntries(categories.map((c) => [c.id, c])), [categories]);

  const openNew = () => { setEditing(null); setSheetOpen(true); };
  const openEdit = (r) => { setEditing(r); setSheetOpen(true); };
  const closeSheet = () => { setSheetOpen(false); setEditing(null); };

  const handleSubmit = async ({ categoryId, stationId }) => {
    setSaving(true);
    try {
      await setCategoryRouting(locationId, categoryId, stationId);
      await load();
      closeSheet();
    } catch (e) {
      alert(e.message);
    } finally {
      setSaving(false);
    }
  };

  const confirmDelete = async () => {
    if (!toDelete) return;
    try { await deleteCategoryRouting(toDelete.id); await load(); }
    catch (e) { alert(e.message); }
    finally { setToDelete(null); }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Route all items in a category to a specific station by default.
        </p>
        <Button onClick={openNew} className="gap-2">
          <Plus className="h-4 w-4" />
          Add route
        </Button>
      </div>

      {error && <ErrorBanner message={error} />}
      {loading && <LoadingSkeleton />}

      {!loading && routings.length === 0 && (
        <EmptyState
          icon={Tag}
          label="No category routes yet"
          action={
            <Button variant="outline" onClick={openNew} className="mt-3 gap-2">
              <Plus className="h-4 w-4" /> Add route
            </Button>
          }
        />
      )}

      {!loading && routings.length > 0 && (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Category</TableHead>
                <TableHead>Station</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {routings.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-medium">
                    {categoryById[r.category_id]?.name ?? <span className="italic text-muted-foreground">{r.category_id?.slice(0, 8)}</span>}
                  </TableCell>
                  <TableCell>
                    {stationById[r.station_id]
                      ? <Badge variant="outline" className="border-orange-400 text-orange-700">{stationById[r.station_id].name}</Badge>
                      : <span className="italic text-muted-foreground">{r.station_id?.slice(0, 8)}</span>
                    }
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={() => openEdit(r)} title="Edit">
                        <Edit className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="sm" className="h-8 w-8 p-0 text-destructive hover:text-destructive" onClick={() => setToDelete(r)} title="Delete">
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Sheet */}
      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent side="right" className="sm:max-w-md overflow-y-auto">
          <SheetHeader className="mb-4">
            <SheetTitle>{editing ? 'Edit category route' : 'Add category route'}</SheetTitle>
            <SheetDescription>Bind a menu category to a KDS station.</SheetDescription>
          </SheetHeader>
          <RoutingForm
            initial={editing}
            stations={stations}
            sourceItems={categories}
            sourceLabel="Category"
            sourceKey="categoryId"
            onSubmit={handleSubmit}
            onCancel={closeSheet}
            saving={saving}
          />
        </SheetContent>
      </Sheet>

      {/* Delete confirm */}
      <DeleteConfirm
        open={Boolean(toDelete)}
        onOpenChange={(v) => !v && setToDelete(null)}
        title="Remove category route?"
        description={`The route for "${categoryById[toDelete?.category_id]?.name ?? toDelete?.category_id}" will be removed.`}
        onConfirm={confirmDelete}
      />
    </div>
  );
}

// ============================================================
// Tab 3 — Item routes
// ============================================================

function ItemRoutingTab({ locationId }) {
  const [stations, setStations] = useState([]);
  const [items, setItems] = useState([]);
  const [routings, setRoutings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [sheetOpen, setSheetOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [saving, setSaving] = useState(false);
  const [toDelete, setToDelete] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [s, it, r] = await Promise.all([
        fetchStations(locationId),
        fetchItems(locationId),
        fetchItemRoutings(locationId),
      ]);
      setStations(s);
      setItems(it);
      setRoutings(r);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [locationId]);

  useEffect(() => { load(); }, [load]);

  const stationById = useMemo(() => Object.fromEntries(stations.map((s) => [s.id, s])), [stations]);
  const itemById = useMemo(() => Object.fromEntries(items.map((it) => [it.id, it])), [items]);

  const openNew = () => { setEditing(null); setSheetOpen(true); };
  const openEdit = (r) => { setEditing(r); setSheetOpen(true); };
  const closeSheet = () => { setSheetOpen(false); setEditing(null); };

  const handleSubmit = async ({ categoryId: itemId, stationId }) => {
    // RoutingForm uses categoryId key generically; here it maps to itemId
    setSaving(true);
    try {
      await setItemRouting(locationId, itemId, stationId);
      await load();
      closeSheet();
    } catch (e) {
      alert(e.message);
    } finally {
      setSaving(false);
    }
  };

  const confirmDelete = async () => {
    if (!toDelete) return;
    try { await deleteItemRouting(toDelete.id); await load(); }
    catch (e) { alert(e.message); }
    finally { setToDelete(null); }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Item-level overrides take precedence over category routes.
        </p>
        <Button onClick={openNew} className="gap-2">
          <Plus className="h-4 w-4" />
          Add route
        </Button>
      </div>

      {error && <ErrorBanner message={error} />}
      {loading && <LoadingSkeleton />}

      {!loading && routings.length === 0 && (
        <EmptyState
          icon={Utensils}
          label="No item routes yet"
          action={
            <Button variant="outline" onClick={openNew} className="mt-3 gap-2">
              <Plus className="h-4 w-4" /> Add route
            </Button>
          }
        />
      )}

      {!loading && routings.length > 0 && (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Item</TableHead>
                <TableHead>Station</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {routings.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-medium">
                    {itemById[r.item_id]?.name ?? <span className="italic text-muted-foreground">{r.item_id?.slice(0, 8)}</span>}
                  </TableCell>
                  <TableCell>
                    {stationById[r.station_id]
                      ? <Badge variant="outline" className="border-orange-400 text-orange-700">{stationById[r.station_id].name}</Badge>
                      : <span className="italic text-muted-foreground">{r.station_id?.slice(0, 8)}</span>
                    }
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={() => openEdit(r)} title="Edit">
                        <Edit className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="sm" className="h-8 w-8 p-0 text-destructive hover:text-destructive" onClick={() => setToDelete(r)} title="Delete">
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Sheet */}
      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent side="right" className="sm:max-w-md overflow-y-auto">
          <SheetHeader className="mb-4">
            <SheetTitle>{editing ? 'Edit item route' : 'Add item route'}</SheetTitle>
            <SheetDescription>Override which station receives a specific menu item.</SheetDescription>
          </SheetHeader>
          <RoutingForm
            initial={editing
              ? { ...editing, category_id: editing.item_id } // normalise key for generic form
              : null
            }
            stations={stations}
            sourceItems={items}
            sourceLabel="Item"
            sourceKey="categoryId"
            onSubmit={handleSubmit}
            onCancel={closeSheet}
            saving={saving}
          />
        </SheetContent>
      </Sheet>

      <DeleteConfirm
        open={Boolean(toDelete)}
        onOpenChange={(v) => !v && setToDelete(null)}
        title="Remove item route?"
        description={`The override for "${itemById[toDelete?.item_id]?.name ?? toDelete?.item_id}" will be removed.`}
        onConfirm={confirmDelete}
      />
    </div>
  );
}

// ---- Generic routing form (shared by category + item tabs) ------------------

/**
 * @param {{ initial, stations, sourceItems, sourceLabel, sourceKey, onSubmit, onCancel, saving }}
 * sourceKey is the field name emitted in the onSubmit payload (always 'categoryId' for generics).
 */
function RoutingForm({ initial, stations, sourceItems, sourceLabel, sourceKey, onSubmit, onCancel, saving }) {
  const [sourceId, setSourceId] = useState(initial?.category_id ?? '');
  const [stationId, setStationId] = useState(initial?.station_id ?? '');

  const handleSubmit = (e) => {
    e.preventDefault();
    onSubmit({ [sourceKey]: sourceId, stationId });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-1.5">
        <Label>{sourceLabel}</Label>
        <Select value={sourceId} onValueChange={setSourceId} required>
          <SelectTrigger>
            <SelectValue placeholder={`Select a ${sourceLabel.toLowerCase()}…`} />
          </SelectTrigger>
          <SelectContent>
            {sourceItems.map((it) => (
              <SelectItem key={it.id} value={it.id}>{it.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1.5">
        <Label>Station</Label>
        <Select value={stationId} onValueChange={setStationId} required>
          <SelectTrigger>
            <SelectValue placeholder="Select a station…" />
          </SelectTrigger>
          <SelectContent>
            {stations.filter((s) => s.is_active !== false).map((s) => (
              <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex gap-2 pt-2">
        <Button type="submit" disabled={saving || !sourceId || !stationId} className="flex-1">
          {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          {initial ? 'Save changes' : 'Add route'}
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel}>Cancel</Button>
      </div>
    </form>
  );
}

// ============================================================
// Tab 4 — Display groups
// ============================================================

function DisplayGroupsTab({ locationId }) {
  const [stations, setStations] = useState([]);
  const [groups, setGroups] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [sheetOpen, setSheetOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [saving, setSaving] = useState(false);
  const [toDelete, setToDelete] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [s, g] = await Promise.all([
        fetchStations(locationId),
        fetchDisplayGroups(locationId),
      ]);
      setStations(s);
      setGroups(g);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [locationId]);

  useEffect(() => { load(); }, [load]);

  const stationById = useMemo(() => Object.fromEntries(stations.map((s) => [s.id, s])), [stations]);

  const openNew = () => { setEditing(null); setSheetOpen(true); };
  const openEdit = (g) => { setEditing(g); setSheetOpen(true); };
  const closeSheet = () => { setSheetOpen(false); setEditing(null); };

  const handleSubmit = async (payload) => {
    setSaving(true);
    try {
      if (editing?.id) {
        await updateDisplayGroup(editing.id, payload);
      } else {
        await createDisplayGroup({ ...payload, location_id: locationId });
      }
      await load();
      closeSheet();
    } catch (e) {
      alert(e.message);
    } finally {
      setSaving(false);
    }
  };

  const confirmDelete = async () => {
    if (!toDelete) return;
    try { await deleteDisplayGroup(toDelete.id); await load(); }
    catch (e) { alert(e.message); }
    finally { setToDelete(null); }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Group multiple stations into a single display view with optional auto-recall.
        </p>
        <Button onClick={openNew} className="gap-2">
          <Plus className="h-4 w-4" />
          New group
        </Button>
      </div>

      {error && <ErrorBanner message={error} />}
      {loading && <LoadingSkeleton />}

      {!loading && groups.length === 0 && (
        <EmptyState
          icon={Layers}
          label="No display groups yet"
          action={
            <Button variant="outline" onClick={openNew} className="mt-3 gap-2">
              <Plus className="h-4 w-4" /> New group
            </Button>
          }
        />
      )}

      {!loading && groups.length > 0 && (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Stations</TableHead>
                <TableHead>Order</TableHead>
                <TableHead>Auto-recall</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {groups.map((g) => (
                <TableRow key={g.id}>
                  <TableCell className="font-medium">{g.name}</TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {(Array.isArray(g.station_ids) ? g.station_ids : []).map((sid) => (
                        <Badge key={sid} variant="outline" className="border-orange-400 text-orange-700 text-xs">
                          {stationById[sid]?.name ?? sid.slice(0, 8)}
                        </Badge>
                      ))}
                      {(!g.station_ids || g.station_ids.length === 0) && (
                        <span className="italic text-muted-foreground text-sm">none</span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="text-muted-foreground text-sm">{g.display_order ?? '—'}</TableCell>
                  <TableCell className="text-sm">
                    {g.auto_recall_seconds
                      ? <span className="flex items-center gap-1 text-emerald-700"><RotateCcw className="h-3.5 w-3.5" />{g.auto_recall_seconds}s</span>
                      : <span className="text-muted-foreground">off</span>
                    }
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={() => openEdit(g)} title="Edit">
                        <Edit className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="sm" className="h-8 w-8 p-0 text-destructive hover:text-destructive" onClick={() => setToDelete(g)} title="Delete">
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Sheet */}
      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent side="right" className="sm:max-w-md overflow-y-auto">
          <SheetHeader className="mb-4">
            <SheetTitle>{editing ? 'Edit display group' : 'New display group'}</SheetTitle>
            <SheetDescription>
              {editing ? `Update "${editing.name}"` : 'Create a grouped KDS view spanning multiple stations.'}
            </SheetDescription>
          </SheetHeader>
          <DisplayGroupForm
            initial={editing}
            stations={stations}
            onSubmit={handleSubmit}
            onCancel={closeSheet}
            saving={saving}
          />
        </SheetContent>
      </Sheet>

      <DeleteConfirm
        open={Boolean(toDelete)}
        onOpenChange={(v) => !v && setToDelete(null)}
        title="Delete display group?"
        description={`"${toDelete?.name}" will be permanently deleted.`}
        onConfirm={confirmDelete}
      />
    </div>
  );
}

function DisplayGroupForm({ initial, stations, onSubmit, onCancel, saving }) {
  const [name, setName] = useState(initial?.name ?? '');
  const [displayOrder, setDisplayOrder] = useState(initial?.display_order ?? '');
  const [autoRecall, setAutoRecall] = useState(initial?.auto_recall_seconds ?? '');
  // station_ids is an array; use a Set for toggle UX
  const [selectedStations, setSelectedStations] = useState(
    new Set(Array.isArray(initial?.station_ids) ? initial.station_ids : [])
  );

  const toggleStation = (id) => {
    setSelectedStations((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    onSubmit({
      name: name.trim(),
      station_ids: [...selectedStations],
      display_order: displayOrder !== '' ? Number(displayOrder) : null,
      auto_recall_seconds: autoRecall !== '' ? Number(autoRecall) : null,
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="dg-name">Group name</Label>
        <Input
          id="dg-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Hot Food, Cold & Salads"
          required
        />
      </div>

      <div className="space-y-2">
        <Label>Stations in this group</Label>
        {stations.length === 0 && (
          <p className="text-sm text-muted-foreground italic">No stations configured yet.</p>
        )}
        <div className="space-y-1.5">
          {stations.map((s) => (
            <label key={s.id} className="flex cursor-pointer items-center gap-3 rounded-md border px-3 py-2 hover:bg-accent">
              <input
                type="checkbox"
                className="accent-orange-500"
                checked={selectedStations.has(s.id)}
                onChange={() => toggleStation(s.id)}
              />
              <span className="text-sm font-medium">{s.name}</span>
            </label>
          ))}
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="dg-order">Display order</Label>
        <Input
          id="dg-order"
          type="number"
          value={displayOrder}
          onChange={(e) => setDisplayOrder(e.target.value)}
          placeholder="0"
          min={0}
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="dg-recall">Auto-recall after (seconds, blank = off)</Label>
        <Input
          id="dg-recall"
          type="number"
          value={autoRecall}
          onChange={(e) => setAutoRecall(e.target.value)}
          placeholder="e.g. 300"
          min={0}
        />
        <p className="text-xs text-muted-foreground">
          Bumped tickets in this group are automatically recalled after this many seconds.
        </p>
      </div>

      <div className="flex gap-2 pt-2">
        <Button type="submit" disabled={saving || !name.trim()} className="flex-1">
          {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          {initial ? 'Save changes' : 'Create group'}
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel}>Cancel</Button>
      </div>
    </form>
  );
}

// ============================================================
// Shared DeleteConfirm dialog
// ============================================================

function DeleteConfirm({ open, onOpenChange, title, description, onConfirm }) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={onConfirm}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
