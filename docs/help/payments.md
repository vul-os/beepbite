# Payments

**BeepBite records tenders; it does not process cards.**

There is no payment gateway, no merchant account and no integration to connect.
The shop already has a card machine on the counter, a bank account that receives
EFTs, and a cash drawer. BeepBite's job is to record which of those the customer
used, so the drawer reconciles and the reports are true.

Consequences worth stating plainly: no card data ever reaches BeepBite, so there
is no PCI scope, and nobody is holding your money in transit.

---

## Tender types

| Code | Name | What it means |
|---|---|---|
| `cash` | Cash | Notes and coins into the drawer. |
| `card` | Card Machine | Swiped on **your own** card machine. BeepBite records the amount and your slip number; it does not talk to your acquirer. |
| `transfer` | Bank Transfer | EFT or instant transfer. Capture the reference so you can match it on your bank statement. |
| `voucher` | Voucher | Gift card, meal voucher or comp instrument. |
| `cash_on_delivery` | Cash on Delivery | Collected at the door by the driver. |
| `card_on_delivery` | Card on Delivery | Collected at the door on a portable machine. |

The on-delivery variants are deliberately distinct codes: that money is not in
the till, so drawer reconciliation must not expect it there.

## Taking a payment

1. On the POS payment screen, choose the tender.
2. Enter the amount. For cash, enter the amount tendered — change due is
   calculated for you.
3. For card, transfer and voucher, capture the reference (slip number, EFT
   reference, voucher serial) so you can reconcile later.
4. Split tender is supported: record several legs against one order, and they
   sum to the total.

## On-delivery / COD

Create the order as a delivery. It sits unpaid until the driver collects, then
**Mark paid on delivery** records `cash_on_delivery` or `card_on_delivery`.

## Cash and the drawer

A cash tender is automatically linked to the drawer session that is open at that
location. At close, expected cash is:

```
opening float
  + cash sales linked to the session
  + net drawer movements (paid in / paid out / drops / pickups)
```

Declared minus expected is the over/short figure. If no drawer session is open
the sale is still recorded — it just is not attributed to a session.

## Reconciliation

**Reports → Cash reconciliation** gives a per-session breakdown of cash versus
every other tender.

**Reports → Revenue by payment method** gives totals by tender over any date
range, so you can match the card rows against your card machine's own settlement
report.

## Refunds

1. Go to **Orders → [order] → Refund**.
2. Select items to refund, or enter a custom amount.
3. BeepBite records the refund against the original tender. Actually returning
   the money is a physical act: open the drawer, or reverse on your card
   machine. BeepBite does not move money.

## Adding a real gateway later

The backend defines a `PaymentProvider` seam in `backend/internal/payments`
(`Charge` / `Refund` / `GetStatus`) with exactly one implementation, manual
tender. A self-hoster who wants online payments can add a bring-your-own-key
adapter behind that interface without touching the POS.

Note the deliberate absence of any webhook entry point. A counter charge is
synchronous, and `GetStatus` polling is outbound-only, so it works behind CGNAT
with no port forwarding, static IP, DNS or any server operated by anyone else.
