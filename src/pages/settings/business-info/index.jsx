/**
 * Business Info settings page — Wave 34 / Now-26.
 *
 * Allows the org to fill in its legal / VAT registration details
 * (tax_profile). These details appear on invoices the org raises
 * against its B2B customers.
 *
 * Route: /settings/business-info (wire externally in routes.jsx)
 */

import React, { useState, useEffect, useCallback } from 'react';
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
import { Loader2, Save, Building2, AlertCircle, CheckCircle } from 'lucide-react';
import { getTaxProfile, saveTaxProfile } from '@/services/invoicing';

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
    setForm((prev) => ({ ...prev, [name]: value }));
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
    <div className="max-w-2xl mx-auto px-4 py-6 space-y-6">
      {/* Page header */}
      <div className="flex items-center gap-3">
        <Building2 className="h-6 w-6 text-primary" />
        <div>
          <h1 className="text-xl font-semibold">Business Info</h1>
          <p className="text-sm text-muted-foreground">
            Your legal and VAT registration details. These appear on invoices
            you send to customers.
          </p>
        </div>
      </div>

      {/* Alerts */}
      {error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {success && (
        <Alert>
          <CheckCircle className="h-4 w-4 text-green-600" />
          <AlertDescription className="text-green-700">
            Business info saved successfully.
          </AlertDescription>
        </Alert>
      )}

      <form onSubmit={handleSave}>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Legal Details</CardTitle>
            <CardDescription>
              Used as the "From" block on invoices you raise.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Legal name */}
            <div className="space-y-1">
              <Label htmlFor="legal_name">Legal business name</Label>
              <Input
                id="legal_name"
                name="legal_name"
                value={form.legal_name}
                onChange={handleChange}
                placeholder="Acme Pty Ltd"
              />
            </div>

            {/* Registered address */}
            <div className="space-y-1">
              <Label htmlFor="registered_address">Registered address</Label>
              <Input
                id="registered_address"
                name="registered_address"
                value={form.registered_address}
                onChange={handleChange}
                placeholder="123 Main Street, Cape Town, 8001"
              />
            </div>

            {/* Country */}
            <div className="space-y-1">
              <Label htmlFor="country">Country</Label>
              <Input
                id="country"
                name="country"
                value={form.country}
                onChange={handleChange}
                placeholder="South Africa"
              />
            </div>

            {/* Company number */}
            <div className="space-y-1">
              <Label htmlFor="company_number">
                Company / registration number{' '}
                <span className="text-muted-foreground text-xs">(optional)</span>
              </Label>
              <Input
                id="company_number"
                name="company_number"
                value={form.company_number}
                onChange={handleChange}
                placeholder="2024/123456/07"
              />
            </div>

            {/* VAT number */}
            <div className="space-y-1">
              <Label htmlFor="vat_number">
                VAT number{' '}
                <span className="text-muted-foreground text-xs">
                  (optional — enables VAT line on invoices)
                </span>
              </Label>
              <Input
                id="vat_number"
                name="vat_number"
                value={form.vat_number}
                onChange={handleChange}
                placeholder="4123456789"
              />
              <p className="text-xs text-muted-foreground">
                When set, a VAT line is automatically added to every invoice
                you issue and the VAT number is printed on the PDF.
              </p>
            </div>
          </CardContent>
        </Card>

        <Card className="mt-4">
          <CardHeader>
            <CardTitle className="text-base">Contact Details</CardTitle>
            <CardDescription>
              Shown on the invoice so recipients can reach you.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1">
              <Label htmlFor="contact_email">Contact email</Label>
              <Input
                id="contact_email"
                name="contact_email"
                type="email"
                value={form.contact_email}
                onChange={handleChange}
                placeholder="accounts@acme.co.za"
              />
            </div>

            <div className="space-y-1">
              <Label htmlFor="contact_phone">Contact phone</Label>
              <Input
                id="contact_phone"
                name="contact_phone"
                type="tel"
                value={form.contact_phone}
                onChange={handleChange}
                placeholder="+27 21 000 0000"
              />
            </div>
          </CardContent>
        </Card>

        <div className="flex justify-end mt-4">
          <Button type="submit" disabled={saving}>
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
      </form>
    </div>
  );
}
