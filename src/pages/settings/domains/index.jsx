/**
 * Custom Domains settings page (Wave 23 / Now-13 + T7.6).
 *
 * Allows org members to:
 *   • Add a custom hostname to their location.
 *   • See the required TXT and CNAME DNS records.
 *   • Click "Verify" to trigger DNS verification and cert issuance.
 *   • Remove a domain.
 *
 * Route: wired externally; this file is the default export.
 * Wire example (routes.jsx):
 *   { path: 'settings/domains', element: <DomainsSettingsPage /> }
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  Globe,
  Plus,
  Trash2,
  RefreshCw,
  Copy,
  Check,
  Loader2,
  AlertTriangle,
  CheckCircle2,
  Clock,
  ShieldCheck,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
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
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';

import { useAuth } from '@/context/auth-context';
import {
  listDomains,
  addDomain,
  removeDomain,
  verifyDomain,
} from '@/services/domains';

// ---------------------------------------------------------------------------
// Status helpers
// ---------------------------------------------------------------------------

const STATUS_LABEL = {
  pending:      'Pending DNS',
  verifying:    'Verifying',
  verified:     'Verified',
  cert_issuing: 'Issuing Cert',
  live:         'Live',
  failed:       'Failed',
};

const STATUS_VARIANT = {
  pending:      'secondary',
  verifying:    'secondary',
  verified:     'default',
  cert_issuing: 'default',
  live:         'default',   // styled green via className
  failed:       'destructive',
};

function StatusBadge({ status }) {
  return (
    <Badge
      variant={STATUS_VARIANT[status] ?? 'secondary'}
      className={cn(status === 'live' && 'bg-green-600 text-white')}
    >
      {STATUS_LABEL[status] ?? status}
    </Badge>
  );
}

// ---------------------------------------------------------------------------
// Copy-to-clipboard button
// ---------------------------------------------------------------------------

function CopyButton({ value }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* silent */
    }
  }

  return (
    <button
      type="button"
      onClick={handleCopy}
      className="ml-2 inline-flex items-center text-muted-foreground hover:text-foreground transition-colors"
      title="Copy to clipboard"
    >
      {copied ? <Check className="h-3.5 w-3.5 text-green-600" /> : <Copy className="h-3.5 w-3.5" />}
    </button>
  );
}

// ---------------------------------------------------------------------------
// DNS instructions card
// ---------------------------------------------------------------------------

function DnsInstructions({ domain }) {
  const txtHost = `_beepbite-verify.${domain.hostname}`;
  const txtValue = domain.verification_token;
  const cnameTarget = 'mystore.beepbite.io';

  return (
    <div className="rounded-md border bg-muted/40 p-4 space-y-4 text-sm">
      <p className="font-medium">Add these DNS records at your domain registrar:</p>

      {/* TXT record */}
      <div className="space-y-1">
        <div className="flex items-center gap-2 font-mono text-xs text-muted-foreground uppercase tracking-wide">
          <span className="bg-secondary rounded px-1 py-0.5">TXT</span>
          <span>Ownership verification</span>
        </div>
        <div className="grid gap-1">
          <div className="flex items-center">
            <span className="w-14 shrink-0 text-muted-foreground">Host</span>
            <code className="font-mono break-all">{txtHost}</code>
            <CopyButton value={txtHost} />
          </div>
          <div className="flex items-center">
            <span className="w-14 shrink-0 text-muted-foreground">Value</span>
            <code className="font-mono break-all">{txtValue}</code>
            <CopyButton value={txtValue} />
          </div>
        </div>
      </div>

      <Separator />

      {/* CNAME record */}
      <div className="space-y-1">
        <div className="flex items-center gap-2 font-mono text-xs text-muted-foreground uppercase tracking-wide">
          <span className="bg-secondary rounded px-1 py-0.5">CNAME</span>
          <span>Traffic routing</span>
        </div>
        <div className="grid gap-1">
          <div className="flex items-center">
            <span className="w-14 shrink-0 text-muted-foreground">Host</span>
            <code className="font-mono break-all">{domain.hostname}</code>
            <CopyButton value={domain.hostname} />
          </div>
          <div className="flex items-center">
            <span className="w-14 shrink-0 text-muted-foreground">Target</span>
            <code className="font-mono break-all">{cnameTarget}</code>
            <CopyButton value={cnameTarget} />
          </div>
        </div>
      </div>

      <p className="text-xs text-muted-foreground">
        DNS changes can take up to 48 hours to propagate. Click{' '}
        <strong>Verify</strong> once both records are in place.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Domain row
// ---------------------------------------------------------------------------

function DomainRow({ domain, onVerify, onRemove, verifying }) {
  const [expanded, setExpanded] = useState(false);
  const needsDns = ['pending', 'verifying', 'failed'].includes(domain.status);

  return (
    <div className="border rounded-lg p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <Globe className="h-4 w-4 shrink-0 text-muted-foreground" />
          <span className="font-medium truncate">{domain.hostname}</span>
          <StatusBadge status={domain.status} />
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {needsDns && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => onVerify(domain.id)}
              disabled={verifying === domain.id}
            >
              {verifying === domain.id ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
              ) : (
                <ShieldCheck className="h-3.5 w-3.5 mr-1" />
              )}
              Verify
            </Button>
          )}
          {needsDns && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setExpanded((v) => !v)}
            >
              DNS instructions
            </Button>
          )}
          <Button
            size="sm"
            variant="ghost"
            className="text-destructive hover:text-destructive"
            onClick={() => onRemove(domain)}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {expanded && needsDns && <DnsInstructions domain={domain} />}

      {domain.status === 'live' && (
        <div className="flex items-center gap-1.5 text-xs text-green-700">
          <CheckCircle2 className="h-3.5 w-3.5" />
          <span>
            Active — visitors to{' '}
            <strong>{domain.hostname}</strong> are routed to this location.
          </span>
        </div>
      )}

      {domain.status === 'cert_issuing' && (
        <div className="flex items-center gap-1.5 text-xs text-amber-700">
          <Clock className="h-3.5 w-3.5" />
          <span>SSL certificate is being issued — this may take a few minutes.</span>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page component
// ---------------------------------------------------------------------------

export default function DomainsSettingsPage() {
  const { activeLocation } = useAuth();

  const [domains, setDomains] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Add dialog state
  const [addOpen, setAddOpen] = useState(false);
  const [hostname, setHostname] = useState('');
  const [addError, setAddError] = useState(null);
  const [adding, setAdding] = useState(false);

  // Verify state
  const [verifying, setVerifying] = useState(null); // domain id being verified
  const [verifyError, setVerifyError] = useState(null);

  // Remove alert state
  const [removeTarget, setRemoveTarget] = useState(null);
  const [removing, setRemoving] = useState(false);

  // ---------------------------------------------------------------------------
  // Load
  // ---------------------------------------------------------------------------

  const load = useCallback(async () => {
    if (!activeLocation?.id) return;
    setLoading(true);
    setError(null);
    const { data, error: err } = await listDomains(activeLocation.id);
    if (err) {
      setError(err.message || 'Failed to load domains');
    } else {
      setDomains(data?.data ?? data ?? []);
    }
    setLoading(false);
  }, [activeLocation?.id]);

  useEffect(() => { load(); }, [load]);

  // ---------------------------------------------------------------------------
  // Add
  // ---------------------------------------------------------------------------

  async function handleAdd() {
    if (!hostname.trim()) { setAddError('Hostname is required'); return; }
    setAdding(true);
    setAddError(null);

    const { data, error: err } = await addDomain({
      locationId: activeLocation.id,
      hostname: hostname.trim().toLowerCase(),
    });

    if (err) {
      setAddError(err.message || 'Failed to add domain');
      setAdding(false);
      return;
    }

    setDomains((prev) => [data, ...prev]);
    setHostname('');
    setAddOpen(false);
    setAdding(false);
  }

  // ---------------------------------------------------------------------------
  // Verify
  // ---------------------------------------------------------------------------

  async function handleVerify(id) {
    setVerifying(id);
    setVerifyError(null);

    const { data, error: err } = await verifyDomain(id);

    if (err) {
      setVerifyError(err.message || 'Verification failed');
    } else {
      setDomains((prev) => prev.map((d) => (d.id === id ? data : d)));
    }
    setVerifying(null);
  }

  // ---------------------------------------------------------------------------
  // Remove
  // ---------------------------------------------------------------------------

  async function handleConfirmRemove() {
    if (!removeTarget) return;
    setRemoving(true);

    const { error: err } = await removeDomain(removeTarget.id);

    if (!err) {
      setDomains((prev) => prev.filter((d) => d.id !== removeTarget.id));
    }
    setRemoving(false);
    setRemoveTarget(null);
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  if (!activeLocation) {
    return (
      <div className="flex items-center gap-2 p-6 text-muted-foreground">
        <AlertTriangle className="h-4 w-4" />
        <span>Select a location to manage custom domains.</span>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6 max-w-3xl">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Custom Domains</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Connect your own hostname (e.g.{' '}
            <code className="font-mono text-xs bg-muted px-1 rounded">
              order.mybakery.com
            </code>
            ) to <strong>{activeLocation.name}</strong>.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={load}
            disabled={loading}
          >
            <RefreshCw className={cn('h-3.5 w-3.5 mr-1', loading && 'animate-spin')} />
            Refresh
          </Button>
          <Button size="sm" onClick={() => { setAddError(null); setHostname(''); setAddOpen(true); }}>
            <Plus className="h-3.5 w-3.5 mr-1" />
            Add domain
          </Button>
        </div>
      </div>

      {/* Verify error banner */}
      {verifyError && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 flex items-start gap-2 text-sm text-destructive">
          <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <p className="font-medium">Verification failed</p>
            <p>{verifyError}</p>
          </div>
          <button
            type="button"
            className="ml-auto text-xs underline"
            onClick={() => setVerifyError(null)}
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Domain list */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Domains</CardTitle>
          <CardDescription>
            Add your custom hostname, configure DNS, then click Verify to go live.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {loading && (
            <div className="flex items-center gap-2 text-muted-foreground py-6 justify-center">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span>Loading domains…</span>
            </div>
          )}

          {!loading && error && (
            <div className="text-destructive text-sm py-4 text-center">{error}</div>
          )}

          {!loading && !error && domains.length === 0 && (
            <div className="text-muted-foreground text-sm py-8 text-center">
              No custom domains yet.{' '}
              <button
                type="button"
                className="underline"
                onClick={() => { setAddError(null); setHostname(''); setAddOpen(true); }}
              >
                Add one
              </button>
              .
            </div>
          )}

          {!loading && !error && domains.map((domain) => (
            <DomainRow
              key={domain.id}
              domain={domain}
              onVerify={handleVerify}
              onRemove={setRemoveTarget}
              verifying={verifying}
            />
          ))}
        </CardContent>
      </Card>

      {/* How it works */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">How it works</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground space-y-2">
          <ol className="list-decimal list-inside space-y-1">
            <li>Add your custom hostname above.</li>
            <li>
              Click <strong>DNS instructions</strong> to see the TXT and CNAME records
              you need to add at your domain registrar.
            </li>
            <li>
              Once the records are in place (may take up to 48 h), click{' '}
              <strong>Verify</strong>.
            </li>
            <li>
              BeepBite automatically issues an SSL certificate and routes traffic to
              this location.
            </li>
          </ol>
        </CardContent>
      </Card>

      {/* ── Add domain dialog ── */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add custom domain</DialogTitle>
            <DialogDescription>
              Enter the hostname you want to point to{' '}
              <strong>{activeLocation.name}</strong>.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 py-2">
            <div className="space-y-1">
              <Label htmlFor="hostname">Hostname</Label>
              <Input
                id="hostname"
                placeholder="order.mybakery.com"
                value={hostname}
                onChange={(e) => setHostname(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
                disabled={adding}
              />
              <p className="text-xs text-muted-foreground">
                Use a subdomain (e.g. <code>order.example.com</code>), not a bare apex
                domain, for best DNS compatibility.
              </p>
            </div>
            {addError && (
              <p className="text-sm text-destructive">{addError}</p>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)} disabled={adding}>
              Cancel
            </Button>
            <Button onClick={handleAdd} disabled={adding}>
              {adding && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}
              Add domain
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Remove confirmation dialog ── */}
      <AlertDialog open={!!removeTarget} onOpenChange={(o) => !o && setRemoveTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove domain?</AlertDialogTitle>
            <AlertDialogDescription>
              Removing <strong>{removeTarget?.hostname}</strong> will stop routing
              traffic to this location. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={removing}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmRemove}
              disabled={removing}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {removing && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
