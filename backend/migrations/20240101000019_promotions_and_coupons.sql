-- ======================
-- PROMOTIONS & COUPONS ENGINE
-- Discounts, promotions, coupon-code campaigns and redemption audit trail.
-- ======================

-- TODO: attach updated_at trigger once set_updated_at() helper exists

-- ======================
-- PROMOTIONS (parent config)
-- ======================

-- Parent configuration for any promotion or coupon campaign.
-- organization_id is always set so org-wide promos work; location_id is
-- optional (NULL = applies to every location in the org).
CREATE TABLE promotions (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    location_id uuid REFERENCES locations(id) ON DELETE CASCADE,
    organization_id uuid REFERENCES organizations(id) ON DELETE CASCADE NOT NULL,
    name text NOT NULL,
    description text,

    -- What kind of discount this is
    promo_type text NOT NULL CHECK (promo_type IN ('percent_off', 'fixed_off', 'bogo', 'free_item', 'happy_hour_price', 'free_delivery')),
    -- What the discount attaches to
    scope text NOT NULL CHECK (scope IN ('order', 'item', 'category', 'delivery')),

    -- Discount value fields (which one is used depends on promo_type)
    percent_off decimal(5,2) CHECK (percent_off IS NULL OR (percent_off >= 0 AND percent_off <= 100)), -- for percent_off
    fixed_off_cents bigint, -- for fixed_off
    happy_hour_price_cents bigint, -- for happy_hour_price (override price)

    -- BOGO configuration
    bogo_buy_qty integer DEFAULT 1, -- buy N
    bogo_get_qty integer DEFAULT 1, -- get M free/discounted
    bogo_get_discount_percent decimal(5,2) DEFAULT 100 CHECK (bogo_get_discount_percent IS NULL OR (bogo_get_discount_percent >= 0 AND bogo_get_discount_percent <= 100)), -- 100 = free

    -- Free-item promo target
    free_item_id uuid REFERENCES items(id) ON DELETE SET NULL,

    -- Qualification & caps
    min_spend_cents bigint DEFAULT 0, -- minimum order subtotal to qualify
    max_discount_cents bigint, -- cap on total applied discount

    -- Stacking / coupon requirement
    stackable boolean NOT NULL DEFAULT false, -- can combine with other promos?
    requires_coupon_code boolean NOT NULL DEFAULT false, -- customer must enter a coupon_codes row

    -- Validity window
    active_from timestamptz,
    active_until timestamptz,

    -- Daypart restrictions, e.g. [{"day":"mon","from":"15:00","until":"18:00"}]
    -- NULL means any time
    dayparts jsonb,

    -- Customer targeting
    customer_segment text DEFAULT 'all' CHECK (customer_segment IN ('all', 'first_time', 'vip', 'lapsed') OR customer_segment IS NULL),

    -- Usage caps
    usage_limit_total integer, -- max total redemptions across all customers (NULL = unlimited)
    usage_limit_per_customer integer DEFAULT 1, -- per-customer cap; NULL = unlimited

    -- Admin flags
    is_active boolean NOT NULL DEFAULT true,
    priority integer NOT NULL DEFAULT 0, -- when non-stackable promos collide, higher wins

    created_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
    created_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- ======================
-- PROMOTION TARGETS
-- ======================

-- For scope='item': which specific items the promotion applies to.
CREATE TABLE promotion_target_items (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    promotion_id uuid REFERENCES promotions(id) ON DELETE CASCADE NOT NULL,
    item_id uuid REFERENCES items(id) ON DELETE CASCADE NOT NULL,
    created_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL,
    UNIQUE(promotion_id, item_id)
);

-- For scope='category': which categories the promotion applies to.
CREATE TABLE promotion_target_categories (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    promotion_id uuid REFERENCES promotions(id) ON DELETE CASCADE NOT NULL,
    category_id uuid REFERENCES categories(id) ON DELETE CASCADE NOT NULL,
    created_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL,
    UNIQUE(promotion_id, category_id)
);

-- ======================
-- COUPON CODES
-- ======================

-- Bulk-generatable / single-use codes linked to a promotion.
-- Codes are treated case-insensitively in practice; enforced via a functional
-- unique index on lower(code) below (the column itself has no UNIQUE).
CREATE TABLE coupon_codes (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    promotion_id uuid REFERENCES promotions(id) ON DELETE CASCADE NOT NULL,
    code text NOT NULL,
    max_uses integer DEFAULT 1, -- per-code cap (1 = single-use)
    used_count integer NOT NULL DEFAULT 0,
    assigned_to_customer_id uuid REFERENCES customers(id) ON DELETE SET NULL, -- if set, only that customer can redeem
    active_from timestamptz,
    active_until timestamptz,
    is_active boolean NOT NULL DEFAULT true,
    created_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Case-insensitive uniqueness on coupon code
CREATE UNIQUE INDEX coupon_codes_code_lower_idx ON coupon_codes (lower(code));

-- ======================
-- REDEMPTIONS (audit trail)
-- ======================

-- One row per promotion applied to an order (order-level attribution).
CREATE TABLE promotion_redemptions (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    promotion_id uuid REFERENCES promotions(id) ON DELETE CASCADE NOT NULL,
    coupon_code_id uuid REFERENCES coupon_codes(id) ON DELETE SET NULL, -- NULL for auto-applied promos
    order_id uuid REFERENCES orders(id) ON DELETE CASCADE NOT NULL,
    customer_id uuid REFERENCES customers(id) ON DELETE SET NULL,
    discount_amount_cents bigint NOT NULL CHECK (discount_amount_cents >= 0),
    applied_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL,
    created_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL,
    UNIQUE(promotion_id, order_id) -- one redemption of a given promo per order
);

-- Line-level attribution: which order_item took which slice of a redemption's
-- discount. Enables accurate per-item reporting and margin analysis.
CREATE TABLE order_item_discounts (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    order_item_id uuid REFERENCES order_items(id) ON DELETE CASCADE NOT NULL,
    promotion_redemption_id uuid REFERENCES promotion_redemptions(id) ON DELETE CASCADE NOT NULL,
    discount_amount_cents bigint NOT NULL CHECK (discount_amount_cents >= 0),
    created_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL,
    UNIQUE(order_item_id, promotion_redemption_id)
);

-- ======================
-- INDEXES
-- ======================

-- promotions
CREATE INDEX idx_promotions_org_active ON promotions(organization_id, is_active);
CREATE INDEX idx_promotions_location_active ON promotions(location_id, is_active) WHERE location_id IS NOT NULL;
CREATE INDEX idx_promotions_window ON promotions(active_from, active_until);

-- promotion_target_items
CREATE INDEX idx_promotion_target_items_promotion ON promotion_target_items(promotion_id);
CREATE INDEX idx_promotion_target_items_item ON promotion_target_items(item_id);

-- promotion_target_categories
CREATE INDEX idx_promotion_target_categories_promotion ON promotion_target_categories(promotion_id);
CREATE INDEX idx_promotion_target_categories_category ON promotion_target_categories(category_id);

-- coupon_codes
CREATE INDEX idx_coupon_codes_promotion ON coupon_codes(promotion_id);
CREATE INDEX idx_coupon_codes_assigned_customer ON coupon_codes(assigned_to_customer_id) WHERE assigned_to_customer_id IS NOT NULL;

-- promotion_redemptions
CREATE INDEX idx_promotion_redemptions_promotion ON promotion_redemptions(promotion_id);
CREATE INDEX idx_promotion_redemptions_order ON promotion_redemptions(order_id);
CREATE INDEX idx_promotion_redemptions_customer ON promotion_redemptions(customer_id);
CREATE INDEX idx_promotion_redemptions_applied_at ON promotion_redemptions(applied_at);

-- order_item_discounts
CREATE INDEX idx_order_item_discounts_order_item ON order_item_discounts(order_item_id);
CREATE INDEX idx_order_item_discounts_redemption ON order_item_discounts(promotion_redemption_id);
