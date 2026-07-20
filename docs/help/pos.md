# Point of Sale (POS)

The POS is the primary order-taking interface. It supports dine-in, takeaway and delivery orders, cash drawers, split payments and manager overrides.

---

## Opening the POS

1. Navigate to **POS** in the sidebar (or `/pos`).
2. Select your location from the dropdown.
3. If cash-drawer management is enabled, open a cash-drawer session first.

## Taking an order

1. Select items from the menu grid. Use the category tabs to filter.
2. Tap an item to add it to the cart. Tap again to increase quantity, or use the `+`/`−` controls.
3. Variations and modifiers (e.g. size, extras) are presented automatically.
4. Set the **table**, **covers** or **order type** (dine-in / takeaway / delivery) if relevant.
5. Tap **Charge** to proceed to payment.

## Payment screen

- **Cash**: enter the amount tendered; the system calculates change.
- **Card machine**: run the card on your own machine, then record the amount and slip number here.
- **Transfer / voucher**: record the amount and the reference.
- **Split payment**: tap **Split** to divide the bill across multiple tenders.
- **On delivery**: marks the order as pending payment.

## Courses & KDS

Items can be assigned to courses (starter, main, dessert). The KDS fan-out service sends each course to the appropriate kitchen station when fired.

## Adjustments & discounts

- **Discount**: tap the discount button in cart view, choose a percentage or fixed amount.
- **Void item**: requires the `can_void` capability or a manager PIN override.
- **Refund**: go to **Orders → [order] → Refund**. Partial refunds are supported.

## Cash drawer

- **Open session**: enter float amount at start of shift.
- **Close session**: declare cash, system calculates over/short.
- **Cash out**: log a mid-session cash removal.
- **Dual-drawer**: two drawers can be open simultaneously per location.

## Receipt

After payment, a receipt can be printed, emailed or sent via WhatsApp. Receipts include a QR code linking to the digital receipt.
