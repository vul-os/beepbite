# Payments

BeepBite supports multiple payment providers and cash. Payment credentials are stored per-location and enforced by row-level security.

---

## Supported providers

| Provider | Regions | Notes |
|---|---|---|
| **Paystack** | Africa (ZA, NG, GH, KE…) | Card, EFT, mobile money |
| **Stripe** | Global | Card, Apple Pay, Google Pay |
| **Yoco** | South Africa | Card present + online |
| **Zapper** | South Africa | QR code scan-to-pay |
| **Cash** | Any | No setup required |
| **On delivery** | Any | Mark as paid at delivery |

## Connecting a provider

1. Go to **Settings → Location → Payments**.
2. Select a provider and enter your API keys (public key + secret key).
3. Toggle **Active** to enable.
4. A location can have multiple active providers simultaneously.

## Cash payments

No setup required. Select **Cash** on the POS payment screen. The system records the amount tendered and change due.

## On-delivery / COD

Select **On delivery** on the POS. The order is created in a *pending payment* state. Mark it paid once the driver collects.

## Payment fees

Configure convenience or processing fees per provider under **Settings → Location → Payments → Fees**.

Fees can be:
- Fixed amount (e.g. R2.50 per transaction)
- Percentage (e.g. 2.9% of total)
- Combined fixed + percentage

## Reconciliation

Go to **Reports → Cash reconciliation** to see a per-session breakdown of cash vs card vs other methods.

The **Revenue by payment method** report (Reports → Revenue) shows totals by provider over any date range.

## Payouts

If payouts are configured, the system triggers the payout job nightly and logs the transfer. Go to **Reports → Payouts** for a history.

## Refunds

1. Go to **Orders → [order] → Refund**.
2. Select items to refund or enter a custom amount.
3. For card payments the refund is sent back to the original payment method via the provider's API.
4. For cash, the refund amount is shown for manual return.
