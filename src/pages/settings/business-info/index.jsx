/**
 * Business Info settings page — Wave 34 / Now-26.
 *
 * Allows the org to fill in its legal / tax registration details
 * (tax_profile). These details appear on invoices the org raises
 * against its B2B customers.
 *
 * Route: /settings/business-info (wire externally in routes.jsx)
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Reveal } from '@/components/ui/motion';
import { Loader2, Save, Building2, AlertCircle, CheckCircle, Phone } from 'lucide-react';
import { getTaxProfile, saveTaxProfile } from '@/services/invoicing';
import { useLocale } from '@/context/locale-context';
import { countryOptions } from '@/lib/locale-data';

// ── Helpers ──────────────────────────────────────────────────────────────────

const EMPTY_FORM = {
  legal_name: '',
  registered_address: '',
  country: '',
  vat_number: '',
  company_number: '',
  contact_email: '',
  contact_phone: '',
};

// ── Component ─────────────────────────────────────────────────────────────────

export default function BusinessInfoPage() {
  // The tax is called VAT here, GST there, IVA elsewhere and Sales Tax in the
  // US. The API field is still `vat_number` — renaming it would be a breaking
  // change for no gain — but nothing the operator READS should assert a tax
  // regime their country does not have.
  const { taxLabel, locale } = useLocale();
  const tax = taxLabel || 'Tax';
  const countries = useMemo(() => countryOptions(locale), [locale]);

  const [form, setForm] = useState(EMPTY_FORM);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(false);

  // ── Load ─────────────────────────────────────────────────────────────────

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data, error: err } = await getTaxProfile();
    if (!err && data) {
      setForm({
        legal_name:         data.legal_name         ?? '',
        registered_address: data.registered_address ?? '',
        country:            data.country            ?? '',
        vat_number:         data.vat_number         ?? '',
        company_number:     data.company_number     ?? '',
        contact_email:      data.contact_email      ?? '',  // may be null from API
        contact_phone:      data.contact_phone      ?? '',  // may be null from API
      });
    }
    // 404 is fine — no profile yet; user will create one on save.
    if (err && err.status !== 404) {
      setError(err.message || 'Failed to load business info.');
    }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  // ── Field change ─────────────────────────────────────────────────────────

  function handleChange(e) {
    const { name, value } = e.target;
    // country must be a 2-letter ISO code — enforce uppercase at input time.
    const coerced = name === 'country' ? value.toUpperCase().slice(0, 2) : value;
    setForm((prev) => ({ ...prev, [name]: coerced }));
    setSuccess(false);
  }

  // ── Save ─────────────────────────────────────────────────────────────────

  async function handleSave(e) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setSuccess(false);

    // Send null for empty optional fields so the backend stores NULL.
    const body = {
      ...form,
      vat_number:     form.vat_number     || null,
      company_number: form.company_number || null,
      contact_email:  form.contact_email  || null,
      contact_phone:  form.contact_phone  || null,
    };

    const { error: err } = await saveTaxProfile(body);
    if (err) {
      setError(err.message || 'Failed to save business info.');
    } else {
      setSuccess(true);
    }
    setSaving(false);
  }

  // ── Render ───────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex items-center justify-center h-48">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Alerts */}
      {error && (
        <Alert variant="destructive" className="rounded-xl">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {success && (
        <Alert className="rounded-xl border-green-200 bg-green-50 text-green-800 dark:bg-green-950/40 dark:text-green-300 dark:border-green-800">
          <CheckCircle className="h-4 w-4 text-green-600 dark:text-green-400" />
          <AlertDescription>Business info saved successfully.</AlertDescription>
        </Alert>
      )}

      <form onSubmit={handleSave} className="space-y-5">
        <Reveal>
          <Card variant="elevated">
            <CardHeader className="pb-4">
              <div className="flex items-center gap-2.5">
                <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-primary/10 text-primary">
                  <Building2 className="h-4 w-4" />
                </span>
                <div>
                  <CardTitle>Legal details</CardTitle>
                  <CardDescription className="mt-0.5">
                    Used as the "From" block on invoices you raise.
                  </CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Legal name */}
              <div className="space-y-1.5">
                <Label htmlFor="legal_name" className="text-sm font-medium">Legal business name</Label>
                <Input
                  id="legal_name"
                  name="legal_name"
                  value={form.legal_name}
                  onChange={handleChange}
                  placeholder="Acme Pty Ltd"
                  className="rounded-xl h-10"
                />
              </div>

              {/* Registered address */}
              <div className="space-y-1.5">
                <Label htmlFor="registered_address" className="text-sm font-medium">Registered address</Label>
                <Input
                  id="registered_address"
                  name="registered_address"
                  value={form.registered_address}
                  onChange={handleChange}
                  placeholder="Street, city, postal code"
                  className="rounded-xl h-10"
                />
              </div>

              {/* Country */}
              <div className="space-y-1.5">
                <Label htmlFor="country" className="text-sm font-medium">Country</Label>
                <Select
                  value={form.country || undefined}
                  onValueChange={(v) => {
                    setForm((prev) => ({ ...prev, country: v }));
                    setSuccess(false);
                  }}
                >
                  <SelectTrigger id="country" className="rounded-xl h-10 max-w-xs">
                    <SelectValue placeholder="Select a country…" />
                  </SelectTrigger>
                  <SelectContent className="max-h-72">
                    {countries.map((c) => (
                      <SelectItem key={c.code} value={c.code}>
                        {c.name} ({c.code})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  Stored as the 2-letter ISO 3166-1 code.
                </p>
              </div>

              {/* Company number */}
              <div className="space-y-1.5">
                <Label htmlFor="company_number" className="text-sm font-medium">
                  Company / registration number{' '}
                  <span className="text-muted-foreground font-normal text-xs">(optional)</span>
                </Label>
                <Input
                  id="company_number"
                  name="company_number"
                  value={form.company_number}
                  onChange={handleChange}
                  placeholder="As issued by your company registry"
                  className="rounded-xl h-10"
                />
              </div>

              {/* VAT number */}
              <div className="space-y-1.5">
                <Label htmlFor="vat_number" className="text-sm font-medium">
                  {tax} registration number{' '}
                  <span className="text-muted-foreground font-normal text-xs">
                    (optional — enables the {tax} line on invoices)
                  </span>
                </Label>
                <Input
                  id="vat_number"
                  name="vat_number"
                  value={form.vat_number}
                  onChange={handleChange}
                  placeholder="As issued by your tax authority"
                  className="rounded-xl h-10"
                />
                <p className="text-xs text-muted-foreground">
                  When set, a {tax} line is automatically added to every invoice
                  you issue and the number is printed on the PDF.
                </p>
              </div>
            </CardContent>
          </Card>
        </Reveal>

        <Reveal delay={0.06}>
          <Card variant="elevated">
            <CardHeader className="pb-4">
              <div className="flex items-center gap-2.5">
                <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-primary/10 text-primary">
                  <Phone className="h-4 w-4" />
                </span>
                <div>
                  <CardTitle>Contact details</CardTitle>
                  <CardDescription className="mt-0.5">
                    Shown on the invoice so recipients can reach you.
                  </CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="contact_email" className="text-sm font-medium">Contact email</Label>
                <Input
                  id="contact_email"
                  name="contact_email"
                  type="email"
                  value={form.contact_email}
                  onChange={handleChange}
                  placeholder="accounts@yourcompany.example"
                  className="rounded-xl h-10"
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="contact_phone" className="text-sm font-medium">Contact phone</Label>
                <Input
                  id="contact_phone"
                  name="contact_phone"
                  type="tel"
                  value={form.contact_phone}
                  onChange={handleChange}
                  placeholder="International format, starting with +"
                  className="rounded-xl h-10"
                />
              </div>
            </CardContent>
          </Card>
        </Reveal>

        <Reveal delay={0.1}>
          <div className="flex justify-end">
            <Button type="submit" disabled={saving} className="rounded-xl shadow-sm">
              {saving ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Saving…
                </>
              ) : (
                <>
                  <Save className="mr-2 h-4 w-4" />
                  Save Business Info
                </>
              )}
            </Button>
          </div>
        </Reveal>
      </form>
    </div>
  );
}
