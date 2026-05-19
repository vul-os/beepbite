
CREATE TABLE pii_access_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_type TEXT NOT NULL CHECK (actor_type IN ('member','staff','system','webhook')),
  actor_id UUID,
  customer_id UUID REFERENCES customers(id),
  access_kind TEXT NOT NULL CHECK (access_kind IN ('view','export','update','search')),
  fields_accessed TEXT[] NOT NULL DEFAULT '{}',  -- e.g. {'email','phone','address'}
  reason TEXT,
  request_id TEXT,
  ip_address INET,
  user_agent TEXT,
  accessed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_pii_access_log_customer ON pii_access_log(customer_id, accessed_at DESC);
CREATE INDEX idx_pii_access_log_actor ON pii_access_log(actor_type, actor_id, accessed_at DESC);

-- Audit-log retention sweep: archive rows older than N days to a partitioned cold table.
-- For v1, just hard-delete; partitioning is a follow-up.
CREATE TABLE audit_log_archived (LIKE audit_log INCLUDING ALL);

CREATE OR REPLACE FUNCTION archive_old_audit_log(retain_days INT)
RETURNS TABLE(moved_rows BIGINT) AS $$
DECLARE
  cutoff TIMESTAMPTZ;
BEGIN
  cutoff := now() - (retain_days || ' days')::INTERVAL;
  WITH moved AS (
    DELETE FROM audit_log WHERE created_at < cutoff RETURNING *
  )
  INSERT INTO audit_log_archived SELECT * FROM moved;
  GET DIAGNOSTICS moved_rows = ROW_COUNT;
  RETURN NEXT;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION archive_old_audit_log IS 'Move audit_log rows older than retain_days into audit_log_archived. Call from a scheduled job.';

