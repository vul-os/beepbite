# Getting Started with BeepBite

BeepBite is a cloud point-of-sale (POS) system for restaurants, cafes and delivery services. This guide walks you through the six steps to launch your first store.

---

## 1. Verify your email

After signing up you will receive a verification email. Click the link in it before proceeding. You will not be able to receive order notifications until your email is verified.

## 2. Create your first location

A **location** is a physical store, kitchen or service point.

1. Go to **Settings → Locations → Add location**.
2. Enter a store name, URL slug (e.g. `my-cafe`) and city.
3. Save. Your location will appear in the sidebar.

You can add more locations later under the same organisation.

## 3. Build your menu

Add at least 5 active items before taking orders.

1. Go to **Menu → Categories** and create a category (e.g. *Mains*, *Drinks*).
2. Add items with a name, price and optional image.
3. Toggle items **active** to make them visible on the POS.

See [menu.md](./menu.md) for full menu management documentation.

## 4. Invite your team

Add staff so they can take orders or manage the kitchen.

1. Go to **Staff → Add staff member**.
2. Enter a name and a 4-digit PIN.
3. For delivery drivers go to **Drivers → Add driver**.

See [staff.md](./staff.md) and [drivers.md](./drivers.md) for details.

## 5. Check your tender types

There is nothing to connect. BeepBite records how the customer paid; it does not
process cards. Cash, your own card machine, bank transfer, vouchers and the
on-delivery variants all work out of the box.

See [payments.md](./payments.md).

## 6. Take your first order

1. Open the **POS** from the sidebar.
2. Select items and add them to the cart.
3. Choose a payment method and complete the sale.
4. The KDS (kitchen display) will show the order automatically.

---

## Onboarding wizard

The **Setup wizard** at `/onboard` tracks your progress through these six steps. It remembers where you left off so you can resume across sessions. Once all steps are complete the wizard is accessible from Settings but will no longer appear as a blocker.

---

## Next steps

| Guide | What it covers |
|---|---|
| [POS](./pos.md) | Taking orders, cash drawer, refunds |
| [KDS](./kds.md) | Kitchen display screens, stations |
| [Menu](./menu.md) | Categories, modifiers, courses |
| [Payments](./payments.md) | Providers, fees, reconciliation |
| [Staff](./staff.md) | Roles, PINs, payroll |
| [Drivers](./drivers.md) | Delivery assignments, tracking |
| [API](./api.md) | Webhooks, API keys |
| [FAQ](./faq.md) | Common questions |
