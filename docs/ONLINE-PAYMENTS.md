# Online payments (optional)

BeepBite records tenders; by default it does **not** process cards — the shop
has its own card machine, cash drawer, or EFT, and BeepBite is never a
facilitator (see `docs/help/payments.md`). That does not change.

But a **remote** order — placed through the public marketplace or over
WhatsApp, with no counter to pay at — has nowhere to tender in person. For that
case only, a shop can **optionally** turn on online payments: the customer pays
on a real processor's hosted page (Stripe, Paystack, Yoco, PayFast, …), and the
order is confirmed when payment clears. It is off unless you deliberately enable
it, and the in-person POS path is completely unchanged.

## How settlement works — verify-on-return, not webhooks, not polling

The hard part of taking online payment on a self-hosted box is confirming it
without the box being publicly reachable (BeepBite is deliberately outbound-only
and works behind CGNAT — no port forwarding, no static IP). BeepBite solves this
the same way it already handles everything else: **the customer's browser is the
courier.**

1. At checkout, BeepBite asks the gateway to create a hosted payment and hands
   it a **return URL** pointing back at BeepBite —
   `…/api/marketplace/pay/return?ott=<token>`. The `ott` is an HMAC-SHA256
   signed, 2-hour, order-scoped token (`internal/payments/returntoken.go`); it
   only *names* an order, it authenticates nothing, and it is unforgeable.
2. The customer pays on the processor's hosted page.
3. The processor **redirects the customer's browser** to that return URL. That
   browser hit — reaching the same host the customer already used to order — is
   the settlement event.
4. On that hit, BeepBite does **exactly one authoritative `verify`** with the
   processor (`SettleOnlinePayment`, `internal/payments/settle.go`). Only a
   confirmed-paid response moves the order to `confirmed`. Any error or
   still-pending response settles nothing — **fail closed, never paid on
   doubt.** Merely hitting the return URL without having paid does nothing.

So: **no inbound webhook, no publicly-reachable-for-the-processor requirement,
and no polling loop.** The processor never touches the box; only the customer's
browser does, and it already can.

**Backstop** for the rare "paid, then closed the tab before the redirect":
staff can hit **"recheck payment"** in the POS (`internal/handlers/pos`, one
authoritative verify on demand), and the order re-checks lazily when next
opened. There is no background poller.

### Do I ever need webhooks / a reachable instance?

No, for the flow above. If you specifically want processor **push webhooks**
(some advanced reconciliation cases), that is the one thing that needs a
publicly-reachable instance — an optional advanced path, not a requirement, and
not what this seam does.

## Enabling it

Online payments only exist in a build compiled **with the patala substrate**
(`-tags patala`, cgo — see `internal/payments/patala_gateway.go` and the
Makefile's `build-patala`). The default shipped image (`CGO_ENABLED=0`) has no
gateway code linked in at all, so the settings below do nothing there and
checkout stays on-delivery-only, byte for byte.

| Env var | Purpose |
|---|---|
| `BEEPBITE_ONLINE_PAYMENT_PROVIDER` | The one patala-fiat rail to use, e.g. `stripe`, `paystack`, `yoco`, `payfast`. Unset ⇒ on-delivery only. |
| `BEEPBITE_<PROVIDER>_*` | That rail's credentials (read by `PatalaConfigFromEnv`). |
| `BEEPBITE_API_PUBLIC_URL` | The reachable base URL the customer's browser is redirected back to. Required, or the gateway can't be used. |

A typo'd provider name fails at **startup**, not silently — a shop that meant to
take online payments should find out immediately.

## Honesty / limitations

- **BeepBite still never holds funds.** The processor custodies money in flight;
  BeepBite records the tender, exactly as with the in-person path.
- **UNVERIFIED AGAINST LIVE.** The gateway path is unit- and
  integration-tested (fail-closed verify, idempotent settlement, the signed
  return token), but has **not** been run against a real merchant sandbox. A
  live `checkout → pay → return → verify → confirm` round trip per processor is
  the top remaining verification.
- **No new tables.** Online-gateway charges reuse `order_payments` (a `pending`
  row carrying the charge token, settled to `completed`) and the existing order
  lifecycle (`pending → confirmed`). The online tender is registered as a
  `payment_methods` row of `kind='offline'` — the schema's CHECK constraint
  admits no other `kind`, and that value describes only "no other kind exists to
  pick," not that the tender settles offline. Loosening it would need a
  migration, deliberately out of scope for this seam.
- **One gateway per instance.** A deployment-wide choice; per-tenant gateways
  mean separate instances, like every other single-tenant-per-process setting.
