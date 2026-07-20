import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { ShoppingCart, Plus, AlertCircle, ChevronRight, Send } from 'lucide-react';
import { useAuth } from '@/context/auth-context';
import { useDateTime, useLocale } from '@/context/locale-context';
import { formatMoney } from '@/lib/currency';
import { usePOs } from './hooks/use-pos';
import { useSuppliers } from './hooks/use-suppliers';
import { POForm } from './components/po-form';
import { PageContainer, PageHeader } from '@/components/ui/page-header';
import { PO_STATUS_COLORS as STATUS_COLORS } from '@/lib/status-colors';

const STATUS_OPTIONS = [
  { value: 'all', label: 'All Statuses' },
  { value: 'draft', label: 'Draft' },
  { value: 'sent', label: 'Sent' },
  { value: 'partially_received', label: 'Partially Received' },
  { value: 'received', label: 'Received' },
  { value: 'cancelled', label: 'Cancelled' },
  { value: 'closed', label: 'Closed' },
];

export default function PurchaseOrdersPage() {
  const { activeLocation, activeOrganization } = useAuth();
  const { locale } = useLocale();
  const { formatDate } = useDateTime();
  const [statusFilter, setStatusFilter] = useState('all');
  const { pos, loading, error, refetch, createPO, submitPO } = usePOs(activeLocation?.id, statusFilter);
  const { suppliers } = useSuppliers(activeOrganization?.id);

  const [newPOOpen, setNewPOOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveErr, setSaveErr] = useState('');

  const [detailPO, setDetailPO] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitErr, setSubmitErr] = useState('');

  // Each PO carries its own currency: a supplier may invoice the store in a
  // currency the store does not trade in, so the record wins over the location.
  const fmtCents = (cents, currency) =>
    formatMoney(cents ?? 0, { currency, locale });

  const fmtDate = (iso) => (iso ? formatDate(iso) : '—');

  if (!activeLocation) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <AlertCircle className="w-12 h-12 text-muted-foreground mb-4" />
        <p className="text-muted-foreground">Select a location to view purchase orders.</p>
      </div>
    );
  }

  async function handleCreatePO(payload) {
    setSaving(true);
    setSaveErr('');
    try {
      const created = await createPO({ ...payload, location_id: activeLocation.id });
      setNewPOOpen(false);
      setDetailPO(created);
    } catch (e) {
      setSaveErr(e.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleSubmitPO(po) {
    setSubmitting(true);
    setSubmitErr('');
    try {
      const updated = await submitPO(po.id);
      setDetailPO(updated);
    } catch (e) {
      setSubmitErr(e.message);
    } finally {
      setSubmitting(false);
    }
  }

  const supplierMap = Object.fromEntries(suppliers.map((s) => [s.id, s.name]));

  return (
    <PageContainer>
      <PageHeader
        icon={ShoppingCart}
        title="Purchase Orders"
        description={activeLocation.name}
        actions={
          <Button onClick={() => { setSaveErr(''); setNewPOOpen(true); }}>
            <Plus className="w-4 h-4 mr-2" /> New PO
          </Button>
        }
      />

      {/* Status filter */}
      <div className="max-w-xs">
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {STATUS_OPTIONS.map((o) => (
              <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* States */}
      {loading && (
        <div className="space-y-3">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="h-16 bg-muted rounded-lg animate-pulse" />
          ))}
        </div>
      )}

      {!loading && error && (
        <div className="flex items-center gap-2 text-red-600 bg-red-50 border border-red-200 rounded p-3">
          <AlertCircle className="w-4 h-4" />
          <span>{error}</span>
        </div>
      )}

      {!loading && !error && pos.length === 0 && (
        <Card className="border-orange-100">
          <CardContent className="p-10 text-center">
            <ShoppingCart className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
            <p className="text-muted-foreground">No purchase orders found. Create the first one.</p>
          </CardContent>
        </Card>
      )}

      {!loading && !error && pos.length > 0 && (
        <div className="space-y-2">
          {pos.map((po) => (
            <Card
              key={po.id}
              className="border-orange-100 hover:border-orange-300 cursor-pointer transition-colors"
              onClick={() => { setSubmitErr(''); setDetailPO(po); }}
            >
              <CardContent className="p-4 flex items-center gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-foreground">{po.po_number}</span>
                    <Badge className={STATUS_COLORS[po.status] || 'bg-muted text-foreground'}>
                      {po.status}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {supplierMap[po.supplier_id] || 'No supplier'} &middot; {fmtDate(po.created_at)}
                    {po.expected_delivery_date && ` &middot; ETA ${fmtDate(po.expected_delivery_date)}`}
                  </p>
                </div>
                <div className="text-right shrink-0">
                  <p className="font-semibold text-foreground">{fmtCents(po.total_cents, po.currency)}</p>
                  <p className="text-xs text-muted-foreground">{po.currency}</p>
                </div>
                <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* New PO Dialog */}
      <Dialog open={newPOOpen} onOpenChange={(v) => { if (!v) setNewPOOpen(false); }}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>New Purchase Order</DialogTitle>
            <DialogDescription>Create a purchase order for {activeLocation.name}</DialogDescription>
          </DialogHeader>
          {saveErr && <p className="text-sm text-red-600">{saveErr}</p>}
          <POForm
            locationId={activeLocation.id}
            suppliers={suppliers}
            onSubmit={handleCreatePO}
            onCancel={() => setNewPOOpen(false)}
            saving={saving}
          />
        </DialogContent>
      </Dialog>

      {/* Detail Dialog */}
      <Dialog open={!!detailPO} onOpenChange={(v) => { if (!v) setDetailPO(null); }}>
        <DialogContent className="max-w-lg">
          {detailPO && (
            <>
              <DialogHeader>
                <DialogTitle>PO {detailPO.po_number}</DialogTitle>
                <DialogDescription>
                  <Badge className={STATUS_COLORS[detailPO.status] || 'bg-muted'}>{detailPO.status}</Badge>
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-2 text-sm text-foreground">
                <div className="grid grid-cols-2 gap-2">
                  <div><span className="text-muted-foreground">Supplier</span><br />{supplierMap[detailPO.supplier_id] || '—'}</div>
                  <div><span className="text-muted-foreground">Created</span><br />{fmtDate(detailPO.created_at)}</div>
                  <div><span className="text-muted-foreground">Expected delivery</span><br />{fmtDate(detailPO.expected_delivery_date)}</div>
                  <div><span className="text-muted-foreground">Currency</span><br />{detailPO.currency}</div>
                </div>
                <div className="border border-orange-100 rounded p-3 space-y-1 mt-2">
                  <div className="flex justify-between"><span>Subtotal</span><span>{fmtCents(detailPO.subtotal_cents, detailPO.currency)}</span></div>
                  <div className="flex justify-between"><span>Tax</span><span>{fmtCents(detailPO.tax_cents, detailPO.currency)}</span></div>
                  <div className="flex justify-between"><span>Shipping</span><span>{fmtCents(detailPO.shipping_cents, detailPO.currency)}</span></div>
                  <div className="flex justify-between font-semibold border-t border-orange-100 pt-1"><span>Total</span><span>{fmtCents(detailPO.total_cents, detailPO.currency)}</span></div>
                </div>
                {detailPO.notes && <p className="text-muted-foreground italic">{detailPO.notes}</p>}
              </div>

              {submitErr && <p className="text-sm text-red-600">{submitErr}</p>}

              <div className="flex gap-3 pt-2">
                <Button variant="outline" onClick={() => setDetailPO(null)} className="flex-1">Close</Button>
                {detailPO.status === 'draft' && (
                  <Button
                    onClick={() => handleSubmitPO(detailPO)}
                    disabled={submitting}
                    className="flex-1 bg-orange-500 hover:bg-orange-600 text-white"
                  >
                    <Send className="w-4 h-4 mr-2" />
                    {submitting ? 'Submitting…' : 'Submit PO'}
                  </Button>
                )}
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </PageContainer>
  );
}
