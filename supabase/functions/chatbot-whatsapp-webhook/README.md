# WhatsApp Chatbot - Organized Structure

This chatbot implementation has been reorganized into smaller, focused files for better maintainability and to prevent tool limitations with large files.

## Recent Updates ✅

### Global Bot System
- **Removed location dependency** from bots table
- **One bot serves all locations** - simplified architecture
- **Location context** is set when customer selects a store during ordering
- **7-day review window** instead of 24 hours
- **Cart continuation support** with deletion warnings

## Folder Structure

```
chatbot-whatsapp-webhook/
├── index.ts                          # Main webhook handler
├── README.md                         # This file
└── chatbot/
    ├── main_handler.ts              # Main message routing handler
    ├── conversation_state.ts        # Conversation state management
    ├── database_helpers.ts          # Database operations
    ├── message_formatter.ts         # Message formatting utilities
    ├── main_menu.ts                 # Main menu handling
    ├── ordering.ts                  # Complete ordering flow
    └── review_system.ts             # Review collection (existing functionality)
```

## Flow Implementation

Based on the requirements in `whatsappbot.txt`, the bot implements this flow:

### Main Menu
- **Has Cart?** Shows continue option or cart deletion warning
- **A** - Make an Order (or Make New Order if cart exists)
- **B** - View Previous Orders (routes to review system for compatibility)
- **C** - My Profile (placeholder)
- **D** - Billing (placeholder)
- **E** - Addresses (placeholder)

### Cart Management
- **[1] Continue with Plate** - Direct to checkout when cart exists
- **Cart deletion warning** when making new order with existing cart
- **View cart option** before deletion
- **Cross-location cart detection** 

### Ordering Flow (A - Make an Order)

1. **Order Type Selection**
   - Delivery or Collection choice

2. **Address Selection** (for delivery)
   - Show saved addresses
   - Option to add new address
   - Geocoding support with Mapbox

3. **Store Selection**
   - For delivery: Show nearby stores based on address
   - For collection: Search by name or location
   - **Sets location context** in chat when store selected

4. **Menu Display**
   - Show categorized menu items
   - Display cart status
   - Item selection

5. **Item Details**
   - Show item description, price, prep time
   - Handle variations/customizations
   - Add to cart

6. **Checkout**
   - View cart items
   - Show totals including delivery fees
   - Payment option selection:
     - Pay Online
     - Pay on Delivery (Card)
     - Pay on Delivery (Cash)

7. **Tip Selection**
   - 5%, 15%, 30% options
   - Custom amount
   - Skip option

8. **Email Collection** (for online payment)
   - Required for card payments
   - Validation

9. **Payment Method Selection**
   - Show saved payment methods
   - Add new card option
   - Integration with PayStack

10. **Payment Processing**
    - Handle existing payment methods
    - Generate payment links for new cards
    - Order confirmation

## Key Features

- **Global Bot System**: One bot serves all locations
- **Modular Design**: Each file handles specific functionality
- **State Management**: Conversation state tracked in database
- **Cart Management**: Full cart functionality with database persistence
- **Cart Continuation**: No lost carts, proper warnings
- **Payment Integration**: PayStack integration for online payments
- **Review System**: 7-day review window, maintains existing functionality
- **Geocoding**: Address geocoding with Mapbox
- **Smart Routing**: Falls back to email/SMS when WhatsApp unavailable

## Database Changes

### Global Bot System
- **Removed** `location_id` from `bots` table
- **Made nullable** `location_id` in `chats` table
- **Location context** set during ordering process
- **Updated indexes** to handle nullable location_id

### Tables Updated
- `bots` - No longer tied to specific locations
- `chats` - Location context optional, set during ordering
- `bot_menu_sessions` - Handles nullable location references

## Database Integration

The bot uses the existing database schema:
- `customers` - Customer information
- `customer_addresses` - Saved addresses
- `locations` - Store locations
- `items` - Menu items
- `cart_items` - Shopping cart
- `orders` - Order management
- `customer_payment_authorizations` - Saved payment methods
- `chats` - Conversation management (now global)
- `messages` - Message history

## Environment Variables Required

```
SUPABASE_URL=your_supabase_url
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
WHATSAPP_ACCESS_TOKEN=your_whatsapp_access_token
WHATSAPP_WEBHOOK_VERIFY_TOKEN=your_verify_token
MAPBOX_API_KEY=your_mapbox_key
PAYSTACK_SECRET_KEY=your_paystack_key
```

**Note:** `WHATSAPP_PHONE_NUMBER_ID` is no longer needed as an environment variable - it's now stored in the bot record and retrieved dynamically!

## Migration Required

Run the following SQL to update your database:

```sql
-- Apply the global bot system changes
\i sql/remove_bot_location_dependency.sql
```

## Next Steps

1. **Run database migration**: Apply the global bot changes
2. **Test the basic flow**: Start with main menu and cart continuation
3. **Implement missing functions**: Some helper functions need full implementation
4. **Add error handling**: Enhance error handling throughout the flow
5. **Test payment integration**: Ensure PayStack integration works correctly
6. **Add order management**: Complete order creation and tracking
7. **Implement profile/billing**: Add the remaining menu options

The structure is now much more manageable, supports cart continuation, and uses a global bot system that's much simpler to maintain. 