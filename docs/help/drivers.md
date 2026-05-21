# Drivers and Delivery

BeepBite supports in-house driver management with real-time tracking, delivery zone pricing and order assignment.

---

## Adding a driver

1. Go to **Drivers → Add driver**.
2. Enter the driver's **name** and **phone number**.
3. Optionally set a **vehicle type** and **license plate**.
4. Save.

## Assigning orders to drivers

1. When an order is placed with type **delivery**, it appears in the **Drivers** panel.
2. Tap **Assign driver** and select the driver.
3. The driver receives a notification (if WhatsApp integration is configured).
4. The order status updates to *out for delivery* once the driver picks up.

## Real-time tracking

Drivers can share their location via the driver app (mobile web link sent via WhatsApp or SMS). The location is updated every 30 seconds and shown on the dashboard map.

Customers can track their order at the tracking URL included in the order confirmation.

## Delivery zones

1. Go to **Settings → Location → Delivery zones → Add zone**.
2. Draw the zone on the map or enter a radius.
3. Set the delivery fee for that zone.

When a customer enters their address at checkout, the system matches it to a zone and applies the fee automatically.

## Driver invite

To invite a driver to access the driver mobile interface:

1. Go to **Drivers → Invite driver**.
2. Enter their phone number.
3. They receive a link to the driver interface where they can view assigned orders and update status.

## Delivery order lifecycle

| Status | Description |
|---|---|
| **Pending** | Order placed, driver not yet assigned |
| **Assigned** | Driver assigned, preparing for pickup |
| **Out for delivery** | Driver picked up order |
| **Delivered** | Order confirmed delivered |
| **Failed delivery** | Delivery attempt failed |
