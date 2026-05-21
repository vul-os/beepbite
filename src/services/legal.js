// legal.js — legal document API calls and per-tenant privacy policy generator.
// No auth required for document fetching; acceptance recording requires a JWT.

import { api } from '../lib/api-client.js';

// ── API helpers ───────────────────────────────────────────────────────────────

/**
 * Fetch the current (latest effective) legal document for a given kind.
 *
 * @param {'terms'|'privacy'} kind
 * @returns {Promise<{ data: { id: string, kind: string, version: string, body_md: string, effective_at: string }, error: any }>}
 */
export async function getCurrentDocument(kind) {
  return api.request('GET', `/legal/${encodeURIComponent(kind)}/current`, { auth: false });
}

/**
 * Record the authenticated user's acceptance of a specific document version.
 * Requires a valid JWT (the api client attaches the bearer token automatically).
 *
 * @param {string} documentId  UUID of the legal_documents row being accepted.
 * @returns {Promise<{ data: { id: string, profile_id: string, document_id: string, accepted_at: string } | { already_accepted: true }, error: any }>}
 */
export async function acceptDocument(documentId) {
  return api.request('POST', '/legal/accept', {
    body: { document_id: documentId },
    auth: true,
  });
}

// ── Per-tenant privacy policy generator ──────────────────────────────────────

/**
 * Generates a per-store privacy policy string from the store's business info.
 *
 * Accepts either:
 *   - An `organization` row (from the organizations table):
 *       { name, default_currency_code, ... }
 *   - Optionally a `taxProfile` row (from tax_profiles, may be absent):
 *       { legal_name, registered_address, country, vat_number, contact_email }
 *
 * The function is purely functional — it performs no network requests and
 * requires no new endpoint.
 *
 * @param {{
 *   name: string,
 *   default_currency_code?: string,
 *   [key: string]: any
 * }} organization  Row from the `organizations` table.
 *
 * @param {{
 *   legal_name?: string,
 *   registered_address?: string,
 *   country?: string,
 *   vat_number?: string,
 *   contact_email?: string,
 * } | null} [taxProfile]  Row from `tax_profiles` if available; null/undefined degrades gracefully.
 *
 * @returns {string}  Markdown-formatted privacy policy string.
 */
export function generateStorePolicyMd(organization, taxProfile = null) {
  if (!organization || !organization.name) {
    throw new Error('generateStorePolicyMd: organization.name is required');
  }

  // Prefer tax_profiles data when available; fall back to organizations fields.
  const legalName    = taxProfile?.legal_name      || organization.name;
  const address      = taxProfile?.registered_address || organization.address || 'address on file';
  const country      = taxProfile?.country         || organization.country     || 'ZA';
  const contactEmail = taxProfile?.contact_email   || organization.contact_email || 'privacy@beepbite.io';
  const vatNumber    = taxProfile?.vat_number;
  const storeName    = organization.name;
  const currency     = organization.default_currency_code || 'ZAR';

  const today = new Date().toISOString().slice(0, 10);

  return `# Privacy Policy — ${storeName}

**Effective date:** ${today}

## 1. Who we are

${legalName} ("we", "us", "our") operates the point-of-sale and online ordering
services for **${storeName}** using the BeepBite platform.

${vatNumber ? `**VAT/Tax registration:** ${vatNumber}  ` : ''}
**Registered address:** ${address}
**Country:** ${country}
**Contact:** ${contactEmail}

## 2. Information we collect

We collect information you provide when you place an order, create an account, or
contact us:

- **Contact details** — name, phone number (including WhatsApp), email address.
- **Order information** — items ordered, transaction amounts (in ${currency}),
  fulfilment preferences.
- **Device & session data** — IP address, browser type, timestamps.
- **Payment data** — payment method type and last-four digits (full card numbers
  are processed by our payment provider and are never stored by us).

## 3. How we use your information

We use your information to:

- Process and fulfil your orders.
- Send order status updates via WhatsApp and/or email.
- Manage your loyalty and reward account (if applicable).
- Improve our menu, operations, and service quality.
- Comply with applicable law (tax records, consumer protection).

## 4. Sub-processors and third parties

We share data with the following trusted service providers:

| Provider | Purpose | Location |
|---|---|---|
| **BeepBite / Exolution Technologies** | POS platform, data storage | South Africa / Fly.io (EU & US) |
| **Cloudflare R2** | Media & file storage | Global CDN |
| **Paystack** | Card payment processing (ZA) | South Africa |
| **Stripe** | Card payment processing (intl.) | US / EU |
| **Resend / SendGrid** | Transactional email | US |
| **Meta (WhatsApp Business API)** | Order & notification messaging | US |
| **Anthropic** | AI-assisted menu suggestions | US |
| **OpenAI** | AI-assisted features | US |
| **Google** | Authentication (Google Sign-in) | US |

We do not sell your personal information to third parties.

## 5. Data retention

Order and transaction data is retained for 7 years to meet tax and legal
requirements.  Account data is retained until you request deletion.
Audit logs are retained for 90 days and then automatically purged.

## 6. Your rights

Depending on your jurisdiction you may have the right to:

- Access the personal data we hold about you.
- Request correction or deletion of your data.
- Object to or restrict processing.
- Lodge a complaint with your local data protection authority.

To exercise these rights, contact us at **${contactEmail}**.

## 7. Cookies and local storage

Our web application uses browser **local storage** (not third-party cookies) to
maintain your session, cart, and consent preferences.  We do not use cross-site
tracking cookies.  See our cookie consent banner for granular controls.

## 8. Security

We use industry-standard encryption (TLS 1.2+) for all data in transit and
AES-256 encryption for sensitive data at rest.  Access to production data is
restricted to authorised personnel and logged.

## 9. Changes to this policy

We may update this policy from time to time.  When we do, we will update the
effective date above.  Continued use of our services after a change constitutes
your acceptance of the updated policy.

## 10. Contact

Questions about this policy?  Email us at **${contactEmail}** or write to:

> ${legalName}
> ${address}
> ${country}
`;
}
