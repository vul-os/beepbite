-- Migration 019: auto-grant full capabilities to owner/manager memberships.
--
-- When the onboarding flow (or any caller) inserts an organization_members row
-- with role='owner' or 'manager' and an empty capabilities object, stamp the
-- full default capability set so the owner can immediately void/comp/settle/
-- view reports/manage inventory/etc.
--
-- This is a BEFORE INSERT/UPDATE trigger that only mutates the NEW row — it
-- performs no cross-table writes, so it does not interact with RLS on other
-- tables and needs no service-role elevation.

BEGIN;

CREATE OR REPLACE FUNCTION public.default_member_capabilities()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    -- Only fill when capabilities are absent/empty so explicit grants are kept.
    IF NEW.capabilities IS NULL OR NEW.capabilities = '{}'::jsonb THEN
        IF NEW.role IN ('owner', 'manager', 'admin') THEN
            NEW.capabilities := jsonb_build_object(
                'can_pos',               true,
                'can_kitchen',           true,
                'can_void',              true,
                'can_comp',              true,
                'can_refund',            true,
                'can_settle',            true,
                'can_view_reports',      true,
                'can_manage_payroll',    true,
                'can_manage_bank',       true,
                'can_manage_inventory',  true,
                'can_view_inventory',    true,
                'can_manage_promotions', true,
                'can_manage_menu',       true,
                'can_drive',             false
            );
        ELSIF NEW.role = 'kitchen' THEN
            NEW.capabilities := jsonb_build_object('can_kitchen', true, 'can_view_inventory', true);
        ELSIF NEW.role = 'pos' THEN
            NEW.capabilities := jsonb_build_object('can_pos', true, 'can_settle', true);
        ELSIF NEW.role = 'driver' THEN
            NEW.capabilities := jsonb_build_object('can_drive', true);
        END IF;
        -- role='staff' keeps an empty capability set (explicit grants only).
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_default_member_capabilities ON organization_members;
CREATE TRIGGER trg_default_member_capabilities
    BEFORE INSERT OR UPDATE OF role ON organization_members
    FOR EACH ROW
    EXECUTE FUNCTION public.default_member_capabilities();

COMMIT;
