-- Core function to send WhatsApp notifications
CREATE OR REPLACE FUNCTION public.send_whatsapp_bite_notification(bite_uuid uuid, bite_status text)
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
            'bite_id', bite_uuid::text,
            'order_status', bite_status
        ),
        '{}'::jsonb, -- No URL params
        '{"Content-Type": "application/json"}'::jsonb,
        30000 -- 30 second timeout
    );
    
    RAISE NOTICE 'WhatsApp notification sent for bite % with status %', bite_uuid, bite_status;
    RETURN true;
EXCEPTION
    WHEN OTHERS THEN
        RAISE WARNING 'Error sending WhatsApp notification: %', SQLERRM;
        RETURN false;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Updated trigger function that handles both INSERT and UPDATE
CREATE OR REPLACE FUNCTION public.handle_bite_status_notification()
RETURNS TRIGGER AS $$
BEGIN
    -- Handle INSERT (new bite created)
    IF TG_OP = 'INSERT' THEN
        PERFORM send_whatsapp_bite_notification(NEW.id, NEW.status);
        RETURN NEW;
    END IF;
    
    -- Handle UPDATE (status changed)
    IF TG_OP = 'UPDATE' THEN
        -- Only send notification if status actually changed
        IF OLD.status IS DISTINCT FROM NEW.status THEN
            PERFORM send_whatsapp_bite_notification(NEW.id, NEW.status);
        END IF;
        RETURN NEW;
    END IF;
    
    RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Drop existing triggers to avoid conflicts
DROP TRIGGER IF EXISTS bite_status_update_trigger ON bites;
DROP TRIGGER IF EXISTS bite_status_insert_trigger ON bites;

-- Create trigger for INSERT operations (new bites)
CREATE TRIGGER bite_status_insert_trigger
    AFTER INSERT ON bites
    FOR EACH ROW
    EXECUTE FUNCTION handle_bite_status_notification();

-- Create trigger for UPDATE operations (status changes)
CREATE TRIGGER bite_status_update_trigger
    AFTER UPDATE OF status ON bites
    FOR EACH ROW
    EXECUTE FUNCTION handle_bite_status_notification();

-- Alternative: Single trigger that handles both INSERT and UPDATE
-- Uncomment this section if you prefer one trigger instead of two:

/*
-- Drop the separate triggers
DROP TRIGGER IF EXISTS bite_status_insert_trigger ON bites;
DROP TRIGGER IF EXISTS bite_status_update_trigger ON bites;

-- Create single trigger for both operations
CREATE TRIGGER bite_status_notification_trigger
    AFTER INSERT OR UPDATE OF status ON bites
    FOR EACH ROW
    EXECUTE FUNCTION handle_bite_status_notification();
*/