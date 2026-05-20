-- Trigger fires on new row in auth_users. Responsibility scope:
--   - Create the public.profiles row (deterministic from auth metadata).
--   - Auto-accept any pending organization_invites and attach the user
--     to those orgs.
--
-- Org / location creation is INTENTIONALLY NOT done here. That belongs
-- to the onboarding popup so the user supplies a real business name +
-- address instead of a placeholder. After signup, AuthContext sees
-- organizations.length === 0 and flips needsOnboarding=true.

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
DECLARE
    new_profile_id uuid;
    proposed_username text;
    final_username text;
    username_counter integer := 1;
    username_exists boolean;
    invite_count integer;
BEGIN
    proposed_username := COALESCE(
        NULLIF(trim(new.raw_user_meta_data->>'username'), ''),
        split_part(new.email, '@', 1)
    );

    IF char_length(proposed_username) < 3 THEN
        proposed_username := proposed_username || '123';
    END IF;

    final_username := proposed_username;
    LOOP
        SELECT EXISTS(
            SELECT 1 FROM public.profiles WHERE username = final_username
        ) INTO username_exists;
        EXIT WHEN NOT username_exists;
        final_username := proposed_username || username_counter::text;
        username_counter := username_counter + 1;
    END LOOP;

    INSERT INTO public.profiles (id, full_name, email, avatar_url, username)
    VALUES (
        new.id,
        new.raw_user_meta_data->>'full_name',
        new.email,
        new.raw_user_meta_data->>'avatar_url',
        final_username
    )
    ON CONFLICT (id) DO NOTHING
    RETURNING id INTO new_profile_id;

    IF new_profile_id IS NULL THEN
        SELECT id INTO new_profile_id FROM public.profiles WHERE id = new.id;
    END IF;

    -- Auto-accept any pending invites addressed to this email.
    SELECT count(*) INTO invite_count
    FROM public.organization_invites
    WHERE email = new.email AND status = 'pending';

    IF invite_count > 0 THEN
        INSERT INTO public.organization_members (organization_id, profile_id, role)
        SELECT organization_id, new_profile_id, role
        FROM public.organization_invites
        WHERE email = new.email AND status = 'pending'
        ON CONFLICT (organization_id, profile_id) DO NOTHING;

        UPDATE public.organization_invites
        SET status = 'accepted', updated_at = now()
        WHERE email = new.email AND status = 'pending';
    END IF;

    RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth_users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
