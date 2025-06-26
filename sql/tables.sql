-- First, recreate tables exactly matching the structure
DROP TABLE IF EXISTS reviews CASCADE;
DROP TABLE IF EXISTS bites CASCADE;
DROP TABLE IF EXISTS bistro_invites CASCADE;
DROP TABLE IF EXISTS bistro_members CASCADE;
DROP TABLE IF EXISTS bistros CASCADE;
DROP TABLE IF EXISTS profiles CASCADE;

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
    description text,
    whatsapp_number text,
    address text,
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
ALTER TABLE reviews ADD COLUMN anon boolean DEFAULT false;


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

DROP TABLE IF EXISTS bistro_settings CASCADE;

-- Create bistro_settings table
CREATE TABLE bistro_settings (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    bistro_id uuid REFERENCES bistros(id) ON DELETE CASCADE NOT NULL UNIQUE,
    completed boolean DEFAULT false,
    description text,
    cell_number text,
    address text,
    company_name text,
    company_reg_identifier text,
    stages jsonb DEFAULT '{}',
    created_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- NEW STUFF




-- Drop all new tables first
DROP TABLE IF EXISTS messages CASCADE;
DROP TABLE IF EXISTS chats CASCADE;
DROP TABLE IF EXISTS customers CASCADE;
DROP TABLE IF EXISTS customer_bistros CASCADE;
DROP TABLE IF EXISTS bots CASCADE;

-- Drop and recreate bites table with customer_id integrated
DROP TABLE IF EXISTS bites CASCADE;

-- Create customers table to store WhatsApp customer information
CREATE TABLE customers (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    whatsapp_number text NOT NULL UNIQUE, -- International format (e.g., +27821234567)
    display_name text, -- Customer's WhatsApp display name (if available)
    first_name text,
    last_name text,
    email text,
    notes text,
    is_blocked boolean DEFAULT false,
    last_seen_at timestamptz,
    preferences jsonb DEFAULT '{}', -- User preferences learned over time
    conversation_history_summary text, -- AI-generated summary of past interactions
    created_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Create customer_bistros association table for many-to-many relationship
CREATE TABLE customer_bistros (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    customer_id uuid REFERENCES customers(id) ON DELETE CASCADE NOT NULL,
    bistro_id uuid REFERENCES bistros(id) ON DELETE CASCADE NOT NULL,
    first_interaction_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL,
    last_interaction_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL,
    interaction_count integer DEFAULT 1,
    is_blocked boolean DEFAULT false,
    notes text,
    created_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL,
    UNIQUE(customer_id, bistro_id)
);

-- Create bots table to track WhatsApp numbers used for sending messages (needed before chats)
CREATE TABLE bots (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    phone_number text NOT NULL UNIQUE, -- International format (e.g., +27821234567)
    whatsapp_phone_number_id text UNIQUE, -- WhatsApp Phone Number ID from Meta
    name text, -- Optional name/description for the bot
    is_active boolean DEFAULT true,
    created_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Drop and recreate bites table with customer integration
DROP TABLE IF EXISTS bites CASCADE;

CREATE TABLE bites (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    bistro_id uuid REFERENCES bistros(id) ON DELETE CASCADE NOT NULL,
    customer_id uuid REFERENCES customers(id) ON DELETE CASCADE NOT NULL,
    order_number text NOT NULL,
    whatsapp_number text NOT NULL, -- Keep for backwards compatibility and quick reference
    original_number text, -- Store the original number before any processing
    status text DEFAULT 'pending' CHECK (status IN ('pending', 'preparing', 'ready', 'completed', 'cancelled')),
    order_ready_at timestamp with time zone,
    review_requested_at timestamp with time zone,
    created_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL,
    UNIQUE(bistro_id, order_number)
);

-- Create chats table to store chat sessions/conversations
CREATE TABLE chats (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    bot_id uuid REFERENCES bots(id) ON DELETE CASCADE NOT NULL,
    customer_id uuid REFERENCES customers(id) ON DELETE CASCADE NOT NULL,
    status text DEFAULT 'active' CHECK (status IN ('active', 'closed', 'archived')),
    last_message_at timestamptz,
    last_message_preview text, -- Preview of the last message
    unread_count integer DEFAULT 0,
    assigned_to uuid REFERENCES profiles(id) ON DELETE SET NULL, -- Staff member assigned to chat
    tags text[], -- Array of tags for categorization
    conversation_state jsonb DEFAULT '{}', -- Current bot conversation state
    current_flow_step text, -- Current step in conversation flow
    flow_context jsonb DEFAULT '{}', -- User inputs and variables for current conversation
    bot_active boolean DEFAULT true, -- Whether bot is handling this chat or human took over
    created_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL,
    UNIQUE(bot_id, customer_id) -- One active chat per customer per bot
);

-- Create messages table to store individual messages
CREATE TABLE messages (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    chat_id uuid REFERENCES chats(id) ON DELETE CASCADE NOT NULL,
    whatsapp_message_id text, -- WhatsApp's unique message ID
    direction text NOT NULL CHECK (direction IN ('inbound', 'outbound')),
    message_type text DEFAULT 'text' CHECK (message_type IN ('text', 'image', 'document', 'audio', 'video', 'location', 'contact', 'sticker', 'template')),
    content text, -- Message text content
    media_url text, -- URL for media files
    media_mime_type text, -- MIME type for media
    template_name text, -- For template messages
    template_params jsonb, -- Parameters for template messages
    status text DEFAULT 'sent' CHECK (status IN ('sent', 'delivered', 'read', 'failed')),
    error_message text, -- Error details if message failed
    sent_by uuid REFERENCES profiles(id) ON DELETE SET NULL, -- Staff member who sent the message (for outbound)
    delivered_at timestamptz,
    read_at timestamptz,
    created_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL
);



-- Add updated_at triggers for new tables
CREATE TRIGGER update_customers_updated_at
    BEFORE UPDATE ON customers
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_customer_bistros_updated_at
    BEFORE UPDATE ON customer_bistros
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_chats_updated_at
    BEFORE UPDATE ON chats
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_messages_updated_at
    BEFORE UPDATE ON messages
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_bots_updated_at
    BEFORE UPDATE ON bots
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Create indexes for better performance
CREATE INDEX idx_customers_whatsapp_number ON customers(whatsapp_number);
CREATE INDEX idx_customers_last_seen_at ON customers(last_seen_at);

CREATE INDEX idx_customer_bistros_customer_id ON customer_bistros(customer_id);
CREATE INDEX idx_customer_bistros_bistro_id ON customer_bistros(bistro_id);
CREATE INDEX idx_customer_bistros_last_interaction_at ON customer_bistros(last_interaction_at);

CREATE INDEX idx_chats_bot_id ON chats(bot_id);
CREATE INDEX idx_chats_customer_id ON chats(customer_id);
CREATE INDEX idx_chats_status ON chats(status);
CREATE INDEX idx_chats_last_message_at ON chats(last_message_at);
CREATE INDEX idx_chats_assigned_to ON chats(assigned_to);

CREATE INDEX idx_messages_chat_id ON messages(chat_id);
CREATE INDEX idx_messages_whatsapp_message_id ON messages(whatsapp_message_id);
CREATE INDEX idx_messages_direction ON messages(direction);
CREATE INDEX idx_messages_status ON messages(status);
CREATE INDEX idx_messages_created_at ON messages(created_at);

CREATE INDEX idx_bots_phone_number ON bots(phone_number);
CREATE INDEX idx_bots_whatsapp_phone_number_id ON bots(whatsapp_phone_number_id);
CREATE INDEX idx_bots_is_active ON bots(is_active);


INSERT INTO bots (phone_number, whatsapp_phone_number_id, name, is_active) 
VALUES (
    '+27731136480',
    '623113050896244',
    'Main Bot',  -- Optional name
    true
);