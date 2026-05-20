# Paystack Setup Instructions

Follow these steps to connect your Paystack account to BeepBite.

## Step 1 — Get your API keys

1. Log in to your [Paystack Dashboard](https://dashboard.paystack.com/#/settings/developer).
2. Navigate to **Settings → Developer**.
3. Copy your **Secret Key** (starts with `sk_live_` for production or `sk_test_` for testing).
4. Copy your **Public Key** (starts with `pk_live_` or `pk_test_`).
5. Paste both keys into the form above and click **Save**.

## Step 2 — Register your webhook URL

After saving your keys, BeepBite will display a unique webhook URL for your store. To register it:

1. In the Paystack Dashboard, go to **Settings → API Keys & Webhooks**.
2. Scroll to the **Webhook URL** field.
3. Paste your BeepBite webhook URL.
4. Click **Update**.

## Step 3 — Subscribe to the required events

Paystack sends event notifications for every transaction. BeepBite requires these events:

| Event | Purpose |
|-------|---------|
| `charge.success` | Marks an order as paid when a customer completes payment |
| `charge.failed` | Notifies BeepBite of a failed payment attempt |
| `transfer.success` | Confirms outbound payouts to your bank account |
| `transfer.failed` | Alerts on a failed payout |
| `transfer.reversed` | Records reversed payouts |

> **Note:** Paystack sends all events to the single webhook URL by default — no per-event subscription is needed. However, verify in your dashboard that the webhook URL is saved and test it using the **Send test webhook** button.

## Step 4 — Test the connection

Once your keys and webhook URL are registered, click **Test connection** on this page to confirm BeepBite can reach Paystack successfully.
