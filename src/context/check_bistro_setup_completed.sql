-- Function to check if bistro setup is completed
CREATE OR REPLACE FUNCTION check_bistro_setup_completed(p_bistro_id uuid)
RETURNS boolean AS $$
DECLARE
    setup_completed boolean DEFAULT false;
BEGIN
    -- Check if bistro_settings exists and is completed
    SELECT COALESCE(completed, false)
    INTO setup_completed
    FROM bistro_settings
    WHERE bistro_id = p_bistro_id;
    
    -- If no record exists, return false
    IF NOT FOUND THEN
        RETURN false;
    END IF;
    
    RETURN setup_completed;
    
EXCEPTION WHEN others THEN
    RAISE LOG 'Error in check_bistro_setup_completed: %', SQLERRM;
    RETURN false;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Example usage:
-- SELECT check_bistro_setup_completed('your-bistro-id-here'::uuid); 