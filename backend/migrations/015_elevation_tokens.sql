-- =============================================================================
-- MIGRATION 015 — MANAGER ELEVATION TOKENS (T9.5e)
-- =============================================================================
-- Tracks consumed single-use manager-elevation tokens so that replaying a
-- valid JWT returns 403 elevation_used rather than allowing a second action.
--
-- Design notes:
--   • token_hash is the hex-encoded SHA-256 of the raw signed JWT string.
--     Using the hash rather than the raw token limits the stored data size
--     (64 bytes vs up to ~500 bytes) and avoids storing the full JWT secret
--     signing material in the audit table.
--   • The row is inserted atomically via INSERT ... ON CONFLICT DO NOTHING
--     before the guarded handler executes. RowsAffected == 0 signals replay.
--   • Elevation tokens expire after 60 seconds (TTL enforced by the JWT
--     ExpiresAt claim). Rows older than 5 minutes are safe to prune; the
--     audit_retention job can handle that. The table is tiny in practice —
--     even a busy POS generates ≪ 100 elevation events per day.
--   • No FK to staff because the token carries the staff_id in the JWT claim;
--     the INSERT only stores the hash + timestamp. Keeping it FK-free means
--     the row can be written inside the middleware without resolving UUIDs.
-- =============================================================================

CREATE TABLE IF NOT EXISTS elevation_tokens_used (
    token_hash   text        NOT NULL PRIMARY KEY,  -- SHA-256 hex of raw JWT
    used_at      timestamptz NOT NULL DEFAULT now()
);

-- Optional: index for time-based pruning (WHERE used_at < now() - interval '5 minutes').
CREATE INDEX IF NOT EXISTS elevation_tokens_used_used_at_idx
    ON elevation_tokens_used (used_at);

COMMENT ON TABLE elevation_tokens_used IS
    'Single-use tracking for manager-elevation JWTs (T9.5e). '
    'Rows are inserted before the privileged action executes; '
    'a duplicate token_hash means the token was already consumed (replay).';
