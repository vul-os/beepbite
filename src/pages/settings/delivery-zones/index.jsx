import { useState } from 'react';
import {
  MapPin,
  Plus,
  Edit,
  Trash2,
  AlertCircle,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
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

import { useAuth } from '@/context/auth-context';
import { useMoney } from '@/context/locale-context';
import { useToast } from '@/hooks/use-toast';
import { PageHeader, PageContainer } from '@/components/ui/page-header';
import { useDeliveryZones } from './hooks/use-delivery-zones';
import ZoneForm from './components/zone-form';

// ---- page ----

export default function DeliveryZonesPage() {
  const { activeLocation, activeOrganization } = useAuth();
  const { toast } = useToast();
  const { format: fmtCents } = useMoney();

  const {
    zones,
    loading,
    error,
    createZone,
    updateZone,
    deleteZone,
    toggleActive,
  } = useDeliveryZones(activeLocation?.id);

  const [sheetOpen, setSheetOpen] = useState(false);
  const [editing, setEditing] = useState(null); // null = new, obj = edit
  const [saving, setSaving] = useState(false);
  const [toDelete, setToDelete] = useState(null);

  // ---- sheet actions ----

  const openNew = () => { setEditing(null); setSheetOpen(true); };
  const openEdit = (zone) => { setEditing(zone); setSheetOpen(true); };
  const closeSheet = () => { setSheetOpen(false); setEditing(null); };

  const handleSubmit = async (payload) => {
    setSaving(true);
    try {
      if (editing?.id) {
        await updateZone(editing.id, payload);
      } else {
        await createZone(payload);
      }
      closeSheet();
      toast({ title: editing?.id ? 'Zone updated.' : 'Zone created.' });
    } catch (err) {
      toast({ variant: 'destructive', title: 'Save failed', description: err.message });
    } finally {
      setSaving(false);
    }
  };

  // ---- delete ----

  const confirmDelete = async () => {
    if (!toDelete) return;
    try {
      await deleteZone(toDelete.id);
      toast({ title: 'Zone deactivated.' });
    } catch (err) {
      toast({ variant: 'destructive', title: 'Deactivate failed', description: err.message });
    } finally {
      setToDelete(null);
    }
  };

  // ---- no location guard ----

  if (!activeLocation) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <AlertCircle className="h-12 w-12 text-muted-foreground mb-4" />
        <h2 className="text-xl font-semibold mb-1">No location selected</h2>
        <p className="text-muted-foreground">
          Please select a location to manage delivery zones.
        </p>
      </div>
    );
  }

  return (
    <PageContainer>

      {/* Header */}
      <PageHeader
        eyebrow="Settings"
        title="Delivery zones"
        description={`Define deliverable areas with per-zone fees and ETAs for ${activeLocation.name}.`}
        icon={MapPin}
        actions={
          <Button onClick={openNew} className="gap-2">
            <Plus className="h-4 w-4" />
            New zone
          </Button>
        }
      />

      {/* Error */}
      {error && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {/* Loading skeleton */}
      {loading && (
        <div className="space-y-2">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="h-14 rounded-md bg-muted animate-pulse" />
          ))}
        </div>
      )}

      {/* Empty state */}
      {!loading && zones.length === 0 && (
        <div className="rounded-lg border border-dashed p-10 text-center">
          <MapPin className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
          <p className="font-medium">No delivery zones yet</p>
          <p className="text-sm text-muted-foreground mb-4">
            Create your first zone to define deliverable areas.
          </p>
          <Button variant="outline" onClick={openNew} className="gap-2">
            <Plus className="h-4 w-4" />
            New zone
          </Button>
        </div>
      )}

      {/* Table */}
      {!loading && zones.length > 0 && (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[200px]">Name</TableHead>
                <TableHead>Fee</TableHead>
                <TableHead>Min order</TableHead>
                <TableHead>ETA</TableHead>
                <TableHead>Priority</TableHead>
                <TableHead className="text-center">Active</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {zones.map((zone) => (
                <TableRow key={zone.id}>
                  <TableCell className="font-medium">{zone.name}</TableCell>
                  <TableCell className="text-sm">
                    {zone.delivery_fee_cents === 0
                      ? <Badge variant="outline" className="text-green-700 border-green-400">Free</Badge>
                      : fmtCents(zone.delivery_fee_cents)
                    }
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {zone.min_order_cents > 0 ? fmtCents(zone.min_order_cents) : '—'}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {zone.estimated_eta_minutes} min
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {zone.priority}
                  </TableCell>
                  <TableCell className="text-center">
                    <Switch
                      checked={zone.is_active}
                      onCheckedChange={() => toggleActive(zone)}
                      aria-label="Toggle active"
                    />
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 w-8 p-0"
                        onClick={() => openEdit(zone)}
                        title="Edit"
                      >
                        <Edit className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 w-8 p-0 text-destructive hover:text-destructive"
                        onClick={() => setToDelete(zone)}
                        title="Deactivate"
                      >
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

      {/* Create / Edit Sheet */}
      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent side="right" className="w-full sm:max-w-lg overflow-y-auto">
          <SheetHeader className="mb-4">
            <SheetTitle>
              {editing ? 'Edit delivery zone' : 'New delivery zone'}
            </SheetTitle>
            <SheetDescription>
              {editing
                ? `Update "${editing.name}"`
                : 'Define the polygon and fee for a new delivery zone.'}
            </SheetDescription>
          </SheetHeader>

          <ZoneForm
            initial={editing}
            locationId={activeLocation?.id}
            organizationId={activeOrganization?.id}
            location={activeLocation}
            onSubmit={handleSubmit}
            onCancel={closeSheet}
            saving={saving}
          />
        </SheetContent>
      </Sheet>

      {/* Delete / deactivate confirmation */}
      <AlertDialog open={Boolean(toDelete)} onOpenChange={(v) => !v && setToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Deactivate zone?</AlertDialogTitle>
            <AlertDialogDescription>
              "{toDelete?.name}" will be deactivated and hidden from delivery lookups.
              You can re-enable it later from the table.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Deactivate
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </PageContainer>
  );
}
