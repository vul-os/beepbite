-- ======================
-- GIFT CARDS / STORE CREDIT / HOUSE ACCOUNTS / LOYALTY REDEMPTION
-- Adds four tender types (gift_card, store_credit, house_account, loyalty_points)
-- plus their ledgers. Payment methods table is seeded so order_payments can
-- reference them immediately.
-- ======================

-- TODO: no set_updated_at() helper exists in this schema yet; updated_at columns
-- on the tables below are not auto-maintained by a trigger. Applications must
-- set them explicitly on UPDATE, or a helper trigger should be added later.

-- ======================
-- GIFT CARDS
-- ======================

CREATE TABLE gift_cards (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    organization_id uuid REFERENCES organizations(id) ON DELETE CASCADE NOT NULL,
    code text NOT NULL,
    card_type text NOT NULL DEFAULT 'digital' CHECK (card_type IN ('physical','digital')),
    pin_hash text,
    initial_balance_cents bigint NOT NULL CHECK (initial_balance_cents >= 0),
    current_balance_cents bigint NOT NULL CHECK (current_balance_cents >= 0),
    currency text NOT NULL DEFAULT 'ZAR' CHECK (char_length(currency) = 3),
    status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','redeemed','expired','disabled','fraud_hold')),
    issued_to_customer_id uuid REFERENCES customers(id) ON DELETE SET NULL,
    issued_to_name text,
    issued_to_email text,
    issued_to_phone text,
    issued_by_staff_id uuid REFERENCES staff(id) ON DELETE SET NULL,
    purchased_in_order_id uuid REFERENCES orders(id) ON DELETE SET NULL,
    expires_at timestamptz,
    activated_at timestamptz,
    last_redeemed_at timestamptz,
    notes text,
    created_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE UNIQUE INDEX gift_cards_code_lower ON gift_cards(lower(code));

CREATE TABLE gift_card_transactions (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    gift_card_id uuid REFERENCES gift_cards(id) ON DELETE CASCADE NOT NULL,
    txn_type text NOT NULL CHECK (txn_type IN ('issue','redeem','reload','refund','adjust','expire')),
    amount_cents bigint NOT NULL,
    balance_after_cents bigint NOT NULL CHECK (balance_after_cents >= 0),
    order_id uuid REFERENCES orders(id) ON DELETE SET NULL,
    payment_id uuid REFERENCES order_payments(id) ON DELETE SET NULL,
    performed_by_staff_id uuid REFERENCES staff(id) ON DELETE SET NULL,
    notes text,
    created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now())
);

-- ======================
-- STORE CREDITS
-- ======================

CREATE TABLE store_credits (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    organization_id uuid REFERENCES organizations(id) ON DELETE CASCADE NOT NULL,
    customer_id uuid REFERENCES customers(id) ON DELETE CASCADE NOT NULL,
    balance_cents bigint NOT NULL DEFAULT 0 CHECK (balance_cents >= 0),
    currency text NOT NULL DEFAULT 'ZAR',
    created_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL,
    UNIQUE(organization_id, customer_id)
);

CREATE TABLE store_credit_transactions (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    store_credit_id uuid REFERENCES store_credits(id) ON DELETE CASCADE NOT NULL,
    txn_type text NOT NULL CHECK (txn_type IN ('grant','redeem','refund_to_credit','expire','adjust')),
    amount_cents bigint NOT NULL,
    balance_after_cents bigint NOT NULL CHECK (balance_after_cents >= 0),
    order_id uuid REFERENCES orders(id) ON DELETE SET NULL,
    payment_id uuid REFERENCES order_payments(id) ON DELETE SET NULL,
    refund_id uuid REFERENCES refunds(id) ON DELETE SET NULL,
    performed_by_staff_id uuid REFERENCES staff(id) ON DELETE SET NULL,
    granted_by_profile_id uuid REFERENCES profiles(id) ON DELETE SET NULL,
    reason text,
    expires_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now())
);

-- ======================
-- HOUSE ACCOUNTS (corporate tabs, invoiced monthly)
-- ======================

CREATE TABLE house_accounts (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    organization_id uuid REFERENCES organizations(id) ON DELETE CASCADE NOT NULL,
    account_name text NOT NULL,
    contact_name text,
    contact_email text,
    contact_phone text,
    billing_address text,
    credit_limit_cents bigint, -- NULL = unlimited
    current_balance_cents bigint NOT NULL DEFAULT 0, -- positive = amount owed
    currency text NOT NULL DEFAULT 'ZAR',
    billing_cycle text NOT NULL DEFAULT 'monthly' CHECK (billing_cycle IN ('monthly','weekly','on_demand')),
    net_terms_days int DEFAULT 30,
    is_active boolean NOT NULL DEFAULT true,
    notes text,
    created_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE TABLE house_account_members (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    house_account_id uuid REFERENCES house_accounts(id) ON DELETE CASCADE NOT NULL,
    customer_id uuid REFERENCES customers(id) ON DELETE CASCADE NOT NULL,
    spending_limit_cents bigint,
    is_active boolean NOT NULL DEFAULT true,
    created_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL,
    UNIQUE(house_account_id, customer_id)
);

CREATE TABLE house_account_charges (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    house_account_id uuid REFERENCES house_accounts(id) ON DELETE CASCADE NOT NULL,
    order_id uuid REFERENCES orders(id) ON DELETE CASCADE NOT NULL,
    customer_id uuid REFERENCES customers(id) ON DELETE SET NULL,
    amount_cents bigint NOT NULL CHECK (amount_cents > 0),
    house_account_invoice_id uuid, -- FK added below once invoices table exists
    created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
    UNIQUE(order_id)
);

CREATE TABLE house_account_invoices (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    house_account_id uuid REFERENCES house_accounts(id) ON DELETE CASCADE NOT NULL,
    invoice_number text NOT NULL,
    period_start date NOT NULL,
    period_end date NOT NULL,
    subtotal_cents bigint NOT NULL DEFAULT 0,
    tax_cents bigint NOT NULL DEFAULT 0,
    total_cents bigint NOT NULL DEFAULT 0,
    status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','sent','paid','overdue','cancelled','partial')),
    due_date date,
    sent_at timestamptz,
    paid_at timestamptz,
    paid_amount_cents bigint NOT NULL DEFAULT 0,
    pdf_url text,
    notes text,
    created_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Deferred FK now that house_account_invoices exists
ALTER TABLE house_account_charges
    ADD CONSTRAINT fk_house_account_charges_invoice
    FOREIGN KEY (house_account_invoice_id) REFERENCES house_account_invoices(id) ON DELETE SET NULL;

-- ======================
-- LOYALTY POINTS AS CURRENCY
-- ======================

CREATE TABLE loyalty_config (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    organization_id uuid REFERENCES organizations(id) ON DELETE CASCADE NOT NULL,
    points_per_currency_unit decimal(12,4) NOT NULL DEFAULT 100, -- e.g. 100 points = 1 ZAR
    min_redemption_points int DEFAULT 0,
    max_redemption_pct_of_order decimal(5,2) CHECK (max_redemption_pct_of_order BETWEEN 0 AND 100),
    points_expiry_months int,
    is_active boolean NOT NULL DEFAULT true,
    created_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL,
    UNIQUE(organization_id)
);

CREATE TABLE loyalty_transactions (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    customer_id uuid REFERENCES customers(id) ON DELETE CASCADE NOT NULL,
    organization_id uuid REFERENCES organizations(id) ON DELETE CASCADE NOT NULL,
    txn_type text NOT NULL CHECK (txn_type IN ('earn','redeem','adjust','expire','transfer')),
    points int NOT NULL,
    balance_after int NOT NULL CHECK (balance_after >= 0),
    order_id uuid REFERENCES orders(id) ON DELETE SET NULL,
    expires_at timestamptz,
    notes text,
    performed_by_staff_id uuid REFERENCES staff(id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now())
);

-- ======================
-- SEED NEW TENDER TYPES INTO payment_methods
-- ======================
-- payment_methods (from 20240101000004) columns used:
--   code, name, kind, requires_reference, supports_tips,
--   processing_fee_percentage, fixed_fee_cents, is_active
INSERT INTO payment_methods (code, name, kind, requires_reference, supports_tips, processing_fee_percentage, fixed_fee_cents, is_active)
VALUES
    ('gift_card',      'Gift Card',      'offline', true,  false, 0, 0, true),
    ('store_credit',   'Store Credit',   'offline', false, false, 0, 0, true),
    ('house_account',  'House Account',  'offline', true,  false, 0, 0, true),
    ('loyalty_points', 'Loyalty Points', 'offline', false, false, 0, 0, true)
ON CONFLICT (code) DO NOTHING;

-- ======================
-- INDEXES
-- ======================

CREATE INDEX idx_gift_cards_organization ON gift_cards(organization_id);
CREATE INDEX idx_gift_cards_issued_to_customer ON gift_cards(issued_to_customer_id);
CREATE INDEX idx_gift_cards_status ON gift_cards(status);
CREATE INDEX idx_gift_cards_expires_at ON gift_cards(expires_at) WHERE expires_at IS NOT NULL;

CREATE INDEX idx_gift_card_transactions_card_created ON gift_card_transactions(gift_card_id, created_at DESC);
CREATE INDEX idx_gift_card_transactions_order ON gift_card_transactions(order_id) WHERE order_id IS NOT NULL;

CREATE INDEX idx_store_credits_customer ON store_credits(customer_id);
CREATE INDEX idx_store_credits_organization ON store_credits(organization_id);

CREATE INDEX idx_store_credit_transactions_credit_created ON store_credit_transactions(store_credit_id, created_at DESC);
CREATE INDEX idx_store_credit_transactions_order ON store_credit_transactions(order_id);
CREATE INDEX idx_store_credit_transactions_refund ON store_credit_transactions(refund_id) WHERE refund_id IS NOT NULL;

CREATE INDEX idx_house_accounts_org_active ON house_accounts(organization_id, is_active);

CREATE INDEX idx_house_account_members_account ON house_account_members(house_account_id);
CREATE INDEX idx_house_account_members_customer ON house_account_members(customer_id);

CREATE INDEX idx_house_account_charges_account ON house_account_charges(house_account_id);
CREATE INDEX idx_house_account_charges_order ON house_account_charges(order_id);
CREATE INDEX idx_house_account_charges_invoice ON house_account_charges(house_account_invoice_id) WHERE house_account_invoice_id IS NOT NULL;

CREATE INDEX idx_house_account_invoices_account_status ON house_account_invoices(house_account_id, status);
CREATE INDEX idx_house_account_invoices_due_date ON house_account_invoices(due_date) WHERE due_date IS NOT NULL;

CREATE INDEX idx_loyalty_transactions_customer_created ON loyalty_transactions(customer_id, created_at DESC);
CREATE INDEX idx_loyalty_transactions_organization ON loyalty_transactions(organization_id);
CREATE INDEX idx_loyalty_transactions_order ON loyalty_transactions(order_id) WHERE order_id IS NOT NULL;
CREATE INDEX idx_loyalty_transactions_expires_at ON loyalty_transactions(expires_at) WHERE expires_at IS NOT NULL;
