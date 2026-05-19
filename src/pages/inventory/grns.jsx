import React, { useState, useEffect, useCallback } from 'react';
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
        <AlertCircle className="w-12 h-12 text-gray-400 mb-4" />
        <p className="text-gray-600">Select a location to view goods receipts.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Package className="w-6 h-6 text-orange-500" />
            Goods Receipts (GRN)
          </h1>
          <p className="text-gray-500 text-sm mt-1">{activeLocation.name}</p>
        </div>
        <Button variant="outline" onClick={fetchGRNs} className="border-orange-200 text-orange-700 hover:bg-orange-50">
          Refresh
        </Button>
      </div>

      {loading && (
        <div className="space-y-3">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-16 bg-gray-100 rounded-lg animate-pulse" />
          ))}
        </div>
      )}

      {!loading && error && (
        <div className="flex items-center gap-2 text-red-600 bg-red-50 border border-red-200 rounded p-3">
          <AlertCircle className="w-4 h-4" />
          <span>{error}</span>
        </div>
      )}

      {!loading && !error && grns.length === 0 && (
        <Card className="border-orange-100">
          <CardContent className="p-10 text-center">
            <Package className="w-12 h-12 text-gray-300 mx-auto mb-3" />
            <p className="text-gray-500">No goods receipts found.</p>
          </CardContent>
        </Card>
      )}

      {!loading && !error && grns.length > 0 && (
        <div className="space-y-2">
          {grns.map((grn) => {
            const received = isReceived(grn);
            return (
              <Card key={grn.id} className="border-orange-100 hover:border-orange-200 transition-colors">
                <CardContent className="p-4 flex items-center gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-gray-900">
                        {grn.receipt_number || grn.id.slice(0, 8)}
                      </span>
                      <Badge
                        className={received
                          ? 'bg-green-100 text-green-700'
                          : 'bg-yellow-100 text-yellow-800'}
                      >
                        {received ? 'Received' : 'Pending'}
                      </Badge>
                    </div>
                    <p className="text-xs text-gray-500 mt-0.5">
                      PO: {grn.purchase_order_id?.slice(0, 8)}…
                      &middot; Created {fmtDate(grn.created_at)}
                      {received && ` · Received ${fmtDate(grn.received_at)}`}
                    </p>
                    {grn.delivery_note_number && (
                      <p className="text-xs text-gray-400">DN: {grn.delivery_note_number}</p>
                    )}
                  </div>
                  {!received && (
                    <Button
                      size="sm"
                      onClick={() => openConfirm(grn)}
                      className="bg-orange-500 hover:bg-orange-600 text-white shrink-0"
                    >
                      Receive
                    </Button>
                  )}
                  {received && (
                    <CheckCircle className="w-5 h-5 text-green-500 shrink-0" />
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Confirm receive dialog */}
      <Dialog open={!!confirmGRN} onOpenChange={(v) => { if (!v) closeConfirm(); }}>
        <DialogContent className="max-w-sm bg-white">
          <DialogHeader>
            <DialogTitle>Confirm Receive GRN</DialogTitle>
            <DialogDescription>
              This will update stock levels and record a purchase movement for each line item.
            </DialogDescription>
          </DialogHeader>

          {confirmGRN && !receiveResult && (
            <div className="text-sm text-gray-700 space-y-1">
              <p>GRN: <strong>{confirmGRN.receipt_number || confirmGRN.id.slice(0, 8)}</strong></p>
              <p>PO: {confirmGRN.purchase_order_id?.slice(0, 8)}…</p>
            </div>
          )}

          {receiveResult && (
            <div className="flex items-center gap-2 text-green-700 bg-green-50 rounded p-3 text-sm">
              <CheckCircle className="w-4 h-4" />
              <span>Received {receiveResult.lines_processed} line{receiveResult.lines_processed !== 1 ? 's' : ''}. Stock updated.</span>
            </div>
          )}

          {receiveErr && <p className="text-sm text-red-600">{receiveErr}</p>}

          <div className="flex gap-3 pt-2">
            <Button variant="outline" onClick={closeConfirm} className="flex-1">
              {receiveResult ? 'Close' : 'Cancel'}
            </Button>
            {!receiveResult && (
              <Button
                onClick={handleReceive}
                disabled={receiving}
                className="flex-1 bg-orange-500 hover:bg-orange-600 text-white"
              >
                {receiving ? 'Receiving…' : 'Confirm Receive'}
              </Button>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
