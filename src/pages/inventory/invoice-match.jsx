import { useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { FileText, AlertCircle } from 'lucide-react';
import { useAuth } from '@/context/auth-context';
import { useDateTime, useLocale } from '@/context/locale-context';
import { formatMoney } from '@/lib/currency';
import { api } from '@/lib/api-client';
import { MatchModal } from './components/match-modal';
import { PageContainer, PageHeader } from '@/components/ui/page-header';

// Badge variant per supplier-invoice status. "disputed" is the one genuinely
// blocking outcome (destructive); matched/paid are the healthy end states;
// approved is an in-flight positive step; pending/cancelled are neutral.
function invoiceStatusVariant(status) {
  switch (status) {
    case 'matched':
    case 'paid': return 'success';
    case 'disputed': return 'destructive';
    case 'approved': return 'default';
    default: return 'secondary';
  }
}

// Badge variant per 3-way match status — a variance is "needs a second
// look, not yet lost anything" (warning), matched is the success state,
// unmatched is just the neutral not-yet-attempted state.
function matchStatusVariant(status) {
  switch (status) {
    case 'matched': return 'success';
    case 'price_variance':
    case 'qty_variance': return 'warning';
    default: return 'secondary';
  }
}

export default function InvoiceMatchPage() {
  const { activeLocation } = useAuth();
  const { locale } = useLocale();
  const { formatDate } = useDateTime();
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

  // Each invoice carries its own currency: a supplier may bill in a currency
  // the store does not trade in, so the record wins over the location.
  const fmtCents = (cents, currency) =>
    formatMoney(cents ?? 0, { currency, locale });

  const fmtDate = (iso) => (iso ? formatDate(iso) : '—');

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
        <AlertCircle className="w-12 h-12 text-muted-foreground mb-4" />
        <p className="text-muted-foreground">Select a location to view supplier invoices.</p>
      </div>
    );
  }

  return (
    <PageContainer>
      <PageHeader
        icon={FileText}
        title="Invoice Match (3-Way)"
        description={activeLocation.name}
        actions={
          <Button variant="outline" onClick={fetchInvoices}>
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

      {!loading && !error && invoices.length === 0 && (
        <Card>
          <CardContent className="p-10 text-center">
            <FileText className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
            <p className="text-muted-foreground">No supplier invoices found for this location.</p>
          </CardContent>
        </Card>
      )}

      {!loading && !error && invoices.length > 0 && (
        <div className="space-y-2">
          {invoices.map((inv) => (
            <Card
              key={inv.id}
              variant="interactive"
              className="cursor-pointer"
              onClick={() => setSelectedInvoice(inv)}
            >
              <CardContent className="p-4 flex items-center gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-foreground">{inv.invoice_number}</span>
                    <Badge variant={invoiceStatusVariant(inv.status)}>
                      {inv.status}
                    </Badge>
                    <Badge variant={matchStatusVariant(inv.match_status)}>
                      {inv.match_status?.replace('_', ' ') || 'unmatched'}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Date: {fmtDate(inv.invoice_date)}
                    {inv.due_date && ` · Due: ${fmtDate(inv.due_date)}`}
                  </p>
                </div>
                <div className="text-right shrink-0">
                  <p className="font-semibold text-foreground tabular-nums">{fmtCents(inv.total_cents, inv.currency)}</p>
                  <p className="text-xs text-muted-foreground">{inv.currency}</p>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={(e) => { e.stopPropagation(); setSelectedInvoice(inv); }}
                  className="border-primary/25 text-primary hover:bg-primary/10 shrink-0"
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
    </PageContainer>
  );
}
