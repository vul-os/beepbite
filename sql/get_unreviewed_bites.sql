-- Function to get unreviewed bites for a WhatsApp number (considering 24-hour chat window)
CREATE OR REPLACE FUNCTION get_unreviewed_bites(whatsapp_num TEXT)
RETURNS TABLE (
    bite_id UUID,
    order_number TEXT,
    created_at TIMESTAMPTZ,
    bistro_name TEXT,
    can_send_whatsapp BOOLEAN,
    customer_email TEXT
) 
LANGUAGE plpgsql
AS $$
BEGIN
    RETURN QUERY
    SELECT 
        b.id as bite_id,
        b.order_number,
        b.created_at,
        bistros.name as bistro_name,
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
    FROM bites b
    INNER JOIN bistros ON b.bistro_id = bistros.id
    INNER JOIN customers ON b.customer_id = customers.id
    WHERE 
        b.whatsapp_number = whatsapp_num
        AND b.status IN ('completed', 'ready')
        AND b.created_at >= NOW() - INTERVAL '24 hours'
        AND NOT EXISTS (
            SELECT 1 FROM reviews r WHERE r.bite_id = b.id
        )
    ORDER BY b.created_at DESC;
END;
$$;

-- Test query: Check all bites for a phone number (replace with actual number)
-- SELECT * FROM get_unreviewed_bites('+27821234567');
-- Result includes: bite_id, order_number, created_at, bistro_name, can_send_whatsapp, customer_email 

