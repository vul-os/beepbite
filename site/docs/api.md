# API Documentation

BeepBite provides a RESTful API for integrating with external systems, building custom applications, and automating workflows.

## Base URL

```
Production: https://api.beepbite.com/v1
Staging: https://staging-api.beepbite.com/v1
```

## Authentication

### API Key Authentication

All API requests require authentication using an API key in the request header:

```http
Authorization: Bearer YOUR_API_KEY
Content-Type: application/json
```

### Getting Your API Key

1. Log in to your BeepBite dashboard
2. Navigate to Settings > API Access
3. Generate or retrieve your API key
4. Store securely and never expose in client-side code

### Rate Limiting

- **Starter Plan**: 1,000 requests/hour
- **Professional Plan**: 10,000 requests/hour  
- **Enterprise Plan**: 100,000 requests/hour

Rate limit headers included in responses:
```http
X-RateLimit-Limit: 1000
X-RateLimit-Remaining: 999
X-RateLimit-Reset: 1640995200
```

## Orders API

### Get Orders

Retrieve orders with filtering and pagination.

```http
GET /orders
```

**Query Parameters:**

| Parameter | Type | Description | Default |
|-----------|------|-------------|---------|
| `status` | string | Filter by order status | all |
| `date_from` | string | Start date (YYYY-MM-DD) | today |
| `date_to` | string | End date (YYYY-MM-DD) | today |
| `limit` | integer | Number of orders per page (max 100) | 20 |
| `offset` | integer | Number of orders to skip | 0 |
| `customer_id` | string | Filter by customer ID | - |
| `payment_status` | string | Filter by payment status | all |

**Example Request:**

```bash
curl -X GET "https://api.beepbite.com/v1/orders?status=pending&limit=10" \
  -H "Authorization: Bearer YOUR_API_KEY"
```

**Example Response:**

```json
{
  "success": true,
  "data": {
    "orders": [
      {
        "id": "ord_abc123",
        "customer": {
          "id": "cust_xyz789",
          "name": "John Doe",
          "phone": "+1234567890",
          "email": "john@example.com"
        },
        "items": [
          {
            "id": "item_001",
            "name": "Margherita Pizza",
            "quantity": 2,
            "price": 15.99,
            "modifications": ["Extra cheese", "No olives"]
          }
        ],
        "status": "pending",
        "total_amount": 31.98,
        "payment_status": "paid",
        "payment_method": "card",
        "created_at": "2024-01-15T14:30:00Z",
        "estimated_ready_time": "2024-01-15T15:00:00Z",
        "special_instructions": "Please ring doorbell twice",
        "delivery_type": "delivery",
        "delivery_address": {
          "street": "123 Main St",
          "city": "New York",
          "state": "NY",
          "zip": "10001"
        }
      }
    ],
    "total_count": 156,
    "has_more": true
  }
}
```

### Get Single Order

```http
GET /orders/{order_id}
```

**Example Request:**

```bash
curl -X GET "https://api.beepbite.com/v1/orders/ord_abc123" \
  -H "Authorization: Bearer YOUR_API_KEY"
```

### Update Order Status

```http
PATCH /orders/{order_id}/status
```

**Request Body:**

```json
{
  "status": "preparing",
  "estimated_ready_time": "2024-01-15T15:15:00Z",
  "notes": "Starting preparation now"
}
```

**Available Statuses:**
- `pending` - Order received, awaiting confirmation
- `confirmed` - Order accepted and queued
- `preparing` - Order being prepared
- `almost_ready` - Order nearly complete
- `ready` - Order ready for pickup/delivery
- `completed` - Order successfully delivered
- `cancelled` - Order cancelled

### Create Order

```http
POST /orders
```

**Request Body:**

```json
{
  "customer": {
    "name": "Jane Smith",
    "phone": "+1987654321",
    "email": "jane@example.com"
  },
  "items": [
    {
      "menu_item_id": "menu_001",
      "quantity": 1,
      "modifications": ["Medium spice level"]
    }
  ],
  "delivery_type": "pickup",
  "payment_method": "cash",
  "special_instructions": "Call when ready"
}
```

## Customers API

### Get Customers

```http
GET /customers
```

**Query Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `search` | string | Search by name, phone, or email |
| `limit` | integer | Results per page (max 100) |
| `offset` | integer | Number to skip |

### Create Customer

```http
POST /customers
```

**Request Body:**

```json
{
  "name": "Alice Johnson",
  "phone": "+1555123456",
  "email": "alice@example.com",
  "address": {
    "street": "456 Oak Ave",
    "city": "Boston",
    "state": "MA",
    "zip": "02101"
  },
  "preferences": {
    "dietary_restrictions": ["vegetarian"],
    "preferred_contact": "sms"
  }
}
```

### Update Customer

```http
PUT /customers/{customer_id}
```

## Menu API

### Get Menu Items

```http
GET /menu
```

**Query Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `category` | string | Filter by category |
| `available` | boolean | Filter by availability |
| `search` | string | Search by name or description |

**Example Response:**

```json
{
  "success": true,
  "data": {
    "categories": [
      {
        "id": "cat_pizza",
        "name": "Pizzas",
        "items": [
          {
            "id": "menu_001",
            "name": "Margherita Pizza",
            "description": "Fresh tomatoes, mozzarella, basil",
            "price": 15.99,
            "available": true,
            "prep_time_minutes": 20,
            "allergens": ["gluten", "dairy"],
            "image_url": "https://cdn.beepbite.com/pizza1.jpg"
          }
        ]
      }
    ]
  }
}
```

### Update Menu Item

```http
PUT /menu/{item_id}
```

**Request Body:**

```json
{
  "name": "Margherita Pizza",
  "price": 16.99,
  "available": true,
  "prep_time_minutes": 18
}
```

## Analytics API

### Get Order Analytics

```http
GET /analytics/orders
```

**Query Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `period` | string | `day`, `week`, `month`, `year` |
| `date_from` | string | Start date |
| `date_to` | string | End date |
| `group_by` | string | `hour`, `day`, `week`, `month` |

**Example Response:**

```json
{
  "success": true,
  "data": {
    "summary": {
      "total_orders": 1250,
      "total_revenue": 18750.50,
      "average_order_value": 15.00,
      "average_prep_time": "18 minutes"
    },
    "trends": [
      {
        "date": "2024-01-15",
        "orders": 45,
        "revenue": 675.50
      }
    ]
  }
}
```

### Get Customer Analytics

```http
GET /analytics/customers
```

### Get Revenue Analytics

```http
GET /analytics/revenue
```

## Reviews API

### Get Reviews

```http
GET /reviews
```

**Query Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `rating` | integer | Filter by star rating (1-5) |
| `date_from` | string | Start date |
| `date_to` | string | End date |
| `responded` | boolean | Filter by response status |

### Respond to Review

```http
POST /reviews/{review_id}/response
```

**Request Body:**

```json
{
  "message": "Thank you for your feedback! We're glad you enjoyed your meal.",
  "public": true
}
```

## Notifications API

### Send Custom Notification

```http
POST /notifications/send
```

**Request Body:**

```json
{
  "type": "whatsapp",
  "recipient": "+1234567890",
  "message": "Your order is ready for pickup!",
  "template": "order_ready",
  "variables": {
    "order_number": "ORD123",
    "customer_name": "John"
  }
}
```

### Get Notification Templates

```http
GET /notifications/templates
```

## Webhooks

BeepBite can send real-time notifications to your endpoints when events occur.

### Setting Up Webhooks

1. Configure webhook URL in Settings > API > Webhooks
2. Select events to subscribe to
3. Verify endpoint with test payload

### Webhook Events

**Order Events:**
- `order.created`
- `order.updated`
- `order.completed`
- `order.cancelled`

**Customer Events:**
- `customer.created`
- `customer.updated`

**Review Events:**
- `review.created`
- `review.updated`

### Webhook Payload Example

```json
{
  "event": "order.created",
  "timestamp": "2024-01-15T14:30:00Z",
  "data": {
    "order": {
      "id": "ord_abc123",
      "status": "pending",
      "customer": {
        "name": "John Doe",
        "phone": "+1234567890"
      },
      "total_amount": 31.98
    }
  },
  "restaurant_id": "rest_xyz789"
}
```

### Webhook Security

Verify webhook authenticity using the signature header:

```python
import hmac
import hashlib

def verify_webhook(payload, signature, secret):
    expected = hmac.new(
        secret.encode('utf-8'),
        payload.encode('utf-8'),
        hashlib.sha256
    ).hexdigest()
    return hmac.compare_digest(f"sha256={expected}", signature)
```

## Error Handling

### HTTP Status Codes

- `200` - Success
- `201` - Created
- `400` - Bad Request
- `401` - Unauthorized
- `403` - Forbidden
- `404` - Not Found
- `422` - Validation Error
- `429` - Rate Limited
- `500` - Internal Server Error

### Error Response Format

```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Invalid request parameters",
    "details": {
      "field": "email",
      "issue": "Invalid email format"
    }
  }
}
```

### Common Error Codes

- `INVALID_API_KEY` - API key missing or invalid
- `RATE_LIMITED` - Too many requests
- `VALIDATION_ERROR` - Invalid request data
- `RESOURCE_NOT_FOUND` - Requested resource doesn't exist
- `PERMISSION_DENIED` - Insufficient permissions

## SDKs and Libraries

### JavaScript/Node.js

```bash
npm install @beepbite/api-client
```

```javascript
const BeepBite = require('@beepbite/api-client');

const client = new BeepBite({
  apiKey: 'your-api-key',
  environment: 'production' // or 'staging'
});

// Get orders
const orders = await client.orders.list({
  status: 'pending',
  limit: 10
});
```

### Python

```bash
pip install beepbite-python
```

```python
from beepbite import BeepBiteClient

client = BeepBiteClient(api_key='your-api-key')

# Get orders
orders = client.orders.list(status='pending', limit=10)
```

### PHP

```bash
composer require beepbite/php-sdk
```

```php
use BeepBite\Client;

$client = new Client('your-api-key');

// Get orders
$orders = $client->orders()->list([
    'status' => 'pending',
    'limit' => 10
]);
```

## Testing

### Sandbox Environment

Use the staging environment for testing:

```
https://staging-api.beepbite.com/v1
```

### Test Data

- Test API keys are available in staging
- Sample data is pre-populated
- No charges for staging requests

### Postman Collection

Download our Postman collection for easy API testing:
[BeepBite API Collection](https://api.beepbite.com/postman/collection.json)

## Support

- **API Documentation**: [api.beepbite.com](https://api.beepbite.com)
- **Status Page**: [status.beepbite.com](https://status.beepbite.com)
- **Developer Support**: developers@beepbite.com
- **Community Forum**: [community.beepbite.com](https://community.beepbite.com)

---

For more examples and detailed integration guides, visit our [Developer Portal](https://developers.beepbite.com). 