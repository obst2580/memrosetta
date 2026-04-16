-- 002_oauth_auth.sql
-- OAuth-backed auth/session tables for hosted sync, while retaining
-- legacy API-key compatibility for self-host and migration periods.

CREATE TABLE IF NOT EXISTS users (
  id             UUID PRIMARY KEY,
  primary_email  TEXT,
  display_name   TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS auth_accounts (
  id                UUID PRIMARY KEY,
  user_id           UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider          TEXT NOT NULL CHECK (provider IN ('github', 'google')),
  provider_subject  TEXT NOT NULL,
  email             TEXT,
  display_name      TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_login_at     TIMESTAMPTZ,
  UNIQUE (provider, provider_subject)
);

CREATE TABLE IF NOT EXISTS sessions (
  id                  UUID PRIMARY KEY,
  user_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_id           TEXT NOT NULL,
  access_token_hash   TEXT NOT NULL UNIQUE,
  refresh_token_hash  TEXT NOT NULL UNIQUE,
  access_expires_at   TIMESTAMPTZ NOT NULL,
  refresh_expires_at  TIMESTAMPTZ NOT NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at        TIMESTAMPTZ,
  revoked_at          TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_sessions_user_device
  ON sessions(user_id, device_id);

CREATE TABLE IF NOT EXISTS auth_device_requests (
  id                    UUID PRIMARY KEY,
  provider              TEXT NOT NULL CHECK (provider IN ('github', 'google')),
  device_id             TEXT NOT NULL,
  user_code             TEXT NOT NULL,
  verification_uri      TEXT NOT NULL,
  interval_seconds      INTEGER NOT NULL,
  expires_at            TIMESTAMPTZ NOT NULL,
  provider_device_code  TEXT NOT NULL,
  status                TEXT NOT NULL CHECK (status IN ('pending', 'completed', 'expired')),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at          TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_auth_device_requests_status_expires
  ON auth_device_requests(status, expires_at);

ALTER TABLE sync_ops
  ADD COLUMN IF NOT EXISTS owner_user_id TEXT;

UPDATE sync_ops
SET owner_user_id = user_id
WHERE owner_user_id IS NULL;

ALTER TABLE sync_ops
  ALTER COLUMN owner_user_id SET NOT NULL;

ALTER TABLE sync_ops
  DROP CONSTRAINT IF EXISTS sync_ops_user_id_op_id_key;

DROP INDEX IF EXISTS idx_sync_ops_user_cursor;
DROP INDEX IF EXISTS idx_sync_ops_user_device;

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
