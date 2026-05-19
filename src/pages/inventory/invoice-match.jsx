import React, { useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { FileText, AlertCircle } from 'lucide-react';
import { useAuth } from '@/context/auth-context';
import { api } from '@/lib/api-client';
import { MatchModal } from './components/match-modal';

function fmtCents(cents) {
  return `R ${((cents ?? 0) / 100).toFixed(2)}`;
}

function fmtDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString();
}

const STATUS_COLORS = {
  pending: 'bg-gray-100 text-gray-700',
  matched: 'bg-green-100 text-green-700',
  disputed: 'bg-red-100 text-red-700',
  approved: 'bg-blue-100 text-blue-700',
  paid: 'bg-purple-100 text-purple-700',
  cancelled: 'bg-gray-200 text-gray-500',
};

const MATCH_COLORS = {
  unmatched: 'bg-gray-100 text-gray-600',
  matched: 'bg-green-100 text-green-700',
  price_variance: 'bg-yellow-100 text-yellow-800',
  qty_variance: 'bg-orange-100 text-orange-700',
};

export default function InvoiceMatchPage() {
  const { activeLocation } = useAuth();
  const [invoices, setInvoices] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [selectedInvoice, setSelectedInvoice] = useState(null);

  const fetchInvoices = useCallback(async () => {
    if (!activeLocation) return;
    setLoading(true);
    setError('');
    try {
      const { data, error: err } = await api.from('supplier_invoices')
        .select('*')
        .eq('location_id', activeLocation.id)
        .order('created_at', { ascending: false });
      if (err) throw new Error(err.message);
      setInvoices(data || []);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [activeLocation]);

  useEffect(() => { fetchInvoices(); }, [fetchInvoices]);

  function handleMatched(result) {
    // Optimistically update the invoice in the list
    setInvoices((prev) =>
      prev.map((inv) =>
        inv.id === result.invoice_id
          ? { ...inv, match_status: result.match_status }
          : inv
      )
    );
  }

  if (!activeLocation) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <AlertCircle className="w-12 h-12 text-gray-400 mb-4" />
        <p className="text-gray-600">Select a location to view supplier invoices.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <FileText className="w-6 h-6 text-orange-500" />
            Invoice Match (3-Way)
          </h1>
          <p className="text-gray-500 text-sm mt-1">{activeLocation.name}</p>
        </div>
        <Button variant="outline" onClick={fetchInvoices} className="border-orange-200 text-orange-700 hover:bg-orange-50">
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

      {!loading && !error && invoices.length === 0 && (
        <Card className="border-orange-100">
          <CardContent className="p-10 text-center">
            <FileText className="w-12 h-12 text-gray-300 mx-auto mb-3" />
            <p className="text-gray-500">No supplier invoices found for this location.</p>
          </CardContent>
        </Card>
      )}

      {!loading && !error && invoices.length > 0 && (
        <div className="space-y-2">
          {invoices.map((inv) => (
            <Card
              key={inv.id}
              className="border-orange-100 hover:border-orange-300 cursor-pointer transition-colors"
              onClick={() => setSelectedInvoice(inv)}
            >
              <CardContent className="p-4 flex items-center gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-gray-900">{inv.invoice_number}</span>
                    <Badge className={STATUS_COLORS[inv.status] || 'bg-gray-100 text-gray-700'}>
                      {inv.status}
                    </Badge>
                    <Badge className={MATCH_COLORS[inv.match_status] || 'bg-gray-100 text-gray-600'}>
                      {inv.match_status?.replace('_', ' ') || 'unmatched'}
                    </Badge>
                  </div>
                  <p className="text-xs text-gray-500 mt-0.5">
                    Date: {fmtDate(inv.invoice_date)}
                    {inv.due_date && ` · Due: ${fmtDate(inv.due_date)}`}
                  </p>
                </div>
                <div className="text-right shrink-0">
                  <p className="font-semibold text-gray-900">{fmtCents(inv.total_cents)}</p>
                  <p className="text-xs text-gray-500">{inv.currency}</p>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={(e) => { e.stopPropagation(); setSelectedInvoice(inv); }}
                  className="border-orange-200 text-orange-700 hover:bg-orange-50 shrink-0"
                >
                  Review
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <MatchModal
        invoice={selectedInvoice}
        open={!!selectedInvoice}
        onClose={() => setSelectedInvoice(null)}
        onMatched={handleMatched}
      />
    </div>
  );
}
