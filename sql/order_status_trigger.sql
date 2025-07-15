-- Core function to send WhatsApp notifications
CREATE OR REPLACE FUNCTION public.send_whatsapp_order_notification(order_uuid uuid, order_status text)
RETURNS boolean AS $$
DECLARE
    send_url text;
BEGIN
    -- Set the edge function URL
    send_url := 'https://afbfotxelguficwfagnu.supabase.co/functions/v1/chatbot-whatsapp-send';
    
    -- Send the HTTP request to WhatsApp send function
    PERFORM net.http_post(
        send_url,
        jsonb_build_object(
            'order_id', order_uuid::text,
            'order_status', order_status
        ),
        '{}'::jsonb, -- No URL params
        '{"Content-Type": "application/json"}'::jsonb,
        30000 -- 30 second timeout
    );
    
    RAISE NOTICE 'WhatsApp notification sent for order % with status %', order_uuid, order_status;
    RETURN true;
EXCEPTION
    WHEN OTHERS THEN
        RAISE WARNING 'Error sending WhatsApp notification: %', SQLERRM;
        RETURN false;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Updated trigger function that handles both INSERT and UPDATE
CREATE OR REPLACE FUNCTION public.handle_order_status_notification()
RETURNS TRIGGER AS $$
BEGIN
    -- Handle INSERT (new order created)
    IF TG_OP = 'INSERT' THEN
        PERFORM send_whatsapp_order_notification(NEW.id, NEW.status);
        RETURN NEW;
    END IF;
    
    -- Handle UPDATE (status changed)
    IF TG_OP = 'UPDATE' THEN
        -- Only send notification if status actually changed
        IF OLD.status IS DISTINCT FROM NEW.status THEN
            PERFORM send_whatsapp_order_notification(NEW.id, NEW.status);
        END IF;
        RETURN NEW;
    END IF;
    
    RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Drop existing triggers to avoid conflicts
DROP TRIGGER IF EXISTS order_status_update_trigger ON orders;
DROP TRIGGER IF EXISTS order_status_insert_trigger ON orders;

-- Create trigger for INSERT operations (new orders)
CREATE TRIGGER order_status_insert_trigger
    AFTER INSERT ON orders
    FOR EACH ROW
    EXECUTE FUNCTION handle_order_status_notification();

-- Create trigger for UPDATE operations (status changes)
CREATE TRIGGER order_status_update_trigger
    AFTER UPDATE OF status ON orders
    FOR EACH ROW
    EXECUTE FUNCTION handle_order_status_notification();

-- Alternative: Single trigger that handles both INSERT and UPDATE
-- Uncomment this section if you prefer one trigger instead of two:

/*
-- Drop the separate triggers
DROP TRIGGER IF EXISTS order_status_insert_trigger ON orders;
DROP TRIGGER IF EXISTS order_status_update_trigger ON orders;

-- Create single trigger for both operations
CREATE TRIGGER order_status_notification_trigger
    AFTER INSERT OR UPDATE OF status ON orders
    FOR EACH ROW
    EXECUTE FUNCTION handle_order_status_notification();
*/