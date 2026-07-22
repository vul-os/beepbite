import { useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Package, AlertCircle, CheckCircle } from 'lucide-react';
import { useAuth } from '@/context/auth-context';
import { api } from '@/lib/api-client';
import { PageContainer, PageHeader } from '@/components/ui/page-header';

function fmtDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString();
}

export default function GRNsPage() {
  const { activeLocation } = useAuth();
  const [grns, setGRNs] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const [confirmGRN, setConfirmGRN] = useState(null);
  const [receiving, setReceiving] = useState(false);
  const [receiveResult, setReceiveResult] = useState(null);
  const [receiveErr, setReceiveErr] = useState('');

  const fetchGRNs = useCallback(async () => {
    if (!activeLocation) return;
    setLoading(true);
    setError('');
    try {
      // The data layer supports filtering via eq
      const { data, error: err } = await api.from('goods_receipts')
        .select('*')
        .order('created_at', { ascending: false });
      if (err) throw new Error(err.message);
      // Client-side filter by location via join on purchase_orders is not
      // easily done through the generic layer; we list all and filter by
      // purchase_order_id being from this location — but we don't have that
      // without a join. Return everything for now; the BE can add a location
      // filter via a view if needed.
      setGRNs(data || []);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [activeLocation]);

  useEffect(() => { fetchGRNs(); }, [fetchGRNs]);

  async function handleReceive() {
    if (!confirmGRN) return;
    setReceiving(true);
    setReceiveErr('');
    setReceiveResult(null);
    try {
      const { data, error: err } = await api.request(
        'POST',
        `/inventory/goods-receipts/${confirmGRN.id}/receive`,
        { body: {} }
      );
      if (err) throw new Error(err.message);
      setReceiveResult(data);
      await fetchGRNs();
    } catch (e) {
      setReceiveErr(e.message);
    } finally {
      setReceiving(false);
    }
  }

  function openConfirm(grn) {
    setConfirmGRN(grn);
    setReceiveResult(null);
    setReceiveErr('');
  }

  function closeConfirm() {
    setConfirmGRN(null);
    setReceiveResult(null);
    setReceiveErr('');
  }

  const isReceived = (grn) => !!grn.received_at;

  if (!activeLocation) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <AlertCircle className="w-12 h-12 text-muted-foreground mb-4" />
        <p className="text-muted-foreground">Select a location to view goods receipts.</p>
      </div>
    );
  }

  return (
    <PageContainer>
      <PageHeader
        icon={Package}
        title="Goods Receipts (GRN)"
        description={activeLocation.name}
        actions={
          <Button variant="outline" onClick={fetchGRNs}>
            Refresh
          </Button>
        }
      />

      {loading && (
        <div className="space-y-3">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-16 bg-muted rounded-lg animate-pulse" />
          ))}
        </div>
      )}

      {!loading && error && (
        <div className="flex items-center gap-2 text-destructive bg-destructive/10 border border-destructive/20 rounded p-3">
          <AlertCircle className="w-4 h-4" />
          <span>{error}</span>
        </div>
      )}

      {!loading && !error && grns.length === 0 && (
        <Card>
          <CardContent className="p-10 text-center">
            <Package className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
            <p className="text-muted-foreground">No goods receipts found.</p>
          </CardContent>
        </Card>
      )}

      {!loading && !error && grns.length > 0 && (
        <div className="space-y-2">
          {grns.map((grn) => {
            const received = isReceived(grn);
            return (
              <Card key={grn.id} variant="interactive">
                <CardContent className="p-4 flex items-center gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-foreground">
                        {grn.receipt_number || grn.id.slice(0, 8)}
                      </span>
                      {/* Pending is reversible/awaiting action (warning);
                          Received is the confirmed, healthy end state. */}
                      <Badge variant={received ? 'success' : 'warning'}>
                        {received ? 'Received' : 'Pending'}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      PO: {grn.purchase_order_id?.slice(0, 8)}…
                      &middot; Created {fmtDate(grn.created_at)}
                      {received && ` · Received ${fmtDate(grn.received_at)}`}
                    </p>
                    {grn.delivery_note_number && (
                      <p className="text-xs text-muted-foreground">DN: {grn.delivery_note_number}</p>
                    )}
                  </div>
                  {!received && (
                    <Button
                      size="sm"
                      onClick={() => openConfirm(grn)}
                      className="shrink-0"
                    >
                      Receive
                    </Button>
                  )}
                  {received && (
                    <CheckCircle className="w-5 h-5 text-success shrink-0" />
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Confirm receive dialog */}
      <Dialog open={!!confirmGRN} onOpenChange={(v) => { if (!v) closeConfirm(); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Confirm Receive GRN</DialogTitle>
            <DialogDescription>
              This will update stock levels and record a purchase movement for each line item.
            </DialogDescription>
          </DialogHeader>

          {confirmGRN && !receiveResult && (
            <div className="text-sm text-foreground space-y-1">
              <p>GRN: <strong>{confirmGRN.receipt_number || confirmGRN.id.slice(0, 8)}</strong></p>
              <p>PO: {confirmGRN.purchase_order_id?.slice(0, 8)}…</p>
            </div>
          )}

          {receiveResult && (
            <div className="flex items-center gap-2 text-success bg-success/10 rounded p-3 text-sm">
              <CheckCircle className="w-4 h-4" />
              <span>Received {receiveResult.lines_processed} line{receiveResult.lines_processed !== 1 ? 's' : ''}. Stock updated.</span>
            </div>
          )}

          {receiveErr && <p className="text-sm text-destructive">{receiveErr}</p>}

          <div className="flex gap-3 pt-2">
            <Button variant="outline" onClick={closeConfirm} className="flex-1">
              {receiveResult ? 'Close' : 'Cancel'}
            </Button>
            {!receiveResult && (
              <Button
                onClick={handleReceive}
                disabled={receiving}
                className="flex-1"
              >
                {receiving ? 'Receiving…' : 'Confirm Receive'}
              </Button>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </PageContainer>
  );
}
