-- Function to get unreviewed orders for a WhatsApp number (considering 24-hour chat window)
CREATE OR REPLACE FUNCTION get_unreviewed_orders(whatsapp_num TEXT)
RETURNS TABLE (
    order_id UUID,
    order_number TEXT,
    created_at TIMESTAMPTZ,
    location_name TEXT,
    can_send_whatsapp BOOLEAN,
    customer_email TEXT
) 
LANGUAGE plpgsql
AS $$
BEGIN
    RETURN QUERY
    SELECT 
        o.id as order_id,
        o.order_number,
        o.created_at,
        l.name as location_name,
        -- Check if we can send WhatsApp (last message within 24 hours)
        CASE 
            WHEN EXISTS (
                SELECT 1 FROM chats c 
                INNER JOIN messages m ON c.id = m.chat_id 
                INNER JOIN customers cust ON c.customer_id = cust.id
                WHERE cust.whatsapp_number = whatsapp_num 
                AND m.created_at >= NOW() - INTERVAL '24 hours'
            ) THEN true
            ELSE false
        END as can_send_whatsapp,
        -- Get customer email if available
        customers.email as customer_email
    FROM orders o
    INNER JOIN locations l ON o.location_id = l.id
    INNER JOIN customers ON o.customer_id = customers.id
    WHERE 
        customers.whatsapp_number = whatsapp_num
        AND o.status IN ('completed', 'ready')
        AND NOT EXISTS (
            SELECT 1 FROM reviews r WHERE r.order_id = o.id
        )
    ORDER BY o.created_at DESC;
END;
$$;

-- Test query: Check all orders for a phone number (replace with actual number)
-- SELECT * FROM get_unreviewed_orders('+27821234567');
-- Result includes: order_id, order_number, created_at, location_name, can_send_whatsapp, customer_email 

