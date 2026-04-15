import type Database from 'better-sqlite3';

const SYNC_SCHEMA = `
CREATE TABLE IF NOT EXISTS sync_outbox (
  op_id       TEXT PRIMARY KEY,
  op_type     TEXT NOT NULL,
  device_id   TEXT NOT NULL,
  user_id     TEXT NOT NULL,
  payload     TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  pushed_at   TEXT
);

CREATE TABLE IF NOT EXISTS sync_inbox (
  op_id       TEXT PRIMARY KEY,
  op_type     TEXT NOT NULL,
  device_id   TEXT NOT NULL,
  user_id     TEXT NOT NULL,
  payload     TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  applied_at  TEXT
);

CREATE TABLE IF NOT EXISTS sync_state (
  key         TEXT PRIMARY KEY,
  value       TEXT NOT NULL
);
`;

export function ensureSyncSchema(db: Database.Database): void {
  db.exec(SYNC_SCHEMA);
}
