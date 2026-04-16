-- 002a_oauth_additive.sql
-- Additive-first auth rework migration.
--
-- Safe to run before the new JWT-based sync-server is deployed.
-- Creates the minimal users mirror, adds owner_user_id partition columns,
-- backfills existing rows, and creates owner-based indexes.
-- Does not remove any legacy auth tables or legacy user_id-based indexes.

CREATE TABLE IF NOT EXISTS users (
  owner_user_id  TEXT PRIMARY KEY,
  email          TEXT NOT NULL,
  roles          JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

ALTER TABLE sync_ops
  ADD COLUMN IF NOT EXISTS owner_user_id TEXT;

UPDATE sync_ops
SET owner_user_id = user_id
WHERE owner_user_id IS NULL;

ALTER TABLE sync_ops
  ALTER COLUMN owner_user_id SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_sync_ops_owner_op
  ON sync_ops(owner_user_id, op_id);

CREATE INDEX IF NOT EXISTS idx_sync_ops_owner_cursor
  ON sync_ops(owner_user_id, cursor);

ALTER TABLE sync_devices
  ADD COLUMN IF NOT EXISTS owner_user_id TEXT;

UPDATE sync_devices
SET owner_user_id = user_id
WHERE owner_user_id IS NULL;

ALTER TABLE sync_devices
  ALTER COLUMN owner_user_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_sync_devices_owner_device
  ON sync_devices(owner_user_id, device_id);
