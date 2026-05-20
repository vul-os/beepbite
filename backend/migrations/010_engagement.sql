-- =============================================================================
-- MIGRATION 010 — ENGAGEMENT
-- =============================================================================
-- Sources: legacy 2 (customers, customer_addresses, reviews), 19 (promotions),
--          25 (gift_cards, store_credits, house_accounts, loyalty), 37 (reservations),
--          42 (reviews reply columns), 39 (customers.last_seen_at already in legacy 2
--          ALTER; consolidated here inline).
-- New tables: marketplace_reviews, tax_profiles, invoices.
--
-- Key changes vs legacy:
--   - customers gains organization_id (org-scoped), profile_id FK to profiles.
--     legacy customers were org-less (whatsapp-keyed); plan § 010 adds org scope.
--   - reviews: reply + replied_at columns absorbed from legacy 42 inline.
--   - gift_card_transactions / loyalty_transactions: INSERT-only RLS (no UPDATE/DELETE).
--   - invoices schema per plan § 010 expanded spec (issuer_org_id, recipient_*, etc.).
--
-- RLS:
--   - customers / customer_addresses: org-scoped.
--   - promotions / coupon_codes / redemptions / discounts: org-scoped.
--   - gift_cards / store_credits / house_accounts / loyalty_config: org-scoped.
--   - gift_card_transactions / loyalty_transactions: INSERT-only (append-only ledger).
--   - store_credit_transactions / house_account_*: org-scoped via parent.
--   - reservations / waitlist: org-scoped.
--   - reviews: org-scoped (via order→location→org).
--   - marketplace_reviews: org-scoped writes; marketplace_role public SELECT on visible.
--   - tax_profiles: org-scoped (org_id PK = own row only).
--   - invoices: recipient + issuer can both read; service_role full access.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. CUSTOMERS
-- ---------------------------------------------------------------------------
-- organization_id added so every customer belongs to an org (multi-tenant safe).
-- profile_id links a WhatsApp-identified customer to an auth account (nullable).
-- last_seen_at was added in legacy 2 via ALTER; included inline here.

CREATE TABLE customers (
    id                      uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
    organization_id         uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    profile_id              uuid        REFERENCES profiles(id) ON DELETE SET NULL,
    whatsapp_number         text        NOT NULL,
    first_name              text,
    last_name               text,
    email                   text,
    notes                   text,
    is_blocked              boolean     NOT NULL DEFAULT false,
    last_order_at           timestamptz,
    last_seen_at            timestamptz,
    total_orders            integer     NOT NULL DEFAULT 0,
    total_spent             decimal(12,2) NOT NULL DEFAULT 0,
    -- Loyalty denormalised totals (source of truth is loyalty_transactions ledger)
    loyalty_points          integer     NOT NULL DEFAULT 0,
    loyalty_tier            text        NOT NULL DEFAULT 'bronze'
                                        CHECK (loyalty_tier IN ('bronze','silver','gold','platinum')),
    points_earned_total     integer     NOT NULL DEFAULT 0,
    points_redeemed_total   integer     NOT NULL DEFAULT 0,
    created_at              timestamptz NOT NULL DEFAULT timezone('utc', now()),
    updated_at              timestamptz NOT NULL DEFAULT timezone('utc', now()),
    -- whatsapp_number unique per org
    UNIQUE (organization_id, whatsapp_number)
);

CREATE INDEX idx_customers_org         ON customers(organization_id);
CREATE INDEX idx_customers_profile     ON customers(profile_id) WHERE profile_id IS NOT NULL;
CREATE INDEX idx_customers_whatsapp    ON customers(whatsapp_number);

DROP TRIGGER IF EXISTS trg_customers_updated_at ON customers;
CREATE TRIGGER trg_customers_updated_at
    BEFORE UPDATE ON customers
    FOR EACH ROW EXECUTE FUNCTION set_updated_at_now();

-- ---------------------------------------------------------------------------
-- 2. CUSTOMER ADDRESSES
-- ---------------------------------------------------------------------------

CREATE TABLE customer_addresses (
    id                      uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
    customer_id             uuid        NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    address_line_1          text,
    address_line_2          text,
    city                    text,
    postal_code             text,
    latitude                decimal(10,7),
    longitude               decimal(10,7),
    delivery_instructions   text,
    is_default              boolean     NOT NULL DEFAULT false,
    created_at              timestamptz NOT NULL DEFAULT timezone('utc', now()),
    updated_at              timestamptz NOT NULL DEFAULT timezone('utc', now())
);

-- Only one default address per customer
CREATE UNIQUE INDEX one_default_address_per_customer
    ON customer_addresses(customer_id)
    WHERE is_default;

CREATE INDEX idx_customer_addresses_customer ON customer_addresses(customer_id);

DROP TRIGGER IF EXISTS trg_customer_addresses_updated_at ON customer_addresses;
CREATE TRIGGER trg_customer_addresses_updated_at
    BEFORE UPDATE ON customer_addresses
    FOR EACH ROW EXECUTE FUNCTION set_updated_at_now();

-- ---------------------------------------------------------------------------
-- 3. PROMOTIONS
-- ---------------------------------------------------------------------------

CREATE TABLE promotions (
    id                          uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
    organization_id             uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    location_id                 uuid        REFERENCES locations(id) ON DELETE CASCADE, -- NULL = all locations
    name                        text        NOT NULL,
    description                 text,
    promo_type                  text        NOT NULL
                                            CHECK (promo_type IN (
                                                'percent_off','fixed_off','bogo',
                                                'free_item','happy_hour_price','free_delivery'
                                            )),
    scope                       text        NOT NULL
                                            CHECK (scope IN ('order','item','category','delivery')),
    percent_off                 decimal(5,2) CHECK (percent_off IS NULL OR (percent_off BETWEEN 0 AND 100)),
    fixed_off_cents             bigint,
    happy_hour_price_cents      bigint,
    bogo_buy_qty                integer     NOT NULL DEFAULT 1,
    bogo_get_qty                integer     NOT NULL DEFAULT 1,
    bogo_get_discount_percent   decimal(5,2) NOT NULL DEFAULT 100
                                            CHECK (bogo_get_discount_percent BETWEEN 0 AND 100),
    free_item_id                uuid        REFERENCES items(id) ON DELETE SET NULL,
    min_spend_cents             bigint      NOT NULL DEFAULT 0,
    max_discount_cents          bigint,
    stackable                   boolean     NOT NULL DEFAULT false,
    requires_coupon_code        boolean     NOT NULL DEFAULT false,
    active_from                 timestamptz,
    active_until                timestamptz,
    dayparts                    jsonb,      -- [{"day":"mon","from":"15:00","until":"18:00"}]
    customer_segment            text        DEFAULT 'all'
                                            CHECK (customer_segment IN ('all','first_time','vip','lapsed') OR customer_segment IS NULL),
    usage_limit_total           integer,    -- NULL = unlimited
    usage_limit_per_customer    integer     DEFAULT 1,
    is_active                   boolean     NOT NULL DEFAULT true,
    priority                    integer     NOT NULL DEFAULT 0,
    created_by                  uuid        REFERENCES profiles(id) ON DELETE SET NULL,
    created_at                  timestamptz NOT NULL DEFAULT timezone('utc', now()),
    updated_at                  timestamptz NOT NULL DEFAULT timezone('utc', now())
);

CREATE INDEX idx_promotions_org_active      ON promotions(organization_id, is_active);
CREATE INDEX idx_promotions_location_active ON promotions(location_id, is_active) WHERE location_id IS NOT NULL;
CREATE INDEX idx_promotions_window          ON promotions(active_from, active_until);

DROP TRIGGER IF EXISTS trg_promotions_updated_at ON promotions;
CREATE TRIGGER trg_promotions_updated_at
    BEFORE UPDATE ON promotions
    FOR EACH ROW EXECUTE FUNCTION set_updated_at_now();

-- ---------------------------------------------------------------------------
-- 4. PROMOTION TARGET ITEMS / CATEGORIES
-- ---------------------------------------------------------------------------

CREATE TABLE promotion_target_items (
    id              uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
    promotion_id    uuid        NOT NULL REFERENCES promotions(id) ON DELETE CASCADE,
    item_id         uuid        NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    created_at      timestamptz NOT NULL DEFAULT timezone('utc', now()),
    UNIQUE (promotion_id, item_id)
);

CREATE INDEX idx_promotion_target_items_promotion ON promotion_target_items(promotion_id);
CREATE INDEX idx_promotion_target_items_item       ON promotion_target_items(item_id);

CREATE TABLE promotion_target_categories (
    id              uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
    promotion_id    uuid        NOT NULL REFERENCES promotions(id) ON DELETE CASCADE,
    category_id     uuid        NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
    created_at      timestamptz NOT NULL DEFAULT timezone('utc', now()),
    UNIQUE (promotion_id, category_id)
);

CREATE INDEX idx_promotion_target_categories_promotion ON promotion_target_categories(promotion_id);
CREATE INDEX idx_promotion_target_categories_category  ON promotion_target_categories(category_id);

-- ---------------------------------------------------------------------------
-- 5. COUPON CODES
-- ---------------------------------------------------------------------------

CREATE TABLE coupon_codes (
    id                          uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
    promotion_id                uuid        NOT NULL REFERENCES promotions(id) ON DELETE CASCADE,
    code                        text        NOT NULL,
    max_uses                    integer     NOT NULL DEFAULT 1,
    used_count                  integer     NOT NULL DEFAULT 0,
    assigned_to_customer_id     uuid        REFERENCES customers(id) ON DELETE SET NULL,
    active_from                 timestamptz,
    active_until                timestamptz,
    is_active                   boolean     NOT NULL DEFAULT true,
    created_at                  timestamptz NOT NULL DEFAULT timezone('utc', now()),
    updated_at                  timestamptz NOT NULL DEFAULT timezone('utc', now())
);

-- Case-insensitive uniqueness on code
CREATE UNIQUE INDEX coupon_codes_code_lower_idx ON coupon_codes(lower(code));
CREATE INDEX idx_coupon_codes_promotion         ON coupon_codes(promotion_id);
CREATE INDEX idx_coupon_codes_assigned_customer ON coupon_codes(assigned_to_customer_id) WHERE assigned_to_customer_id IS NOT NULL;

DROP TRIGGER IF EXISTS trg_coupon_codes_updated_at ON coupon_codes;
CREATE TRIGGER trg_coupon_codes_updated_at
    BEFORE UPDATE ON coupon_codes
    FOR EACH ROW EXECUTE FUNCTION set_updated_at_now();

-- ---------------------------------------------------------------------------
-- 6. PROMOTION REDEMPTIONS
-- ---------------------------------------------------------------------------

CREATE TABLE promotion_redemptions (
    id                      uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
    promotion_id            uuid        NOT NULL REFERENCES promotions(id) ON DELETE CASCADE,
    coupon_code_id          uuid        REFERENCES coupon_codes(id) ON DELETE SET NULL,
    order_id                uuid        NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    customer_id             uuid        REFERENCES customers(id) ON DELETE SET NULL,
    discount_amount_cents   bigint      NOT NULL CHECK (discount_amount_cents >= 0),
    applied_at              timestamptz NOT NULL DEFAULT timezone('utc', now()),
    created_at              timestamptz NOT NULL DEFAULT timezone('utc', now()),
    UNIQUE (promotion_id, order_id)
);

CREATE INDEX idx_promotion_redemptions_promotion  ON promotion_redemptions(promotion_id);
CREATE INDEX idx_promotion_redemptions_order       ON promotion_redemptions(order_id);
CREATE INDEX idx_promotion_redemptions_customer    ON promotion_redemptions(customer_id);
CREATE INDEX idx_promotion_redemptions_applied_at  ON promotion_redemptions(applied_at);

-- ---------------------------------------------------------------------------
-- 7. ORDER ITEM DISCOUNTS
-- Line-level attribution of a redemption's discount to individual order items.
-- ---------------------------------------------------------------------------

CREATE TABLE order_item_discounts (
    id                          uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
    order_item_id               uuid        NOT NULL REFERENCES order_items(id) ON DELETE CASCADE,
    promotion_redemption_id     uuid        NOT NULL REFERENCES promotion_redemptions(id) ON DELETE CASCADE,
    discount_amount_cents       bigint      NOT NULL CHECK (discount_amount_cents >= 0),
    created_at                  timestamptz NOT NULL DEFAULT timezone('utc', now()),
    UNIQUE (order_item_id, promotion_redemption_id)
);

CREATE INDEX idx_order_item_discounts_order_item   ON order_item_discounts(order_item_id);
CREATE INDEX idx_order_item_discounts_redemption   ON order_item_discounts(promotion_redemption_id);

-- ---------------------------------------------------------------------------
-- 8. GIFT CARDS
-- ---------------------------------------------------------------------------

CREATE TABLE gift_cards (
    id                      uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
    organization_id         uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    code                    text        NOT NULL,
    card_type               text        NOT NULL DEFAULT 'digital'
                                        CHECK (card_type IN ('physical','digital')),
    pin_hash                text,
    initial_balance_cents   bigint      NOT NULL CHECK (initial_balance_cents >= 0),
    current_balance_cents   bigint      NOT NULL CHECK (current_balance_cents >= 0),
    currency                text        NOT NULL DEFAULT 'ZAR' CHECK (char_length(currency) = 3),
    status                  text        NOT NULL DEFAULT 'active'
                                        CHECK (status IN ('active','redeemed','expired','disabled','fraud_hold')),
    issued_to_customer_id   uuid        REFERENCES customers(id) ON DELETE SET NULL,
    issued_to_name          text,
    issued_to_email         text,
    issued_to_phone         text,
    issued_by_staff_id      uuid        REFERENCES staff(id) ON DELETE SET NULL,
    purchased_in_order_id   uuid        REFERENCES orders(id) ON DELETE SET NULL,
    expires_at              timestamptz,
    activated_at            timestamptz,
    last_redeemed_at        timestamptz,
    notes                   text,
    created_at              timestamptz NOT NULL DEFAULT timezone('utc', now()),
    updated_at              timestamptz NOT NULL DEFAULT timezone('utc', now())
);

CREATE UNIQUE INDEX gift_cards_code_lower ON gift_cards(lower(code));
CREATE INDEX idx_gift_cards_organization       ON gift_cards(organization_id);
CREATE INDEX idx_gift_cards_issued_to_customer ON gift_cards(issued_to_customer_id);
CREATE INDEX idx_gift_cards_status             ON gift_cards(status);
CREATE INDEX idx_gift_cards_expires_at         ON gift_cards(expires_at) WHERE expires_at IS NOT NULL;

DROP TRIGGER IF EXISTS trg_gift_cards_updated_at ON gift_cards;
CREATE TRIGGER trg_gift_cards_updated_at
    BEFORE UPDATE ON gift_cards
    FOR EACH ROW EXECUTE FUNCTION set_updated_at_now();

-- ---------------------------------------------------------------------------
-- 9. GIFT CARD TRANSACTIONS  (append-only ledger)
-- ---------------------------------------------------------------------------

CREATE TABLE gift_card_transactions (
    id                          uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
    gift_card_id                uuid        NOT NULL REFERENCES gift_cards(id) ON DELETE CASCADE,
    txn_type                    text        NOT NULL
                                            CHECK (txn_type IN ('issue','redeem','reload','refund','adjust','expire')),
    amount_cents                bigint      NOT NULL,
    balance_after_cents         bigint      NOT NULL CHECK (balance_after_cents >= 0),
    order_id                    uuid        REFERENCES orders(id) ON DELETE SET NULL,
    payment_id                  uuid        REFERENCES order_payments(id) ON DELETE SET NULL,
    performed_by_staff_id       uuid        REFERENCES staff(id) ON DELETE SET NULL,
    notes                       text,
    created_at                  timestamptz NOT NULL DEFAULT timezone('utc', now())
);

CREATE INDEX idx_gift_card_transactions_card_created ON gift_card_transactions(gift_card_id, created_at DESC);
CREATE INDEX idx_gift_card_transactions_order        ON gift_card_transactions(order_id) WHERE order_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 10. STORE CREDITS
-- ---------------------------------------------------------------------------

CREATE TABLE store_credits (
    id              uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
    organization_id uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    customer_id     uuid        NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    balance_cents   bigint      NOT NULL DEFAULT 0 CHECK (balance_cents >= 0),
    currency        text        NOT NULL DEFAULT 'ZAR',
    created_at      timestamptz NOT NULL DEFAULT timezone('utc', now()),
    updated_at      timestamptz NOT NULL DEFAULT timezone('utc', now()),
    UNIQUE (organization_id, customer_id)
);

CREATE INDEX idx_store_credits_customer     ON store_credits(customer_id);
CREATE INDEX idx_store_credits_organization ON store_credits(organization_id);

DROP TRIGGER IF EXISTS trg_store_credits_updated_at ON store_credits;
CREATE TRIGGER trg_store_credits_updated_at
    BEFORE UPDATE ON store_credits
    FOR EACH ROW EXECUTE FUNCTION set_updated_at_now();

-- ---------------------------------------------------------------------------
-- 11. STORE CREDIT TRANSACTIONS  (append-only ledger)
-- ---------------------------------------------------------------------------

CREATE TABLE store_credit_transactions (
    id                      uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
    store_credit_id         uuid        NOT NULL REFERENCES store_credits(id) ON DELETE CASCADE,
    txn_type                text        NOT NULL
                                        CHECK (txn_type IN ('grant','redeem','refund_to_credit','expire','adjust')),
    amount_cents            bigint      NOT NULL,
    balance_after_cents     bigint      NOT NULL CHECK (balance_after_cents >= 0),
    order_id                uuid        REFERENCES orders(id) ON DELETE SET NULL,
    payment_id              uuid        REFERENCES order_payments(id) ON DELETE SET NULL,
    refund_id               uuid        REFERENCES refunds(id) ON DELETE SET NULL,
    performed_by_staff_id   uuid        REFERENCES staff(id) ON DELETE SET NULL,
    granted_by_profile_id   uuid        REFERENCES profiles(id) ON DELETE SET NULL,
    reason                  text,
    expires_at              timestamptz,
    created_at              timestamptz NOT NULL DEFAULT timezone('utc', now())
);

CREATE INDEX idx_store_credit_transactions_credit_created ON store_credit_transactions(store_credit_id, created_at DESC);
CREATE INDEX idx_store_credit_transactions_order          ON store_credit_transactions(order_id);
CREATE INDEX idx_store_credit_transactions_refund         ON store_credit_transactions(refund_id) WHERE refund_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 12. HOUSE ACCOUNTS
-- ---------------------------------------------------------------------------

CREATE TABLE house_accounts (
    id                      uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
    organization_id         uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    account_name            text        NOT NULL,
    contact_name            text,
    contact_email           text,
    contact_phone           text,
    billing_address         text,
    credit_limit_cents      bigint,     -- NULL = unlimited
    current_balance_cents   bigint      NOT NULL DEFAULT 0, -- positive = amount owed
    currency                text        NOT NULL DEFAULT 'ZAR',
    billing_cycle           text        NOT NULL DEFAULT 'monthly'
                                        CHECK (billing_cycle IN ('monthly','weekly','on_demand')),
    net_terms_days          int         NOT NULL DEFAULT 30,
    is_active               boolean     NOT NULL DEFAULT true,
    notes                   text,
    created_at              timestamptz NOT NULL DEFAULT timezone('utc', now()),
    updated_at              timestamptz NOT NULL DEFAULT timezone('utc', now())
);

CREATE INDEX idx_house_accounts_org_active ON house_accounts(organization_id, is_active);

DROP TRIGGER IF EXISTS trg_house_accounts_updated_at ON house_accounts;
CREATE TRIGGER trg_house_accounts_updated_at
    BEFORE UPDATE ON house_accounts
    FOR EACH ROW EXECUTE FUNCTION set_updated_at_now();

-- ---------------------------------------------------------------------------
-- 13. HOUSE ACCOUNT MEMBERS
-- ---------------------------------------------------------------------------

CREATE TABLE house_account_members (
    id                  uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
    house_account_id    uuid        NOT NULL REFERENCES house_accounts(id) ON DELETE CASCADE,
    customer_id         uuid        NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    spending_limit_cents bigint,
    is_active           boolean     NOT NULL DEFAULT true,
    created_at          timestamptz NOT NULL DEFAULT timezone('utc', now()),
    updated_at          timestamptz NOT NULL DEFAULT timezone('utc', now()),
    UNIQUE (house_account_id, customer_id)
);

CREATE INDEX idx_house_account_members_account  ON house_account_members(house_account_id);
CREATE INDEX idx_house_account_members_customer ON house_account_members(customer_id);

DROP TRIGGER IF EXISTS trg_house_account_members_updated_at ON house_account_members;
CREATE TRIGGER trg_house_account_members_updated_at
    BEFORE UPDATE ON house_account_members
    FOR EACH ROW EXECUTE FUNCTION set_updated_at_now();

-- ---------------------------------------------------------------------------
-- 14. HOUSE ACCOUNT INVOICES
-- ---------------------------------------------------------------------------

CREATE TABLE house_account_invoices (
    id                  uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
    house_account_id    uuid        NOT NULL REFERENCES house_accounts(id) ON DELETE CASCADE,
    invoice_number      text        NOT NULL,
    period_start        date        NOT NULL,
    period_end          date        NOT NULL,
    subtotal_cents      bigint      NOT NULL DEFAULT 0,
    tax_cents           bigint      NOT NULL DEFAULT 0,
    total_cents         bigint      NOT NULL DEFAULT 0,
    status              text        NOT NULL DEFAULT 'draft'
                                    CHECK (status IN ('draft','sent','paid','overdue','cancelled','partial')),
    due_date            date,
    sent_at             timestamptz,
    paid_at             timestamptz,
    paid_amount_cents   bigint      NOT NULL DEFAULT 0,
    pdf_url             text,
    notes               text,
    created_at          timestamptz NOT NULL DEFAULT timezone('utc', now()),
    updated_at          timestamptz NOT NULL DEFAULT timezone('utc', now())
);

CREATE INDEX idx_house_account_invoices_account_status ON house_account_invoices(house_account_id, status);
CREATE INDEX idx_house_account_invoices_due_date       ON house_account_invoices(due_date) WHERE due_date IS NOT NULL;

DROP TRIGGER IF EXISTS trg_house_account_invoices_updated_at ON house_account_invoices;
CREATE TRIGGER trg_house_account_invoices_updated_at
    BEFORE UPDATE ON house_account_invoices
    FOR EACH ROW EXECUTE FUNCTION set_updated_at_now();

-- ---------------------------------------------------------------------------
-- 15. HOUSE ACCOUNT CHARGES
-- ---------------------------------------------------------------------------

CREATE TABLE house_account_charges (
    id                          uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
    house_account_id            uuid        NOT NULL REFERENCES house_accounts(id) ON DELETE CASCADE,
    order_id                    uuid        NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    customer_id                 uuid        REFERENCES customers(id) ON DELETE SET NULL,
    amount_cents                bigint      NOT NULL CHECK (amount_cents > 0),
    house_account_invoice_id    uuid        REFERENCES house_account_invoices(id) ON DELETE SET NULL,
    created_at                  timestamptz NOT NULL DEFAULT timezone('utc', now()),
    UNIQUE (order_id)
);

CREATE INDEX idx_house_account_charges_account ON house_account_charges(house_account_id);
CREATE INDEX idx_house_account_charges_order   ON house_account_charges(order_id);
CREATE INDEX idx_house_account_charges_invoice ON house_account_charges(house_account_invoice_id)
    WHERE house_account_invoice_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 16. LOYALTY CONFIG
-- ---------------------------------------------------------------------------

CREATE TABLE loyalty_config (
    id                              uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
    organization_id                 uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    points_per_currency_unit        decimal(12,4) NOT NULL DEFAULT 100,
    min_redemption_points           int         NOT NULL DEFAULT 0,
    max_redemption_pct_of_order     decimal(5,2) CHECK (max_redemption_pct_of_order BETWEEN 0 AND 100),
    points_expiry_months            int,
    is_active                       boolean     NOT NULL DEFAULT true,
    created_at                      timestamptz NOT NULL DEFAULT timezone('utc', now()),
    updated_at                      timestamptz NOT NULL DEFAULT timezone('utc', now()),
    UNIQUE (organization_id)
);

DROP TRIGGER IF EXISTS trg_loyalty_config_updated_at ON loyalty_config;
CREATE TRIGGER trg_loyalty_config_updated_at
    BEFORE UPDATE ON loyalty_config
    FOR EACH ROW EXECUTE FUNCTION set_updated_at_now();

-- ---------------------------------------------------------------------------
-- 17. LOYALTY TRANSACTIONS  (append-only ledger)
-- ---------------------------------------------------------------------------

CREATE TABLE loyalty_transactions (
    id                      uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
    customer_id             uuid        NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    organization_id         uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    txn_type                text        NOT NULL
                                        CHECK (txn_type IN ('earn','redeem','adjust','expire','transfer')),
    points                  int         NOT NULL,
    balance_after           int         NOT NULL CHECK (balance_after >= 0),
    order_id                uuid        REFERENCES orders(id) ON DELETE SET NULL,
    expires_at              timestamptz,
    notes                   text,
    performed_by_staff_id   uuid        REFERENCES staff(id) ON DELETE SET NULL,
    created_at              timestamptz NOT NULL DEFAULT timezone('utc', now())
);

CREATE INDEX idx_loyalty_transactions_customer_created ON loyalty_transactions(customer_id, created_at DESC);
CREATE INDEX idx_loyalty_transactions_organization     ON loyalty_transactions(organization_id);
CREATE INDEX idx_loyalty_transactions_order            ON loyalty_transactions(order_id) WHERE order_id IS NOT NULL;
CREATE INDEX idx_loyalty_transactions_expires_at       ON loyalty_transactions(expires_at) WHERE expires_at IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 18. RESERVATIONS
-- ---------------------------------------------------------------------------

CREATE TABLE reservations (
    id                      uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
    organization_id         uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    location_id             uuid        NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
    customer_id             uuid        REFERENCES customers(id) ON DELETE SET NULL,
    customer_name           text        NOT NULL,
    customer_phone          text,
    customer_email          text,
    party_size              int         NOT NULL CHECK (party_size > 0),
    reservation_at          timestamptz NOT NULL,
    duration_minutes        int         NOT NULL DEFAULT 90,
    table_id                uuid        REFERENCES "tables"(id) ON DELETE SET NULL,
    section_id              uuid        REFERENCES sections(id) ON DELETE SET NULL,
    status                  text        NOT NULL DEFAULT 'pending'
                                        CHECK (status IN ('pending','confirmed','seated','completed','cancelled','no_show')),
    special_requests        text,
    confirmation_sent_at    timestamptz,
    created_by_staff_id     uuid        REFERENCES staff(id) ON DELETE SET NULL,
    created_at              timestamptz NOT NULL DEFAULT timezone('utc', now()),
    updated_at              timestamptz NOT NULL DEFAULT timezone('utc', now())
);

CREATE INDEX idx_reservations_location_date ON reservations(location_id, reservation_at);

DROP TRIGGER IF EXISTS trg_reservations_updated_at ON reservations;
CREATE TRIGGER trg_reservations_updated_at
    BEFORE UPDATE ON reservations
    FOR EACH ROW EXECUTE FUNCTION set_updated_at_now();

-- ---------------------------------------------------------------------------
-- 19. WAITLIST
-- ---------------------------------------------------------------------------

CREATE TABLE waitlist (
    id                      uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
    organization_id         uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    location_id             uuid        NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
    customer_name           text        NOT NULL,
    customer_phone          text,
    party_size              int         NOT NULL CHECK (party_size > 0),
    quoted_wait_minutes     int,
    added_at                timestamptz NOT NULL DEFAULT timezone('utc', now()),
    seated_at               timestamptz,
    removed_at              timestamptz,
    removal_reason          text,       -- 'seated','left','no_show'
    notes                   text,
    created_at              timestamptz NOT NULL DEFAULT timezone('utc', now()),
    updated_at              timestamptz NOT NULL DEFAULT timezone('utc', now())
);

CREATE INDEX idx_waitlist_location_active ON waitlist(location_id, added_at)
    WHERE seated_at IS NULL AND removed_at IS NULL;

DROP TRIGGER IF EXISTS trg_waitlist_updated_at ON waitlist;
CREATE TRIGGER trg_waitlist_updated_at
    BEFORE UPDATE ON waitlist
    FOR EACH ROW EXECUTE FUNCTION set_updated_at_now();

-- ---------------------------------------------------------------------------
-- 20. REVIEWS
-- reply / replied_at columns absorbed from legacy 42 inline.
-- ---------------------------------------------------------------------------

CREATE TABLE reviews (
    id          uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
    order_id    uuid        NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    rating      integer     NOT NULL CHECK (rating BETWEEN 1 AND 10),
    comment     text,
    reply       text,       -- store reply (added in legacy 42)
    replied_at  timestamptz,
    created_at  timestamptz NOT NULL DEFAULT timezone('utc', now()),
    UNIQUE (order_id)
);

CREATE INDEX idx_reviews_order ON reviews(order_id);

-- ---------------------------------------------------------------------------
-- 21. MARKETPLACE REVIEWS  [NEW]
-- Customer-side star ratings visible on the public marketplace.
-- verified_purchase=true enforced: must come from a completed order.
-- owner_reply: store owner can respond publicly.
-- ---------------------------------------------------------------------------

CREATE TABLE marketplace_reviews (
    id                      uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
    order_id                uuid        NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    customer_profile_id     uuid        REFERENCES profiles(id) ON DELETE SET NULL,
    location_id             uuid        NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
    stars                   int         NOT NULL CHECK (stars BETWEEN 1 AND 5),
    review_text             text,
    photos                  text[]      NOT NULL DEFAULT '{}',
    verified_purchase       boolean     NOT NULL DEFAULT true,
    status                  text        NOT NULL DEFAULT 'pending'
                                        CHECK (status IN ('pending','visible','hidden','removed')),
    owner_reply             text,
    owner_replied_at        timestamptz,
    created_at              timestamptz NOT NULL DEFAULT timezone('utc', now()),
    updated_at              timestamptz NOT NULL DEFAULT timezone('utc', now()),
    UNIQUE (order_id)  -- one marketplace review per order
);

CREATE INDEX idx_marketplace_reviews_location_status ON marketplace_reviews(location_id, status);
CREATE INDEX idx_marketplace_reviews_customer        ON marketplace_reviews(customer_profile_id) WHERE customer_profile_id IS NOT NULL;

DROP TRIGGER IF EXISTS trg_marketplace_reviews_updated_at ON marketplace_reviews;
CREATE TRIGGER trg_marketplace_reviews_updated_at
    BEFORE UPDATE ON marketplace_reviews
    FOR EACH ROW EXECUTE FUNCTION set_updated_at_now();

-- ---------------------------------------------------------------------------
-- 22. TAX PROFILES  [NEW]
-- Per-org VAT / company registration details for invoice generation.
-- One row per org (org_id is the PK and FK).
-- ---------------------------------------------------------------------------

CREATE TABLE tax_profiles (
    org_id              uuid        PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
    legal_name          text        NOT NULL,
    registered_address  text        NOT NULL,
    country             text        NOT NULL CHECK (char_length(country) = 2), -- ISO-3166-1 alpha-2
    vat_number          text,       -- NULL if not VAT-registered
    vat_rate_percent    decimal(6,4), -- e.g. 15.0000 for 15%; NULL if not applicable
    company_number      text,       -- company registration number; NULL if sole trader
    contact_email       text,
    contact_phone       text,
    updated_at          timestamptz NOT NULL DEFAULT timezone('utc', now())
);

DROP TRIGGER IF EXISTS trg_tax_profiles_updated_at ON tax_profiles;
CREATE TRIGGER trg_tax_profiles_updated_at
    BEFORE UPDATE ON tax_profiles
    FOR EACH ROW EXECUTE FUNCTION set_updated_at_now();

-- ---------------------------------------------------------------------------
-- 23. INVOICES  [NEW]
-- Platform invoices (billing tenants) and tenant invoices (billing customers).
-- issuer='platform' → BeepBite bills a tenant org.
-- issuer='tenant'   → A tenant org bills a customer.
-- Recipient is either an org (recipient_org_id) or a customer profile
-- (recipient_customer_id); the current snapshot is stored in recipient_snapshot.
-- ---------------------------------------------------------------------------

CREATE TABLE invoices (
    id                          uuid        DEFAULT gen_random_uuid() PRIMARY KEY,

    -- Who issues
    issuer                      text        NOT NULL CHECK (issuer IN ('platform', 'tenant')),
    issuer_org_id               uuid        REFERENCES organizations(id) ON DELETE SET NULL,
        -- NULL when issuer='platform' (platform itself issues)

    -- Who receives
    recipient_org_id            uuid        REFERENCES organizations(id) ON DELETE SET NULL,
    recipient_customer_id       uuid        REFERENCES customers(id) ON DELETE SET NULL,
    recipient_snapshot          jsonb,      -- snapshot of name/address at issuance time

    invoice_number              text        NOT NULL,
    currency                    text        NOT NULL CHECK (char_length(currency) = 3),
    subtotal_cents              bigint      NOT NULL CHECK (subtotal_cents >= 0),
    vat_cents                   bigint      NOT NULL DEFAULT 0 CHECK (vat_cents >= 0),
    vat_rate_percent            decimal(6,4),
    vat_applied                 boolean     NOT NULL DEFAULT false,
    total_cents                 bigint      NOT NULL CHECK (total_cents >= 0),
    due_date                    date,
    status                      text        NOT NULL DEFAULT 'draft'
                                            CHECK (status IN ('draft','sent','paid','overdue','cancelled','void')),
    issued_at                   timestamptz,
    paid_at                     timestamptz,
    pdf_object_key              text,       -- object storage key for the generated PDF
    idempotency_key             text        UNIQUE,
    metadata                    jsonb       NOT NULL DEFAULT '{}',
    created_at                  timestamptz NOT NULL DEFAULT timezone('utc', now()),
    updated_at                  timestamptz NOT NULL DEFAULT timezone('utc', now()),

    UNIQUE (invoice_number),
    -- At least one of issuer_org_id / recipient must be set; enforced at app layer.
    CONSTRAINT invoices_has_recipient CHECK (
        recipient_org_id IS NOT NULL OR recipient_customer_id IS NOT NULL OR issuer = 'platform'
    )
);

CREATE INDEX idx_invoices_issuer_org      ON invoices(issuer_org_id) WHERE issuer_org_id IS NOT NULL;
CREATE INDEX idx_invoices_recipient_org   ON invoices(recipient_org_id) WHERE recipient_org_id IS NOT NULL;
CREATE INDEX idx_invoices_recipient_cust  ON invoices(recipient_customer_id) WHERE recipient_customer_id IS NOT NULL;
CREATE INDEX idx_invoices_status          ON invoices(status);
CREATE INDEX idx_invoices_due_date        ON invoices(due_date) WHERE due_date IS NOT NULL;
CREATE INDEX idx_invoices_issued_at       ON invoices(issued_at);

DROP TRIGGER IF EXISTS trg_invoices_updated_at ON invoices;
CREATE TRIGGER trg_invoices_updated_at
    BEFORE UPDATE ON invoices
    FOR EACH ROW EXECUTE FUNCTION set_updated_at_now();

-- ---------------------------------------------------------------------------
-- 24. ROW LEVEL SECURITY
-- ---------------------------------------------------------------------------

-- 24.1  customers  (org-scoped) -------------------------------------------
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE customers FORCE ROW LEVEL SECURITY;

CREATE POLICY customers_select ON customers FOR SELECT
    USING (organization_id = current_org_id() OR is_service_role());
CREATE POLICY customers_insert ON customers FOR INSERT
    WITH CHECK (organization_id = current_org_id() OR is_service_role());
CREATE POLICY customers_update ON customers FOR UPDATE
    USING (organization_id = current_org_id() OR is_service_role())
    WITH CHECK (organization_id = current_org_id() OR is_service_role());
CREATE POLICY customers_delete ON customers FOR DELETE
    USING (is_service_role());

-- 24.2  customer_addresses  (via customer → org) --------------------------
ALTER TABLE customer_addresses ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_addresses FORCE ROW LEVEL SECURITY;

CREATE POLICY customer_addresses_select ON customer_addresses FOR SELECT
    USING (
        customer_id IN (SELECT id FROM customers WHERE organization_id = current_org_id())
        OR is_service_role()
    );
CREATE POLICY customer_addresses_insert ON customer_addresses FOR INSERT
    WITH CHECK (
        customer_id IN (SELECT id FROM customers WHERE organization_id = current_org_id())
        OR is_service_role()
    );
CREATE POLICY customer_addresses_update ON customer_addresses FOR UPDATE
    USING (
        customer_id IN (SELECT id FROM customers WHERE organization_id = current_org_id())
        OR is_service_role()
    )
    WITH CHECK (
        customer_id IN (SELECT id FROM customers WHERE organization_id = current_org_id())
        OR is_service_role()
    );
CREATE POLICY customer_addresses_delete ON customer_addresses FOR DELETE
    USING (is_service_role());

-- 24.3  promotions  (org-scoped) ------------------------------------------
ALTER TABLE promotions ENABLE ROW LEVEL SECURITY;
ALTER TABLE promotions FORCE ROW LEVEL SECURITY;

CREATE POLICY promotions_select ON promotions FOR SELECT
    USING (organization_id = current_org_id() OR is_service_role());
CREATE POLICY promotions_insert ON promotions FOR INSERT
    WITH CHECK (organization_id = current_org_id() OR is_service_role());
CREATE POLICY promotions_update ON promotions FOR UPDATE
    USING (organization_id = current_org_id() OR is_service_role())
    WITH CHECK (organization_id = current_org_id() OR is_service_role());
CREATE POLICY promotions_delete ON promotions FOR DELETE
    USING (is_service_role());

-- 24.4  promotion_target_items  (via promotion → org) ---------------------
ALTER TABLE promotion_target_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE promotion_target_items FORCE ROW LEVEL SECURITY;

CREATE POLICY promotion_target_items_select ON promotion_target_items FOR SELECT
    USING (
        promotion_id IN (SELECT id FROM promotions WHERE organization_id = current_org_id())
        OR is_service_role()
    );
CREATE POLICY promotion_target_items_insert ON promotion_target_items FOR INSERT
    WITH CHECK (
        promotion_id IN (SELECT id FROM promotions WHERE organization_id = current_org_id())
        OR is_service_role()
    );
CREATE POLICY promotion_target_items_update ON promotion_target_items FOR UPDATE
    USING (
        promotion_id IN (SELECT id FROM promotions WHERE organization_id = current_org_id())
        OR is_service_role()
    )
    WITH CHECK (
        promotion_id IN (SELECT id FROM promotions WHERE organization_id = current_org_id())
        OR is_service_role()
    );
CREATE POLICY promotion_target_items_delete ON promotion_target_items FOR DELETE
    USING (is_service_role());

-- 24.5  promotion_target_categories  (via promotion → org) ----------------
ALTER TABLE promotion_target_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE promotion_target_categories FORCE ROW LEVEL SECURITY;

CREATE POLICY promotion_target_categories_select ON promotion_target_categories FOR SELECT
    USING (
        promotion_id IN (SELECT id FROM promotions WHERE organization_id = current_org_id())
        OR is_service_role()
    );
CREATE POLICY promotion_target_categories_insert ON promotion_target_categories FOR INSERT
    WITH CHECK (
        promotion_id IN (SELECT id FROM promotions WHERE organization_id = current_org_id())
        OR is_service_role()
    );
CREATE POLICY promotion_target_categories_update ON promotion_target_categories FOR UPDATE
    USING (
        promotion_id IN (SELECT id FROM promotions WHERE organization_id = current_org_id())
        OR is_service_role()
    )
    WITH CHECK (
        promotion_id IN (SELECT id FROM promotions WHERE organization_id = current_org_id())
        OR is_service_role()
    );
CREATE POLICY promotion_target_categories_delete ON promotion_target_categories FOR DELETE
    USING (is_service_role());

-- 24.6  coupon_codes  (via promotion → org) --------------------------------
ALTER TABLE coupon_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE coupon_codes FORCE ROW LEVEL SECURITY;

CREATE POLICY coupon_codes_select ON coupon_codes FOR SELECT
    USING (
        promotion_id IN (SELECT id FROM promotions WHERE organization_id = current_org_id())
        OR is_service_role()
    );
CREATE POLICY coupon_codes_insert ON coupon_codes FOR INSERT
    WITH CHECK (
        promotion_id IN (SELECT id FROM promotions WHERE organization_id = current_org_id())
        OR is_service_role()
    );
CREATE POLICY coupon_codes_update ON coupon_codes FOR UPDATE
    USING (
        promotion_id IN (SELECT id FROM promotions WHERE organization_id = current_org_id())
        OR is_service_role()
    )
    WITH CHECK (
        promotion_id IN (SELECT id FROM promotions WHERE organization_id = current_org_id())
        OR is_service_role()
    );
CREATE POLICY coupon_codes_delete ON coupon_codes FOR DELETE
    USING (is_service_role());

-- 24.7  promotion_redemptions  (via promotion → org) ----------------------
ALTER TABLE promotion_redemptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE promotion_redemptions FORCE ROW LEVEL SECURITY;

CREATE POLICY promotion_redemptions_select ON promotion_redemptions FOR SELECT
    USING (
        promotion_id IN (SELECT id FROM promotions WHERE organization_id = current_org_id())
        OR is_service_role()
    );
CREATE POLICY promotion_redemptions_insert ON promotion_redemptions FOR INSERT
    WITH CHECK (
        promotion_id IN (SELECT id FROM promotions WHERE organization_id = current_org_id())
        OR is_service_role()
    );
CREATE POLICY promotion_redemptions_update ON promotion_redemptions FOR UPDATE
    USING (
        promotion_id IN (SELECT id FROM promotions WHERE organization_id = current_org_id())
        OR is_service_role()
    )
    WITH CHECK (
        promotion_id IN (SELECT id FROM promotions WHERE organization_id = current_org_id())
        OR is_service_role()
    );
CREATE POLICY promotion_redemptions_delete ON promotion_redemptions FOR DELETE
    USING (is_service_role());

-- 24.8  order_item_discounts  (via redemption → promotion → org) ----------
ALTER TABLE order_item_discounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_item_discounts FORCE ROW LEVEL SECURITY;

CREATE POLICY order_item_discounts_select ON order_item_discounts FOR SELECT
    USING (
        promotion_redemption_id IN (
            SELECT pr.id FROM promotion_redemptions pr
            JOIN promotions p ON p.id = pr.promotion_id
            WHERE p.organization_id = current_org_id()
        )
        OR is_service_role()
    );
CREATE POLICY order_item_discounts_insert ON order_item_discounts FOR INSERT
    WITH CHECK (
        promotion_redemption_id IN (
            SELECT pr.id FROM promotion_redemptions pr
            JOIN promotions p ON p.id = pr.promotion_id
            WHERE p.organization_id = current_org_id()
        )
        OR is_service_role()
    );
CREATE POLICY order_item_discounts_update ON order_item_discounts FOR UPDATE
    USING (
        promotion_redemption_id IN (
            SELECT pr.id FROM promotion_redemptions pr
            JOIN promotions p ON p.id = pr.promotion_id
            WHERE p.organization_id = current_org_id()
        )
        OR is_service_role()
    )
    WITH CHECK (
        promotion_redemption_id IN (
            SELECT pr.id FROM promotion_redemptions pr
            JOIN promotions p ON p.id = pr.promotion_id
            WHERE p.organization_id = current_org_id()
        )
        OR is_service_role()
    );
CREATE POLICY order_item_discounts_delete ON order_item_discounts FOR DELETE
    USING (is_service_role());

-- 24.9  gift_cards  (org-scoped) ------------------------------------------
ALTER TABLE gift_cards ENABLE ROW LEVEL SECURITY;
ALTER TABLE gift_cards FORCE ROW LEVEL SECURITY;

CREATE POLICY gift_cards_select ON gift_cards FOR SELECT
    USING (organization_id = current_org_id() OR is_service_role());
CREATE POLICY gift_cards_insert ON gift_cards FOR INSERT
    WITH CHECK (organization_id = current_org_id() OR is_service_role());
CREATE POLICY gift_cards_update ON gift_cards FOR UPDATE
    USING (organization_id = current_org_id() OR is_service_role())
    WITH CHECK (organization_id = current_org_id() OR is_service_role());
CREATE POLICY gift_cards_delete ON gift_cards FOR DELETE
    USING (is_service_role());

-- 24.10 gift_card_transactions  (APPEND-ONLY; no UPDATE/DELETE) -----------
ALTER TABLE gift_card_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE gift_card_transactions FORCE ROW LEVEL SECURITY;

CREATE POLICY gift_card_transactions_select ON gift_card_transactions FOR SELECT
    USING (
        gift_card_id IN (SELECT id FROM gift_cards WHERE organization_id = current_org_id())
        OR is_service_role()
    );
-- INSERT allowed for org members (they write their own ledger)
CREATE POLICY gift_card_transactions_insert ON gift_card_transactions FOR INSERT
    WITH CHECK (
        gift_card_id IN (SELECT id FROM gift_cards WHERE organization_id = current_org_id())
        OR is_service_role()
    );
-- UPDATE forbidden for all (append-only)
CREATE POLICY gift_card_transactions_update ON gift_card_transactions FOR UPDATE
    USING (false);
-- DELETE forbidden for all (append-only)
CREATE POLICY gift_card_transactions_delete ON gift_card_transactions FOR DELETE
    USING (false);

-- 24.11 store_credits  (org-scoped) ---------------------------------------
ALTER TABLE store_credits ENABLE ROW LEVEL SECURITY;
ALTER TABLE store_credits FORCE ROW LEVEL SECURITY;

CREATE POLICY store_credits_select ON store_credits FOR SELECT
    USING (organization_id = current_org_id() OR is_service_role());
CREATE POLICY store_credits_insert ON store_credits FOR INSERT
    WITH CHECK (organization_id = current_org_id() OR is_service_role());
CREATE POLICY store_credits_update ON store_credits FOR UPDATE
    USING (organization_id = current_org_id() OR is_service_role())
    WITH CHECK (organization_id = current_org_id() OR is_service_role());
CREATE POLICY store_credits_delete ON store_credits FOR DELETE
    USING (is_service_role());

-- 24.12 store_credit_transactions  (org-scoped; append-only in practice but
--        not strictly enforced via RLS — service_role can correct errors) ---
ALTER TABLE store_credit_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE store_credit_transactions FORCE ROW LEVEL SECURITY;

CREATE POLICY store_credit_transactions_select ON store_credit_transactions FOR SELECT
    USING (
        store_credit_id IN (SELECT id FROM store_credits WHERE organization_id = current_org_id())
        OR is_service_role()
    );
CREATE POLICY store_credit_transactions_insert ON store_credit_transactions FOR INSERT
    WITH CHECK (
        store_credit_id IN (SELECT id FROM store_credits WHERE organization_id = current_org_id())
        OR is_service_role()
    );
CREATE POLICY store_credit_transactions_update ON store_credit_transactions FOR UPDATE
    USING (is_service_role());
CREATE POLICY store_credit_transactions_delete ON store_credit_transactions FOR DELETE
    USING (is_service_role());

-- 24.13 house_accounts  (org-scoped) --------------------------------------
ALTER TABLE house_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE house_accounts FORCE ROW LEVEL SECURITY;

CREATE POLICY house_accounts_select ON house_accounts FOR SELECT
    USING (organization_id = current_org_id() OR is_service_role());
CREATE POLICY house_accounts_insert ON house_accounts FOR INSERT
    WITH CHECK (organization_id = current_org_id() OR is_service_role());
CREATE POLICY house_accounts_update ON house_accounts FOR UPDATE
    USING (organization_id = current_org_id() OR is_service_role())
    WITH CHECK (organization_id = current_org_id() OR is_service_role());
CREATE POLICY house_accounts_delete ON house_accounts FOR DELETE
    USING (is_service_role());

-- 24.14 house_account_members  (via house_account → org) ------------------
ALTER TABLE house_account_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE house_account_members FORCE ROW LEVEL SECURITY;

CREATE POLICY house_account_members_select ON house_account_members FOR SELECT
    USING (
        house_account_id IN (SELECT id FROM house_accounts WHERE organization_id = current_org_id())
        OR is_service_role()
    );
CREATE POLICY house_account_members_insert ON house_account_members FOR INSERT
    WITH CHECK (
        house_account_id IN (SELECT id FROM house_accounts WHERE organization_id = current_org_id())
        OR is_service_role()
    );
CREATE POLICY house_account_members_update ON house_account_members FOR UPDATE
    USING (
        house_account_id IN (SELECT id FROM house_accounts WHERE organization_id = current_org_id())
        OR is_service_role()
    )
    WITH CHECK (
        house_account_id IN (SELECT id FROM house_accounts WHERE organization_id = current_org_id())
        OR is_service_role()
    );
CREATE POLICY house_account_members_delete ON house_account_members FOR DELETE
    USING (is_service_role());

-- 24.15 house_account_invoices  (via house_account → org) -----------------
ALTER TABLE house_account_invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE house_account_invoices FORCE ROW LEVEL SECURITY;

CREATE POLICY house_account_invoices_select ON house_account_invoices FOR SELECT
    USING (
        house_account_id IN (SELECT id FROM house_accounts WHERE organization_id = current_org_id())
        OR is_service_role()
    );
CREATE POLICY house_account_invoices_insert ON house_account_invoices FOR INSERT
    WITH CHECK (
        house_account_id IN (SELECT id FROM house_accounts WHERE organization_id = current_org_id())
        OR is_service_role()
    );
CREATE POLICY house_account_invoices_update ON house_account_invoices FOR UPDATE
    USING (
        house_account_id IN (SELECT id FROM house_accounts WHERE organization_id = current_org_id())
        OR is_service_role()
    )
    WITH CHECK (
        house_account_id IN (SELECT id FROM house_accounts WHERE organization_id = current_org_id())
        OR is_service_role()
    );
CREATE POLICY house_account_invoices_delete ON house_account_invoices FOR DELETE
    USING (is_service_role());

-- 24.16 house_account_charges  (via house_account → org) -----------------
ALTER TABLE house_account_charges ENABLE ROW LEVEL SECURITY;
ALTER TABLE house_account_charges FORCE ROW LEVEL SECURITY;

CREATE POLICY house_account_charges_select ON house_account_charges FOR SELECT
    USING (
        house_account_id IN (SELECT id FROM house_accounts WHERE organization_id = current_org_id())
        OR is_service_role()
    );
CREATE POLICY house_account_charges_insert ON house_account_charges FOR INSERT
    WITH CHECK (
        house_account_id IN (SELECT id FROM house_accounts WHERE organization_id = current_org_id())
        OR is_service_role()
    );
CREATE POLICY house_account_charges_update ON house_account_charges FOR UPDATE
    USING (
        house_account_id IN (SELECT id FROM house_accounts WHERE organization_id = current_org_id())
        OR is_service_role()
    )
    WITH CHECK (
        house_account_id IN (SELECT id FROM house_accounts WHERE organization_id = current_org_id())
        OR is_service_role()
    );
CREATE POLICY house_account_charges_delete ON house_account_charges FOR DELETE
    USING (is_service_role());

-- 24.17 loyalty_config  (org-scoped) --------------------------------------
ALTER TABLE loyalty_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE loyalty_config FORCE ROW LEVEL SECURITY;

CREATE POLICY loyalty_config_select ON loyalty_config FOR SELECT
    USING (organization_id = current_org_id() OR is_service_role());
CREATE POLICY loyalty_config_insert ON loyalty_config FOR INSERT
    WITH CHECK (organization_id = current_org_id() OR is_service_role());
CREATE POLICY loyalty_config_update ON loyalty_config FOR UPDATE
    USING (organization_id = current_org_id() OR is_service_role())
    WITH CHECK (organization_id = current_org_id() OR is_service_role());
CREATE POLICY loyalty_config_delete ON loyalty_config FOR DELETE
    USING (is_service_role());

-- 24.18 loyalty_transactions  (APPEND-ONLY; no UPDATE/DELETE) -------------
ALTER TABLE loyalty_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE loyalty_transactions FORCE ROW LEVEL SECURITY;

CREATE POLICY loyalty_transactions_select ON loyalty_transactions FOR SELECT
    USING (organization_id = current_org_id() OR is_service_role());
CREATE POLICY loyalty_transactions_insert ON loyalty_transactions FOR INSERT
    WITH CHECK (organization_id = current_org_id() OR is_service_role());
-- UPDATE forbidden (append-only ledger)
CREATE POLICY loyalty_transactions_update ON loyalty_transactions FOR UPDATE
    USING (false);
-- DELETE forbidden (append-only ledger)
CREATE POLICY loyalty_transactions_delete ON loyalty_transactions FOR DELETE
    USING (false);

-- 24.19 reservations  (org-scoped) ----------------------------------------
ALTER TABLE reservations ENABLE ROW LEVEL SECURITY;
ALTER TABLE reservations FORCE ROW LEVEL SECURITY;

CREATE POLICY reservations_select ON reservations FOR SELECT
    USING (organization_id = current_org_id() OR is_service_role());
CREATE POLICY reservations_insert ON reservations FOR INSERT
    WITH CHECK (organization_id = current_org_id() OR is_service_role());
CREATE POLICY reservations_update ON reservations FOR UPDATE
    USING (organization_id = current_org_id() OR is_service_role())
    WITH CHECK (organization_id = current_org_id() OR is_service_role());
CREATE POLICY reservations_delete ON reservations FOR DELETE
    USING (is_service_role());

-- 24.20 waitlist  (org-scoped) --------------------------------------------
ALTER TABLE waitlist ENABLE ROW LEVEL SECURITY;
ALTER TABLE waitlist FORCE ROW LEVEL SECURITY;

CREATE POLICY waitlist_select ON waitlist FOR SELECT
    USING (organization_id = current_org_id() OR is_service_role());
CREATE POLICY waitlist_insert ON waitlist FOR INSERT
    WITH CHECK (organization_id = current_org_id() OR is_service_role());
CREATE POLICY waitlist_update ON waitlist FOR UPDATE
    USING (organization_id = current_org_id() OR is_service_role())
    WITH CHECK (organization_id = current_org_id() OR is_service_role());
CREATE POLICY waitlist_delete ON waitlist FOR DELETE
    USING (is_service_role());

-- 24.21 reviews  (via order → location → org) ------------------------------
ALTER TABLE reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE reviews FORCE ROW LEVEL SECURITY;

CREATE POLICY reviews_select ON reviews FOR SELECT
    USING (
        order_id IN (
            SELECT o.id FROM orders o
            JOIN locations l ON l.id = o.location_id
            WHERE l.organization_id = current_org_id()
        )
        OR is_service_role()
    );
CREATE POLICY reviews_insert ON reviews FOR INSERT
    WITH CHECK (
        order_id IN (
            SELECT o.id FROM orders o
            JOIN locations l ON l.id = o.location_id
            WHERE l.organization_id = current_org_id()
        )
        OR is_service_role()
    );
CREATE POLICY reviews_update ON reviews FOR UPDATE
    USING (
        order_id IN (
            SELECT o.id FROM orders o
            JOIN locations l ON l.id = o.location_id
            WHERE l.organization_id = current_org_id()
        )
        OR is_service_role()
    )
    WITH CHECK (
        order_id IN (
            SELECT o.id FROM orders o
            JOIN locations l ON l.id = o.location_id
            WHERE l.organization_id = current_org_id()
        )
        OR is_service_role()
    );
CREATE POLICY reviews_delete ON reviews FOR DELETE
    USING (is_service_role());

-- 24.22 marketplace_reviews
--   - Org-scoped writes (tenants manage their reviews).
--   - marketplace_role can SELECT rows where status='visible' (public display).
ALTER TABLE marketplace_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE marketplace_reviews FORCE ROW LEVEL SECURITY;

-- Tenant members read/write their own location's reviews
CREATE POLICY marketplace_reviews_select_tenant ON marketplace_reviews FOR SELECT
    USING (
        location_id IN (SELECT id FROM locations WHERE organization_id = current_org_id())
        OR is_service_role()
    );
-- Public marketplace read: only visible reviews
CREATE POLICY marketplace_reviews_select_public ON marketplace_reviews FOR SELECT
    USING (is_marketplace_role() AND status = 'visible');

CREATE POLICY marketplace_reviews_insert ON marketplace_reviews FOR INSERT
    WITH CHECK (
        location_id IN (SELECT id FROM locations WHERE organization_id = current_org_id())
        OR is_service_role()
    );
CREATE POLICY marketplace_reviews_update ON marketplace_reviews FOR UPDATE
    USING (
        location_id IN (SELECT id FROM locations WHERE organization_id = current_org_id())
        OR is_service_role()
    )
    WITH CHECK (
        location_id IN (SELECT id FROM locations WHERE organization_id = current_org_id())
        OR is_service_role()
    );
CREATE POLICY marketplace_reviews_delete ON marketplace_reviews FOR DELETE
    USING (is_service_role());

-- 24.23 tax_profiles  (each org sees only its own row; org_id = PK) --------
ALTER TABLE tax_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE tax_profiles FORCE ROW LEVEL SECURITY;

CREATE POLICY tax_profiles_select ON tax_profiles FOR SELECT
    USING (org_id = current_org_id() OR is_service_role());
CREATE POLICY tax_profiles_insert ON tax_profiles FOR INSERT
    WITH CHECK (org_id = current_org_id() OR is_service_role());
CREATE POLICY tax_profiles_update ON tax_profiles FOR UPDATE
    USING (org_id = current_org_id() OR is_service_role())
    WITH CHECK (org_id = current_org_id() OR is_service_role());
CREATE POLICY tax_profiles_delete ON tax_profiles FOR DELETE
    USING (is_service_role());

-- 24.24 invoices  (complex — both issuer and recipient can read) ----------
-- Threat: an org must not see invoices addressed to another org, and a customer
-- must not see another customer's invoice.
-- Allowed readers:
--   a) org that issued it (issuer_org_id = current_org_id)
--   b) org that received it (recipient_org_id = current_org_id)
--   c) service_role (full access)
-- Customer-facing reads go through service_role in practice (handler layer).
ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoices FORCE ROW LEVEL SECURITY;

CREATE POLICY invoices_select ON invoices FOR SELECT
    USING (
        issuer_org_id = current_org_id()
        OR recipient_org_id = current_org_id()
        OR is_service_role()
    );
CREATE POLICY invoices_insert ON invoices FOR INSERT
    WITH CHECK (
        issuer_org_id = current_org_id()
        OR is_service_role()
    );
CREATE POLICY invoices_update ON invoices FOR UPDATE
    USING (
        issuer_org_id = current_org_id()
        OR is_service_role()
    )
    WITH CHECK (
        issuer_org_id = current_org_id()
        OR is_service_role()
    );
CREATE POLICY invoices_delete ON invoices FOR DELETE
    USING (is_service_role());

-- ---------------------------------------------------------------------------
-- DONE
-- ---------------------------------------------------------------------------
-- Tables: customers, customer_addresses,
--         promotions, promotion_target_items, promotion_target_categories,
--         coupon_codes, promotion_redemptions, order_item_discounts,
--         gift_cards, gift_card_transactions,
--         store_credits, store_credit_transactions,
--         house_accounts, house_account_members, house_account_charges,
--         house_account_invoices,
--         loyalty_config, loyalty_transactions,
--         reservations, waitlist,
--         reviews, marketplace_reviews,
--         tax_profiles, invoices
--         (24 total)
--
-- Append-only enforced via RLS (UPDATE=false, DELETE=false) on:
--   gift_card_transactions, loyalty_transactions

-- =============================================================================
-- DEFERRED RLS POLICIES FROM 007 — require customers table (defined here)
-- =============================================================================
-- customer_payment_authorizations policies reference customers.id.
-- Deferred from 007 because customers is defined in this migration (010).
-- Postgres 18 validates policy table references at DDL time.
-- =============================================================================

CREATE POLICY cpa_select ON customer_payment_authorizations FOR SELECT
    USING (
        customer_id IN (
            SELECT c.id FROM customers c
            WHERE c.organization_id = current_org_id()
        )
        OR is_service_role()
    );

CREATE POLICY cpa_insert ON customer_payment_authorizations FOR INSERT
    WITH CHECK (
        customer_id IN (
            SELECT c.id FROM customers c
            WHERE c.organization_id = current_org_id()
        )
        OR is_service_role()
    );

CREATE POLICY cpa_update ON customer_payment_authorizations FOR UPDATE
    USING (
        customer_id IN (
            SELECT c.id FROM customers c
            WHERE c.organization_id = current_org_id()
        )
        OR is_service_role()
    )
    WITH CHECK (
        customer_id IN (
            SELECT c.id FROM customers c
            WHERE c.organization_id = current_org_id()
        )
        OR is_service_role()
    );

-- =============================================================================
-- DEFERRED FK CONSTRAINTS FROM 007 — require customers table (defined here)
-- =============================================================================
-- customer_payment_authorizations.customer_id and cart_items.customer_id
-- reference customers(id) but customers is defined in this migration (010).
-- The inline REFERENCES clauses were removed from 007 and the FKs are added here.
-- =============================================================================

ALTER TABLE customer_payment_authorizations
    ADD CONSTRAINT fk_cpa_customer
    FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE;

ALTER TABLE cart_items
    ADD CONSTRAINT fk_cart_items_customer
    FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE;

-- orders.customer_id FK (from 008) — customers defined here in 010.
ALTER TABLE orders
    ADD CONSTRAINT fk_orders_customer
    FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE SET NULL;

