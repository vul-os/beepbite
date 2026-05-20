-- For single-tenant merchants, the organisation IS the location. Whenever a
-- new org is created, auto-create a matching location with the same name
-- and the first available region as a sensible default. The merchant can
-- rename / re-region later from settings.
--
-- This removes the need for the onboarding popup to know about regions or
-- to issue a second INSERT after the org create — the UI just creates an
-- organisation row and the location appears automatically.

CREATE OR REPLACE FUNCTION public.handle_new_organization()
RETURNS TRIGGER AS $$
DECLARE
    default_region_id uuid;
BEGIN
    -- Skip if a location already exists for this org (defensive — covers
    -- the case where a manual seed pre-inserted one).
    IF EXISTS (SELECT 1 FROM public.locations WHERE organization_id = NEW.id) THEN
        RETURN NEW;
    END IF;

    SELECT id INTO default_region_id
    FROM public.regions
    WHERE is_active = true
    ORDER BY code
    LIMIT 1;

    IF default_region_id IS NULL THEN
        RAISE NOTICE 'handle_new_organization: no active regions configured; skipping default location';
        RETURN NEW;
    END IF;

    INSERT INTO public.locations (organization_id, name, region_id)
    VALUES (NEW.id, NEW.name, default_region_id);

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_organization_created ON public.organizations;
CREATE TRIGGER on_organization_created
    AFTER INSERT ON public.organizations
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_organization();
