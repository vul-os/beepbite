-- Function to update bistro details
CREATE OR REPLACE FUNCTION update_bistro_details(
    p_bistro_id uuid,
    p_description text DEFAULT NULL,
    p_cell_number text DEFAULT NULL,
    p_address text DEFAULT NULL,
    p_company_name text DEFAULT NULL,
    p_company_reg_identifier text DEFAULT NULL,
    p_stages jsonb DEFAULT NULL
)
RETURNS TABLE(
    id uuid,
    bistro_id uuid,
    completed boolean,
    description text,
    cell_number text,
    address text,
    company_name text,
    company_reg_identifier text,
    stages jsonb,
    created_at timestamptz,
    updated_at timestamptz
) AS $$
BEGIN
    -- First, try to update existing record
    UPDATE bistro_settings
    SET 
        description = COALESCE(p_description, bistro_settings.description),
        cell_number = COALESCE(p_cell_number, bistro_settings.cell_number),
        address = COALESCE(p_address, bistro_settings.address),
        company_name = COALESCE(p_company_name, bistro_settings.company_name),
        company_reg_identifier = COALESCE(p_company_reg_identifier, bistro_settings.company_reg_identifier),
        stages = COALESCE(p_stages, bistro_settings.stages),
        updated_at = timezone('utc'::text, now())
    WHERE bistro_settings.bistro_id = p_bistro_id;

    -- If no record was updated, insert a new one
    IF NOT FOUND THEN
        INSERT INTO bistro_settings (
            bistro_id,
            description,
            cell_number,
            address,
            company_name,
            company_reg_identifier,
            stages
        )
        VALUES (
            p_bistro_id,
            p_description,
            p_cell_number,
            p_address,
            p_company_name,
            p_company_reg_identifier,
            COALESCE(p_stages, '{}')
        );
    END IF;

    -- Return the updated/inserted record
    RETURN QUERY
    SELECT 
        bs.id,
        bs.bistro_id,
        bs.completed,
        bs.description,
        bs.cell_number,
        bs.address,
        bs.company_name,
        bs.company_reg_identifier,
        bs.stages,
        bs.created_at,
        bs.updated_at
    FROM bistro_settings bs
    WHERE bs.bistro_id = p_bistro_id;

EXCEPTION WHEN others THEN
    RAISE LOG 'Error in update_bistro_details: %', SQLERRM;
    RAISE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Example usage:
-- SELECT * FROM update_bistro_details(
--     'your-bistro-id-here'::uuid,
--     p_description := 'A cozy family restaurant',
--     p_cell_number := '+1234567890',
--     p_address := '123 Main Street, City, Country'
-- );

-- Or update just specific fields:
-- SELECT * FROM update_bistro_details(
--     'your-bistro-id-here'::uuid,
--     p_company_name := 'My Restaurant LLC'
-- );

-- Update stages (JSON):
-- SELECT * FROM update_bistro_details(
--     'your-bistro-id-here'::uuid,
--     p_stages := '{"onboarding": true, "verification": false}'::jsonb
-- ); 