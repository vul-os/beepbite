-- Function to get unreviewed bites for a WhatsApp number
CREATE OR REPLACE FUNCTION get_unreviewed_bites(whatsapp_num TEXT)
RETURNS TABLE (
    bite_id UUID,
    order_number TEXT,
    created_at TIMESTAMPTZ,
    bistro_name TEXT
) 
LANGUAGE plpgsql
AS $$
BEGIN
    RETURN QUERY
    SELECT 
        b.id as bite_id,
        b.order_number,
        b.created_at,
        bistros.name as bistro_name
    FROM bites b
    INNER JOIN bistros ON b.bistro_id = bistros.id
    WHERE 
        b.whatsapp_number = whatsapp_num
        AND b.status IN ('completed', 'ready')
        AND b.created_at >= NOW() - INTERVAL '48 hours'
        AND NOT EXISTS (
            SELECT 1 FROM reviews r WHERE r.bite_id = b.id
        )
    ORDER BY b.created_at DESC;
END;
$$;

-- Test query: Check all bites for a phone number (replace with actual number)
-- SELECT * FROM get_unreviewed_bites('1234567890'); 