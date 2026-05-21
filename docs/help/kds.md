# Kitchen Display System (KDS)

The KDS shows incoming orders to kitchen staff in real time. Each order item is routed to the correct station based on category or manual configuration.

---

## Stations

A **station** is a display assigned to a role in the kitchen (e.g. *Grill*, *Fryer*, *Expo*).

1. Go to **Settings → Kitchen → Stations → Add station**.
2. Give it a name and assign categories or item tags that route to it.
3. The KDS screen for that station shows only the items it is responsible for.

## Expo station

The **expo** station shows all items across all stations. Use it to coordinate plating and dispatch.

## Order lifecycle on the KDS

| Status | Meaning |
|---|---|
| **New** | Order received, not yet acknowledged |
| **In progress** | Staff tapped to start preparation |
| **Ready** | Item / course marked ready |
| **Served** | Marked served from expo or POS |

Completed orders are auto-archived after a configurable interval.

## Bump & recall

- **Bump**: swipe or tap the item card to mark it done.
- **Recall**: tap **Recall** to bring back a recently bumped order (default 5 minutes).

## Display groups

Items can be grouped by **course** (starter, main, dessert) so the kitchen sees them in fire order. Configure courses in Menu settings.

## Fan-out rules

The KDS fan-out job routes each `order_item` to its station based on:
1. Item-level station override.
2. Category-to-station mapping (configured in Kitchen settings).
3. Default station fallback if no mapping matches.

## Alerts

A visual and audio alert fires when a new order arrives at a station. Audio alerts can be muted per device in KDS settings.
