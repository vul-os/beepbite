-- ======================
-- DELIVERY PARTNER INTEGRATIONS
-- Uber Eats, DoorDash, Grubhub, etc.
-- ======================

-- Delivery partners table (Uber Eats, DoorDash, etc.)
CREATE TABLE delivery_partners (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    name text NOT NULL, -- 'uber_eats', 'doordash', 'grubhub', etc.
    display_name text NOT NULL, -- 'Uber Eats', 'DoorDash', 'Grubhub'
    api_base_url text NOT NULL,
    webhook_url text,
    is_active boolean DEFAULT true,
    
    -- API configuration
    api_version text DEFAULT 'v1',
    supports_webhooks boolean DEFAULT true,
    supports_menu_sync boolean DEFAULT true,
    supports_order_sync boolean DEFAULT true,
    supports_status_updates boolean DEFAULT true,
    
    -- Platform-specific settings
    default_commission_rate decimal(5,2) DEFAULT 0.00, -- Default commission percentage (can be overridden per location)
    delivery_fee_structure jsonb DEFAULT '{}', -- Platform delivery fee structure
    
    created_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL,
    
    UNIQUE(name)
);

-- Insert default delivery partners
INSERT INTO delivery_partners (name, display_name, api_base_url, default_commission_rate) VALUES
('uber_eats', 'Uber Eats', 'https://api.uber.com/v2/eats', 15.00),
('doordash', 'DoorDash', 'https://api.doordash.com/drive/v2', 18.00),
('grubhub', 'Grubhub', 'https://api-gtm.grubhub.com/v1', 20.00),
('postmates', 'Postmates', 'https://api.postmates.com/v1', 15.00);

-- Partner credentials per location
CREATE TABLE delivery_partner_credentials (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    location_id uuid REFERENCES locations(id) ON DELETE CASCADE NOT NULL,
    partner_id uuid REFERENCES delivery_partners(id) ON DELETE CASCADE NOT NULL,
    
    -- API credentials
    api_key text,
    api_secret text,
    access_token text,
    refresh_token text,
    webhook_secret text,
    
    -- Partner-specific IDs
    partner_merchant_id text NOT NULL, -- Restaurant ID on partner platform
    partner_store_id text, -- Store ID on partner platform
    
    -- Configuration
    is_active boolean DEFAULT true,
    auto_accept_orders boolean DEFAULT true,
    auto_sync_menu boolean DEFAULT true,
    
    -- Location-specific pricing
    commission_rate decimal(5,2), -- Location-specific commission rate (overrides partner default)
    delivery_fee decimal(10,2), -- Location-specific delivery fee
    service_fee decimal(10,2) DEFAULT 0.00, -- Additional service fees
    minimum_order_amount decimal(10,2), -- Minimum order amount for this location
    
    -- Operational settings
    preparation_time_minutes integer DEFAULT 30,
    auto_confirm_orders boolean DEFAULT true,
    supports_scheduling boolean DEFAULT true,
    
    -- Token management
    token_expires_at timestamptz,
    last_token_refresh timestamptz,
    
    created_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL,
    
    UNIQUE(location_id, partner_id)
);

-- Partner menu items mapping
CREATE TABLE delivery_partner_menu_items (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    location_id uuid REFERENCES locations(id) ON DELETE CASCADE NOT NULL,
    partner_id uuid REFERENCES delivery_partners(id) ON DELETE CASCADE NOT NULL,
    item_id uuid REFERENCES items(id) ON DELETE CASCADE NOT NULL,
    
    -- Partner-specific item details
    partner_item_id text NOT NULL, -- Item ID on partner platform
    partner_item_name text NOT NULL, -- Item name on partner platform (may differ)
    partner_description text, -- Description on partner platform
    partner_price decimal(10,2) NOT NULL, -- Price on partner platform
    partner_category text, -- Category on partner platform
    
    -- Availability and settings
    is_available boolean DEFAULT true,
    is_synced boolean DEFAULT false,
    
    -- Platform-specific settings
    platform_settings jsonb DEFAULT '{}', -- Platform-specific item settings
    
    -- Sync tracking
    last_synced_at timestamptz,
    sync_status text DEFAULT 'pending' CHECK (sync_status IN ('pending', 'synced', 'failed', 'out_of_sync')),
    sync_error_message text,
    
    created_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL,
    
    UNIQUE(location_id, partner_id, item_id),
    UNIQUE(location_id, partner_id, partner_item_id)
);

-- Partner menu variations mapping
CREATE TABLE delivery_partner_item_variations (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    partner_menu_item_id uuid REFERENCES delivery_partner_menu_items(id) ON DELETE CASCADE NOT NULL,
    variation_id uuid REFERENCES item_variations(id) ON DELETE CASCADE NOT NULL,
    
    -- Partner-specific variation details
    partner_variation_id text NOT NULL,
    partner_variation_name text NOT NULL,
    partner_price_modifier decimal(10,2) DEFAULT 0,
    
    -- Availability
    is_available boolean DEFAULT true,
    is_synced boolean DEFAULT false,
    
    created_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL,
    
    UNIQUE(partner_menu_item_id, variation_id),
    UNIQUE(partner_menu_item_id, partner_variation_id)
);

-- Partner orders table
CREATE TABLE delivery_partner_orders (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    order_id uuid REFERENCES orders(id) ON DELETE CASCADE NOT NULL,
    partner_id uuid REFERENCES delivery_partners(id) ON DELETE CASCADE NOT NULL,
    
    -- Partner order details
    partner_order_id text NOT NULL, -- Order ID on partner platform
    partner_order_number text, -- Order number on partner platform
    partner_customer_id text, -- Customer ID on partner platform
    
    -- Order source and type
    order_source text NOT NULL CHECK (order_source IN ('partner_app', 'partner_web', 'partner_kiosk')),
    fulfillment_type text NOT NULL CHECK (fulfillment_type IN ('delivery', 'pickup', 'dine_in')),
    
    -- Financial details
    partner_subtotal decimal(10,2) DEFAULT 0,
    partner_delivery_fee decimal(10,2) DEFAULT 0,
    partner_service_fee decimal(10,2) DEFAULT 0,
    partner_tax_amount decimal(10,2) DEFAULT 0,
    partner_tip_amount decimal(10,2) DEFAULT 0,
    partner_total_amount decimal(10,2) DEFAULT 0,
    
    -- Commission and fees
    commission_amount decimal(10,2) DEFAULT 0,
    commission_rate decimal(5,2) DEFAULT 0,
    
    -- Status tracking
    partner_status text NOT NULL,
    local_status text NOT NULL,
    status_sync_required boolean DEFAULT false,
    
    -- Timing
    partner_created_at timestamptz NOT NULL,
    partner_pickup_time timestamptz,
    partner_delivery_time timestamptz,
    partner_estimated_delivery_time timestamptz,
    
    -- Delivery details
    partner_delivery_address text,
    partner_delivery_instructions text,
    partner_customer_phone text,
    partner_customer_name text,
    
    -- Sync tracking
    last_status_sync_at timestamptz,
    sync_error_message text,
    
    created_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL,
    
    UNIQUE(partner_id, partner_order_id),
    UNIQUE(order_id, partner_id)
);

-- Partner order items
CREATE TABLE delivery_partner_order_items (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    partner_order_id uuid REFERENCES delivery_partner_orders(id) ON DELETE CASCADE NOT NULL,
    order_item_id uuid REFERENCES order_items(id) ON DELETE CASCADE NOT NULL,
    
    -- Partner item details
    partner_item_id text NOT NULL,
    partner_item_name text NOT NULL,
    partner_quantity integer NOT NULL,
    partner_unit_price decimal(10,2) NOT NULL,
    partner_total_price decimal(10,2) NOT NULL,
    
    -- Special instructions
    partner_special_instructions text,
    
    created_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Partner order status history
CREATE TABLE delivery_partner_order_status_history (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    partner_order_id uuid REFERENCES delivery_partner_orders(id) ON DELETE CASCADE NOT NULL,
    
    -- Status details
    from_status text,
    to_status text NOT NULL,
    partner_status text, -- Status from partner platform
    
    -- Timing
    status_changed_at timestamptz NOT NULL,
    
    -- Additional details
    notes text,
    webhook_data jsonb,
    
    created_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Partner webhook events
CREATE TABLE delivery_partner_webhook_events (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    partner_id uuid REFERENCES delivery_partners(id) ON DELETE CASCADE NOT NULL,
    
    -- Event details
    event_type text NOT NULL, -- 'order_created', 'order_updated', 'order_cancelled', etc.
    event_id text, -- Partner's event ID
    
    -- Webhook data
    payload jsonb NOT NULL,
    headers jsonb,
    
    -- Processing status
    processing_status text DEFAULT 'pending' CHECK (processing_status IN ('pending', 'processing', 'processed', 'failed')),
    processing_error text,
    processed_at timestamptz,
    
    -- Related entities
    partner_order_id text,
    order_id uuid REFERENCES orders(id) ON DELETE SET NULL,
    
    created_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL
);
-- Note: equivalent indexes are created further down at lines ~770 alongside the
-- other delivery_partner_webhook_events indexes. The MySQL-style inline INDEX()
-- syntax above was invalid in Postgres and has been removed.

-- Menu sync jobs
CREATE TABLE delivery_partner_menu_sync_jobs (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    location_id uuid REFERENCES locations(id) ON DELETE CASCADE NOT NULL,
    partner_id uuid REFERENCES delivery_partners(id) ON DELETE CASCADE NOT NULL,
    
    -- Job details
    job_type text NOT NULL CHECK (job_type IN ('full_sync', 'incremental_sync', 'item_sync', 'price_sync')),
    job_status text DEFAULT 'pending' CHECK (job_status IN ('pending', 'running', 'completed', 'failed')),
    
    -- Progress tracking
    total_items integer DEFAULT 0,
    processed_items integer DEFAULT 0,
    failed_items integer DEFAULT 0,
    
    -- Timing
    started_at timestamptz,
    completed_at timestamptz,
    
    -- Results
    sync_results jsonb DEFAULT '{}',
    error_message text,
    
    created_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- ======================
-- UBER EATS SPECIFIC TABLES
-- ======================

-- Uber Eats store configuration
CREATE TABLE uber_eats_store_config (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    location_id uuid REFERENCES locations(id) ON DELETE CASCADE NOT NULL,
    
    -- Uber Eats specific settings
    store_id text NOT NULL,
    merchant_id text NOT NULL,
    
    -- Menu settings
    menu_id text,
    menu_version text,
    
    -- Operational settings
    accepts_orders boolean DEFAULT true,
    auto_accept_orders boolean DEFAULT true,
    preparation_time_minutes integer DEFAULT 30,
    
    -- Delivery settings
    delivery_radius_miles decimal(5,2) DEFAULT 5.0,
    delivery_fee decimal(10,2) DEFAULT 2.99,
    minimum_order_amount decimal(10,2) DEFAULT 10.00,
    
    -- Platform settings
    platform_settings jsonb DEFAULT '{}',
    
    created_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL,
    
    UNIQUE(location_id),
    UNIQUE(store_id)
);

-- Uber Eats order mapping
CREATE TABLE uber_eats_orders (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    partner_order_id uuid REFERENCES delivery_partner_orders(id) ON DELETE CASCADE NOT NULL,
    
    -- Uber Eats specific fields
    uber_order_id text NOT NULL,
    uber_order_uuid text,
    uber_store_id text NOT NULL,
    
    -- Timing details
    placed_at timestamptz NOT NULL,
    estimated_pickup_time timestamptz,
    estimated_delivery_time timestamptz,
    
    -- Customer details
    customer_uuid text,
    customer_phone_number text,
    
    -- Delivery details
    delivery_address_line1 text,
    delivery_address_line2 text,
    delivery_city text,
    delivery_state text,
    delivery_zip_code text,
    delivery_country text,
    delivery_latitude decimal(10,7),
    delivery_longitude decimal(10,7),
    
    -- Payment details
    payment_method text,
    payment_status text,
    
    -- Uber Eats specific data
    uber_data jsonb DEFAULT '{}',
    
    created_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL,
    
    UNIQUE(uber_order_id),
    UNIQUE(partner_order_id)
);

-- ======================
-- FUNCTIONS FOR PARTNER INTEGRATION
-- ======================

-- Function to sync menu item to partner platform
CREATE OR REPLACE FUNCTION sync_item_to_partner(
    p_location_id uuid,
    p_partner_id uuid,
    p_item_id uuid
) RETURNS boolean AS $$
DECLARE
    v_partner_item_id text;
    v_partner_name text;
    v_sync_success boolean := false;
BEGIN
    -- Get item details
    SELECT 
        CONCAT(l.name, '_', i.name, '_', i.id::text),
        i.name
    INTO v_partner_item_id, v_partner_name
    FROM items i
    JOIN locations l ON i.location_id = l.id
    WHERE i.id = p_item_id AND l.id = p_location_id;
    
    -- Insert or update partner menu item
    INSERT INTO delivery_partner_menu_items (
        location_id, partner_id, item_id, partner_item_id, 
        partner_item_name, partner_price, is_synced, sync_status
    )
    SELECT 
        p_location_id, p_partner_id, i.id, v_partner_item_id,
        v_partner_name, i.price, true, 'synced'
    FROM items i
    WHERE i.id = p_item_id
    ON CONFLICT (location_id, partner_id, item_id) 
    DO UPDATE SET
        partner_item_name = EXCLUDED.partner_item_name,
        partner_price = EXCLUDED.partner_price,
        is_synced = true,
        sync_status = 'synced',
        last_synced_at = now(),
        updated_at = now();
    
    v_sync_success := true;
    
    RETURN v_sync_success;
EXCEPTION
    WHEN OTHERS THEN
        -- Log error and mark as failed
        UPDATE delivery_partner_menu_items 
        SET sync_status = 'failed',
            sync_error_message = SQLERRM,
            updated_at = now()
        WHERE location_id = p_location_id 
        AND partner_id = p_partner_id 
        AND item_id = p_item_id;
        
        RETURN false;
END;
$$ LANGUAGE plpgsql;

-- Function to create partner order from webhook
CREATE OR REPLACE FUNCTION create_partner_order_from_webhook(
    p_partner_id uuid,
    p_location_id uuid,
    p_webhook_data jsonb
) RETURNS uuid AS $$
DECLARE
    v_order_id uuid;
    v_partner_order_id uuid;
    v_customer_id uuid;
    v_partner_order_ref text;
    v_partner_total decimal(10,2);
BEGIN
    -- Extract order details from webhook data
    v_partner_order_ref := p_webhook_data->>'order_id';
    v_partner_total := (p_webhook_data->>'total_amount')::decimal;
    
    -- Get or create customer based on phone number
    SELECT id INTO v_customer_id
    FROM customers 
    WHERE whatsapp_number = p_webhook_data->>'customer_phone';
    
    IF v_customer_id IS NULL THEN
        INSERT INTO customers (whatsapp_number, first_name, last_name)
        VALUES (
            p_webhook_data->>'customer_phone',
            p_webhook_data->>'customer_first_name',
            p_webhook_data->>'customer_last_name'
        )
        RETURNING id INTO v_customer_id;
    END IF;
    
    -- Create main order
    INSERT INTO orders (location_id, customer_id, order_type, status)
    VALUES (p_location_id, v_customer_id, 'delivery', 'pending')
    RETURNING id INTO v_order_id;
    
    -- Create partner order record
    INSERT INTO delivery_partner_orders (
        order_id, partner_id, partner_order_id, partner_order_number,
        partner_customer_id, order_source, fulfillment_type,
        partner_subtotal, partner_delivery_fee, partner_tax_amount,
        partner_tip_amount, partner_total_amount, commission_amount,
        partner_status, local_status, partner_created_at,
        partner_delivery_address, partner_customer_phone, partner_customer_name
    )
    VALUES (
        v_order_id, p_partner_id, v_partner_order_ref, 
        p_webhook_data->>'order_number',
        p_webhook_data->>'customer_id', 'partner_app', 'delivery',
        (p_webhook_data->>'subtotal')::decimal,
        (p_webhook_data->>'delivery_fee')::decimal,
        (p_webhook_data->>'tax_amount')::decimal,
        (p_webhook_data->>'tip_amount')::decimal,
        v_partner_total,
        (v_partner_total * COALESCE(
            (SELECT dpc.commission_rate FROM delivery_partner_credentials dpc 
             WHERE dpc.location_id = p_location_id AND dpc.partner_id = p_partner_id),
            (SELECT dp.default_commission_rate FROM delivery_partners dp WHERE dp.id = p_partner_id)
        ) / 100), -- Location-specific or default commission
        p_webhook_data->>'status', 'pending',
        (p_webhook_data->>'created_at')::timestamptz,
        p_webhook_data->>'delivery_address',
        p_webhook_data->>'customer_phone',
        p_webhook_data->>'customer_name'
    )
    RETURNING id INTO v_partner_order_id;
    
    -- TODO: Add order items processing here
    
    RETURN v_partner_order_id;
END;
$$ LANGUAGE plpgsql;

-- Function to update order status from partner
CREATE OR REPLACE FUNCTION update_order_status_from_partner(
    p_partner_order_id uuid,
    p_new_status text,
    p_partner_status text DEFAULT NULL
) RETURNS boolean AS $$
DECLARE
    v_order_id uuid;
    v_old_status text;
    v_local_status text;
BEGIN
    -- Get current order details
    SELECT po.order_id, po.local_status 
    INTO v_order_id, v_old_status
    FROM delivery_partner_orders po
    WHERE po.id = p_partner_order_id;
    
    IF v_order_id IS NULL THEN
        RETURN false;
    END IF;
    
    -- Map partner status to local status
    v_local_status := CASE p_new_status
        WHEN 'accepted' THEN 'confirmed'
        WHEN 'in_preparation' THEN 'preparing'
        WHEN 'ready_for_pickup' THEN 'ready'
        WHEN 'picked_up' THEN 'out_for_delivery'
        WHEN 'delivered' THEN 'delivered'
        WHEN 'cancelled' THEN 'cancelled'
        ELSE 'pending'
    END;
    
    -- Update partner order status
    UPDATE delivery_partner_orders 
    SET local_status = v_local_status,
        partner_status = COALESCE(p_partner_status, p_new_status),
        last_status_sync_at = now(),
        updated_at = now()
    WHERE id = p_partner_order_id;
    
    -- Update main order status
    UPDATE orders 
    SET status = v_local_status,
        updated_at = now()
    WHERE id = v_order_id;
    
    -- Log status change
    INSERT INTO delivery_partner_order_status_history (
        partner_order_id, from_status, to_status, partner_status, status_changed_at
    )
    VALUES (
        p_partner_order_id, v_old_status, v_local_status, 
        COALESCE(p_partner_status, p_new_status), now()
    );
    
    RETURN true;
END;
$$ LANGUAGE plpgsql;

-- Function to get menu sync status for location
CREATE OR REPLACE FUNCTION get_menu_sync_status(p_location_id uuid, p_partner_id uuid)
RETURNS TABLE (
    total_items bigint,
    synced_items bigint,
    failed_items bigint,
    out_of_sync_items bigint,
    last_sync_at timestamptz
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        COUNT(*) as total_items,
        SUM(CASE WHEN sync_status = 'synced' THEN 1 ELSE 0 END) as synced_items,
        SUM(CASE WHEN sync_status = 'failed' THEN 1 ELSE 0 END) as failed_items,
        SUM(CASE WHEN sync_status = 'out_of_sync' THEN 1 ELSE 0 END) as out_of_sync_items,
        MAX(last_synced_at) as last_sync_at
    FROM delivery_partner_menu_items
    WHERE location_id = p_location_id AND partner_id = p_partner_id;
END;
$$ LANGUAGE plpgsql;

-- Function to get effective commission rate for location/partner
CREATE OR REPLACE FUNCTION get_effective_commission_rate(p_location_id uuid, p_partner_id uuid)
RETURNS decimal(5,2) AS $$
DECLARE
    v_commission_rate decimal(5,2);
BEGIN
    -- Get location-specific rate if exists, otherwise use partner default
    SELECT COALESCE(dpc.commission_rate, dp.default_commission_rate)
    INTO v_commission_rate
    FROM delivery_partners dp
    LEFT JOIN delivery_partner_credentials dpc ON dp.id = dpc.partner_id AND dpc.location_id = p_location_id
    WHERE dp.id = p_partner_id;
    
    RETURN COALESCE(v_commission_rate, 15.00); -- Fallback to 15% if nothing found
END;
$$ LANGUAGE plpgsql;

-- Function to calculate partner fees and commissions
CREATE OR REPLACE FUNCTION calculate_partner_fees(
    p_location_id uuid,
    p_partner_id uuid,
    p_order_total decimal(10,2)
) 
RETURNS TABLE (
    commission_rate decimal(5,2),
    commission_amount decimal(10,2),
    delivery_fee decimal(10,2),
    service_fee decimal(10,2),
    net_amount decimal(10,2)
) AS $$
DECLARE
    v_commission_rate decimal(5,2);
    v_commission_amount decimal(10,2);
    v_delivery_fee decimal(10,2);
    v_service_fee decimal(10,2);
    v_net_amount decimal(10,2);
BEGIN
    -- Get rates from credentials or defaults
    SELECT 
        COALESCE(dpc.commission_rate, dp.default_commission_rate),
        COALESCE(dpc.delivery_fee, 2.99),
        COALESCE(dpc.service_fee, 0.00)
    INTO v_commission_rate, v_delivery_fee, v_service_fee
    FROM delivery_partners dp
    LEFT JOIN delivery_partner_credentials dpc ON dp.id = dpc.partner_id AND dpc.location_id = p_location_id
    WHERE dp.id = p_partner_id;
    
    -- Calculate amounts
    v_commission_amount := (p_order_total * v_commission_rate / 100);
    v_net_amount := p_order_total - v_commission_amount - v_service_fee;
    
    RETURN QUERY VALUES (
        v_commission_rate,
        v_commission_amount,
        v_delivery_fee,
        v_service_fee,
        v_net_amount
    );
END;
$$ LANGUAGE plpgsql;

-- Function to get all active delivery partners for a location with their rates
CREATE OR REPLACE FUNCTION get_location_delivery_partners(p_location_id uuid)
RETURNS TABLE (
    partner_id uuid,
    partner_name text,
    partner_display_name text,
    commission_rate decimal(5,2),
    delivery_fee decimal(10,2),
    service_fee decimal(10,2),
    minimum_order_amount decimal(10,2),
    auto_accept_orders boolean,
    is_configured boolean
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        dp.id,
        dp.name,
        dp.display_name,
        COALESCE(dpc.commission_rate, dp.default_commission_rate) as commission_rate,
        COALESCE(dpc.delivery_fee, 2.99) as delivery_fee,
        COALESCE(dpc.service_fee, 0.00) as service_fee,
        COALESCE(dpc.minimum_order_amount, 10.00) as minimum_order_amount,
        COALESCE(dpc.auto_accept_orders, false) as auto_accept_orders,
        (dpc.id IS NOT NULL AND dpc.is_active = true) as is_configured
    FROM delivery_partners dp
    LEFT JOIN delivery_partner_credentials dpc ON dp.id = dpc.partner_id AND dpc.location_id = p_location_id
    WHERE dp.is_active = true
    ORDER BY dp.display_name;
END;
$$ LANGUAGE plpgsql;

-- Function to update location-specific commission rate
CREATE OR REPLACE FUNCTION update_location_commission_rate(
    p_location_id uuid,
    p_partner_id uuid,
    p_new_rate decimal(5,2)
) RETURNS boolean AS $$
BEGIN
    UPDATE delivery_partner_credentials 
    SET commission_rate = p_new_rate,
        updated_at = now()
    WHERE location_id = p_location_id AND partner_id = p_partner_id;
    
    IF NOT FOUND THEN
        -- Create new credentials record if it doesn't exist
        INSERT INTO delivery_partner_credentials (
            location_id, partner_id, commission_rate, 
            partner_merchant_id, partner_store_id
        )
        VALUES (
            p_location_id, p_partner_id, p_new_rate,
            'pending_setup_' || p_location_id::text,
            'pending_setup_' || p_location_id::text
        );
    END IF;
    
    RETURN true;
EXCEPTION
    WHEN OTHERS THEN
        RETURN false;
END;
$$ LANGUAGE plpgsql;

-- ======================
-- TRIGGERS FOR AUTOMATIC SYNC
-- ======================

-- Trigger to mark items as out of sync when price changes
CREATE OR REPLACE FUNCTION mark_partner_items_out_of_sync()
RETURNS TRIGGER AS $$
BEGIN
    -- Mark all partner menu items as out of sync when item price changes
    IF NEW.price != OLD.price THEN
        UPDATE delivery_partner_menu_items 
        SET sync_status = 'out_of_sync',
            updated_at = now()
        WHERE item_id = NEW.id;
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER items_price_change_sync_trigger
    AFTER UPDATE ON items
    FOR EACH ROW
    EXECUTE FUNCTION mark_partner_items_out_of_sync();

-- Trigger to log webhook events
CREATE OR REPLACE FUNCTION log_partner_webhook_event()
RETURNS TRIGGER AS $$
BEGIN
    -- This would be called from your webhook endpoint
    -- Log the webhook event for processing
    INSERT INTO delivery_partner_webhook_events (
        partner_id, event_type, payload, processing_status
    )
    VALUES (
        NEW.partner_id, 
        NEW.event_type, 
        NEW.payload, 
        'pending'
    );
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ======================
-- INDEXES FOR PERFORMANCE
-- ======================

CREATE INDEX idx_delivery_partner_credentials_location ON delivery_partner_credentials(location_id);
CREATE INDEX idx_delivery_partner_credentials_partner ON delivery_partner_credentials(partner_id);
CREATE INDEX idx_delivery_partner_credentials_active ON delivery_partner_credentials(is_active);

CREATE INDEX idx_delivery_partner_menu_items_location ON delivery_partner_menu_items(location_id);
CREATE INDEX idx_delivery_partner_menu_items_partner ON delivery_partner_menu_items(partner_id);
CREATE INDEX idx_delivery_partner_menu_items_item ON delivery_partner_menu_items(item_id);
CREATE INDEX idx_delivery_partner_menu_items_sync_status ON delivery_partner_menu_items(sync_status);
CREATE INDEX idx_delivery_partner_menu_items_partner_item ON delivery_partner_menu_items(partner_item_id);

CREATE INDEX idx_delivery_partner_orders_order ON delivery_partner_orders(order_id);
CREATE INDEX idx_delivery_partner_orders_partner ON delivery_partner_orders(partner_id);
CREATE INDEX idx_delivery_partner_orders_partner_order ON delivery_partner_orders(partner_order_id);
CREATE INDEX idx_delivery_partner_orders_status ON delivery_partner_orders(local_status);
CREATE INDEX idx_delivery_partner_orders_created ON delivery_partner_orders(created_at);

CREATE INDEX idx_delivery_partner_webhook_events_partner ON delivery_partner_webhook_events(partner_id);
CREATE INDEX idx_delivery_partner_webhook_events_type ON delivery_partner_webhook_events(event_type);
CREATE INDEX idx_delivery_partner_webhook_events_status ON delivery_partner_webhook_events(processing_status);
CREATE INDEX idx_delivery_partner_webhook_events_created ON delivery_partner_webhook_events(created_at);

CREATE INDEX idx_uber_eats_orders_uber_order ON uber_eats_orders(uber_order_id);
CREATE INDEX idx_uber_eats_orders_partner_order ON uber_eats_orders(partner_order_id);
CREATE INDEX idx_uber_eats_store_config_location ON uber_eats_store_config(location_id);
CREATE INDEX idx_uber_eats_store_config_store ON uber_eats_store_config(store_id);

-- ======================
-- VIEWS FOR REPORTING
-- ======================

-- View for commission rates by location and partner
CREATE VIEW location_partner_rates AS
SELECT 
    l.id as location_id,
    l.name as location_name,
    dp.id as partner_id,
    dp.display_name as partner_name,
    COALESCE(dpc.commission_rate, dp.default_commission_rate) as effective_commission_rate,
    dp.default_commission_rate,
    dpc.commission_rate as location_override_rate,
    dpc.delivery_fee,
    dpc.service_fee,
    dpc.minimum_order_amount,
    dpc.is_active as location_active,
    dp.is_active as partner_active,
    dpc.auto_accept_orders,
    dpc.preparation_time_minutes
FROM locations l
CROSS JOIN delivery_partners dp
LEFT JOIN delivery_partner_credentials dpc ON l.id = dpc.location_id AND dp.id = dpc.partner_id
WHERE l.is_active = true;

-- View for partner order summary
CREATE VIEW partner_order_summary AS
SELECT 
    dp.display_name as partner_name,
    l.name as location_name,
    po.partner_order_id,
    po.partner_total_amount,
    po.commission_amount,
    po.commission_rate,
    (po.partner_total_amount - po.commission_amount) as net_amount,
    po.local_status,
    po.partner_status,
    po.created_at,
    po.partner_created_at,
    c.first_name || ' ' || c.last_name as customer_name,
    c.whatsapp_number as customer_phone
FROM delivery_partner_orders po
JOIN delivery_partners dp ON po.partner_id = dp.id
JOIN orders o ON po.order_id = o.id
JOIN locations l ON o.location_id = l.id
JOIN customers c ON o.customer_id = c.id;

-- View for menu sync status
CREATE VIEW menu_sync_status AS
SELECT 
    l.name as location_name,
    dp.display_name as partner_name,
    COUNT(*) as total_items,
    SUM(CASE WHEN pmi.sync_status = 'synced' THEN 1 ELSE 0 END) as synced_items,
    SUM(CASE WHEN pmi.sync_status = 'failed' THEN 1 ELSE 0 END) as failed_items,
    SUM(CASE WHEN pmi.sync_status = 'out_of_sync' THEN 1 ELSE 0 END) as out_of_sync_items,
    MAX(pmi.last_synced_at) as last_sync_at
FROM delivery_partner_menu_items pmi
JOIN delivery_partners dp ON pmi.partner_id = dp.id
JOIN locations l ON pmi.location_id = l.id
GROUP BY l.id, l.name, dp.id, dp.display_name;

-- ======================
-- SAMPLE DATA FOR TESTING
-- ======================

-- -- Sample partner credentials (replace with actual credentials)
-- INSERT INTO delivery_partner_credentials (
--     location_id, partner_id, partner_merchant_id, partner_store_id, 
--     api_key, commission_rate, delivery_fee, minimum_order_amount, is_active
-- )
-- SELECT 
--     l.id,
--     dp.id,
--     'sample_merchant_' || l.id::text,
--     'sample_store_' || l.id::text,
--     'sample_api_key_' || dp.name,
--     -- Vary commission rates by location (some get better rates)
--     CASE 
--         WHEN l.id::text ~ '[02468]$' THEN dp.default_commission_rate - 2.0 -- Even IDs get 2% discount
--         WHEN l.id::text ~ '[13579]$' THEN dp.default_commission_rate + 1.0 -- Odd IDs pay 1% more
--         ELSE dp.default_commission_rate
--     END,
--     -- Vary delivery fees by location
--     CASE 
--         WHEN dp.name = 'uber_eats' THEN 2.99
--         WHEN dp.name = 'doordash' THEN 3.99
--         WHEN dp.name = 'grubhub' THEN 4.99
--         ELSE 2.99
--     END,
--     -- Minimum order amounts
--     CASE 
--         WHEN dp.name = 'uber_eats' THEN 12.00
--         WHEN dp.name = 'doordash' THEN 15.00
--         WHEN dp.name = 'grubhub' THEN 10.00
--         ELSE 12.00
--     END,
--     true
-- FROM locations l
-- CROSS JOIN delivery_partners dp
-- WHERE l.is_active = true AND dp.is_active = true
-- LIMIT 10; -- Limit to avoid too much sample data

-- -- Comments for documentation
-- COMMENT ON TABLE delivery_partners IS 'Stores configuration for different delivery platforms (Uber Eats, DoorDash, etc.)';
-- COMMENT ON TABLE delivery_partner_credentials IS 'API credentials and partner-specific configuration per location';
-- COMMENT ON TABLE delivery_partner_menu_items IS 'Maps local menu items to partner platform items with different pricing/names';
-- COMMENT ON TABLE delivery_partner_orders IS 'Orders received from delivery partners with partner-specific details';
-- COMMENT ON TABLE delivery_partner_webhook_events IS 'Logs all webhook events received from delivery partners';
-- COMMENT ON TABLE uber_eats_store_config IS 'Uber Eats specific configuration per location';
-- COMMENT ON TABLE uber_eats_orders IS 'Uber Eats specific order details and mapping'; 

