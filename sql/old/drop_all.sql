-- DROP SCRIPT FOR BEEPBITE DELIVERY SYSTEM
-- This script drops all tables, functions, triggers, and indexes
-- Run this to completely remove the database schema

-- ======================
-- DROP TRIGGERS FIRST
-- ======================

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

-- ======================
-- DROP FUNCTIONS
-- ======================

DROP FUNCTION IF EXISTS public.handle_new_user();
DROP FUNCTION IF EXISTS check_invites();
DROP FUNCTION IF EXISTS respond_invitation(uuid, boolean);
DROP FUNCTION IF EXISTS send_invitation(uuid, text, text);

-- ======================
-- DROP INDEXES
-- ======================

DROP INDEX IF EXISTS unique_order_number_per_day_simplified;

-- ======================
-- DROP TABLES (in reverse dependency order)
-- ======================

-- Drop tables with foreign keys first
DROP TABLE IF EXISTS reviews CASCADE;
DROP TABLE IF EXISTS tax_rates CASCADE;

DROP TABLE IF EXISTS stock_movements CASCADE;
DROP TABLE IF EXISTS inventory_items CASCADE;
DROP TABLE IF EXISTS messages CASCADE;
DROP TABLE IF EXISTS chats CASCADE;
DROP TABLE IF EXISTS bots CASCADE;
DROP TABLE IF EXISTS notifications CASCADE;
DROP TABLE IF EXISTS driver_earnings CASCADE;
DROP TABLE IF EXISTS order_item_variations CASCADE;
DROP TABLE IF EXISTS order_items CASCADE;
DROP TABLE IF EXISTS driver_ratings CASCADE;
DROP TABLE IF EXISTS order_financial_details CASCADE;
DROP TABLE IF EXISTS order_details CASCADE;
DROP TABLE IF EXISTS orders CASCADE;
DROP TABLE IF EXISTS driver_locations CASCADE;
DROP TABLE IF EXISTS delivery_drivers CASCADE;
DROP TABLE IF EXISTS item_variation_options CASCADE;
DROP TABLE IF EXISTS item_variations CASCADE;
DROP TABLE IF EXISTS items CASCADE;
DROP TABLE IF EXISTS categories CASCADE;
DROP TABLE IF EXISTS customers CASCADE;
DROP TABLE IF EXISTS staff_attendance_summary CASCADE;
DROP TABLE IF EXISTS staff_shifts CASCADE;
DROP TABLE IF EXISTS staff_time_entries CASCADE;
DROP TABLE IF EXISTS staff CASCADE;
DROP TABLE IF EXISTS business_invites CASCADE;
DROP TABLE IF EXISTS business_members CASCADE;
DROP TABLE IF EXISTS business_locations CASCADE;
DROP TABLE IF EXISTS locations CASCADE;
DROP TABLE IF EXISTS business_details CASCADE;
DROP TABLE IF EXISTS organizations CASCADE;
DROP TABLE IF EXISTS profiles CASCADE;

-- ======================
-- VERIFICATION QUERY
-- ======================

-- Run this to verify all objects have been dropped
-- SELECT 
--     schemaname,
--     tablename,
--     tableowner
-- FROM pg_tables 
-- WHERE schemaname = 'public' 
-- AND tablename IN (
--     'profiles', 'organizations', 'business_details', 'locations', 'business_locations', 
--     'business_members', 'business_invites', 'staff', 'staff_time_entries', 'staff_shifts', 
--     'staff_attendance_summary', 'customers', 'categories', 'items', 'item_variations', 
--     'item_variation_options', 'delivery_drivers', 'driver_locations', 'orders', 'order_details',
--     'order_financial_details', 'driver_ratings', 'order_items', 'order_item_variations',
--     'driver_earnings', 'notifications', 'bots', 'chats', 'messages',
--     'inventory_items', 'stock_movements', 'tax_rates', 'reviews'
-- );

-- Check for remaining functions
-- SELECT 
--     routine_name,
--     routine_type
-- FROM information_schema.routines 
-- WHERE routine_schema = 'public'
-- AND routine_name IN ('handle_new_user', 'check_invites', 'respond_invitation', 'send_invitation');

RAISE NOTICE 'All tables, functions, triggers, and indexes have been dropped successfully.'; 