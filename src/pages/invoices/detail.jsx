/**
 * Invoice detail page — Wave 34 / Now-26.
 *
 * Displays a single invoice with its line items and provides
 * status-transition actions (issue, mark paid, void) and PDF download.
 *
 * Route: /invoices/:id (wire externally in routes.jsx)
 */

import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Alert, AlertDescription } from '@/components/ui/alert';
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
  ArrowLeft,
  Loader2,
  AlertCircle,
  Download,
  Send,
  CheckCircle,
  XCircle,
  Pencil,
} from 'lucide-react';
import {
  getInvoice,
  issueInvoice,
  markInvoicePaid,
  voidInvoice,
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

export default function InvoiceDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { currency: activeCurrency, locale } = useLocale();
  // fmtCents needs the reader's locale, which only the hook can supply, so it
  // lives inside the component rather than as a module-level helper.
  const fmtCents = (cents, currency) =>
    cents == null ? '—' : formatMoney(cents, { currency, locale });
  const [invoice, setInvoice] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [actionLoading, setActionLoading] = useState(null);
  const [confirmVoid, setConfirmVoid] = useState(false);

  // ── Load ─────────────────────────────────────────────────────────────────

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    const { data, error: err } = await getInvoice(id);
    if (err) {
      setError(err.message || 'Failed to load invoice.');
    } else {
      setInvoice(data);
    }
    setLoading(false);
  }, [id]);

  useEffect(() => { load(); }, [load]);

  // ── Actions ───────────────────────────────────────────────────────────────

  async function handleIssue() {
    setActionLoading('issue');
    const { data, error: err } = await issueInvoice(id);
    if (err) setError(err.message || 'Failed to issue invoice.');
    else if (data) setInvoice((prev) => ({ ...prev, ...data }));
    setActionLoading(null);
  }

  async function handlePay() {
    setActionLoading('pay');
    const { data, error: err } = await markInvoicePaid(id);
    if (err) setError(err.message || 'Failed to mark as paid.');
    else if (data) setInvoice((prev) => ({ ...prev, ...data }));
    setActionLoading(null);
  }

  async function handleVoid() {
    setActionLoading('void');
    setConfirmVoid(false);
    const { data, error: err } = await voidInvoice(id);
    if (err) setError(err.message || 'Failed to void invoice.');
    else if (data) setInvoice((prev) => ({ ...prev, ...data }));
    setActionLoading(null);
  }

  async function handleDownload() {
    setActionLoading('pdf');
    try {
      await downloadInvoicePDF(id);
    } catch (e) {
      setError(e.message || 'PDF download failed.');
    }
    setActionLoading(null);
  }

  // ── Render ───────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex items-center justify-center h-48">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!invoice && !loading) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-6">
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error || 'Invoice not found.'}</AlertDescription>
        </Alert>
        <Button variant="ghost" className="mt-4" onClick={() => navigate('/invoices')}>
          <ArrowLeft className="mr-2 h-4 w-4" /> Back to invoices
        </Button>
      </div>
    );
  }

  const inv = invoice;
  const currency = inv.currency || activeCurrency || '';
  const isDraft = inv.status === 'draft';
  const isIssued = inv.status === 'sent' || inv.status === 'overdue';
  const lines = inv.lines ?? [];

  return (
    <div className="max-w-3xl mx-auto px-4 py-6 space-y-6">
      {/* Back + header */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => navigate('/invoices')}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-semibold">
                Invoice {inv.invoice_number
                  ? `#${inv.invoice_number}`
                  : `#${inv.id.slice(0, 8).toUpperCase()}`}
              </h1>
              <Badge variant={STATUS_VARIANT[inv.status] || 'secondary'}>
                {STATUS_LABEL[inv.status] || inv.status}
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">
              {inv.issuer === 'platform' ? 'Platform invoice' : 'Tenant invoice'}
              {' · '}
              Created {fmtDate(inv.created_at)}
              {inv.updated_at && inv.updated_at !== inv.created_at
                ? ` · Updated ${fmtDate(inv.updated_at)}`
                : ''}
            </p>
          </div>
        </div>

        {/* Actions */}
        <div className="flex gap-2 flex-shrink-0">
          {isDraft && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => navigate(`/invoices/${id}/edit`)}
            >
              <Pencil className="mr-1 h-4 w-4" />
              Edit
            </Button>
          )}
          {isDraft && (
            <Button
              size="sm"
              disabled={!!actionLoading}
              onClick={handleIssue}
            >
              {actionLoading === 'issue' ? (
                <Loader2 className="mr-1 h-4 w-4 animate-spin" />
              ) : (
                <Send className="mr-1 h-4 w-4" />
              )}
              Issue
            </Button>
          )}
          {isIssued && (
            <Button
              size="sm"
              disabled={!!actionLoading}
              onClick={handlePay}
            >
              {actionLoading === 'pay' ? (
                <Loader2 className="mr-1 h-4 w-4 animate-spin" />
              ) : (
                <CheckCircle className="mr-1 h-4 w-4" />
              )}
              Mark paid
            </Button>
          )}
          {(isDraft || isIssued) && (
            <Button
              variant="destructive"
              size="sm"
              disabled={!!actionLoading}
              onClick={() => setConfirmVoid(true)}
            >
              {actionLoading === 'void' ? (
                <Loader2 className="mr-1 h-4 w-4 animate-spin" />
              ) : (
                <XCircle className="mr-1 h-4 w-4" />
              )}
              Void
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            disabled={!!actionLoading}
            onClick={handleDownload}
          >
            {actionLoading === 'pdf' ? (
              <Loader2 className="mr-1 h-4 w-4 animate-spin" />
            ) : (
              <Download className="mr-1 h-4 w-4" />
            )}
            PDF
          </Button>
        </div>
      </div>

      {/* Error */}
      {error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* Recipient */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium text-muted-foreground">
            Bill To
          </CardTitle>
        </CardHeader>
        <CardContent className="-mt-2">
          <p className="font-semibold">{inv.recipient_name || '—'}</p>
          {inv.recipient_address && (
            <p className="text-sm text-muted-foreground whitespace-pre-line">
              {inv.recipient_address}
            </p>
          )}
        </CardContent>
      </Card>

      {/* Line items */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium text-muted-foreground">
            Line Items
          </CardTitle>
        </CardHeader>
        <CardContent className="-mt-2">
          {lines.length === 0 ? (
            <p className="text-sm text-muted-foreground">No line items.</p>
          ) : (
            <div className="space-y-0">
              {/* Table header */}
              <div className="grid grid-cols-[1fr_auto_auto_auto] gap-4 text-xs text-muted-foreground pb-1 border-b">
                <span>Description</span>
                <span className="text-center">Qty</span>
                <span className="text-right">Unit price</span>
                <span className="text-right">Total</span>
              </div>
              {lines.map((line, idx) => (
                <div
                  key={idx}
                  className="grid grid-cols-[1fr_auto_auto_auto] gap-4 text-sm py-2 border-b last:border-0"
                >
                  <span>{line.description}</span>
                  <span className="text-center tabular-nums">{line.qty}</span>
                  <span className="text-right tabular-nums">
                    {fmtCents(line.unit_cents, currency)}
                  </span>
                  <span className="text-right tabular-nums font-medium">
                    {fmtCents(line.line_total_cents ?? line.qty * line.unit_cents, currency)}
                  </span>
                </div>
              ))}
            </div>
          )}

          {/* Totals */}
          <div className="mt-4 space-y-1">
            <Separator />
            <div className="flex justify-between text-sm pt-1">
              <span className="text-muted-foreground">Subtotal</span>
              <span className="tabular-nums">{fmtCents(inv.subtotal_cents, currency)}</span>
            </div>
            {inv.vat_applied && inv.vat_cents > 0 && (
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">
                  VAT{inv.vat_rate_percent ? ` (${inv.vat_rate_percent}%)` : ''}
                </span>
                <span className="tabular-nums">{fmtCents(inv.vat_cents, currency)}</span>
              </div>
            )}
            <Separator />
            <div className="flex justify-between font-semibold pt-1">
              <span>Total</span>
              <span className="tabular-nums">
                {fmtCents(inv.total_cents, currency)} {currency}
              </span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Issued at */}
      {inv.issued_at && (
        <p className="text-xs text-muted-foreground text-right">
          Issued on {fmtDate(inv.issued_at)}
        </p>
      )}

      {/* Void confirm */}
      <AlertDialog open={confirmVoid} onOpenChange={setConfirmVoid}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Void this invoice?</AlertDialogTitle>
            <AlertDialogDescription>
              Voiding an invoice cannot be undone. The invoice will be marked
              as void and can no longer be issued or paid.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={handleVoid}
            >
              Void invoice
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
