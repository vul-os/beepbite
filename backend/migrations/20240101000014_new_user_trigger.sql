-- Trigger fires on new row in our own auth_users table (replaces the original
-- supabase auth.users trigger).

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
DECLARE
   new_profile_id uuid;
   organization_id uuid;
   location_id uuid;
   invite_exists boolean;
   proposed_username text;
   final_username text;
   username_counter integer := 1;
   username_exists boolean;
BEGIN
   -- Determine username: use provided username or extract from email
   proposed_username := COALESCE(
       NULLIF(trim(new.raw_user_meta_data->>'username'), ''),
       split_part(new.email, '@', 1)
   );

   -- Ensure username meets minimum length requirement (3 characters)
   IF char_length(proposed_username) < 3 THEN
       proposed_username := proposed_username || '123';
   END IF;

   -- Handle potential username conflicts
   final_username := proposed_username;

   LOOP
       SELECT EXISTS(
           SELECT 1 FROM public.profiles WHERE username = final_username
       ) INTO username_exists;

       IF NOT username_exists THEN
           EXIT;
       END IF;

       final_username := proposed_username || username_counter::text;
       username_counter := username_counter + 1;
   END LOOP;

   -- Create profile and get its ID
   INSERT INTO public.profiles (id, full_name, email, avatar_url, username)
   VALUES (
       new.id,
       new.raw_user_meta_data->>'full_name',
       new.email,
       new.raw_user_meta_data->>'avatar_url',
       final_username
   )
   RETURNING id INTO new_profile_id;

   -- Check if user has pending invites
   SELECT EXISTS(
       SELECT 1 FROM public.organization_invites
       WHERE email = new.email AND status = 'pending'
   ) INTO invite_exists;

   IF NOT invite_exists THEN
       -- Create new organization
       INSERT INTO public.organizations (name)
       VALUES (
           concat(
               initcap(split_part(new.email, '@', 1)),
               '''s Organization'
           )
       )
       RETURNING id INTO organization_id;

       -- Create default location with organization_id
       INSERT INTO public.locations (organization_id, name, address)
       VALUES (
           organization_id,
           concat(
               initcap(split_part(new.email, '@', 1)),
               '''s Location'
           ),
           'Main Location'
       )
       RETURNING id INTO location_id;

       -- Add user as owner of the organization
       INSERT INTO public.organization_members (
           organization_id,
           profile_id,
           role
       )
       VALUES (
           organization_id,
           new_profile_id,
           'owner'
       );
   ELSE
       -- Accept pending invites
       UPDATE public.organization_invites
       SET status = 'accepted', updated_at = now()
       WHERE email = new.email AND status = 'pending';

       -- Add user to organizations they were invited to
       INSERT INTO public.organization_members (organization_id, profile_id, role)
       SELECT organization_id, new_profile_id, role
       FROM public.organization_invites
       WHERE email = new.email AND status = 'accepted';
   END IF;

   RETURN new;
EXCEPTION WHEN others THEN
   raise log 'Error in handle_new_user: %', SQLERRM;
   RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
   AFTER INSERT ON auth_users
   FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
