-- Function to lookup customer details by WhatsApp number
CREATE OR REPLACE FUNCTION lookup_customer_details(input_whatsapp_number TEXT)
RETURNS TABLE (
    customer_id UUID,
    whatsapp_number TEXT,
    email TEXT,
    first_name TEXT,
    last_name TEXT,
    has_chats BOOLEAN,
    has_recent_activity BOOLEAN,
    last_seen_at TIMESTAMPTZ,
    total_orders INTEGER,
    completed_orders INTEGER
) 
LANGUAGE plpgsql
AS $$
DECLARE
    normalized_number TEXT;
    twenty_four_hours_ago TIMESTAMPTZ;
BEGIN
    -- Normalize the input number (remove + if present)
    normalized_number := CASE 
        WHEN input_whatsapp_number LIKE '+%' THEN SUBSTRING(input_whatsapp_number FROM 2)
        ELSE input_whatsapp_number
    END;
    
    -- Calculate 24 hours ago
    twenty_four_hours_ago := NOW() - INTERVAL '24 hours';
    
    RETURN QUERY
    SELECT 
        c.id as customer_id,
        c.whatsapp_number,
        c.email,
        c.first_name,
        c.last_name,
        -- Check if customer has any chats
        EXISTS(
            SELECT 1 FROM chats ch WHERE ch.customer_id = c.id
        ) as has_chats,
        -- Check if customer has recent chat activity (within 24 hours)
        CASE 
            WHEN EXISTS(
                SELECT 1 
                FROM chats ch 
                INNER JOIN messages m ON ch.id = m.chat_id 
                WHERE ch.customer_id = c.id 
                AND m.created_at >= twenty_four_hours_ago
            ) THEN true
            ELSE false
        END as has_recent_activity,
        c.last_seen_at,
        -- Count total orders for this customer
        COALESCE((
            SELECT COUNT(*) 
            FROM orders o 
            WHERE o.customer_id = c.id
        ), 0)::INTEGER as total_orders,
        -- Count completed orders for this customer
        COALESCE((
            SELECT COUNT(*) 
            FROM orders o 
            WHERE o.customer_id = c.id AND o.status = 'completed'
        ), 0)::INTEGER as completed_orders
    FROM customers c
    WHERE c.whatsapp_number = normalized_number;
    
    -- If no customer found, return null row to indicate no match
    IF NOT FOUND THEN
        RETURN QUERY SELECT 
            NULL::UUID, NULL::TEXT, NULL::TEXT, NULL::TEXT, NULL::TEXT,
            FALSE, FALSE, NULL::TIMESTAMPTZ, 0::INTEGER, 0::INTEGER;
    END IF;
END;
$$;

-- Test the function (replace with actual number)
-- SELECT * FROM lookup_customer_details('+27821234567');
-- SELECT * FROM lookup_customer_details('27821234567'); 