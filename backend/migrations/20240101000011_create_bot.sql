-- ======================
-- CREATE GLOBAL WHATSAPP BOT
-- Insert statement to create a bot for the system
-- ======================

-- Insert a new global WhatsApp bot
-- IMPORTANT: whatsapp_phone_number_id is now retrieved from this record, not environment variables!
INSERT INTO bots (
    id,
    phone_number,
    whatsapp_phone_number_id,
    name,
    is_active,
    created_at,
    updated_at
) VALUES (
    '46c4426a-9f5d-43d1-914c-d112deaf1d06',  -- Use the SYSTEM_BOT_ID from code
    '+27123456789',                            -- Replace with your WhatsApp business phone number
    'YOUR_WHATSAPP_PHONE_NUMBER_ID',          -- CRITICAL: Replace with your actual WhatsApp Phone Number ID from Meta Business
    'BeepBite Assistant',                     -- Bot name
    true,                                     -- Active
    now(),                                    -- Created timestamp
    now()                                     -- Updated timestamp
);

-- Verify the bot was created
SELECT * FROM bots WHERE id = '46c4426a-9f5d-43d1-914c-d112deaf1d06';

-- Example with different values (commented out):
/*
INSERT INTO bots (
    phone_number,
    whatsapp_phone_number_id,
    name,
    is_active
) VALUES (
    '+27821234567',
    '1234567890123456',
    'Restaurant Bot',
    true
);
*/

-- How to get your WhatsApp Phone Number ID from Meta Business:
-- 1. Go to Facebook Business Manager
-- 2. Navigate to WhatsApp Manager
-- 3. Go to API Setup
-- 4. Copy the Phone Number ID (looks like: 1234567890123456) 