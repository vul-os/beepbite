-- ======================
-- BOT MENU SESSION MANAGEMENT
-- WhatsApp Bot Navigation and State Management
-- ======================

-- Bot menu sessions for tracking current menu position and flow state
CREATE TABLE bot_menu_sessions (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    chat_id uuid REFERENCES chats(id) ON DELETE CASCADE NOT NULL UNIQUE,
    customer_id uuid REFERENCES customers(id) ON DELETE CASCADE NOT NULL,
    
    -- Current navigation state
    current_menu_level text DEFAULT 'main' CHECK (current_menu_level IN ('main', 'order_type', 'address_selection', 'store_selection', 'categories', 'items', 'item_details', 'checkout', 'payment')),
    current_category_id uuid REFERENCES categories(id) ON DELETE SET NULL,
    current_item_id uuid REFERENCES items(id) ON DELETE SET NULL,
    
    -- Order flow state
    delivery_type text CHECK (delivery_type IN ('delivery', 'collection')),
    selected_location_id uuid REFERENCES locations(id) ON DELETE SET NULL,
    selected_address_id uuid REFERENCES customer_addresses(id) ON DELETE SET NULL,
    
    -- Menu navigation history for back button
    previous_menu_level text,
    menu_history jsonb DEFAULT '[]', -- Array of previous menu states
    
    -- Temporary data during order process
    temp_address_data jsonb, -- For new address input
    temp_item_customizations jsonb, -- For item variations during selection
    
    -- Session management
    is_active boolean DEFAULT true,
    last_activity_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL,
    
    created_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- ======================
-- BOT MENU FUNCTIONS
-- ======================

-- Function to update bot menu session
CREATE OR REPLACE FUNCTION update_bot_menu_session(
    p_chat_id uuid,
    p_menu_level text DEFAULT NULL,
    p_category_id uuid DEFAULT NULL,
    p_item_id uuid DEFAULT NULL,
    p_delivery_type text DEFAULT NULL,
    p_location_id uuid DEFAULT NULL,
    p_address_id uuid DEFAULT NULL
)
RETURNS void AS $$
BEGIN
    INSERT INTO bot_menu_sessions (
        chat_id, 
        customer_id, 
        current_menu_level, 
        current_category_id, 
        current_item_id,
        delivery_type,
        selected_location_id,
        selected_address_id,
        last_activity_at
    )
    SELECT 
        p_chat_id,
        c.customer_id,
        COALESCE(p_menu_level, 'main'),
        p_category_id,
        p_item_id,
        p_delivery_type,
        p_location_id,
        p_address_id,
        now()
    FROM chats c WHERE c.id = p_chat_id
    ON CONFLICT (chat_id) DO UPDATE SET
        current_menu_level = COALESCE(p_menu_level, bot_menu_sessions.current_menu_level),
        current_category_id = COALESCE(p_category_id, bot_menu_sessions.current_category_id),
        current_item_id = COALESCE(p_item_id, bot_menu_sessions.current_item_id),
        delivery_type = COALESCE(p_delivery_type, bot_menu_sessions.delivery_type),
        selected_location_id = COALESCE(p_location_id, bot_menu_sessions.selected_location_id),
        selected_address_id = COALESCE(p_address_id, bot_menu_sessions.selected_address_id),
        last_activity_at = now(),
        updated_at = now();
END;
$$ LANGUAGE plpgsql;

-- Function to reset bot menu session
CREATE OR REPLACE FUNCTION reset_bot_menu_session(p_chat_id uuid)
RETURNS void AS $$
BEGIN
    UPDATE bot_menu_sessions 
    SET 
        current_menu_level = 'main',
        current_category_id = NULL,
        current_item_id = NULL,
        delivery_type = NULL,
        selected_location_id = NULL,
        selected_address_id = NULL,
        previous_menu_level = NULL,
        menu_history = '[]',
        temp_address_data = NULL,
        temp_item_customizations = NULL,
        last_activity_at = now(),
        updated_at = now()
    WHERE chat_id = p_chat_id;
END;
$$ LANGUAGE plpgsql;

-- Function to get current bot menu state
CREATE OR REPLACE FUNCTION get_bot_menu_state(p_chat_id uuid)
RETURNS TABLE (
    menu_level text,
    category_id uuid,
    item_id uuid,
    delivery_type text,
    location_id uuid,
    address_id uuid,
    temp_data jsonb
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        bms.current_menu_level,
        bms.current_category_id,
        bms.current_item_id,
        bms.delivery_type,
        bms.selected_location_id,
        bms.selected_address_id,
        bms.temp_item_customizations
    FROM bot_menu_sessions bms
    WHERE bms.chat_id = p_chat_id
    AND bms.is_active = true;
END;
$$ LANGUAGE plpgsql;

-- Function to add menu history for back navigation
CREATE OR REPLACE FUNCTION push_menu_history(p_chat_id uuid, p_menu_level text)
RETURNS void AS $$
BEGIN
    UPDATE bot_menu_sessions
    SET 
        menu_history = menu_history || jsonb_build_object('level', p_menu_level, 'timestamp', now()),
        previous_menu_level = current_menu_level,
        updated_at = now()
    WHERE chat_id = p_chat_id;
END;
$$ LANGUAGE plpgsql;

-- Function to go back to previous menu level
CREATE OR REPLACE FUNCTION go_back_menu_level(p_chat_id uuid)
RETURNS text AS $$
DECLARE
    prev_level text;
BEGIN
    SELECT previous_menu_level INTO prev_level
    FROM bot_menu_sessions
    WHERE chat_id = p_chat_id;
    
    IF prev_level IS NOT NULL THEN
        UPDATE bot_menu_sessions
        SET 
            current_menu_level = prev_level,
            previous_menu_level = NULL,
            updated_at = now()
        WHERE chat_id = p_chat_id;
    END IF;
    
    RETURN COALESCE(prev_level, 'main');
END;
$$ LANGUAGE plpgsql;

-- Function to clean up inactive sessions (run periodically)
CREATE OR REPLACE FUNCTION cleanup_inactive_bot_sessions()
RETURNS integer AS $$
DECLARE
    deleted_count integer;
BEGIN
    DELETE FROM bot_menu_sessions
    WHERE last_activity_at < (now() - interval '24 hours')
    AND is_active = false;
    
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

-- ======================
-- BOT MENU VIEWS
-- ======================

-- View for active bot sessions with customer details

-- Update the bot menu sessions view to handle nullable location
DROP VIEW IF EXISTS active_bot_sessions;
CREATE VIEW active_bot_sessions AS
SELECT 
    bms.id,
    bms.chat_id,
    bms.customer_id,
    c.whatsapp_number,
    c.first_name,
    c.last_name,
    bms.current_menu_level,
    bms.delivery_type,
    l.name as selected_location_name,
    bms.last_activity_at,
    bms.created_at
FROM bot_menu_sessions bms
JOIN customers c ON bms.customer_id = c.id
LEFT JOIN locations l ON bms.selected_location_id = l.id
WHERE bms.is_active = true
ORDER BY bms.last_activity_at DESC;

-- ======================
-- BOT MENU PERFORMANCE INDEXES
-- ======================

-- Index for bot menu sessions
CREATE INDEX idx_bot_menu_sessions_chat ON bot_menu_sessions(chat_id);
CREATE INDEX idx_bot_menu_sessions_customer ON bot_menu_sessions(customer_id);
CREATE INDEX idx_bot_menu_sessions_activity ON bot_menu_sessions(last_activity_at);
CREATE INDEX idx_bot_menu_sessions_location ON bot_menu_sessions(selected_location_id);
CREATE INDEX idx_bot_menu_sessions_active ON bot_menu_sessions(is_active);
CREATE INDEX idx_bot_menu_sessions_menu_level ON bot_menu_sessions(current_menu_level);

-- ======================
-- WHATSAPP BOT PERFORMANCE INDEXES
-- ======================

-- Core WhatsApp performance indexes
CREATE INDEX idx_chats_customer_bot ON chats(customer_id, bot_id);
CREATE INDEX IF NOT EXISTS idx_chats_location_status ON chats(location_id, status);
CREATE INDEX idx_messages_chat_direction ON messages(chat_id, direction);
CREATE INDEX idx_messages_whatsapp_id ON messages(whatsapp_message_id);
CREATE INDEX idx_customers_whatsapp ON customers(whatsapp_number);
CREATE INDEX idx_customers_last_order ON customers(last_order_at);
CREATE INDEX idx_customer_addresses_customer_default ON customer_addresses(customer_id, is_default);
CREATE INDEX idx_locations_coordinates ON locations(latitude, longitude);
CREATE INDEX idx_items_location_category ON items(location_id, category_id);
CREATE INDEX idx_items_active_price ON items(is_active, price);
CREATE INDEX idx_categories_location_parent ON categories(location_id, parent_id);
CREATE INDEX idx_orders_customer_status ON orders(customer_id, status);
CREATE INDEX idx_orders_location_created ON orders(location_id, created_at);
CREATE INDEX idx_bots_phone_active ON bots(phone_number, is_active); 