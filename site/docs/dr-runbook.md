# Data-Rights & Disaster-Recovery Runbook

## Backup cadence

### Fly.io volume snapshots
- Fly automatically snapshots attached Postgres volumes **daily** and retains them for **7 days**.
- Snapshots are crash-consistent point-in-time images. They are the fastest path to a full restore.

### Hourly pg_dump to Cloudflare R2
- A cron job (managed via Fly Machines) runs `pg_dump --format=custom` every hour and uploads the result to the `beepbite-pgbackups` R2 bucket.
- Retention: **7 days** of hourly dumps → 168 files maximum.
- Naming convention: `pg_dump/YYYY/MM/DD/HH00.pgc` (UTC hour).
- The dump uses a dedicated `backup_role` Postgres user with `SELECT` on all tables and `USAGE` on all schemas.

### RPO / RTO targets
| Target | Value |
|--------|-------|
| Recovery Point Objective (RPO) | ≤ 1 hour |
| Recovery Time Objective (RTO) | ≤ 2 hours |

RPO is met by the hourly pg_dump. RTO is met by the Fly snapshot restore path (< 15 min for volume swap) plus schema-migration replay.

---

## Quarterly restore drill

Perform this drill in a staging Fly app (`beepbite-staging`) every quarter.

### Steps

1. **Identify the backup to restore**
   - For a full restore: use the most recent daily Fly snapshot.
   - For point-in-time: download the appropriate hourly dump from R2.
     ```
     rclone copy r2:beepbite-pgbackups/pg_dump/YYYY/MM/DD/HH00.pgc ./restore.pgc
     ```

2. **Provision a clean Postgres instance** (staging only — never run against production)
   ```
   fly postgres create --name beepbite-staging-db --region jnb
   ```

3. **Restore the dump**
   ```
   fly postgres connect -a beepbite-staging-db
   # Inside psql:
   CREATE DATABASE beepbite_restore;
   \q

   pg_restore \
     --dbname="postgres://..." \
     --no-owner \
     --role=beepbite \
     restore.pgc
   ```

4. **Replay pending migrations** (if the dump predates the live schema)
   ```
   DATABASE_URL="postgres://beepbite-staging-db/..." \
     go run ./cmd/migrate/main.go
   ```

5. **Smoke-test the restore**
   - Verify row counts for `organizations`, `orders`, `customers` match expected ranges.
   - Run the e2e test suite against the staging app:
     ```
     DATABASE_URL="..." go test ./cmd/tests/...
     ```
   - Confirm the API returns 200 on `GET /health`.

6. **Record results** in the quarterly DR log (Notion > Engineering > DR Drills).

7. **Clean up** — destroy the staging DB after the drill:
   ```
   fly postgres destroy beepbite-staging-db --yes
   ```

---

## Soft-delete & purge flow (Wave 31)

When an owner hits `DELETE /settings/account`:

1. `organizations.deleted_at` is set to `now()`.
2. `organizations.scheduled_purge_at` is set to `now() + 30 days`.
3. The `softdelete` background job (`jobs/softdelete`) runs nightly at 02:30 local and hard-deletes any org where `scheduled_purge_at < now()` via `DELETE FROM organizations WHERE id = $1` (ON DELETE CASCADE propagates).

The owner can reverse the deletion at any time before `scheduled_purge_at` via `POST /settings/account/restore`, which clears both columns.

### Manual emergency purge (incident response)
If a user requests immediate erasure (regulatory requirement):
```sql
-- Run as superuser or backup_role in a service-role session.
UPDATE organizations
SET scheduled_purge_at = now() - INTERVAL '1 second'
WHERE id = '<org_uuid>';
-- Then trigger the job manually or DELETE directly:
DELETE FROM organizations WHERE id = '<org_uuid>';
```
Record the action in the incident log.

---

## R2 backup credentials rotation

R2 credentials (`R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`) are stored as Fly secrets.
Rotate quarterly:

1. Generate new keys in the Cloudflare dashboard → R2 → Manage R2 API tokens.
2. Update Fly secrets: `fly secrets set R2_ACCESS_KEY_ID=... R2_SECRET_ACCESS_KEY=...`
3. Verify the next hourly backup job succeeds.
4. Revoke the old keys in Cloudflare.
