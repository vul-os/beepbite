-- ======================
-- REMOVE BOT LOCATION DEPENDENCY
-- Make bots global instead of location-specific
-- ======================

-- Remove location_id constraint and column from bots table
ALTER TABLE bots DROP CONSTRAINT IF EXISTS bots_location_id_fkey;
ALTER TABLE bots DROP COLUMN IF EXISTS location_id;

-- Make location_id in chats table nullable since chat can exist without location context initially
ALTER TABLE chats ALTER COLUMN location_id DROP NOT NULL;

-- Update any existing chats to remove the location requirement if needed
-- (This is safe since we'll set location_id during order process)

-- Update the bot menu sessions view to handle nullable location
DROP VIEW IF EXISTS active_bot_sessions;
CREATE VIEW active_bot_sessions AS
SELECT 
    bms.id,
    bms.chat_id,
    bms.customer_id,
    c.whatsapp_number,
    c.first_name,
    c.last_name,
    bms.current_menu_level,
    bms.delivery_type,
    l.name as selected_location_name,
    bms.last_activity_at,
    bms.created_at
FROM bot_menu_sessions bms
JOIN customers c ON bms.customer_id = c.id
LEFT JOIN locations l ON bms.selected_location_id = l.id
WHERE bms.is_active = true
ORDER BY bms.last_activity_at DESC;

-- Update chat indexes to work without location requirement
DROP INDEX IF EXISTS idx_chats_location_status;
CREATE INDEX idx_chats_location_status ON chats(location_id, status) WHERE location_id IS NOT NULL;

-- Comments for clarity
COMMENT ON TABLE bots IS 'Global WhatsApp bots - one bot serves all locations';
COMMENT ON COLUMN chats.location_id IS 'Optional location context - set when customer starts ordering from specific location'; 