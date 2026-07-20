/**
 * API Keys & Webhooks settings page (Wave 22).
 *
 * Two stacked sections:
 *   1. API Keys — list, create (full key shown once), revoke.
 *   2. Webhooks — list, create (signing_secret shown once), edit, delete,
 *      expandable recent-deliveries per endpoint.
 *
 * Route: wired externally; this file is the default export.
 */

import React, { useState, useEffect, useCallback } from 'react';
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
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { PageHeader, PageContainer } from '@/components/ui/page-header';
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
  Key,
  Webhook,
  Plus,
  Copy,
  Check,
  Trash2,
  ChevronDown,
  ChevronRight,
  AlertTriangle,
  Loader2,
  ShieldOff,
  Globe,
  Clock,
  Activity,
  Pencil,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { listKeys, createKey, revokeKey } from '@/services/api-keys';
import {
  listEndpoints,
  createEndpoint,
  updateEndpoint,
  deleteEndpoint,
  listDeliveries,
} from '@/services/webhooks';

// ── Constants ─────────────────────────────────────────────────────────────────

const ALL_SCOPES = [
  'read:menu',
  'write:menu',
  'read:orders',
  'write:orders',
  'read:reports',
  'read:customers',
  'write:webhooks',
  'write:items',
  'read:staff',
  'write:staff',
  'read:inventory',
  'write:inventory',
];

const ALL_EVENTS = [
  'order.created',
  'order.paid',
  'order.refunded',
  'item.created',
  'item.updated',
  'staff.invited',
];

// ── Tiny helpers ──────────────────────────────────────────────────────────────

function fmtDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function fmtDateTime(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function scopeColor(scope) {
  if (scope.startsWith('write:')) return 'bg-primary/10 text-primary border-primary/20';
  return 'bg-muted text-muted-foreground border-border';
}

function eventColor() {
  return 'bg-blue-50 text-blue-700 border-blue-200';
}

function statusColor(status) {
  if (status === 'success') return 'bg-green-50 text-green-700 border-green-200';
  if (status === 'failed') return 'bg-red-50 text-red-700 border-red-200';
  return 'bg-yellow-50 text-yellow-700 border-yellow-200';
}

// ── Copy-to-clipboard button ──────────────────────────────────────────────────

function CopyButton({ text, className }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // fallback
      const el = document.createElement('textarea');
      el.value = text;
      document.body.appendChild(el);
      el.select();
      document.execCommand('copy');
      document.body.removeChild(el);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }

  return (
    <button
      type="button"
      onClick={handleCopy}
      className={cn(
        'inline-flex items-center gap-1 rounded px-2 py-1 text-xs font-medium transition-colors',
        copied
          ? 'bg-green-100 text-green-700'
          : 'bg-muted text-muted-foreground hover:bg-muted',
        className,
      )}
      title="Copy to clipboard"
    >
      {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
      {copied ? 'Copied' : 'Copy'}
    </button>
  );
}

// ── "Shown once" secret box ───────────────────────────────────────────────────

function SecretRevealBox({ label, value }) {
  return (
    <div className="rounded-lg border border-primary/20 bg-primary/5 p-4 space-y-2">
      <div className="flex items-start gap-2">
        <AlertTriangle className="h-4 w-4 text-primary mt-0.5 flex-shrink-0" />
        <p className="text-sm font-medium text-primary">
          Save this {label} — you won&apos;t see it again
        </p>
      </div>
      <div className="flex items-center gap-2 rounded-md bg-card border border-primary/20 px-3 py-2">
        <code className="flex-1 text-sm font-mono text-foreground break-all select-all">
          {value}
        </code>
        <CopyButton text={value} />
      </div>
      <p className="text-xs text-primary">
        Copy it now and store it securely. It cannot be retrieved after you close this dialog.
      </p>
    </div>
  );
}

// ── Scope / event checkbox grid ───────────────────────────────────────────────

function CheckboxGrid({ items, selected, onChange, colorFn }) {
  function toggle(item) {
    const next = selected.includes(item)
      ? selected.filter((s) => s !== item)
      : [...selected, item];
    onChange(next);
  }

  return (
    <div className="grid grid-cols-2 gap-2">
      {items.map((item) => (
        <label
          key={item}
          className="flex items-center gap-2 cursor-pointer rounded-md border border-transparent px-2 py-1.5 hover:bg-muted/50 transition-colors"
        >
          <Checkbox
            checked={selected.includes(item)}
            onCheckedChange={() => toggle(item)}
            className="data-[state=checked]:bg-primary data-[state=checked]:border-primary"
          />
          <span
            className={cn(
              'text-xs font-medium px-1.5 py-0.5 rounded border',
              colorFn(item),
            )}
          >
            {item}
          </span>
        </label>
      ))}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// API KEYS SECTION
// ═══════════════════════════════════════════════════════════════════════════════

function CreateKeyDialog({ open, onClose, onCreated }) {
  const [name, setName] = useState('');
  const [scopes, setScopes] = useState([]);
  const [environment, setEnvironment] = useState('live');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [createdKey, setCreatedKey] = useState(null);

  function reset() {
    setName('');
    setScopes([]);
    setEnvironment('live');
    setLoading(false);
    setError('');
    setCreatedKey(null);
  }

  function handleClose() {
    if (createdKey) onCreated(createdKey);
    reset();
    onClose();
  }

  async function handleCreate() {
    if (!name.trim()) {
      setError('Key name is required.');
      return;
    }
    if (scopes.length === 0) {
      setError('Select at least one scope.');
      return;
    }
    setError('');
    setLoading(true);
    const { data, error: apiErr } = await createKey({
      name: name.trim(),
      scopes,
      environment,
    });
    setLoading(false);
    if (apiErr) {
      setError(apiErr.message || 'Failed to create key.');
      return;
    }
    setCreatedKey(data);
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) handleClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Key className="h-5 w-5 text-primary" />
            {createdKey ? 'API Key Created' : 'Create API Key'}
          </DialogTitle>
          <DialogDescription>
            {createdKey
              ? 'Your new API key has been created. Copy it now — it will not be shown again.'
              : 'Give the key a name, choose its scopes, and select the environment.'}
          </DialogDescription>
        </DialogHeader>

        {createdKey ? (
          <div className="space-y-4">
            <SecretRevealBox label="API key" value={createdKey.key} />
            <div className="text-sm text-muted-foreground space-y-1">
              <p>
                <span className="font-medium">Name:</span> {createdKey.name}
              </p>
              <p>
                <span className="font-medium">Environment:</span>{' '}
                <Badge
                  className={cn(
                    'text-xs',
                    createdKey.environment === 'live'
                      ? 'bg-green-100 text-green-700 border-green-200'
                      : 'bg-muted text-muted-foreground',
                  )}
                  variant="outline"
                >
                  {createdKey.environment}
                </Badge>
              </p>
              <p>
                <span className="font-medium">Scopes:</span>{' '}
                {(createdKey.scopes || []).join(', ')}
              </p>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="key-name">Key name</Label>
              <Input
                id="key-name"
                placeholder="e.g. Production integration"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label>Environment</Label>
              <div className="flex items-center gap-3">
                <Switch
                  checked={environment === 'live'}
                  onCheckedChange={(v) => setEnvironment(v ? 'live' : 'test')}
                  className="data-[state=checked]:bg-primary"
                />
                <span className="text-sm">
                  {environment === 'live' ? (
                    <span className="font-medium text-beepbite-success">Live</span>
                  ) : (
                    <span className="font-medium text-muted-foreground">Test</span>
                  )}
                </span>
              </div>
            </div>

            <div className="space-y-2">
              <Label>Scopes</Label>
              <CheckboxGrid
                items={ALL_SCOPES}
                selected={scopes}
                onChange={setScopes}
                colorFn={scopeColor}
              />
            </div>

            {error && (
              <p className="text-sm text-destructive flex items-center gap-1">
                <AlertTriangle className="h-3.5 w-3.5" /> {error}
              </p>
            )}
          </div>
        )}

        <DialogFooter>
          {createdKey ? (
            <Button onClick={handleClose}>
              Done
            </Button>
          ) : (
            <>
              <Button variant="outline" onClick={handleClose} disabled={loading}>
                Cancel
              </Button>
              <Button
                onClick={handleCreate}
                disabled={loading}
              >
                {loading && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                Create key
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RevokeKeyDialog({ apiKey, open, onClose, onRevoked }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleRevoke() {
    setLoading(true);
    setError('');
    const { error: apiErr } = await revokeKey(apiKey.id);
    setLoading(false);
    if (apiErr) {
      setError(apiErr.message || 'Failed to revoke key.');
      return;
    }
    onRevoked(apiKey.id);
    onClose();
  }

  return (
    <AlertDialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2 text-destructive">
            <ShieldOff className="h-5 w-5" /> Revoke API key?
          </AlertDialogTitle>
          <AlertDialogDescription>
            <span className="font-mono font-medium">{apiKey?.prefix_visible}</span>
            {apiKey?.name && ` (${apiKey.name})`} will be immediately disabled. Any
            integrations using this key will stop working. This action cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        {error && (
          <p className="text-sm text-destructive px-1">{error}</p>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={loading}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={handleRevoke}
            disabled={loading}
            className="bg-destructive hover:bg-destructive/90 text-destructive-foreground"
          >
            {loading && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
            Revoke key
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function ApiKeyRow({ apiKey, onRevoked }) {
  const [revokeOpen, setRevokeOpen] = useState(false);
  const isRevoked = !!apiKey.revoked_at;

  return (
    <div
      className={cn(
        'flex flex-col sm:flex-row sm:items-center gap-3 px-4 py-3 rounded-lg border transition-colors',
        isRevoked
          ? 'bg-muted/50 border-border opacity-60'
          : 'bg-card border-border hover:border-primary/20',
      )}
    >
      <div className="flex-1 min-w-0 space-y-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-medium text-sm text-foreground">{apiKey.name}</span>
          {apiKey.environment && (
            <Badge
              variant="outline"
              className={cn(
                'text-xs',
                apiKey.environment === 'live'
                  ? 'bg-green-50 text-green-700 border-green-200'
                  : 'bg-muted text-muted-foreground border-border',
              )}
            >
              {apiKey.environment}
            </Badge>
          )}
          {isRevoked && (
            <Badge variant="outline" className="text-xs bg-destructive/10 text-destructive border-destructive/20">
              Revoked
            </Badge>
          )}
        </div>
        <p className="font-mono text-xs text-muted-foreground">{apiKey.prefix_visible}••••••••</p>
        <div className="flex flex-wrap gap-1">
          {(apiKey.scopes || []).map((s) => (
            <span
              key={s}
              className={cn('inline-block text-xs px-1.5 py-0.5 rounded border', scopeColor(s))}
            >
              {s}
            </span>
          ))}
        </div>
      </div>

      <div className="flex items-center gap-4 text-xs text-muted-foreground shrink-0">
        <span className="flex items-center gap-1">
          <Clock className="h-3 w-3" />
          {apiKey.last_used_at ? `Used ${fmtDate(apiKey.last_used_at)}` : 'Never used'}
        </span>
        {!isRevoked && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setRevokeOpen(true)}
            className="text-destructive hover:text-destructive hover:bg-destructive/10 h-7 px-2"
          >
            <ShieldOff className="h-3.5 w-3.5 mr-1" />
            Revoke
          </Button>
        )}
      </div>

      {!isRevoked && (
        <RevokeKeyDialog
          apiKey={apiKey}
          open={revokeOpen}
          onClose={() => setRevokeOpen(false)}
          onRevoked={onRevoked}
        />
      )}
    </div>
  );
}

function ApiKeysSection() {
  const [keys, setKeys] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [createOpen, setCreateOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    const { data, error: apiErr } = await listKeys();
    setLoading(false);
    if (apiErr) {
      setError(apiErr.message || 'Failed to load API keys.');
      return;
    }
    setKeys(Array.isArray(data) ? data : []);
  }, []);

  useEffect(() => { load(); }, [load]);

  function handleRevoked(id) {
    setKeys((prev) =>
      prev.map((k) =>
        k.id === id ? { ...k, revoked_at: new Date().toISOString() } : k,
      ),
    );
  }

  function handleCreated(newKey) {
    // Merge new key (without the plaintext) into list
    setKeys((prev) => [
      {
        id: newKey.id,
        name: newKey.name,
        prefix_visible: newKey.prefix_visible,
        scopes: newKey.scopes,
        environment: newKey.environment,
        last_used_at: null,
        revoked_at: null,
        created_at: newKey.created_at,
      },
      ...prev,
    ]);
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div>
          <CardTitle className="flex items-center gap-2 text-base">
            <Key className="h-5 w-5 text-primary" />
            API Keys
          </CardTitle>
          <CardDescription className="mt-1">
            Programmatic access to your organisation&apos;s data. The full key is shown only once at
            creation.
          </CardDescription>
        </div>
        <Button
          size="sm"
          onClick={() => setCreateOpen(true)}
          className="shrink-0"
        >
          <Plus className="h-4 w-4 mr-1" />
          Create key
        </Button>
      </CardHeader>

      <CardContent>
        {loading ? (
          <div className="flex items-center justify-center py-10 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin mr-2" />
            Loading keys…
          </div>
        ) : error ? (
          <div className="flex items-center gap-2 py-6 text-destructive text-sm">
            <AlertTriangle className="h-4 w-4" /> {error}
            <Button variant="ghost" size="sm" onClick={load} className="ml-auto">
              Retry
            </Button>
          </div>
        ) : keys.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-10 text-muted-foreground text-sm gap-2">
            <Key className="h-8 w-8 opacity-30" />
            <p>No API keys yet.</p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setCreateOpen(true)}
              className="mt-1"
            >
              <Plus className="h-4 w-4 mr-1" /> Create your first key
            </Button>
          </div>
        ) : (
          <div className="space-y-2">
            {keys.map((k) => (
              <ApiKeyRow key={k.id} apiKey={k} onRevoked={handleRevoked} />
            ))}
          </div>
        )}
      </CardContent>

      <CreateKeyDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={handleCreated}
      />
    </Card>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// WEBHOOKS SECTION
// ═══════════════════════════════════════════════════════════════════════════════

function AddEndpointDialog({ open, onClose, onCreated, editEndpoint }) {
  const isEdit = !!editEndpoint;
  const [url, setUrl] = useState('');
  const [events, setEvents] = useState([]);
  const [description, setDescription] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [createdSecret, setCreatedSecret] = useState(null);

  // Pre-fill when editing
  useEffect(() => {
    if (editEndpoint) {
      setUrl(editEndpoint.url || '');
      setEvents(editEndpoint.events || []);
      setDescription(editEndpoint.description || '');
    } else {
      setUrl('');
      setEvents([]);
      setDescription('');
    }
    setError('');
    setCreatedSecret(null);
  }, [editEndpoint, open]);

  function reset() {
    setUrl('');
    setEvents([]);
    setDescription('');
    setLoading(false);
    setError('');
    setCreatedSecret(null);
  }

  function handleClose() {
    if (createdSecret) onCreated(createdSecret.endpoint);
    reset();
    onClose();
  }

  function validateUrl(v) {
    try {
      const u = new URL(v);
      return u.protocol === 'https:';
    } catch {
      return false;
    }
  }

  async function handleSave() {
    if (!validateUrl(url)) {
      setError('URL must be a valid https:// address.');
      return;
    }
    if (events.length === 0) {
      setError('Select at least one event.');
      return;
    }
    setError('');
    setLoading(true);

    if (isEdit) {
      const { data, error: apiErr } = await updateEndpoint(editEndpoint.id, {
        url,
        events,
        description,
      });
      setLoading(false);
      if (apiErr) { setError(apiErr.message || 'Update failed.'); return; }
      onCreated(data);
      reset();
      onClose();
    } else {
      const { data, error: apiErr } = await createEndpoint({ url, events, description });
      setLoading(false);
      if (apiErr) { setError(apiErr.message || 'Failed to create endpoint.'); return; }
      setCreatedSecret({ endpoint: data, secret: data.signing_secret });
    }
  }

  const title = isEdit ? 'Edit webhook endpoint' : 'Add webhook endpoint';

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) handleClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Webhook className="h-5 w-5 text-primary" />
            {createdSecret ? 'Webhook endpoint created' : title}
          </DialogTitle>
          <DialogDescription>
            {createdSecret
              ? 'Save the signing secret below — it will not be shown again.'
              : isEdit
              ? 'Update the endpoint URL, subscribed events, or description.'
              : 'We will POST a signed JSON payload to your HTTPS endpoint when events occur.'}
          </DialogDescription>
        </DialogHeader>

        {createdSecret ? (
          <div className="space-y-4">
            <SecretRevealBox label="signing secret" value={createdSecret.secret} />
            <p className="text-sm text-muted-foreground">
              Verify incoming payloads by computing{' '}
              <code className="text-xs bg-muted px-1 py-0.5 rounded">
                HMAC-SHA256(raw_body, secret)
              </code>{' '}
              and comparing it to the{' '}
              <code className="text-xs bg-muted px-1 py-0.5 rounded">X-Beepbite-Signature</code>{' '}
              header.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="webhook-url">Endpoint URL</Label>
              <Input
                id="webhook-url"
                type="url"
                placeholder="https://example.com/webhooks/beepbite"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">Must use HTTPS.</p>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="webhook-desc">Description (optional)</Label>
              <Input
                id="webhook-desc"
                placeholder="e.g. Sync orders to ERP"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label>Events to subscribe</Label>
              <CheckboxGrid
                items={ALL_EVENTS}
                selected={events}
                onChange={setEvents}
                colorFn={eventColor}
              />
            </div>

            {error && (
              <p className="text-sm text-destructive flex items-center gap-1">
                <AlertTriangle className="h-3.5 w-3.5" /> {error}
              </p>
            )}
          </div>
        )}

        <DialogFooter>
          {createdSecret ? (
            <Button onClick={handleClose}>
              Done
            </Button>
          ) : (
            <>
              <Button variant="outline" onClick={handleClose} disabled={loading}>
                Cancel
              </Button>
              <Button
                onClick={handleSave}
                disabled={loading}
              >
                {loading && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                {isEdit ? 'Save changes' : 'Add endpoint'}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DeliveriesPanel({ endpointId }) {
  const [deliveries, setDeliveries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    listDeliveries(endpointId).then(({ data, error: apiErr }) => {
      if (cancelled) return;
      setLoading(false);
      if (apiErr) { setError(apiErr.message || 'Failed to load deliveries.'); return; }
      setDeliveries(Array.isArray(data) ? data : []);
    });
    return () => { cancelled = true; };
  }, [endpointId]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-4 pl-4 text-muted-foreground text-sm">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading deliveries…
      </div>
    );
  }
  if (error) {
    return (
      <p className="pl-4 py-3 text-sm text-destructive flex items-center gap-1">
        <AlertTriangle className="h-3.5 w-3.5" /> {error}
      </p>
    );
  }
  if (deliveries.length === 0) {
    return (
      <p className="pl-4 py-3 text-sm text-muted-foreground">No deliveries recorded yet.</p>
    );
  }

  return (
    <div className="divide-y divide-border">
      {deliveries.map((d) => (
        <div
          key={d.id}
          className="flex flex-wrap items-center gap-2 px-4 py-2.5 text-xs"
        >
          <span
            className={cn(
              'inline-block px-1.5 py-0.5 rounded border font-mono',
              eventColor(),
            )}
          >
            {d.event}
          </span>
          <span
            className={cn(
              'inline-block px-1.5 py-0.5 rounded border',
              statusColor(d.status),
            )}
          >
            {d.status}
          </span>
          {d.response_code && (
            <span className="text-muted-foreground">HTTP {d.response_code}</span>
          )}
          {d.duration_ms != null && (
            <span className="text-muted-foreground">{d.duration_ms}ms</span>
          )}
          <span className="ml-auto text-muted-foreground">{fmtDateTime(d.delivered_at)}</span>
        </div>
      ))}
    </div>
  );
}

function WebhookEndpointRow({ endpoint, onUpdated, onDeleted }) {
  const [deliveriesOpen, setDeliveriesOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [activeToggling, setActiveToggling] = useState(false);

  async function handleToggleActive(checked) {
    setActiveToggling(true);
    const { data } = await updateEndpoint(endpoint.id, { is_active: checked });
    setActiveToggling(false);
    if (data) onUpdated(data);
  }

  async function handleDelete() {
    await deleteEndpoint(endpoint.id);
    onDeleted(endpoint.id);
  }

  return (
    <div className="rounded-lg border border-border bg-card overflow-hidden">
      <div className="flex flex-col sm:flex-row sm:items-center gap-3 px-4 py-3">
        {/* URL + meta */}
        <div className="flex-1 min-w-0 space-y-1">
          <div className="flex items-center gap-2 flex-wrap">
            <Globe className="h-4 w-4 text-muted-foreground shrink-0" />
            <span className="font-mono text-sm text-foreground break-all">{endpoint.url}</span>
          </div>
          {endpoint.description && (
            <p className="text-xs text-muted-foreground pl-6">{endpoint.description}</p>
          )}
          <div className="flex flex-wrap gap-1 pl-6">
            {(endpoint.events || []).map((e) => (
              <span
                key={e}
                className={cn('text-xs px-1.5 py-0.5 rounded border', eventColor())}
              >
                {e}
              </span>
            ))}
          </div>
        </div>

        {/* Controls */}
        <div className="flex items-center gap-3 shrink-0">
          {/* Active toggle */}
          <div className="flex items-center gap-1.5">
            {activeToggling && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
            <Switch
              checked={endpoint.is_active}
              onCheckedChange={handleToggleActive}
              disabled={activeToggling}
              className="data-[state=checked]:bg-primary"
            />
            <span className="text-xs text-muted-foreground">
              {endpoint.is_active ? 'Active' : 'Paused'}
            </span>
          </div>

          <Button
            variant="ghost"
            size="sm"
            onClick={() => setEditOpen(true)}
            className="h-7 w-7 p-0 text-muted-foreground hover:text-primary"
            title="Edit"
          >
            <Pencil className="h-3.5 w-3.5" />
          </Button>

          <Button
            variant="ghost"
            size="sm"
            onClick={() => setDeleteOpen(true)}
            className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
            title="Delete"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>

          <Button
            variant="ghost"
            size="sm"
            onClick={() => setDeliveriesOpen((v) => !v)}
            className="h-7 px-2 text-muted-foreground hover:text-foreground"
            title="Recent deliveries"
          >
            <Activity className="h-3.5 w-3.5 mr-1" />
            <span className="text-xs">Deliveries</span>
            {deliveriesOpen ? (
              <ChevronDown className="h-3.5 w-3.5 ml-0.5" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5 ml-0.5" />
            )}
          </Button>
        </div>
      </div>

      {/* Collapsible deliveries */}
      {deliveriesOpen && (
        <div className="border-t border-border bg-muted/50">
          <DeliveriesPanel endpointId={endpoint.id} />
        </div>
      )}

      {/* Edit dialog */}
      <AddEndpointDialog
        open={editOpen}
        onClose={() => setEditOpen(false)}
        onCreated={(updated) => { onUpdated(updated); setEditOpen(false); }}
        editEndpoint={endpoint}
      />

      {/* Delete confirmation */}
      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-destructive">
              <Trash2 className="h-4 w-4" /> Delete endpoint?
            </AlertDialogTitle>
            <AlertDialogDescription>
              <span className="font-mono">{endpoint.url}</span> will be permanently removed.
              No further events will be delivered.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-destructive hover:bg-destructive/90 text-destructive-foreground"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function WebhooksSection() {
  const [endpoints, setEndpoints] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [addOpen, setAddOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    const { data, error: apiErr } = await listEndpoints();
    setLoading(false);
    if (apiErr) { setError(apiErr.message || 'Failed to load endpoints.'); return; }
    setEndpoints(Array.isArray(data) ? data : []);
  }, []);

  useEffect(() => { load(); }, [load]);

  function handleCreated(newEndpoint) {
    setEndpoints((prev) => [newEndpoint, ...prev]);
  }

  function handleUpdated(updated) {
    setEndpoints((prev) =>
      prev.map((e) => (e.id === updated.id ? { ...e, ...updated } : e)),
    );
  }

  function handleDeleted(id) {
    setEndpoints((prev) => prev.filter((e) => e.id !== id));
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div>
          <CardTitle className="flex items-center gap-2 text-base">
            <Webhook className="h-5 w-5 text-primary" />
            Webhooks
          </CardTitle>
          <CardDescription className="mt-1">
            Receive real-time event notifications at your HTTPS endpoint. Each endpoint gets a
            unique signing secret shown once on creation.
          </CardDescription>
        </div>
        <Button
          size="sm"
          onClick={() => setAddOpen(true)}
          className="shrink-0"
        >
          <Plus className="h-4 w-4 mr-1" />
          Add endpoint
        </Button>
      </CardHeader>

      <CardContent>
        {loading ? (
          <div className="flex items-center justify-center py-10 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin mr-2" />
            Loading endpoints…
          </div>
        ) : error ? (
          <div className="flex items-center gap-2 py-6 text-destructive text-sm">
            <AlertTriangle className="h-4 w-4" /> {error}
            <Button variant="ghost" size="sm" onClick={load} className="ml-auto">
              Retry
            </Button>
          </div>
        ) : endpoints.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-10 text-muted-foreground text-sm gap-2">
            <Webhook className="h-8 w-8 opacity-30" />
            <p>No webhook endpoints configured.</p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setAddOpen(true)}
              className="mt-1"
            >
              <Plus className="h-4 w-4 mr-1" /> Add first endpoint
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            {endpoints.map((ep) => (
              <WebhookEndpointRow
                key={ep.id}
                endpoint={ep}
                onUpdated={handleUpdated}
                onDeleted={handleDeleted}
              />
            ))}
          </div>
        )}
      </CardContent>

      <AddEndpointDialog
        open={addOpen}
        onClose={() => setAddOpen(false)}
        onCreated={(ep) => { handleCreated(ep); }}
      />
    </Card>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// PAGE ROOT
// ═══════════════════════════════════════════════════════════════════════════════

export default function ApiKeysPage() {
  return (
    <PageContainer className="max-w-3xl">
      {/* Page header */}
      <PageHeader
        eyebrow="Settings"
        title="API Keys & Webhooks"
        description="Manage programmatic access and real-time integrations for your organisation."
        icon={Key}
      />

      {/* Sections */}
      <ApiKeysSection />
      <WebhooksSection />
    </PageContainer>
  );
}
