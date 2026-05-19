import React, { useState } from 'react';
import { api } from '@/lib/api-client';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { CardResult } from './card-result';
import { RefreshCw } from 'lucide-react';

/**
 * IssueForm — the "Issue" tab content.
 * POSTs to /gift-cards/issue and shows a CardResult on success.
 */
export function IssueForm() {
  const [balanceDollars, setBalanceDollars] = useState('');
  const [cardType, setCardType] = useState('digital'); // 'physical' | 'digital'
  const [expiresAt, setExpiresAt] = useState('');       // local date string yyyy-mm-dd
  const [pin, setPin] = useState('');
  const [customerId, setCustomerId] = useState('');
  const [issuedByStaffId, setIssuedByStaffId] = useState('');
  const [organizationId, setOrganizationId] = useState('');

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null); // IssueResult from backend

  function resetForm() {
    setBalanceDollars('');
    setCardType('digital');
    setExpiresAt('');
    setPin('');
    setCustomerId('');
    setIssuedByStaffId('');
    setOrganizationId('');
    setError('');
    setResult(null);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');

    const balanceCents = Math.round(parseFloat(balanceDollars) * 100);
    if (!balanceCents || balanceCents < 0) {
      setError('Enter a valid initial balance.');
      return;
    }

    if (pin && (pin.length < 4 || pin.length > 6)) {
      setError('PIN must be 4–6 digits.');
      return;
    }

    if (!organizationId.trim()) {
      setError('Organization ID is required.');
      return;
    }

    // Build expires_at as RFC3339 (end-of-day UTC) or omit if blank.
    let expiresAtRFC3339 = null;
    if (expiresAt) {
      // Date input gives yyyy-mm-dd in local time; send as end-of-day UTC.
      expiresAtRFC3339 = new Date(`${expiresAt}T23:59:59Z`).toISOString();
    }

    const body = {
      organization_id: organizationId.trim(),
      initial_balance_cents: balanceCents,
      card_type: cardType,
      ...(pin ? { pin } : {}),
      ...(customerId.trim() ? { issued_to_customer_id: customerId.trim() } : {}),
      ...(issuedByStaffId.trim() ? { issued_by_staff_id: issuedByStaffId.trim() } : {}),
      ...(expiresAtRFC3339 ? { expires_at: expiresAtRFC3339 } : { expires_at: null }),
    };

    setLoading(true);
    const { data, error: err } = await api.request('POST', '/gift-cards/issue', { body });
    setLoading(false);

    if (err) {
      setError(err.message || 'Failed to issue card.');
      return;
    }

    setResult(data);
  }

  // After issue, show the result card until user dismisses.
  if (result) {
    return <CardResult result={result} onDismiss={resetForm} />;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Issue a New Gift Card</CardTitle>
        <CardDescription>Fields marked * are required.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-5">
          {/* Organization ID */}
          <div className="space-y-1.5">
            <Label htmlFor="org-id">Organization ID *</Label>
            <Input
              id="org-id"
              placeholder="UUID of the organization"
              value={organizationId}
              onChange={(e) => setOrganizationId(e.target.value)}
              required
            />
          </div>

          {/* Initial balance */}
          <div className="space-y-1.5">
            <Label htmlFor="balance">Initial Balance (ZAR) *</Label>
            <Input
              id="balance"
              type="number"
              min="0"
              step="0.01"
              placeholder="0.00"
              value={balanceDollars}
              onChange={(e) => setBalanceDollars(e.target.value)}
              required
            />
          </div>

          {/* Card type */}
          <div className="space-y-2">
            <Label>Card Type *</Label>
            <RadioGroup
              value={cardType}
              onValueChange={setCardType}
              className="flex gap-6"
            >
              <div className="flex items-center gap-2">
                <RadioGroupItem value="digital" id="type-digital" />
                <Label htmlFor="type-digital" className="cursor-pointer font-normal">
                  Digital
                </Label>
              </div>
              <div className="flex items-center gap-2">
                <RadioGroupItem value="physical" id="type-physical" />
                <Label htmlFor="type-physical" className="cursor-pointer font-normal">
                  Physical
                </Label>
              </div>
            </RadioGroup>
          </div>

          {/* Expiry */}
          <div className="space-y-1.5">
            <Label htmlFor="expires">Expiry Date (optional)</Label>
            <Input
              id="expires"
              type="date"
              value={expiresAt}
              onChange={(e) => setExpiresAt(e.target.value)}
              min={new Date().toISOString().slice(0, 10)}
            />
          </div>

          {/* PIN */}
          <div className="space-y-1.5">
            <Label htmlFor="pin">PIN (optional, 4–6 digits)</Label>
            <Input
              id="pin"
              type="password"
              placeholder="••••"
              maxLength={6}
              pattern="\d{4,6}"
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
            />
          </div>

          {/* Customer ID */}
          <div className="space-y-1.5">
            <Label htmlFor="customer-id">Customer ID (optional)</Label>
            <Input
              id="customer-id"
              placeholder="UUID of the customer"
              value={customerId}
              onChange={(e) => setCustomerId(e.target.value)}
            />
          </div>

          {/* Staff ID */}
          <div className="space-y-1.5">
            <Label htmlFor="staff-id">Issued By Staff ID (optional)</Label>
            <Input
              id="staff-id"
              placeholder="UUID of the staff member"
              value={issuedByStaffId}
              onChange={(e) => setIssuedByStaffId(e.target.value)}
            />
          </div>

          {error && (
            <p className="text-sm text-destructive">{error}</p>
          )}

          <Button type="submit" disabled={loading} className="w-full sm:w-auto">
            {loading && <RefreshCw className="h-4 w-4 animate-spin mr-2" />}
            Issue Card
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
