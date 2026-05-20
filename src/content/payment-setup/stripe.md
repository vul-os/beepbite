# Stripe Setup Instructions

Follow these steps to connect your Stripe account to BeepBite.

## Step 1 — Get your API keys

1. Log in to your [Stripe Dashboard](https://dashboard.stripe.com/apikeys).
2. Navigate to **Developers → API keys**.
3. Copy your **Secret key** (starts with `sk_live_` for production or `sk_test_` for testing).
4. Copy your **Publishable key** (starts with `pk_live_` or `pk_test_`).
5. Paste both keys into the form above and click **Save**.

> **Tip:** For testing, use the test-mode keys. Stripe test cards are listed at [stripe.com/docs/testing](https://stripe.com/docs/testing).

## Step 2 — Register your webhook endpoint

After saving your keys, BeepBite will display a unique webhook URL for your store. To register it:

1. In the Stripe Dashboard, go to **Developers → Webhooks**.
2. Click **Add endpoint**.
3. Paste your BeepBite webhook URL into the **Endpoint URL** field.
4. Under **Select events**, choose the events listed in Step 3 below.
5. Click **Add endpoint** to save.
6. Copy the **Signing secret** (starts with `whsec_`) displayed for the new endpoint.
7. Paste the signing secret into the **Webhook Secret** field in BeepBite and click **Save** again.

## Step 3 — Subscribe to the required events

Select the following events when registering the webhook endpoint:

| Event | Purpose |
|-------|---------|
| `payment_intent.succeeded` | Marks an order as paid |
| `payment_intent.payment_failed` | Notifies BeepBite of a failed payment |
| `charge.refunded` | Records customer refunds |
| `payout.paid` | Confirms payouts to your bank account |
| `payout.failed` | Alerts on failed payouts |

## Step 4 — Test the connection

Once your keys and webhook secret are registered, click **Test connection** on this page to confirm BeepBite can reach Stripe successfully. You can also use the Stripe CLI to forward events locally during development:

```bash
stripe listen --forward-to localhost:8080/webhooks/stripe/<location_id>
```
