-- SIMPLIFIED WHATSAPP-BASED DELIVERY SYSTEM
-- Complete system in one script with minimal tables

-- ======================
-- FOUNDATION TABLES
-- ======================


-- Create profiles table
CREATE TABLE profiles (
    id uuid references auth.users on delete cascade not null primary key,
    updated_at timestamp with time zone,
    username text unique,
    full_name text,
    email text unique,
    avatar_url text,
    website text,
    constraint username_length check (char_length(username) >= 3)
);
ALTER TABLE profiles DISABLE ROW LEVEL SECURITY;

-- Create organizations table (parent entity - minimal)
CREATE TABLE organizations (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    name text NOT NULL,
    is_active boolean DEFAULT true,
    created_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Create locations table (branches/stores) - now with direct organization reference
CREATE TABLE locations (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    organization_id uuid REFERENCES organizations(id) ON DELETE CASCADE NOT NULL,
    name text NOT NULL, -- e.g., "Mario's Pizza - Sandton", "Mario's Pizza - Rosebank"
    description text,
    whatsapp_number text,
    address text,
    latitude decimal(10, 7),
    longitude decimal(10, 7),
    delivery_fee decimal(10,2) DEFAULT 25.00,
    free_delivery_threshold decimal(10,2) DEFAULT 150.00,
    max_delivery_distance_km decimal(5,2) DEFAULT 10.0,
    estimated_prep_time integer DEFAULT 30, -- minutes
    is_active boolean DEFAULT true,
    accepts_delivery boolean DEFAULT true,
    accepts_pickup boolean DEFAULT true,
    created_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Create organization_members table to link profiles to organizations
CREATE TABLE IF NOT EXISTS organization_members (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    organization_id uuid REFERENCES organizations(id) ON DELETE CASCADE NOT NULL,
    profile_id uuid REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
    role text NOT NULL CHECK (role IN ('owner', 'manager', 'staff', 'admin')),
    created_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL,
    UNIQUE(organization_id, profile_id)
);

-- Create organization_invites table for invitation system
CREATE TABLE IF NOT EXISTS organization_invites (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    organization_id uuid REFERENCES organizations(id) ON DELETE CASCADE NOT NULL,
    email text NOT NULL,
    role text NOT NULL CHECK (role IN ('owner', 'manager', 'staff', 'admin')),
    status text DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected')),
    invited_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
    created_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Create staff table
CREATE TABLE staff (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    location_id uuid REFERENCES locations(id) ON DELETE CASCADE NOT NULL,
    employee_id text UNIQUE, -- Optional employee ID/code
    first_name text NOT NULL,
    last_name text NOT NULL,
    email text UNIQUE NOT NULL,
    phone text,
    password_hash text NOT NULL, -- Hashed password (bcrypt, argon2, etc.)
    role text NOT NULL CHECK (role IN ('owner', 'manager', 'cashier', 'kitchen', 'admin')),
    
    -- Status and permissions
    is_active boolean DEFAULT true,
    
    -- Login tracking
    last_login_at timestamptz,
    failed_login_attempts integer DEFAULT 0,
    locked_until timestamptz,
    
    -- Employment details
    hire_date date,
    notes text,
    
    created_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL,
    
    -- Ensure unique password per location
    UNIQUE(location_id, password_hash)
);

-- Staff time and attendance tracking
CREATE TABLE staff_time_entries (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    staff_id uuid REFERENCES staff(id) ON DELETE CASCADE NOT NULL,
    location_id uuid REFERENCES locations(id) ON DELETE CASCADE NOT NULL,
    entry_type text NOT NULL CHECK (entry_type IN ('clock_in', 'clock_out', 'break_start', 'break_end')),
    timestamp timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL,
    notes text,
    created_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Staff scheduled shifts
CREATE TABLE staff_shifts (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    staff_id uuid REFERENCES staff(id) ON DELETE CASCADE NOT NULL,
    location_id uuid REFERENCES locations(id) ON DELETE CASCADE NOT NULL,
    shift_date date NOT NULL,
    scheduled_start time NOT NULL,
    scheduled_end time NOT NULL,
    actual_start time,
    actual_end time,
    total_hours decimal(4,2),
    break_duration_minutes integer DEFAULT 0,
    status text DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'completed', 'no_show', 'partial')),
    notes text,
    created_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL,
    UNIQUE(staff_id, shift_date)
);

-- Staff attendance summary (daily)
CREATE TABLE staff_attendance_summary (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    staff_id uuid REFERENCES staff(id) ON DELETE CASCADE NOT NULL,
    location_id uuid REFERENCES locations(id) ON DELETE CASCADE NOT NULL,
    work_date date NOT NULL,
    clock_in_time timestamptz,
    clock_out_time timestamptz,
    total_hours decimal(4,2) DEFAULT 0,
    break_minutes integer DEFAULT 0,
    overtime_hours decimal(4,2) DEFAULT 0,
    is_present boolean DEFAULT false,
    is_late boolean DEFAULT false,
    minutes_late integer DEFAULT 0,
    created_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL,
    UNIQUE(staff_id, work_date)
);

-- ======================
-- CUSTOMERS AND ADDRESSES
-- ======================

-- Customers table (personal details)
CREATE TABLE customers (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    whatsapp_number text NOT NULL UNIQUE,
    first_name text,
    last_name text,
    email text,
    
    -- Preferences
    notes text,
    is_blocked boolean DEFAULT false,
    last_order_at timestamptz,
    total_orders integer DEFAULT 0,
    total_spent decimal(10,2) DEFAULT 0,
    
    -- Loyalty program
    loyalty_points integer DEFAULT 0,
    loyalty_tier text DEFAULT 'bronze' CHECK (loyalty_tier IN ('bronze', 'silver', 'gold', 'platinum')),
    points_earned_total integer DEFAULT 0,
    points_redeemed_total integer DEFAULT 0,
    
    created_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Customer addresses table
CREATE TABLE customer_addresses (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    customer_id uuid REFERENCES customers(id) ON DELETE CASCADE NOT NULL,
    address_line_1 text,
    address_line_2 text,
    city text,
    postal_code text,
    latitude decimal(10, 7),
    longitude decimal(10, 7),
    delivery_instructions text,
    is_default boolean DEFAULT false NOT NULL,
    created_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Ensure only one default address per customer
CREATE UNIQUE INDEX one_default_address_per_customer
ON customer_addresses (customer_id)
WHERE is_default;

-- ======================
-- SIMPLIFIED PRODUCT CATALOG
-- ======================

-- Categories with subcategory support
CREATE TABLE categories (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    location_id uuid REFERENCES locations(id) ON DELETE CASCADE NOT NULL,
    parent_id uuid REFERENCES categories(id) ON DELETE SET NULL, -- For subcategories
    name text NOT NULL,
    description text,
    sort_order integer DEFAULT 0,
    is_active boolean DEFAULT true,
    created_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL,
    UNIQUE(location_id, name)
);

-- Items/Products
CREATE TABLE items (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    location_id uuid REFERENCES locations(id) ON DELETE CASCADE NOT NULL,
    category_id uuid REFERENCES categories(id) ON DELETE CASCADE NOT NULL,
    name text NOT NULL,
    description text,
    price decimal(10,2) NOT NULL,
    cost_price decimal(10,2), -- Cost to make this item (for profit tracking)
    preparation_time integer DEFAULT 15, -- minutes
    is_active boolean DEFAULT true,
    sort_order integer DEFAULT 0,
    
    -- Basic inventory tracking
    track_inventory boolean DEFAULT false,
    current_stock integer DEFAULT 0,
    low_stock_threshold integer DEFAULT 5,
    
    created_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Simple item variations (size, options, etc.)
CREATE TABLE item_variations (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    item_id uuid REFERENCES items(id) ON DELETE CASCADE NOT NULL,
    name text NOT NULL, -- e.g., "Size", "Spice Level"
    is_required boolean DEFAULT false,
    created_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Variation options
CREATE TABLE item_variation_options (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    variation_id uuid REFERENCES item_variations(id) ON DELETE CASCADE NOT NULL,
    name text NOT NULL, -- e.g., "Large", "Medium", "Spicy"
    price_modifier decimal(10,2) DEFAULT 0,
    is_default boolean DEFAULT false,
    created_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- ======================
-- SIMPLIFIED DELIVERY DRIVERS
-- ======================

-- Delivery drivers
CREATE TABLE delivery_drivers (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    first_name text NOT NULL,
    last_name text NOT NULL,
    phone text NOT NULL UNIQUE,
    email text,
    vehicle_type text CHECK (vehicle_type IN ('bicycle', 'motorcycle', 'car', 'scooter')),
    
    -- Status
    status text DEFAULT 'offline' CHECK (status IN ('offline', 'online', 'busy')),
    is_active boolean DEFAULT true,
       
    -- Performance
    total_deliveries integer DEFAULT 0,
    average_rating decimal(3,2) DEFAULT 5.0,
    completion_rate decimal(5,2) DEFAULT 100,
    
    created_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Driver locations tracking
CREATE TABLE driver_locations (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    driver_id uuid REFERENCES delivery_drivers(id) ON DELETE CASCADE NOT NULL,
    latitude decimal(10, 7) NOT NULL,
    longitude decimal(10, 7) NOT NULL,
    is_on_delivery boolean DEFAULT false,
    created_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- ======================
-- COMPREHENSIVE ORDERS SYSTEM - RESTRUCTURED
-- ======================

-- Base orders table (minimal - for notifications and basic tracking)
CREATE TABLE orders (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    location_id uuid REFERENCES locations(id) ON DELETE CASCADE NOT NULL,
    customer_id uuid REFERENCES customers(id) ON DELETE CASCADE NOT NULL,
    delivery_driver_id uuid REFERENCES delivery_drivers(id) ON DELETE SET NULL,
    order_number text NOT NULL,
    order_type text DEFAULT 'delivery' CHECK (order_type IN ('delivery', 'pickup', 'whatsapp')),
    status text DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'preparing', 'ready', 'out_for_delivery', 'delivered', 'completed', 'cancelled')),
    created_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Create unique index for order numbers per day
CREATE UNIQUE INDEX unique_order_number_per_day_simplified 
    ON orders (location_id, order_number, date_trunc('day', created_at AT TIME ZONE 'UTC'));

-- Order details table (comprehensive details)
CREATE TABLE order_details (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    order_id uuid REFERENCES orders(id) ON DELETE CASCADE NOT NULL UNIQUE,
    
    -- Delivery details
    delivery_address text,
    delivery_latitude decimal(10, 7),
    delivery_longitude decimal(10, 7),
    delivery_distance_km decimal(5,2),
    delivery_instructions text,
    
    -- Timing
    estimated_prep_time integer, -- minutes
    estimated_delivery_time timestamptz,
    ready_at timestamptz,
    picked_up_at timestamptz,
    delivered_at timestamptz,
    
    -- Staff
    taken_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
    
    -- Notes
    notes text,
    kitchen_notes text,
    
    created_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Order financial details table
CREATE TABLE order_financial_details (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    order_id uuid REFERENCES orders(id) ON DELETE CASCADE NOT NULL UNIQUE,
    
    -- Pricing
    subtotal decimal(10,2) DEFAULT 0,
    delivery_fee decimal(10,2) DEFAULT 0,
    total_amount decimal(10,2) DEFAULT 0,
    
    -- Tax calculations (compliance)
    tax_rate decimal(5,2) DEFAULT 15.00, -- VAT percentage
    tax_amount decimal(10,2) DEFAULT 0,
    tax_inclusive boolean DEFAULT true,
    
    -- Discounts and loyalty
    discount_amount decimal(10,2) DEFAULT 0,
    loyalty_points_used integer DEFAULT 0,
    loyalty_discount_amount decimal(10,2) DEFAULT 0,
    
    -- Cost tracking
    total_cost decimal(10,2) DEFAULT 0, -- Cost of goods sold
    profit_amount decimal(10,2) DEFAULT 0, -- total_amount - total_cost - delivery_fee
    
    -- Payment
    payment_status text DEFAULT 'pending' CHECK (payment_status IN ('pending', 'paid', 'cash_on_delivery')),
    payment_method text DEFAULT 'cash',
    
    created_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Driver ratings table (separate from customer reviews)
CREATE TABLE driver_ratings (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    order_id uuid REFERENCES orders(id) ON DELETE CASCADE NOT NULL UNIQUE,
    driver_id uuid REFERENCES delivery_drivers(id) ON DELETE CASCADE NOT NULL,
    rating integer NOT NULL CHECK (rating >= 1 AND rating <= 5),
    comment text,
    rated_by uuid REFERENCES customers(id) ON DELETE SET NULL,
    created_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Order items
CREATE TABLE order_items (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    order_id uuid REFERENCES orders(id) ON DELETE CASCADE NOT NULL,
    item_id uuid REFERENCES items(id) ON DELETE CASCADE NOT NULL,
    quantity integer NOT NULL DEFAULT 1,
    unit_price decimal(10,2) NOT NULL,
    total_price decimal(10,2) NOT NULL,
    special_instructions text,
    created_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Order item variations (customer's choices)
CREATE TABLE order_item_variations (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    order_item_id uuid REFERENCES order_items(id) ON DELETE CASCADE NOT NULL,
    variation_id uuid REFERENCES item_variations(id) ON DELETE CASCADE NOT NULL,
    option_id uuid REFERENCES item_variation_options(id) ON DELETE CASCADE NOT NULL,
    price_modifier decimal(10,2) DEFAULT 0,
    created_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- ======================
-- DRIVER EARNINGS
-- ======================

-- Driver earnings per delivery
CREATE TABLE driver_earnings (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    driver_id uuid REFERENCES delivery_drivers(id) ON DELETE CASCADE NOT NULL,
    order_id uuid REFERENCES orders(id) ON DELETE CASCADE NOT NULL,
    
    -- Earnings breakdown
    base_fee decimal(10,2) DEFAULT 15.00, -- Base payment per delivery
    distance_fee decimal(10,2) DEFAULT 0, -- Extra for long distance
    tip_amount decimal(10,2) DEFAULT 0,
    total_earnings decimal(10,2) NOT NULL,
    
    -- Payment
    payment_status text DEFAULT 'pending' CHECK (payment_status IN ('pending', 'paid')),
    paid_at timestamptz,
    
    created_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- ======================
-- UNIFIED NOTIFICATIONS
-- ======================

-- Unified notifications table for email and SMS
CREATE TABLE notifications (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    recipient_email text, -- For email notifications
    recipient_phone text, -- For SMS notifications
    recipient_type text NOT NULL CHECK (recipient_type IN ('customer', 'restaurant', 'driver')),
    notification_method text NOT NULL CHECK (notification_method IN ('email', 'sms', 'both')),
    subject text, -- For emails (can be null for SMS)
    message text NOT NULL,
    notification_type text NOT NULL, -- 'order_update', 'delivery_assigned', etc.
    order_id uuid REFERENCES orders(id) ON DELETE CASCADE,
    status text DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed', 'partial')), -- partial = only one method succeeded when using 'both'
    sent_at timestamptz,
    error_message text,
    created_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- ======================
-- WHATSAPP CHAT SYSTEM
-- ======================

-- Bots table for WhatsApp business numbers
CREATE TABLE bots (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    phone_number text NOT NULL UNIQUE, -- International format (e.g., +27821234567)
    whatsapp_phone_number_id text UNIQUE, -- WhatsApp Phone Number ID from Meta
    name text, -- Optional name/description for the bot
    location_id uuid REFERENCES locations(id) ON DELETE CASCADE, -- Associate bot with specific location
    is_active boolean DEFAULT true,
    created_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Chats table for conversation sessions
CREATE TABLE chats (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    bot_id uuid REFERENCES bots(id) ON DELETE CASCADE NOT NULL,
    customer_id uuid REFERENCES customers(id) ON DELETE CASCADE NOT NULL,
    location_id uuid REFERENCES locations(id) ON DELETE CASCADE NOT NULL,
    status text DEFAULT 'active' CHECK (status IN ('active', 'closed')),
    last_message_at timestamptz,
    last_message_preview text, -- Preview of the last message
    unread_count integer DEFAULT 0,
    assigned_to uuid REFERENCES profiles(id) ON DELETE SET NULL, -- Staff member assigned to chat
    
    -- Conversation context for orders
    current_order_id uuid REFERENCES orders(id) ON DELETE SET NULL,
    conversation_state jsonb DEFAULT '{}', -- Bot conversation state
    
    created_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL,
    UNIQUE(bot_id, customer_id) -- One active chat per customer per bot
);

-- Messages table for individual WhatsApp messages
CREATE TABLE messages (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    chat_id uuid REFERENCES chats(id) ON DELETE CASCADE NOT NULL,
    whatsapp_message_id text, -- WhatsApp's unique message ID
    direction text NOT NULL CHECK (direction IN ('inbound', 'outbound')),
    message_type text DEFAULT 'text' CHECK (message_type IN ('text', 'image', 'document', 'audio', 'video', 'location', 'contact')),
    content text, -- Message text content
    media_url text, -- URL for media files
    status text DEFAULT 'sent' CHECK (status IN ('sent', 'delivered', 'read', 'failed')),
    error_message text, -- Error details if message failed
    sent_by uuid REFERENCES profiles(id) ON DELETE SET NULL, -- Staff member who sent the message (for outbound)
    delivered_at timestamptz,
    read_at timestamptz,
    created_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- ======================
-- BASIC INVENTORY TRACKING
-- ======================

-- Inventory items (raw materials/ingredients)
CREATE TABLE inventory_items (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    location_id uuid REFERENCES locations(id) ON DELETE CASCADE NOT NULL,
    name text NOT NULL,
    description text,
    unit text NOT NULL, -- kg, liters, pieces, etc.
    current_stock decimal(10,3) DEFAULT 0,
    minimum_stock decimal(10,3) DEFAULT 0,
    cost_per_unit decimal(10,2),
    created_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Stock movements (track inventory changes)
CREATE TABLE stock_movements (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    inventory_item_id uuid REFERENCES inventory_items(id) ON DELETE CASCADE NOT NULL,
    movement_type text NOT NULL CHECK (movement_type IN ('purchase', 'sale', 'waste', 'adjustment')),
    quantity decimal(10,3) NOT NULL, -- Positive for incoming, negative for outgoing
    unit_cost decimal(10,2),
    reference_id uuid, -- Could reference order_id
    notes text,
    recorded_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
    created_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Recipe ingredients (links menu items to inventory)
CREATE TABLE recipe_ingredients (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    item_id uuid REFERENCES items(id) ON DELETE CASCADE NOT NULL,
    inventory_item_id uuid REFERENCES inventory_items(id) ON DELETE CASCADE NOT NULL,
    quantity_needed decimal(10,3) NOT NULL, -- Amount needed per menu item
    created_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL,
    UNIQUE(item_id, inventory_item_id)
);

-- ======================
-- TAX CALCULATIONS & COMPLIANCE
-- ======================

-- Tax rates for different regions/products
CREATE TABLE tax_rates (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    location_id uuid REFERENCES locations(id) ON DELETE CASCADE NOT NULL,
    name text NOT NULL, -- e.g., "VAT", "Service Charge"
    rate decimal(5,2) NOT NULL, -- Percentage
    is_default boolean DEFAULT false,
    applies_to text DEFAULT 'all' CHECK (applies_to IN ('all', 'food', 'drinks', 'delivery')),
    is_active boolean DEFAULT true,
    created_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- ======================
-- REVIEWS (keeping simple)
-- ======================

CREATE TABLE reviews (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    order_id uuid REFERENCES orders(id) ON DELETE CASCADE NOT NULL,
    rating integer NOT NULL CHECK (rating >= 1 AND rating <= 10),
    comment text,
    created_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL,
    UNIQUE(order_id)
);
