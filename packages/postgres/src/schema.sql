-- MemRosetta Sync Server - PostgreSQL Schema
-- This file is for reference only. Use migrations/ for actual schema management.

-- sync server op log
CREATE TABLE IF NOT EXISTS sync_ops (
  cursor        BIGSERIAL PRIMARY KEY,
  user_id       TEXT NOT NULL,
  op_id         TEXT NOT NULL,
  device_id     TEXT NOT NULL,
  op_type       TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL,
  received_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  api_version   INTEGER NOT NULL DEFAULT 1,
  source_seq    BIGINT,
  payload       JSONB NOT NULL,
  UNIQUE (user_id, op_id)
);

CREATE INDEX IF NOT EXISTS idx_sync_ops_user_cursor ON sync_ops(user_id, cursor);
CREATE INDEX IF NOT EXISTS idx_sync_ops_user_device ON sync_ops(user_id, device_id, cursor);

-- device registry
CREATE TABLE IF NOT EXISTS sync_devices (
  device_id     TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL,
  device_name   TEXT,
  last_push_at  TIMESTAMPTZ,
  last_pull_at  TIMESTAMPTZ,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);
