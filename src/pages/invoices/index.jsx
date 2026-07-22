/**
 * Invoices list page — Wave 34 / Now-26.
 *
 * Displays all invoices for the org with status badges and quick actions.
 * Clicking an invoice navigates to the detail page.
 *
 * Route: /invoices (wire externally in routes.jsx)
 */

import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { PageContainer, PageHeader } from '@/components/ui/page-header';
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
  Plus,
  FileText,
  Loader2,
  AlertCircle,
  RefreshCw,
  Trash2,
  Eye,
  Download,
  Send,
} from 'lucide-react';
import {
  listInvoices,
  deleteInvoice,
  issueInvoice,
  downloadInvoicePDF,
} from '@/services/invoicing';
import { useLocale } from '@/context/locale-context';
import { formatMoney } from '@/lib/currency';

// ── Helpers ──────────────────────────────────────────────────────────────────

function fmtDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString(undefined, {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

const STATUS_VARIANT = {
  draft:     'secondary',
  sent:      'default',
  paid:      'success',
  overdue:   'warning',
  cancelled: 'secondary',
  void:      'destructive',
};

const STATUS_LABEL = {
  draft:     'Draft',
  sent:      'Sent',
  paid:      'Paid',
  overdue:   'Overdue',
  cancelled: 'Cancelled',
  void:      'Void',
};

// ── Component ─────────────────────────────────────────────────────────────────

export default function InvoicesPage() {
  const navigate = useNavigate();
  const { currency: activeCurrency, locale } = useLocale();
  // fmtCents needs the reader's locale, which only the hook can supply, so it
  // lives inside the component rather than as a module-level helper. An
  // invoice's own currency wins; the active location is only a fallback for
  // invoices that predate the currency field.
  const fmtCents = (cents, currency) =>
    cents == null ? '—' : formatMoney(cents, { currency: currency || activeCurrency || '', locale });
  const [invoices, setInvoices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [deletingId, setDeletingId] = useState(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const [actionLoading, setActionLoading] = useState(null);

  // ── Load ─────────────────────────────────────────────────────────────────

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data, error: err } = await listInvoices();
    if (err) {
      setError(err.message || 'Failed to load invoices.');
    } else {
      setInvoices(data || []);
    }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  // ── Actions ───────────────────────────────────────────────────────────────

  async function handleDelete(id) {
    setDeletingId(id);
    const { error: err } = await deleteInvoice(id);
    if (err) {
      setError(err.message || 'Failed to delete invoice.');
    } else {
      setInvoices((prev) => prev.filter((i) => i.id !== id));
    }
    setDeletingId(null);
    setConfirmDeleteId(null);
  }

  async function handleIssue(id) {
    setActionLoading(id);
    const { data, error: err } = await issueInvoice(id);
    if (err) {
      setError(err.message || 'Failed to issue invoice.');
    } else if (data) {
      setInvoices((prev) => prev.map((i) => (i.id === id ? { ...i, ...data } : i)));
    }
    setActionLoading(null);
  }

  async function handleDownload(id) {
    setActionLoading(id);
    try {
      await downloadInvoicePDF(id);
    } catch (e) {
      setError(e.message || 'PDF download failed.');
    }
    setActionLoading(null);
  }

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <PageContainer className="max-w-5xl">
      <PageHeader
        icon={FileText}
        title="Invoices"
        description="Create and manage invoices for your B2B customers."
        actions={
          <>
            <Button variant="outline" size="icon" onClick={load} disabled={loading} title="Refresh">
              <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
              <span className="sr-only">Refresh</span>
            </Button>
            <Button onClick={() => navigate('/invoices/new')}>
              <Plus className="mr-2 h-4 w-4" />
              New invoice
            </Button>
          </>
        }
      />

      {/* Error */}
      {error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* Loading */}
      {loading && (
        <div className="flex items-center justify-center h-32">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      )}

      {/* Empty state */}
      {!loading && invoices.length === 0 && !error && (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16 gap-4">
            <FileText className="h-12 w-12 text-muted-foreground/40" />
            <div className="text-center">
              <p className="font-medium">No invoices yet</p>
              <p className="text-sm text-muted-foreground">
                Create your first invoice to get started.
              </p>
            </div>
            <Button onClick={() => navigate('/invoices/new')}>
              <Plus className="mr-2 h-4 w-4" />
              New invoice
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Invoice list */}
      {!loading && invoices.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">All invoices</CardTitle>
            <CardDescription>{invoices.length} invoice{invoices.length !== 1 ? 's' : ''}</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <div className="divide-y">
              {invoices.map((inv) => (
                <div
                  key={inv.id}
                  className="flex items-center gap-4 px-6 py-4 hover:bg-muted/30 transition-colors"
                >
                  {/* Left: recipient + date */}
                  <div
                    className="flex-1 min-w-0 cursor-pointer"
                    onClick={() => navigate(`/invoices/${inv.id}`)}
                  >
                    <p className="font-medium truncate">
                      {inv.recipient_name || 'Unnamed recipient'}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      <span className="font-mono tabular-nums">
                        {inv.invoice_number
                          ? `#${inv.invoice_number}`
                          : `#${inv.id.slice(0, 8).toUpperCase()}`}
                      </span>
                      {' · '}
                      {inv.issuer === 'platform' ? 'Platform invoice' : 'Tenant invoice'}
                      {' · '}
                      <span className="tabular-nums">{fmtDate(inv.created_at)}</span>
                    </p>
                  </div>

                  {/* Middle: amount */}
                  <div className="text-right shrink-0">
                    <p className="font-semibold tabular-nums">
                      {fmtCents(inv.total_cents, inv.currency)}
                    </p>
                    {inv.vat_cents > 0 && (
                      <p className="text-xs text-muted-foreground tabular-nums">
                        incl. VAT {fmtCents(inv.vat_cents, inv.currency)}
                      </p>
                    )}
                  </div>

                  {/* Status badge */}
                  <Badge variant={STATUS_VARIANT[inv.status] || 'secondary'}>
                    {STATUS_LABEL[inv.status] || inv.status}
                  </Badge>

                  {/* Actions */}
                  <div className="flex items-center gap-1 shrink-0">
                    {/* View */}
                    <Button
                      variant="ghost"
                      size="icon"
                      title="View"
                      onClick={() => navigate(`/invoices/${inv.id}`)}
                    >
                      <Eye className="h-4 w-4" />
                    </Button>

                    {/* Issue (draft only) */}
                    {inv.status === 'draft' && (
                      <Button
                        variant="ghost"
                        size="icon"
                        title="Issue invoice"
                        disabled={actionLoading === inv.id}
                        onClick={() => handleIssue(inv.id)}
                      >
                        {actionLoading === inv.id ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Send className="h-4 w-4" />
                        )}
                      </Button>
                    )}

                    {/* PDF */}
                    <Button
                      variant="ghost"
                      size="icon"
                      title="Download PDF"
                      disabled={actionLoading === inv.id}
                      onClick={() => handleDownload(inv.id)}
                    >
                      {actionLoading === inv.id ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Download className="h-4 w-4" />
                      )}
                    </Button>

                    {/* Delete (draft only) */}
                    {inv.status === 'draft' && (
                      <Button
                        variant="ghost"
                        size="icon"
                        title="Delete"
                        className="text-destructive hover:text-destructive"
                        disabled={deletingId === inv.id}
                        onClick={() => setConfirmDeleteId(inv.id)}
                      >
                        {deletingId === inv.id ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Trash2 className="h-4 w-4" />
                        )}
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Delete confirm dialog */}
      <AlertDialog open={!!confirmDeleteId} onOpenChange={(o) => !o && setConfirmDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete invoice?</AlertDialogTitle>
            <AlertDialogDescription>
              This action cannot be undone. The draft invoice will be permanently
              deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => handleDelete(confirmDeleteId)}
            >
              Delete invoice
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </PageContainer>
  );
}
