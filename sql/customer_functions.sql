-- Drop existing functions
DROP FUNCTION IF EXISTS public.get_or_create_customer CASCADE;
DROP FUNCTION IF EXISTS public.create_bite_with_customer CASCADE;

-- Function to get or create a customer by original number
CREATE OR REPLACE FUNCTION public.get_or_create_customer(
    p_original_number text,
    p_display_name text DEFAULT NULL,
    p_first_name text DEFAULT NULL,
    p_last_name text DEFAULT NULL,
    p_email text DEFAULT NULL
)
RETURNS uuid AS $$
DECLARE
    customer_id uuid;
    normalized_number text;
BEGIN
    -- Normalize phone number by removing + prefix if present for storage
    normalized_number := CASE 
        WHEN p_original_number LIKE '+%' THEN SUBSTRING(p_original_number FROM 2)
        ELSE p_original_number
    END;

    -- First try to find existing customer by normalized number
    SELECT id INTO customer_id
    FROM customers
    WHERE whatsapp_number = normalized_number;
    
    -- If customer exists, update last_seen_at and return id
    IF customer_id IS NOT NULL THEN
        UPDATE customers 
        SET 
            last_seen_at = timezone('utc'::text, now()),
            -- Update fields if new values provided
            display_name = COALESCE(p_display_name, display_name),
            first_name = COALESCE(p_first_name, first_name),
            last_name = COALESCE(p_last_name, last_name),
            email = COALESCE(p_email, email)
        WHERE id = customer_id;
        
        RETURN customer_id;
    END IF;
    
    -- Customer doesn't exist, create new one
    INSERT INTO customers (
        whatsapp_number,
        display_name,
        first_name,
        last_name,
        email,
        last_seen_at
    ) VALUES (
        normalized_number,
        p_display_name,
        p_first_name,
        p_last_name,
        p_email,
        timezone('utc'::text, now())
    ) RETURNING id INTO customer_id;
    
    RETURN customer_id;
    
EXCEPTION
    WHEN OTHERS THEN
        RAISE WARNING 'Error in get_or_create_customer: %', SQLERRM;
        RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to create a bite with automatic customer handling using original number
CREATE OR REPLACE FUNCTION public.create_bite_with_customer(
    p_bistro_id uuid,
    p_order_number text,
    p_original_number text,
    p_customer_display_name text DEFAULT NULL,
    p_status text DEFAULT 'pending'
)
RETURNS uuid AS $$
DECLARE
    bite_id uuid;
    customer_id uuid;
    normalized_number text;
BEGIN
    -- Normalize phone number by removing + prefix if present
    normalized_number := CASE 
        WHEN p_original_number LIKE '+%' THEN SUBSTRING(p_original_number FROM 2)
        ELSE p_original_number
    END;

    -- Get or create customer using original number
    customer_id := get_or_create_customer(p_original_number, p_customer_display_name);
    
    IF customer_id IS NULL THEN
        RAISE EXCEPTION 'Failed to get or create customer for number: %', p_original_number;
    END IF;
    
    -- Create the bite with both original and normalized numbers
    INSERT INTO bites (
        bistro_id,
        customer_id,
        order_number,
        whatsapp_number,
        original_number,
        status
    ) VALUES (
        p_bistro_id,
        customer_id,
        p_order_number,
        normalized_number,
        p_original_number,
        p_status
    ) RETURNING id INTO bite_id;
    
    RETURN bite_id;
    
EXCEPTION
    WHEN OTHERS THEN
        RAISE WARNING 'Error in create_bite_with_customer: %', SQLERRM;
        RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER; 