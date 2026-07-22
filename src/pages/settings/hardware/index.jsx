// src/pages/settings/hardware/index.jsx — Hardware Settings (Wave 29 / Now-19)
//
// Printer management page: list, add, edit, delete, and test ESC/POS printers
// attached to the active location.
//
// Data flow: all reads/writes go through src/services/hardware.js which
// wraps the /hardware/* Go backend endpoints.

/* eslint-disable react/prop-types */
import { useCallback, useEffect, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Edit,
  Loader2,
  Plus,
  Printer,
  Trash2,
  Wifi,
  Usb,
  FlaskConical,
  XCircle,
} from 'lucide-react';

import { useAuth } from '@/context/auth-context';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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
  fetchPrinters,
  createPrinter,
  updatePrinter,
  deletePrinter,
  testPrinter,
} from '@/services/hardware';
import { fetchStations } from '@/services/kitchen-config';

// ============================================================
// Root page
// ============================================================

export default function HardwareSettingsPage() {
  const { activeLocation } = useAuth();

  if (!activeLocation) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <AlertCircle className="h-12 w-12 text-muted-foreground mb-4" />
        <h2 className="text-xl font-semibold mb-1">No location selected</h2>
        <p className="text-muted-foreground">
          Please select a location to manage hardware settings.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl flex items-center gap-2">
          <Printer className="h-6 w-6 text-primary" />
          Hardware
        </h1>
        <p className="text-muted-foreground text-sm mt-0.5">
          Manage ESC/POS printers for{' '}
          <strong>{activeLocation.name}</strong>.
        </p>
      </div>

      <PrintersTab locationId={activeLocation.id} />
    </div>
  );
}

// ============================================================
// PrintersTab
// ============================================================

function PrintersTab({ locationId }) {
  const [printers, setPrinters] = useState([]);
  const [stations, setStations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Sheet state
  const [sheetOpen, setSheetOpen] = useState(false);
  const [editing, setEditing] = useState(null); // null = create, Printer = edit

  // Delete dialog
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleting, setDeleting] = useState(false);

  // Test state: printerID → { loading, ok, error }
  const [testResults, setTestResults] = useState({});

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [ps, ss] = await Promise.all([
        fetchPrinters(locationId),
        fetchStations(locationId),
      ]);
      setPrinters(ps);
      setStations(ss);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [locationId]);

  useEffect(() => { load(); }, [load]);

  // ---- handlers ----

  function openCreate() {
    setEditing(null);
    setSheetOpen(true);
  }

  function openEdit(printer) {
    setEditing(printer);
    setSheetOpen(true);
  }

  async function handleSave(payload) {
    if (editing) {
      await updatePrinter(editing.id, payload);
    } else {
      await createPrinter({ ...payload, location_id: locationId });
    }
    setSheetOpen(false);
    await load();
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await deletePrinter(deleteTarget.id);
      setDeleteTarget(null);
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setDeleting(false);
    }
  }

  async function handleTest(printer) {
    setTestResults((prev) => ({ ...prev, [printer.id]: { loading: true } }));
    try {
      const res = await testPrinter(printer.id);
      setTestResults((prev) => ({
        ...prev,
        [printer.id]: { loading: false, ok: res.sent, error: res.error },
      }));
    } catch (e) {
      setTestResults((prev) => ({
        ...prev,
        [printer.id]: { loading: false, ok: false, error: e.message },
      }));
    }
  }

  // ---- render ----

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-8 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
        Loading printers…
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center gap-2 py-8 text-destructive">
        <AlertCircle className="h-5 w-5" />
        {error}
      </div>
    );
  }

  return (
    <>
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {printers.length} printer{printers.length !== 1 ? 's' : ''} configured
        </p>
        <Button size="sm" onClick={openCreate}>
          <Plus className="h-4 w-4 mr-1" />
          Add printer
        </Button>
      </div>

      {printers.length === 0 ? (
        <div className="border rounded-lg p-10 text-center text-muted-foreground">
          <Printer className="h-10 w-10 mx-auto mb-3 opacity-30" />
          <p className="font-medium">No printers configured</p>
          <p className="text-sm mt-1">
            Add a network or USB ESC/POS printer to enable receipt and kitchen printing.
          </p>
        </div>
      ) : (
        <div className="border rounded-lg overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Kind</TableHead>
                <TableHead>Connection</TableHead>
                <TableHead>Host : Port</TableHead>
                <TableHead>Station</TableHead>
                <TableHead>Active</TableHead>
                <TableHead className="w-32" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {printers.map((p) => {
                const tr = testResults[p.id];
                const stationName = p.station_id
                  ? (stations.find((s) => s.id === p.station_id)?.name ?? p.station_id.slice(0, 8))
                  : '—';

                return (
                  <TableRow key={p.id}>
                    <TableCell className="font-medium">{p.name}</TableCell>
                    <TableCell>
                      <Badge variant={p.kind === 'receipt' ? 'secondary' : 'outline'}>
                        {p.kind}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <span className="flex items-center gap-1 text-sm">
                        {p.connection === 'network' ? (
                          <Wifi className="h-3.5 w-3.5 text-muted-foreground" />
                        ) : (
                          <Usb className="h-3.5 w-3.5 text-muted-foreground" />
                        )}
                        {p.connection}
                      </span>
                    </TableCell>
                    <TableCell className="font-mono text-sm">
                      {p.host ? `${p.host}:${p.port}` : '—'}
                    </TableCell>
                    <TableCell className="text-sm">{stationName}</TableCell>
                    <TableCell>
                      <Badge variant={p.is_active ? 'default' : 'secondary'}>
                        {p.is_active ? 'active' : 'inactive'}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        {/* Test button */}
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7"
                          title="Send test ticket"
                          onClick={() => handleTest(p)}
                          disabled={tr?.loading}
                        >
                          {tr?.loading ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : tr?.ok ? (
                            <CheckCircle2 className="h-3.5 w-3.5 text-success" />
                          ) : tr?.error ? (
                            <XCircle className="h-3.5 w-3.5 text-destructive" title={tr.error} />
                          ) : (
                            <FlaskConical className="h-3.5 w-3.5" />
                          )}
                        </Button>
                        {/* Edit */}
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7"
                          onClick={() => openEdit(p)}
                        >
                          <Edit className="h-3.5 w-3.5" />
                        </Button>
                        {/* Delete */}
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7 text-destructive hover:text-destructive"
                          onClick={() => setDeleteTarget(p)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Add / Edit sheet */}
      <PrinterSheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        onSave={handleSave}
        printer={editing}
        stations={stations}
      />

      {/* Delete confirmation */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete printer?</AlertDialogTitle>
            <AlertDialogDescription>
              Remove <strong>{deleteTarget?.name}</strong>? This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={deleting}
              variant="destructive"
            >
              {deleting ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
              Delete printer
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

// ============================================================
// PrinterSheet — add / edit form
// ============================================================

const EMPTY_FORM = {
  name: '',
  kind: 'receipt',
  connection: 'network',
  host: '',
  port: '9100',
  station_id: '',
  is_active: true,
};

function PrinterSheet({ open, onClose, onSave, printer, stations }) {
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState(null);

  // Populate form when editing changes.
  useEffect(() => {
    if (printer) {
      setForm({
        name: printer.name ?? '',
        kind: printer.kind ?? 'receipt',
        connection: printer.connection ?? 'network',
        host: printer.host ?? '',
        port: String(printer.port ?? 9100),
        station_id: printer.station_id ?? '',
        is_active: printer.is_active ?? true,
      });
    } else {
      setForm(EMPTY_FORM);
    }
    setFormError(null);
  }, [printer, open]);

  function set(field, value) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setFormError(null);
    if (!form.name.trim()) {
      setFormError('Name is required.');
      return;
    }
    setSaving(true);
    try {
      const payload = {
        name: form.name.trim(),
        kind: form.kind,
        connection: form.connection,
        is_active: form.is_active,
      };
      if (form.host.trim()) payload.host = form.host.trim();
      const port = parseInt(form.port, 10);
      if (!Number.isNaN(port)) payload.port = port;
      if (form.station_id) payload.station_id = form.station_id;
      else if (printer) payload.station_id = null; // clear existing binding

      await onSave(payload);
    } catch (e) {
      setFormError(e.message);
    } finally {
      setSaving(false);
    }
  }

  const kitchenStations = stations.filter((s) => s.is_active);

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="w-full sm:max-w-md overflow-y-auto">
        <SheetHeader>
          <SheetTitle>{printer ? 'Edit printer' : 'Add printer'}</SheetTitle>
          <SheetDescription>
            Configure an ESC/POS receipt or kitchen printer.
          </SheetDescription>
        </SheetHeader>

        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          {/* Name */}
          <div className="space-y-1.5">
            <Label htmlFor="hw-name">Name</Label>
            <Input
              id="hw-name"
              value={form.name}
              onChange={(e) => set('name', e.target.value)}
              placeholder="Front counter receipt"
              required
            />
          </div>

          {/* Kind */}
          <div className="space-y-1.5">
            <Label>Kind</Label>
            <Select value={form.kind} onValueChange={(v) => set('kind', v)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="receipt">Receipt</SelectItem>
                <SelectItem value="kitchen">Kitchen</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Connection */}
          <div className="space-y-1.5">
            <Label>Connection</Label>
            <Select value={form.connection} onValueChange={(v) => set('connection', v)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="network">Network (TCP)</SelectItem>
                <SelectItem value="usb">USB</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Host / Port — only relevant for network */}
          {form.connection === 'network' && (
            <div className="grid grid-cols-3 gap-3">
              <div className="col-span-2 space-y-1.5">
                <Label htmlFor="hw-host">Host / IP</Label>
                <Input
                  id="hw-host"
                  value={form.host}
                  onChange={(e) => set('host', e.target.value)}
                  placeholder="192.168.1.100"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="hw-port">Port</Label>
                <Input
                  id="hw-port"
                  type="number"
                  min={1}
                  max={65535}
                  value={form.port}
                  onChange={(e) => set('port', e.target.value)}
                />
              </div>
            </div>
          )}

          {/* Station binding — only for kitchen printers */}
          {form.kind === 'kitchen' && (
            <div className="space-y-1.5">
              <Label>Kitchen station (optional)</Label>
              <Select
                value={form.station_id || '__none__'}
                onValueChange={(v) => set('station_id', v === '__none__' ? '' : v)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="All stations" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">All stations</SelectItem>
                  {kitchenStations.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Bind to a station to receive only tickets routed to that station.
              </p>
            </div>
          )}

          {/* Active toggle */}
          <div className="flex items-center gap-3">
            <Switch
              id="hw-active"
              checked={form.is_active}
              onCheckedChange={(v) => set('is_active', v)}
            />
            <Label htmlFor="hw-active">Active</Label>
          </div>

          {formError && (
            <p className="text-sm text-destructive flex items-center gap-1.5">
              <AlertCircle className="h-4 w-4 shrink-0" />
              {formError}
            </p>
          )}

          <div className="flex gap-2 pt-2">
            <Button type="submit" disabled={saving} className="flex-1">
              {saving ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
              {printer ? 'Save changes' : 'Add printer'}
            </Button>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
          </div>
        </form>
      </SheetContent>
    </Sheet>
  );
}
