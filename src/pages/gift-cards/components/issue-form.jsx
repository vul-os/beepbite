import { useState, useEffect } from 'react';
import { api } from '@/lib/api-client';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { CardResult } from './card-result';
import { AlertCircle, RefreshCw, X } from 'lucide-react';
import { useAuth } from '@/context/auth-context';
import { supabase } from '@/services/supabase-client';
import CustomerSearch from '@/pages/pos/components/customer-search';

// Sentinel used in the staff <Select> to represent "no selection".
const STAFF_NONE = '__none__';

/**
 * IssueForm — the "Issue" tab content.
 * POSTs to /gift-cards/issue and shows a CardResult on success.
 *
 * Organisation ID is sourced implicitly from the active organisation context.
 * Customer and staff fields use polished pickers instead of raw UUID inputs.
 */
export function IssueForm() {
  const { activeOrganization, activeLocation } = useAuth();

  const [balanceDollars, setBalanceDollars] = useState('');
  const [cardType, setCardType] = useState('digital'); // 'physical' | 'digital'
  const [expiresAt, setExpiresAt] = useState('');      // local date string yyyy-mm-dd
  const [pin, setPin] = useState('');

  // Customer: store the full object returned by CustomerSearch so we can
  // display the name; only the id is sent in the POST body.
  const [selectedCustomer, setSelectedCustomer] = useState(null);

  // Staff: id string ('' = unset), populated from supabase for active location.
  const [issuedByStaffId, setIssuedByStaffId] = useState('');
  const [staffList, setStaffList] = useState([]);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null); // IssueResult from backend

  // Fetch active staff for the current location so the dropdown is populated.
  useEffect(() => {
    if (!activeLocation) {
      setStaffList([]);
      return;
    }

    supabase
      .from('staff')
      .select('id, first_name, last_name')
      .eq('location_id', activeLocation.id)
      .eq('is_active', true)
      .order('first_name', { ascending: true })
      .then(({ data, error: staffErr }) => {
        if (staffErr) {
          console.error('Failed to fetch staff for gift-card form:', staffErr);
          return;
        }
        setStaffList(data || []);
      });
  }, [activeLocation]);

  function resetForm() {
    setBalanceDollars('');
    setCardType('digital');
    setExpiresAt('');
    setPin('');
    setSelectedCustomer(null);
    setIssuedByStaffId('');
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

    // Build expires_at as RFC3339 (end-of-day UTC) or omit if blank.
    let expiresAtRFC3339 = null;
    if (expiresAt) {
      expiresAtRFC3339 = new Date(`${expiresAt}T23:59:59Z`).toISOString();
    }

    const body = {
      organization_id: activeOrganization.id,
      initial_balance_cents: balanceCents,
      card_type: cardType,
      ...(pin ? { pin } : {}),
      ...(selectedCustomer ? { issued_to_customer_id: selectedCustomer.id } : {}),
      ...(issuedByStaffId ? { issued_by_staff_id: issuedByStaffId } : {}),
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

  // Guard: no active organisation — the org id is required to issue a card.
  if (!activeOrganization) {
    return (
      <Card>
        <CardContent className="py-10 flex flex-col items-center gap-3 text-center">
          <AlertCircle className="h-8 w-8 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            No organisation is active. Please select an organisation from the top
            navigation before issuing a gift card.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Issue a New Gift Card</CardTitle>
        <CardDescription>Fields marked * are required.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-5">
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

          {/* Customer picker */}
          <div className="space-y-1.5">
            <Label>Customer (optional)</Label>
            {selectedCustomer ? (
              /* Show the selected customer as a dismissible chip */
              <div className="flex items-center justify-between rounded-md border border-input bg-muted/40 px-3 py-2 text-sm">
                <div className="min-w-0">
                  <p className="font-medium truncate">{selectedCustomer.name}</p>
                  {selectedCustomer.phone && (
                    <p className="text-xs text-muted-foreground truncate">
                      {selectedCustomer.phone}
                    </p>
                  )}
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 shrink-0 ml-2"
                  onClick={() => setSelectedCustomer(null)}
                  aria-label="Clear customer selection"
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            ) : (
              /* Typeahead search — reuses the POS customer-search widget */
              <CustomerSearch
                onSelect={setSelectedCustomer}
                placeholder="Search by name or phone…"
              />
            )}
          </div>

          {/* Staff picker */}
          <div className="space-y-1.5">
            <Label htmlFor="staff-select">Issued By (optional)</Label>
            <Select
              value={issuedByStaffId || STAFF_NONE}
              onValueChange={(v) => setIssuedByStaffId(v === STAFF_NONE ? '' : v)}
            >
              <SelectTrigger id="staff-select">
                <SelectValue placeholder="Select staff member…" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={STAFF_NONE}>— Unassigned —</SelectItem>
                {staffList.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.first_name} {s.last_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
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
