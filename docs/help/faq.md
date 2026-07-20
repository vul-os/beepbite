# Frequently Asked Questions

---

## General

**Q: What is BeepBite?**
BeepBite is a cloud POS (point-of-sale) system for restaurants, cafes and delivery businesses. It includes a POS, kitchen display (KDS), menu management, staff management, delivery tracking and payments.

**Q: Can I use BeepBite on any device?**
Yes. BeepBite runs in any modern browser (Chrome, Firefox, Safari, Edge). No app installation is required. The POS and KDS are optimised for tablets.

**Q: Can I run multiple locations?**
Yes. You can add multiple locations under one organisation. Each location has its own menu, staff, cash drawer and payment settings.

---

## Onboarding

**Q: What is the onboarding wizard?**
The wizard (at `/onboard`) guides you through six setup steps: email verification, adding a location, building a menu, inviting staff, connecting payments and taking a test order. Progress is saved so you can resume across sessions.

**Q: Do I need to complete all steps before taking orders?**
You need at least one location and one active menu item. Payment setup is recommended but you can start with cash orders immediately.

**Q: How do I skip the onboarding checklist on the dashboard?**
The checklist is shown until you have at least one location. It disappears automatically once a location is added.

---

## POS & Orders

**Q: How do I void an item?**
Tap the item in the cart and select **Void**. You need the `can_void` capability or a manager PIN override.

**Q: Can I split a bill?**
Yes. On the payment screen, tap **Split** to divide the total across multiple payment methods or customers.

**Q: How do I process a refund?**
Go to **Orders → [order] → Refund**. Select items or enter a custom amount. Card refunds are processed via the original payment provider.

**Q: What happens if the internet goes down?**
The POS requires an internet connection for payment processing. Cash orders can be recorded offline if the app is already loaded; sync occurs when connectivity is restored.

---

## Menu

**Q: How many items can I add?**
There is no hard limit on items, categories or variations.

**Q: Can I import my existing menu?**
Use the **AI menu assistant** (Menu → AI import) to generate a menu from a description, or contact support for a bulk import.

**Q: Can I schedule items for certain times?**
Yes. Use **Menu → Schedules** to restrict items or categories to specific days and time windows.

---

## Payments

**Q: Which payment providers are supported?**
None, by design. BeepBite records tenders — cash, your own card machine, bank
transfer, voucher, and the two on-delivery variants — and never processes a
card. There is no gateway to connect and no merchant account to open.

**Q: Is my customer's card data stored?**
No. It never reaches BeepBite at all. The card is run on your own machine; all
BeepBite stores is the amount and whatever reference you type in. That is why
there is no PCI scope.

**Q: Can I add online card payments?**
Not out of the box. The backend defines a `PaymentProvider` seam
(`Charge` / `Refund` / `GetStatus`) so a self-hoster can write a
bring-your-own-key adapter, but no such adapter ships.

---

## Staff & Security

**Q: What is the difference between a staff PIN and an organisation member?**
A staff PIN is used on the POS only. An organisation member has dashboard access (invited by email) and can manage settings, reports and the menu.

**Q: Can I limit what staff can do?**
Yes. Assign capabilities (e.g. `can_pos`, `can_void`, `can_refund`) per staff member. A manager override PIN can temporarily grant extra capabilities for a single action.

**Q: How do I reset a staff PIN?**
Go to **Staff → [staff member] → Edit → Change PIN**.

---

## Technical

**Q: Where can I find the API documentation?**
See [api.md](./api.md) for endpoint reference and webhook documentation.

**Q: How do I report a bug?**
Email support@beepbite.com or open a ticket from the Help menu in the dashboard.
