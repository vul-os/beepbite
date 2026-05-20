import React, { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { Loader2, Copy, CheckCheck, ChevronDown, ChevronUp } from 'lucide-react';
import {
  savePaymentCredentials,
  deletePaymentCredentials,
  testPaymentCredentials,
} from '@/services/payments';

/**
 * ProviderCard — displays one payment provider (paystack / stripe / payfast).
 *
 * Props:
 *   provider       string  — "paystack" | "stripe" | "payfast"
 *   label          string  — display name, e.g. "Paystack"
 *   credential     object | null  — existing credential record from the API
 *   locationId     string
 *   inactive       boolean — true = provider not yet supported (payfast)
 *   instructionsMd string  — raw markdown content for setup instructions
 *   onRefresh      () => void  — called after save / delete to re-fetch
 */
export function ProviderCard({
  provider,
  label,
  credential,
  locationId,
  inactive = false,
  instructionsMd,
  onRefresh,
}) {
  const { toast } = useToast();

  // form state
  const [configuring, setConfiguring] = useState(false);
  const [secretKey, setSecretKey] = useState('');
  const [publicKey, setPublicKey] = useState('');
  const [webhookSecret, setWebhookSecret] = useState('');
  const [saving, setSaving] = useState(false);

  // post-save webhook URL display
  const [webhookUrl, setWebhookUrl] = useState(credential?.webhook_url ?? null);
  const [copied, setCopied] = useState(false);
  const [showInstructions, setShowInstructions] = useState(false);

  // test / delete state
  const [testing, setTesting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);

  const isActive = !!credential && !configuring;

  function handleConfigure() {
    setConfiguring(true);
    setSecretKey('');
    setPublicKey('');
    setWebhookSecret('');
  }

  async function handleSave() {
    if (!secretKey.trim() || !publicKey.trim()) {
      toast({ variant: 'destructive', title: 'Both secret key and public key are required.' });
      return;
    }
    setSaving(true);
    try {
      const payload = {
        location_id: locationId,
        provider,
        secret_key: secretKey.trim(),
        public_key: publicKey.trim(),
        ...(webhookSecret.trim() ? { webhook_secret: webhookSecret.trim() } : {}),
      };
      const { data, error } = await savePaymentCredentials(payload);
      if (error) {
        toast({ variant: 'destructive', title: 'Save failed', description: error.message });
        return;
      }
      toast({ title: `${label} connected successfully.` });
      setConfiguring(false);
      setWebhookUrl(data?.webhook_url ?? null);
      setShowInstructions(true);
      onRefresh();
    } finally {
      setSaving(false);
    }
  }

  async function handleTest() {
    if (!credential?.id) return;
    setTesting(true);
    try {
      const { data, error } = await testPaymentCredentials(credential.id);
      if (error) {
        toast({ variant: 'destructive', title: 'Connection test failed', description: error.message });
        return;
      }
      const msg = data?.message ?? 'Connection is working.';
      toast({ title: `${label}: ${msg}` });
    } finally {
      setTesting(false);
    }
  }

  async function handleDisconnect() {
    if (!credential?.id) return;
    setDisconnecting(true);
    try {
      const { error } = await deletePaymentCredentials(credential.id);
      if (error) {
        toast({ variant: 'destructive', title: 'Disconnect failed', description: error.message });
        return;
      }
      toast({ title: `${label} disconnected.` });
      setWebhookUrl(null);
      setShowInstructions(false);
      onRefresh();
    } finally {
      setDisconnecting(false);
    }
  }

  async function handleCopy() {
    if (!webhookUrl) return;
    try {
      await navigator.clipboard.writeText(webhookUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback for environments where clipboard API is unavailable
      const el = document.createElement('textarea');
      el.value = webhookUrl;
      el.style.position = 'fixed';
      el.style.opacity = '0';
      document.body.appendChild(el);
      el.select();
      document.execCommand('copy');
      document.body.removeChild(el);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }

  // Provider logo placeholder with brand colouring
  const logoBg = {
    paystack: 'bg-teal-50 text-teal-700 border-teal-200',
    stripe: 'bg-indigo-50 text-indigo-700 border-indigo-200',
    payfast: 'bg-gray-50 text-gray-500 border-gray-200',
  }[provider] ?? 'bg-gray-50 text-gray-500 border-gray-200';

  return (
    <Card className="overflow-hidden">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            {/* Logo placeholder */}
            <div className={`flex items-center justify-center w-12 h-12 rounded-lg border text-xs font-bold tracking-wide ${logoBg}`}>
              {label.slice(0, 2).toUpperCase()}
            </div>
            <div>
              <p className="text-sm font-semibold leading-none">{label}</p>
              {inactive && (
                <p className="text-xs text-muted-foreground mt-0.5">Coming soon</p>
              )}
              {isActive && !inactive && (
                <Badge className="mt-1 bg-orange-500 text-white text-xs">Active</Badge>
              )}
              {!isActive && !configuring && !inactive && (
                <p className="text-xs text-muted-foreground mt-0.5">Not configured</p>
              )}
            </div>
          </div>

          {/* Action buttons */}
          {!inactive && (
            <div className="flex items-center gap-2 flex-shrink-0">
              {isActive && (
                <>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={handleTest}
                    disabled={testing || disconnecting}
                  >
                    {testing && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}
                    Test connection
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-destructive hover:text-destructive hover:bg-destructive/10"
                    onClick={handleDisconnect}
                    disabled={testing || disconnecting}
                  >
                    {disconnecting && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}
                    Disconnect
                  </Button>
                </>
              )}
              {!isActive && !configuring && (
                <Button
                  size="sm"
                  className="bg-orange-500 hover:bg-orange-600 text-white"
                  onClick={handleConfigure}
                >
                  Configure
                </Button>
              )}
            </div>
          )}
        </div>
      </CardHeader>

      {/* Configuration form */}
      {configuring && (
        <CardContent className="pt-0 space-y-3">
          <div className="border-t pt-4 space-y-3">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Secret Key
              </label>
              <Input
                type="password"
                placeholder={provider === 'stripe' ? 'sk_live_...' : 'sk_live_...'}
                value={secretKey}
                onChange={(e) => setSecretKey(e.target.value)}
                autoComplete="off"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Public Key
              </label>
              <Input
                type="text"
                placeholder={provider === 'stripe' ? 'pk_live_...' : 'pk_live_...'}
                value={publicKey}
                onChange={(e) => setPublicKey(e.target.value)}
                autoComplete="off"
              />
            </div>
            {provider === 'stripe' && (
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  Webhook Secret <span className="text-muted-foreground font-normal">(optional — add after registering the endpoint)</span>
                </label>
                <Input
                  type="password"
                  placeholder="whsec_..."
                  value={webhookSecret}
                  onChange={(e) => setWebhookSecret(e.target.value)}
                  autoComplete="off"
                />
              </div>
            )}
            <div className="flex gap-2 pt-1">
              <Button
                size="sm"
                className="bg-orange-500 hover:bg-orange-600 text-white"
                onClick={handleSave}
                disabled={saving}
              >
                {saving && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}
                Save
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setConfiguring(false)}
                disabled={saving}
              >
                Cancel
              </Button>
            </div>
          </div>
        </CardContent>
      )}

      {/* Webhook URL display (shown after save or when credential has webhook_url) */}
      {(webhookUrl || (isActive && credential?.webhook_url)) && (
        <CardContent className="pt-0">
          <div className="border-t pt-4 space-y-3">
            <div className="space-y-1.5">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Your Webhook URL
              </p>
              <div className="flex items-center gap-2">
                <code className="flex-1 min-w-0 text-xs bg-muted px-3 py-2 rounded-md truncate font-mono">
                  {webhookUrl ?? credential?.webhook_url}
                </code>
                <Button
                  size="icon"
                  variant="outline"
                  className="flex-shrink-0 h-8 w-8"
                  onClick={handleCopy}
                  title="Copy webhook URL"
                >
                  {copied
                    ? <CheckCheck className="h-3.5 w-3.5 text-green-600" />
                    : <Copy className="h-3.5 w-3.5" />}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Register this URL in your {label} dashboard to receive payment events.
              </p>
            </div>

            {/* Expandable setup instructions */}
            {instructionsMd && (
              <div>
                <button
                  type="button"
                  className="flex items-center gap-1.5 text-xs font-medium text-orange-600 hover:text-orange-700"
                  onClick={() => setShowInstructions((v) => !v)}
                >
                  {showInstructions
                    ? <><ChevronUp className="h-3.5 w-3.5" /> Hide setup instructions</>
                    : <><ChevronDown className="h-3.5 w-3.5" /> Show setup instructions</>}
                </button>
                {showInstructions && (
                  <div className="mt-3 prose prose-sm max-w-none text-sm border rounded-md p-4 bg-muted/30">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>
                      {instructionsMd}
                    </ReactMarkdown>
                  </div>
                )}
              </div>
            )}
          </div>
        </CardContent>
      )}

      {/* Instructions for inactive providers */}
      {inactive && instructionsMd && (
        <CardContent className="pt-0">
          <div className="border-t pt-4">
            <div className="prose prose-sm max-w-none text-sm text-muted-foreground">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {instructionsMd}
              </ReactMarkdown>
            </div>
          </div>
        </CardContent>
      )}
    </Card>
  );
}
