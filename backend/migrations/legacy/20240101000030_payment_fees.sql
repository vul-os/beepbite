-- ======================
-- BEEPBITE PLATFORM FEE LEDGER
-- payment_fees (v2) — records BeepBite's own transaction and payout fees
-- against subscription-plan tiers.  The existing payment_fees table (migration
-- 004) tracks gateway-side processing fees.  This table tracks the platform
-- tier fees written by the Go jobs layer.
-- ======================

CREATE TABLE beepbite_payment_fees (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_payment_id    UUID NOT NULL REFERENCES order_payments(id) ON DELETE CASCADE,
    organization_id     UUID NOT NULL REFERENCES organizations(id),
    subscription_plan_id UUID REFERENCES subscription_plans(id),
    fee_kind            TEXT NOT NULL CHECK (fee_kind IN ('transaction', 'payout')),
    fee_amount_cents    BIGINT NOT NULL,
    captured_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (order_payment_id, fee_kind)
);

CREATE INDEX idx_beepbite_payment_fees_org  ON beepbite_payment_fees(organization_id);
CREATE INDEX idx_beepbite_payment_fees_kind ON beepbite_payment_fees(fee_kind);
CREATE INDEX idx_beepbite_payment_fees_plan ON beepbite_payment_fees(subscription_plan_id)
    WHERE subscription_plan_id IS NOT NULL;
