
CREATE TABLE tip_pools (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  location_id UUID REFERENCES locations(id),
  name TEXT NOT NULL,
  rule_type TEXT NOT NULL CHECK (rule_type IN ('equal_split','hours_weighted','points_weighted','role_weighted')),
  config JSONB NOT NULL DEFAULT '{}',  -- e.g. {"server_pts":3,"runner_pts":2,"busser_pts":1}
  shift_date DATE,                      -- nullable for ongoing pools
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE tip_pool_contributions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tip_pool_id UUID NOT NULL REFERENCES tip_pools(id) ON DELETE CASCADE,
  order_payment_id UUID REFERENCES order_payments(id),
  amount_cents BIGINT NOT NULL,
  contributed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE tip_distributions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tip_pool_id UUID NOT NULL REFERENCES tip_pools(id) ON DELETE CASCADE,
  staff_id UUID NOT NULL REFERENCES staff(id),
  amount_cents BIGINT NOT NULL,
  hours_worked NUMERIC(8,2),
  weight_points NUMERIC(8,2),
  distributed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  payroll_exported_at TIMESTAMPTZ
);

CREATE INDEX idx_tip_pools_location ON tip_pools(location_id) WHERE is_active;
CREATE INDEX idx_tip_distributions_staff ON tip_distributions(staff_id, distributed_at DESC);

-- updated_at trigger (function defined in migration 15)
DROP TRIGGER IF EXISTS tip_pools_updated_at ON tip_pools;
CREATE TRIGGER tip_pools_updated_at BEFORE UPDATE ON tip_pools FOR EACH ROW EXECUTE FUNCTION set_updated_at_now();

