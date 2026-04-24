-- ======================
-- COMPREHENSIVE PAYMENT SYSTEM
-- Handles customer payments, tips, Paystack integration, merchant payouts
-- ======================

-- Payment methods configuration
-- `kind` classifies how the method is collected:
--   'offline'  — cash / card-in-person / card-on-delivery. Always available.
--                Never routed through an online gateway.
--   'gateway'  — online gateway (paystack, stripe, yoco, …). Only surfaced
--                to the customer when the restaurant's location has an
--                active BYO gateway config for that provider AND the
--                organization is on a paid tier. See
--                get_available_payment_methods() (20240101000015).
CREATE TABLE payment_methods (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    code text NOT NULL UNIQUE,
    name text NOT NULL,
    kind text NOT NULL DEFAULT 'offline' CHECK (kind IN ('offline', 'gateway')),
    is_active boolean DEFAULT true,
    requires_reference boolean DEFAULT false,
    supports_tips boolean DEFAULT true,
    processing_fee_percentage decimal(5,2) DEFAULT 0,
    fixed_fee_cents integer DEFAULT 0,
    created_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL
);

INSERT INTO payment_methods (code, name, kind, requires_reference, supports_tips) VALUES
('cash',              'Cash',              'offline', false, true),
('card_in_person',    'Card in person',    'offline', false, true),
('card_on_delivery',  'Card on delivery',  'offline', false, true),
('cash_on_delivery',  'Cash on delivery',  'offline', false, true),
('eft',               'EFT',               'offline', true,  false),
('zapper',            'Zapper',            'gateway', true,  true),
('paystack',          'PayStack',          'gateway', true,  true),
('stripe',            'Stripe',            'gateway', true,  true);

-- Location-specific payment method fees
CREATE TABLE location_payment_method_fees (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    location_id uuid REFERENCES locations(id) ON DELETE CASCADE NOT NULL,
    payment_method_code text REFERENCES payment_methods(code) ON DELETE CASCADE NOT NULL,
    
    -- Fee structure per location
    processing_fee_percentage decimal(5,2) DEFAULT 0, -- What we charge merchant
    fixed_fee_cents integer DEFAULT 0, -- Fixed fee in cents
    gateway_fee_percentage decimal(5,2) DEFAULT 0, -- What gateway charges us
    gateway_fixed_fee_cents integer DEFAULT 0, -- Gateway fixed fee
    
    -- Status
    is_active boolean DEFAULT true,
    
    created_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL,
    
    UNIQUE(location_id, payment_method_code)
);

-- ======================
-- CUSTOMER PAYMENT AUTHORIZATIONS
-- ======================

-- Customer saved payment methods (authorization codes for reuse)
CREATE TABLE customer_payment_authorizations (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    customer_id uuid REFERENCES customers(id) ON DELETE CASCADE NOT NULL,
    payment_method_code text REFERENCES payment_methods(code) NOT NULL,
    
    -- Gateway info
    gateway_provider text NOT NULL, -- 'paystack', 'yoco', 'stripe', etc.
    authorization_code text NOT NULL, -- Gateway authorization token
    
    -- Card details for display (masked)
    card_last_four text,
    card_type text, -- visa, mastercard, etc.
    card_exp_month text, -- MM
    card_exp_year text, -- YYYY
    
    -- Status
    is_active boolean DEFAULT true,
    is_default boolean DEFAULT false,
    
    -- Usage tracking
    last_used_at timestamptz,
    
    -- Customer display name
    nickname text,
    
    created_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL,
    
    UNIQUE(customer_id, authorization_code, gateway_provider)
);

-- Ensure only one default payment method per customer
CREATE UNIQUE INDEX one_default_payment_per_customer
ON customer_payment_authorizations (customer_id)
WHERE is_default = true AND is_active = true;

-- Main payment transactions table
CREATE TABLE order_payments (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    order_id uuid REFERENCES orders(id) ON DELETE CASCADE NOT NULL,
    payment_method_code text REFERENCES payment_methods(code) NOT NULL,
    
    -- Customer payment authorization (for saved payment methods)
    customer_payment_authorization_id uuid REFERENCES customer_payment_authorizations(id) ON DELETE SET NULL,
    
    -- Payment amounts (all in cents for precision)
    amount_paid_cents bigint NOT NULL, -- Amount customer paid
    tip_amount_cents bigint DEFAULT 0, -- Customer tip
    change_given_cents bigint DEFAULT 0, -- Change for cash payments
    
    -- Payment details
    payment_reference text, -- Card ref, PayStack ref, etc.
    external_transaction_id text, -- PayStack transaction ID, bank ref, etc.
    payment_status text DEFAULT 'pending' CHECK (payment_status IN ('pending', 'completed', 'failed', 'refunded', 'partially_refunded')),
    
    -- Timing
    paid_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL,
    confirmed_at timestamptz, -- When payment was confirmed (for card/online payments)
    
    -- Staff and notes
    processed_by uuid REFERENCES staff(id) ON DELETE SET NULL,
    notes text,
    
    -- PayStack specific fields
    paystack_reference text, -- PayStack transaction reference
    paystack_status text, -- PayStack status response
    paystack_gateway_response text, -- Gateway response message
    
    created_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Payment fees tracking (what we charge/get charged)
CREATE TABLE payment_fees (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    payment_id uuid REFERENCES order_payments(id) ON DELETE CASCADE NOT NULL,
    location_payment_method_fee_id uuid REFERENCES location_payment_method_fees(id) ON DELETE SET NULL,
    
    -- Fee breakdown (calculated from location-specific rates)
    processing_fee_cents bigint DEFAULT 0, -- What we charge merchant
    gateway_fee_cents bigint DEFAULT 0, -- What PayStack/gateway charges us
    platform_fee_cents bigint DEFAULT 0, -- Our platform fee
    
    -- Net amounts
    merchant_amount_cents bigint NOT NULL, -- What merchant receives
    platform_amount_cents bigint NOT NULL, -- What we keep
    
    created_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Refunds table
CREATE TABLE refunds (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    payment_id uuid REFERENCES order_payments(id) ON DELETE CASCADE NOT NULL,
    order_id uuid REFERENCES orders(id) ON DELETE CASCADE NOT NULL,
    
    -- Refund details
    refund_amount_cents bigint NOT NULL,
    refund_reason text,
    refund_type text DEFAULT 'full' CHECK (refund_type IN ('full', 'partial')),
    
    -- Processing
    refund_method text, -- How refund was processed
    external_refund_id text, -- PayStack refund ID, etc.
    refund_status text DEFAULT 'pending' CHECK (refund_status IN ('pending', 'completed', 'failed')),
    
    -- Staff tracking
    processed_by uuid REFERENCES staff(id) ON DELETE SET NULL,
    approved_by uuid REFERENCES staff(id) ON DELETE SET NULL,
    
    -- Timing
    refunded_at timestamptz,
    
    notes text,
    created_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Merchant payout tracking (how much we owe locations/merchants)
CREATE TABLE merchant_payouts (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    location_id uuid REFERENCES locations(id) ON DELETE CASCADE NOT NULL,
    
    -- Payout period
    period_start date NOT NULL,
    period_end date NOT NULL,
    
    -- Financial summary
    total_sales_cents bigint DEFAULT 0, -- Total sales in period
    total_fees_cents bigint DEFAULT 0, -- Total fees charged
    total_refunds_cents bigint DEFAULT 0, -- Total refunds processed
    net_payout_cents bigint DEFAULT 0, -- Amount owed to merchant
    
    -- Payout status
    payout_status text DEFAULT 'pending' CHECK (payout_status IN ('pending', 'processing', 'paid', 'failed')),
    payout_reference text, -- Bank transfer reference
    payout_method text DEFAULT 'eft', -- How we pay them
    
    -- Timing
    calculated_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL,
    paid_at timestamptz,
    
    -- Staff
    processed_by uuid REFERENCES staff(id) ON DELETE SET NULL,
    
    notes text,
    created_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL,
    
    UNIQUE(location_id, period_start, period_end)
);

-- Detailed payout line items (which orders contributed to payout)
CREATE TABLE merchant_payout_items (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    payout_id uuid REFERENCES merchant_payouts(id) ON DELETE CASCADE NOT NULL,
    payment_id uuid REFERENCES order_payments(id) ON DELETE CASCADE NOT NULL,
    order_id uuid REFERENCES orders(id) ON DELETE CASCADE NOT NULL,
    
    -- Item details
    payment_amount_cents bigint NOT NULL,
    fee_amount_cents bigint NOT NULL,
    merchant_amount_cents bigint NOT NULL, -- payment_amount - fee_amount
    
    created_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- ======================
-- CUSTOMER PAYMENT FUNCTIONS
-- ======================

-- Function to get customer's default payment method
CREATE OR REPLACE FUNCTION get_customer_default_payment_method(customer_uuid uuid)
RETURNS TABLE (
    id uuid,
    payment_method_code text,
    authorization_code text,
    gateway_provider text,
    card_last_four text,
    card_type text,
    nickname text
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        cpa.id,
        cpa.payment_method_code,
        cpa.authorization_code,
        cpa.gateway_provider,
        cpa.card_last_four,
        cpa.card_type,
        cpa.nickname
    FROM customer_payment_authorizations cpa
    WHERE cpa.customer_id = customer_uuid
    AND cpa.is_active = true
    AND cpa.is_default = true
    LIMIT 1;
END;
$$ LANGUAGE plpgsql;

-- Function to get all customer payment methods
CREATE OR REPLACE FUNCTION get_customer_payment_methods(customer_uuid uuid)
RETURNS TABLE (
    id uuid,
    payment_method_code text,
    payment_method_name text,
    authorization_code text,
    gateway_provider text,
    card_last_four text,
    card_type text,
    nickname text,
    is_default boolean,
    last_used_at timestamptz
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        cpa.id,
        cpa.payment_method_code,
        pm.name as payment_method_name,
        cpa.authorization_code,
        cpa.gateway_provider,
        cpa.card_last_four,
        cpa.card_type,
        cpa.nickname,
        cpa.is_default,
        cpa.last_used_at
    FROM customer_payment_authorizations cpa
    JOIN payment_methods pm ON cpa.payment_method_code = pm.code
    WHERE cpa.customer_id = customer_uuid
    AND cpa.is_active = true
    ORDER BY cpa.is_default DESC, cpa.last_used_at DESC;
END;
$$ LANGUAGE plpgsql;

-- Function to set default payment method
CREATE OR REPLACE FUNCTION set_default_payment_method(customer_uuid uuid, authorization_uuid uuid)
RETURNS boolean AS $$
BEGIN
    -- Remove default from all other methods
    UPDATE customer_payment_authorizations 
    SET is_default = false, updated_at = now()
    WHERE customer_id = customer_uuid;
    
    -- Set new default
    UPDATE customer_payment_authorizations 
    SET is_default = true, updated_at = now()
    WHERE customer_id = customer_uuid 
    AND id = authorization_uuid
    AND is_active = true;
    
    RETURN FOUND;
END;
$$ LANGUAGE plpgsql;

-- Function to deactivate payment method
CREATE OR REPLACE FUNCTION deactivate_payment_method(customer_uuid uuid, authorization_uuid uuid)
RETURNS boolean AS $$
BEGIN
    UPDATE customer_payment_authorizations 
    SET 
        is_active = false,
        updated_at = now()
    WHERE customer_id = customer_uuid 
    AND id = authorization_uuid;
    
    RETURN FOUND;
END;
$$ LANGUAGE plpgsql;

-- ======================
-- LOCATION FEE FUNCTIONS
-- ======================

-- Function to get location-specific payment method fees
CREATE OR REPLACE FUNCTION get_location_payment_method_fee(location_uuid uuid, method_code text)
RETURNS TABLE (
    id uuid,
    processing_fee_percentage decimal(5,2),
    fixed_fee_cents integer,
    gateway_fee_percentage decimal(5,2),
    gateway_fixed_fee_cents integer
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        lpmf.id,
        lpmf.processing_fee_percentage,
        lpmf.fixed_fee_cents,
        lpmf.gateway_fee_percentage,
        lpmf.gateway_fixed_fee_cents
    FROM location_payment_method_fees lpmf
    WHERE lpmf.location_id = location_uuid
    AND lpmf.payment_method_code = method_code
    AND lpmf.is_active = true
    LIMIT 1;
END;
$$ LANGUAGE plpgsql;

-- Function to calculate payment fees for a location
CREATE OR REPLACE FUNCTION calculate_payment_fees(location_uuid uuid, method_code text, amount_cents bigint)
RETURNS TABLE (
    processing_fee_cents bigint,
    gateway_fee_cents bigint,
    platform_fee_cents bigint,
    merchant_amount_cents bigint,
    platform_amount_cents bigint
) AS $$
DECLARE
    fee_record RECORD;
    proc_fee bigint;
    gateway_fee bigint;
    platform_fee bigint;
BEGIN
    -- Get location-specific fees
    SELECT * INTO fee_record
    FROM get_location_payment_method_fee(location_uuid, method_code);
    
    -- Calculate fees
    proc_fee := COALESCE(fee_record.fixed_fee_cents, 0) + 
                ROUND(amount_cents * COALESCE(fee_record.processing_fee_percentage, 0) / 100);
    
    gateway_fee := COALESCE(fee_record.gateway_fixed_fee_cents, 0) + 
                   ROUND(amount_cents * COALESCE(fee_record.gateway_fee_percentage, 0) / 100);
    
    platform_fee := proc_fee - gateway_fee;
    
    RETURN QUERY
    SELECT 
        proc_fee as processing_fee_cents,
        gateway_fee as gateway_fee_cents,
        platform_fee as platform_fee_cents,
        (amount_cents - proc_fee) as merchant_amount_cents,
        platform_fee as platform_amount_cents;
END;
$$ LANGUAGE plpgsql;

-- Function to get available payment methods for a location
CREATE OR REPLACE FUNCTION get_location_payment_methods(location_uuid uuid)
RETURNS TABLE (
    payment_method_code text,
    payment_method_name text,
    requires_reference boolean,
    supports_tips boolean,
    processing_fee_percentage decimal(5,2),
    fixed_fee_cents integer,
    is_active boolean
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        pm.code,
        pm.name,
        pm.requires_reference,
        pm.supports_tips,
        COALESCE(lpmf.processing_fee_percentage, 0) as processing_fee_percentage,
        COALESCE(lpmf.fixed_fee_cents, 0) as fixed_fee_cents,
        COALESCE(lpmf.is_active, false) as is_active
    FROM payment_methods pm
    LEFT JOIN location_payment_method_fees lpmf ON pm.code = lpmf.payment_method_code 
        AND lpmf.location_id = location_uuid
    WHERE pm.is_active = true
    ORDER BY pm.name;
END;
$$ LANGUAGE plpgsql;

-- ======================
-- USEFUL VIEWS
-- ======================

-- View for easy payment display (converts cents to decimals)
CREATE VIEW payment_summary AS
SELECT 
    op.id,
    op.order_id,
    o.location_id,
    op.payment_method_code,
    pm.name as payment_method_name,
    cents_to_decimal(op.amount_paid_cents) as amount_paid,
    cents_to_decimal(op.tip_amount_cents) as tip_amount,
    cents_to_decimal(op.change_given_cents) as change_given,
    op.payment_reference,
    op.payment_status,
    op.paid_at,
    op.confirmed_at,
    op.processed_by,
    cents_to_decimal(COALESCE(pf.merchant_amount_cents, op.amount_paid_cents)) as merchant_amount,
    cents_to_decimal(COALESCE(pf.platform_amount_cents, 0)) as platform_amount,
    cents_to_decimal(COALESCE(pf.processing_fee_cents, 0)) as processing_fee,
    cents_to_decimal(COALESCE(pf.gateway_fee_cents, 0)) as gateway_fee
FROM order_payments op
LEFT JOIN orders o ON op.order_id = o.id
LEFT JOIN payment_methods pm ON op.payment_method_code = pm.code
LEFT JOIN payment_fees pf ON op.id = pf.payment_id;

-- View for merchant earnings summary
CREATE VIEW merchant_earnings_summary AS
SELECT 
    l.id as location_id,
    l.name as location_name,
    COUNT(op.id) as total_transactions,
    cents_to_decimal(SUM(op.amount_paid_cents)) as total_sales,
    cents_to_decimal(SUM(COALESCE(pf.platform_amount_cents, 0))) as total_fees,
    cents_to_decimal(SUM(COALESCE(pf.merchant_amount_cents, op.amount_paid_cents))) as total_merchant_earnings
FROM locations l
LEFT JOIN orders o ON l.id = o.location_id
LEFT JOIN order_payments op ON o.id = op.order_id AND op.payment_status = 'completed'
LEFT JOIN payment_fees pf ON op.id = pf.payment_id
GROUP BY l.id, l.name;

-- ======================
-- INDEXES FOR PERFORMANCE
-- ======================

CREATE INDEX idx_order_payments_order_id ON order_payments(order_id);
CREATE INDEX idx_order_payments_status ON order_payments(payment_status);
CREATE INDEX idx_order_payments_paid_at ON order_payments(paid_at);
CREATE INDEX idx_order_payments_method ON order_payments(payment_method_code);
CREATE INDEX idx_order_payments_authorization ON order_payments(customer_payment_authorization_id);

CREATE INDEX idx_merchant_payouts_location ON merchant_payouts(location_id);
CREATE INDEX idx_merchant_payouts_period ON merchant_payouts(period_start, period_end);
CREATE INDEX idx_merchant_payouts_status ON merchant_payouts(payout_status);

CREATE INDEX idx_refunds_payment_id ON refunds(payment_id);
CREATE INDEX idx_refunds_status ON refunds(refund_status);

-- ======================
-- CART MANAGEMENT SYSTEM
-- ======================

-- Cart items table for items before order is placed
CREATE TABLE cart_items (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    customer_id uuid REFERENCES customers(id) ON DELETE CASCADE NOT NULL,
    location_id uuid REFERENCES locations(id) ON DELETE CASCADE NOT NULL,
    item_id uuid REFERENCES items(id) ON DELETE CASCADE NOT NULL,
    quantity integer NOT NULL DEFAULT 1,
    unit_price decimal(10,2) NOT NULL, -- Price at time of adding to cart
    total_price decimal(10,2) NOT NULL, -- quantity * unit_price + variation costs
    special_instructions text,
    created_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Cart item variations for customer selections
CREATE TABLE cart_item_variations (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    cart_item_id uuid REFERENCES cart_items(id) ON DELETE CASCADE NOT NULL,
    variation_id uuid REFERENCES item_variations(id) ON DELETE CASCADE NOT NULL,
    option_id uuid REFERENCES item_variation_options(id) ON DELETE CASCADE NOT NULL,
    price_modifier decimal(10,2) DEFAULT 0,
    created_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Cart summary view for easy totals
CREATE VIEW cart_summary AS
SELECT 
    c.customer_id,
    c.location_id,
    COUNT(c.id) as item_count,
    SUM(c.quantity) as total_quantity,
    cents_to_decimal(SUM(decimal_to_cents(c.total_price))) as subtotal,
    l.delivery_fee,
    CASE 
        WHEN SUM(c.total_price) >= l.free_delivery_threshold THEN 0
        ELSE cents_to_decimal(decimal_to_cents(l.delivery_fee))
    END as delivery_fee_amount,
    cents_to_decimal(
        SUM(decimal_to_cents(c.total_price)) + 
        CASE 
            WHEN SUM(c.total_price) >= l.free_delivery_threshold THEN 0
            ELSE decimal_to_cents(l.delivery_fee)
        END
    ) as total_amount
FROM cart_items c
LEFT JOIN locations l ON c.location_id = l.id
GROUP BY c.customer_id, c.location_id, l.delivery_fee, l.free_delivery_threshold;

-- Function to clear cart after order is placed
CREATE OR REPLACE FUNCTION clear_customer_cart(customer_uuid uuid, location_uuid uuid)
RETURNS void AS $$
BEGIN
    DELETE FROM cart_items 
    WHERE customer_id = customer_uuid 
    AND location_id = location_uuid;
END;
$$ LANGUAGE plpgsql;

-- Function to move cart items to order items
CREATE OR REPLACE FUNCTION convert_cart_to_order_items(customer_uuid uuid, location_uuid uuid, order_uuid uuid)
RETURNS void AS $$
BEGIN
    -- Insert cart items as order items
    INSERT INTO order_items (order_id, item_id, quantity, unit_price, total_price, special_instructions)
    SELECT 
        order_uuid,
        item_id,
        quantity,
        unit_price,
        total_price,
        special_instructions
    FROM cart_items
    WHERE customer_id = customer_uuid AND location_id = location_uuid;
    
    -- Insert cart item variations as order item variations
    INSERT INTO order_item_variations (order_item_id, variation_id, option_id, price_modifier)
    SELECT 
        oi.id,
        civ.variation_id,
        civ.option_id,
        civ.price_modifier
    FROM cart_items ci
    JOIN order_items oi ON ci.item_id = oi.item_id AND oi.order_id = order_uuid
    JOIN cart_item_variations civ ON ci.id = civ.cart_item_id
    WHERE ci.customer_id = customer_uuid AND ci.location_id = location_uuid;
    
    -- Clear the cart
    PERFORM clear_customer_cart(customer_uuid, location_uuid);
END;
$$ LANGUAGE plpgsql;

-- Cart performance indexes
CREATE INDEX idx_cart_items_customer_location ON cart_items(customer_id, location_id);
CREATE INDEX idx_cart_items_item ON cart_items(item_id);
CREATE INDEX idx_cart_item_variations_cart_item ON cart_item_variations(cart_item_id);
CREATE INDEX idx_cart_items_created_at ON cart_items(created_at);

-- Customer payment authorization indexes
CREATE INDEX idx_customer_payment_auth_customer ON customer_payment_authorizations(customer_id);
CREATE INDEX idx_customer_payment_auth_active ON customer_payment_authorizations(is_active, is_default);
CREATE INDEX idx_customer_payment_auth_gateway ON customer_payment_authorizations(gateway_provider, authorization_code);
CREATE INDEX idx_customer_payment_auth_last_used ON customer_payment_authorizations(last_used_at);

-- Location payment method fee indexes
CREATE INDEX idx_location_payment_method_fees_location ON location_payment_method_fees(location_id);
CREATE INDEX idx_location_payment_method_fees_method ON location_payment_method_fees(payment_method_code);
CREATE INDEX idx_location_payment_method_fees_active ON location_payment_method_fees(is_active);
CREATE INDEX idx_location_payment_method_fees_lookup ON location_payment_method_fees(location_id, payment_method_code);

-- ======================
-- LOCATION FEE SETUP EXAMPLES
-- ======================

-- Example: Set up payment method fees for a specific location
-- Replace 'location-uuid' with actual location ID

/*
-- Example: Paystack fees for a location (merchant BYO Paystack account).
-- Gateway % / fixed is what Paystack takes from the merchant; processing
-- % / fixed is our platform markup (0 if we're just a pass-through).
INSERT INTO location_payment_method_fees (location_id, payment_method_code, processing_fee_percentage, fixed_fee_cents, gateway_fee_percentage, gateway_fixed_fee_cents) VALUES
('location-uuid', 'cash',             0.0, 0, 0.0, 0),
('location-uuid', 'card_in_person',   0.0, 0, 0.0, 0),
('location-uuid', 'card_on_delivery', 0.0, 0, 0.0, 0),
('location-uuid', 'eft',              0.0, 0, 0.0, 0),
('location-uuid', 'paystack',         0.0, 0, 3.1, 10000),  -- Paystack: 3.1% + R1
('location-uuid', 'stripe',           0.0, 0, 2.9, 3000);    -- Stripe:  2.9% + $0.30 (~R5.55 in cents, adjust)

-- Usage examples:
SELECT * FROM get_location_payment_methods('location-uuid');
SELECT * FROM get_available_payment_methods('location-uuid'); -- tier + config aware
SELECT * FROM calculate_payment_fees('location-uuid', 'paystack', 10000); -- R100 payment
*/ 