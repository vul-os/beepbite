import React, { useState } from 'react';
import { Ticket, Copy, Check, Loader2, ChevronDown, ChevronUp } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { createQuickCoupon } from '@/services/quick-coupon';
import { useDateTime, useMoney } from '@/context/locale-context';

/**
 * QuickCouponButton — renders an inline "Send X% off" form anchored to a
 * customer detail view. On success it reveals the generated code with a
 * one-click copy action.
 *
 * Props:
 *   customerId {string}  UUID of the customer whose detail page this is on.
 */
export function QuickCouponButton({ customerId }) {
  const [open, setOpen] = useState(false);
  const [percentOff, setPercentOff] = useState('20');
  const [expiryDays, setExpiryDays] = useState('30');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null); // { code, expires_at, percent_off }
  const [error, setError] = useState(null);
  const [copied, setCopied] = useState(false);
  const { format: formatMoney } = useMoney();
  // The expiry date is the store's, so it renders in the store's timezone —
  // the browser's default puts a US store's coupon a day out.
  const { formatDate } = useDateTime();

  async function handleSend(e) {
    e.preventDefault();
    const pct = parseFloat(percentOff);
    if (!pct || pct <= 0 || pct > 100) {
      setError('Enter a discount between 1 and 100 %.');
      return;
    }

    setLoading(true);
    setError(null);
    setResult(null);

    const payload = {
      customer_id: customerId || undefined,
      percent_off: pct,
    };
    const days = parseInt(expiryDays, 10);
    if (!isNaN(days) && days > 0) {
      payload.expires_in_days = days;
    }

    const { data, error: apiErr } = await createQuickCoupon(payload);
    setLoading(false);

    if (apiErr) {
      setError(apiErr.message || 'Failed to generate coupon.');
      return;
    }

    setResult(data);
  }

  function handleCopy() {
    if (!result?.code) return;
    navigator.clipboard.writeText(result.code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  function handleReset() {
    setResult(null);
    setError(null);
    setCopied(false);
  }

  return (
    <div className="w-full">
      {/* Toggle button */}
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="gap-2"
        onClick={() => { setOpen((v) => !v); handleReset(); }}
      >
        <Ticket className="h-4 w-4" />
        Send coupon
        {open ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
      </Button>

      {open && (
        <Card className="mt-3 border-dashed">
          <CardHeader className="pb-2 pt-4 px-4">
            <CardTitle className="text-sm font-medium">Quick coupon</CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4 space-y-4">
            {result ? (
              /* Success state */
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <Badge variant="secondary" className="text-xs">
                    {result.percent_off != null
                      ? `${result.percent_off}% off`
                      : result.fixed_off_cents != null
                        ? `${formatMoney(result.fixed_off_cents)} off`
                        : 'Discount'}
                  </Badge>
                  {result.expires_at && (
                    <span className="text-xs text-muted-foreground">
                      Expires {formatDate(result.expires_at)}
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  <code className="flex-1 rounded bg-muted px-3 py-2 font-mono text-lg font-bold tracking-widest">
                    {result.code}
                  </code>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={handleCopy}
                    title="Copy code"
                  >
                    {copied
                      ? <Check className="h-4 w-4 text-green-600" />
                      : <Copy className="h-4 w-4" />}
                  </Button>
                </div>

                <p className="text-xs text-muted-foreground">
                  Share this code with the customer — it can be entered at checkout.
                </p>

                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="w-full"
                  onClick={handleReset}
                >
                  Generate another
                </Button>
              </div>
            ) : (
              /* Form state */
              <form onSubmit={handleSend} className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label htmlFor="qc-percent" className="text-xs">
                      Discount (%)
                    </Label>
                    <Input
                      id="qc-percent"
                      type="number"
                      min="1"
                      max="100"
                      step="1"
                      value={percentOff}
                      onChange={(e) => setPercentOff(e.target.value)}
                      className="h-8 text-sm"
                      placeholder="20"
                      required
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="qc-expiry" className="text-xs">
                      Expires in (days)
                    </Label>
                    <Input
                      id="qc-expiry"
                      type="number"
                      min="1"
                      step="1"
                      value={expiryDays}
                      onChange={(e) => setExpiryDays(e.target.value)}
                      className="h-8 text-sm"
                      placeholder="30"
                    />
                  </div>
                </div>

                {error && (
                  <p className="text-xs text-destructive">{error}</p>
                )}

                <Button
                  type="submit"
                  size="sm"
                  className="w-full gap-2"
                  disabled={loading}
                >
                  {loading && <Loader2 className="h-3 w-3 animate-spin" />}
                  {loading ? 'Generating…' : `Send ${percentOff || '?'}% off coupon`}
                </Button>
              </form>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
