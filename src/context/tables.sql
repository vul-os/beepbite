-- First, recreate tables exactly matching the structure
DROP TABLE IF EXISTS reviews CASCADE;
DROP TABLE IF EXISTS bites CASCADE;
DROP TABLE IF EXISTS bistro_invites CASCADE;
DROP TABLE IF EXISTS bistro_members CASCADE;
DROP TABLE IF EXISTS bistros CASCADE;
DROP TABLE IF EXISTS profiles CASCADE;
DROP TABLE IF EXISTS bistro_settings CASCADE;
DROP TABLE IF EXISTS bistro_verifications CASCADE;

-- Create profiles table EXACTLY as in original
CREATE TABLE profiles (
    id uuid references auth.users on delete cascade not null primary key,
    updated_at timestamp with time zone,
    username text unique,
    full_name text,
    email text unique,
    avatar_url text,
    website text,
    constraint username_length check (char_length(username) >= 3)
);
ALTER TABLE profiles DISABLE ROW LEVEL SECURITY;

-- Create bistros table to match organizations
CREATE TABLE bistros (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    name text NOT NULL,
    created_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL
);

ALTER TABLE bistros 
ADD COLUMN IF NOT EXISTS payment_failed BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS payment_failed_at TIMESTAMP WITH TIME ZONE;

-- Create bistro_members to match organization_members
CREATE TABLE bistro_members (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    bistro_id uuid REFERENCES bistros(id) ON DELETE CASCADE NOT NULL,
    profile_id uuid REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
    role text NOT NULL CHECK (role IN ('owner', 'manager', 'staff')),
    created_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL,
    UNIQUE(bistro_id, profile_id)
);

-- Create bites table (orders)
CREATE TABLE bites (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    bistro_id uuid REFERENCES bistros(id) ON DELETE CASCADE NOT NULL,
    order_number text NOT NULL,
    whatsapp_number text NOT NULL,
    status text DEFAULT 'pending' CHECK (status IN ('pending', 'preparing', 'ready', 'completed', 'cancelled')),
    order_ready_at timestamp with time zone,
    review_requested_at timestamp with time zone,
    created_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL,
    UNIQUE(bistro_id, order_number)
);

-- Create reviews table
CREATE TABLE reviews (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    bite_id uuid REFERENCES bites(id) ON DELETE CASCADE NOT NULL,
    rating integer NOT NULL CHECK (rating >= 1 AND rating <= 10),
    comment text,
    created_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL,
    UNIQUE(bite_id) -- One review per order
);

-- Drop existing triggers and functions
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
DROP FUNCTION IF EXISTS handle_new_user();

-- Create function EXACTLY matching the original structure
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
DECLARE
   new_profile_id uuid;
   bistro_id uuid;
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
       SELECT 1 FROM public.bistro_invites 
       WHERE email = new.email AND status = 'pending'
   ) INTO invite_exists;
   
   IF NOT invite_exists THEN
       -- Create new bistro (matching organization creation)
       INSERT INTO public.bistros (name)
       VALUES (
           concat(
               initcap(split_part(new.email, '@', 1)),
               '''s Bistro'
           )
       )
       RETURNING id INTO bistro_id;
       
       -- Add user as owner (matching original)
       INSERT INTO public.bistro_members (
           bistro_id,
           profile_id,
           role
       )
       VALUES (
           bistro_id,
           new_profile_id,
           'owner'
       );
   ELSE
       -- Accept pending invites
       UPDATE public.bistro_invites 
       SET status = 'accepted', updated_at = now()
       WHERE email = new.email AND status = 'pending';
       
       -- Add user to bistros they were invited to
       INSERT INTO public.bistro_members (bistro_id, profile_id, role)
       SELECT bistro_id, new_profile_id, role
       FROM public.bistro_invites
       WHERE email = new.email AND status = 'accepted';
   END IF;
   
   RETURN new;
EXCEPTION WHEN others THEN
   raise log 'Error in handle_new_user: %', SQLERRM;
   RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create trigger exactly as original
CREATE TRIGGER on_auth_user_created
   AFTER INSERT ON auth.users
   FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Create bistro_invites table for storing pending invitations
CREATE TABLE bistro_invites (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    bistro_id uuid REFERENCES bistros(id) ON DELETE CASCADE NOT NULL,
    email text NOT NULL,
    invited_by uuid REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
    status text NOT NULL CHECK (status IN ('pending', 'accepted', 'rejected')),
    role text NOT NULL CHECK (role IN ('owner', 'manager', 'staff')) DEFAULT 'staff',
    created_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL,
    UNIQUE(bistro_id, email, role, status)
);

-- Add trigger to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = timezone('utc'::text, now());
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Create triggers for updated_at
CREATE TRIGGER update_bistros_updated_at
    BEFORE UPDATE ON bistros
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_bistro_members_updated_at
    BEFORE UPDATE ON bistro_members
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_bites_updated_at
    BEFORE UPDATE ON bites
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_reviews_updated_at
    BEFORE UPDATE ON reviews
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_bistro_invites_updated_at
    BEFORE UPDATE ON bistro_invites
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_bistro_settings_updated_at
    BEFORE UPDATE ON bistro_settings
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_bistro_verifications_updated_at
    BEFORE UPDATE ON bistro_verifications
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Create indexes for better performance
CREATE INDEX idx_bistro_members_bistro_id ON bistro_members(bistro_id);
CREATE INDEX idx_bistro_members_profile_id ON bistro_members(profile_id);
CREATE INDEX idx_bites_bistro_id ON bites(bistro_id);
CREATE INDEX idx_bites_whatsapp_number ON bites(whatsapp_number);
CREATE INDEX idx_bites_status ON bites(status);
CREATE INDEX idx_bites_order_ready_at ON bites(order_ready_at);
CREATE INDEX idx_reviews_bite_id ON reviews(bite_id);
CREATE INDEX idx_reviews_rating ON reviews(rating);
CREATE INDEX idx_bistro_invites_email ON bistro_invites(email);
CREATE INDEX idx_bistro_invites_status ON bistro_invites(status);
CREATE INDEX idx_bistro_settings_bistro_id ON bistro_settings(bistro_id);
CREATE INDEX idx_bistro_verifications_bistro_id ON bistro_verifications(bistro_id);
CREATE INDEX idx_bistro_verifications_status ON bistro_verifications(status);

-- Create bistro_settings table
CREATE TABLE bistro_settings (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    bistro_id uuid REFERENCES bistros(id) ON DELETE CASCADE NOT NULL UNIQUE,
    verified boolean DEFAULT false,
    description text,
    cell_number text,
    address text,
    company_name text,
    company_reg_identifier text,
    stages jsonb DEFAULT '{}',
    created_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Create bistro_verifications table
CREATE TABLE bistro_verifications (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    bistro_id uuid REFERENCES bistros(id) ON DELETE CASCADE NOT NULL,
    status text NOT NULL CHECK (status IN ('pending', 'completed', 'verified')),
    created_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL
);