# API & Webhooks

BeepBite exposes a REST API for integrations. All endpoints require a Bearer token (JWT) in the `Authorization` header unless otherwise noted.

---

## Base URL

```
https://api.beepbite.com
```

For local development the default is `http://localhost:8080`.

## Authentication

```http
Authorization: Bearer <access_token>
```

Obtain a token via `POST /auth/signin` with `email` and `password`. Tokens expire after 1 hour; refresh with `POST /auth/refresh`.

## API Keys

For server-to-server integrations, create a long-lived API key:

1. Go to **Settings → API Keys → Create key**.
2. Choose scopes (e.g. `orders:read`, `menu:write`).
3. Copy the key — it is shown **once only**.

Send API keys in the `Authorization` header as `Bearer <api_key>`.

## Common endpoints

| Method | Path | Description |
|---|---|---|
| `GET` | `/orders` | List orders (filter by location, status, date) |
| `POST` | `/orders` | Create an order |
| `GET` | `/menu/items` | List menu items |
| `POST` | `/menu/items` | Create a menu item |
| `GET` | `/locations` | List locations for the org |
| `GET` | `/reports/summary` | Revenue summary |
| `GET` | `/onboarding/progress` | Wizard progress |
| `PUT` | `/onboarding/progress` | Save wizard progress |
| `GET` | `/onboarding/status` | Live completion status |

## Webhooks

Register a webhook to receive real-time event notifications:

1. Go to **Settings → Webhooks → Add endpoint**.
2. Enter your HTTPS URL and select events.
3. Each delivery includes an `X-BeepBite-Signature` HMAC-SHA256 header for verification.

### Webhook events

| Event | Trigger |
|---|---|
| `order.created` | New order placed |
| `order.completed` | Order marked completed |
| `order.refunded` | Refund processed |
| `payment.succeeded` | Payment confirmed |
| `payment.failed` | Payment declined |

## Rate limits

- **Authenticated requests**: 1 000 req/min per token.
- **API key requests**: 5 000 req/min per key.
- `429 Too Many Requests` is returned when exceeded; retry after the `Retry-After` header value.

## Error responses

All errors follow the shape `{ "error": "message" }`. HTTP status codes follow standard REST conventions (400 bad request, 401 unauthenticated, 403 forbidden, 404 not found, 500 server error).
