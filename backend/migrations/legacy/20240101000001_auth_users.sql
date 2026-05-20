-- Auth tables owned by the Go backend (replaces supabase auth.users).

CREATE TABLE IF NOT EXISTS auth_users (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    email text NOT NULL UNIQUE,
    password_hash text,                          -- null for OAuth-only accounts
    google_sub text UNIQUE,                      -- Google subject ID
    email_verified boolean DEFAULT false,
    raw_user_meta_data jsonb DEFAULT '{}'::jsonb,
    last_sign_in_at timestamptz,
    created_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_auth_users_email ON auth_users (lower(email));

CREATE TABLE IF NOT EXISTS refresh_tokens (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
    token_hash text NOT NULL UNIQUE,             -- sha256 of raw token
    issued_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL,
    expires_at timestamptz NOT NULL,
    revoked_at timestamptz,
    replaced_by uuid REFERENCES refresh_tokens(id) ON DELETE SET NULL,
    user_agent text,
    ip inet
);

CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user ON refresh_tokens (user_id);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_expires ON refresh_tokens (expires_at);

CREATE TABLE IF NOT EXISTS password_reset_tokens (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
    token_hash text NOT NULL UNIQUE,
    expires_at timestamptz NOT NULL,
    consumed_at timestamptz,
    created_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL
);
