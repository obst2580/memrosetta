CREATE TABLE IF NOT EXISTS consolidation_jobs (
  id         TEXT PRIMARY KEY,
  kind       TEXT NOT NULL,
  payload    TEXT NOT NULL,
  status     TEXT NOT NULL CHECK(status IN ('pending', 'running', 'done', 'failed')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  attempts   INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  user_id    TEXT NOT NULL,
  dedup_key  TEXT
);

CREATE INDEX IF NOT EXISTS idx_consolidation_jobs_pending
  ON consolidation_jobs(user_id, status, created_at);
CREATE INDEX IF NOT EXISTS idx_consolidation_jobs_kind_status
  ON consolidation_jobs(kind, status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_consolidation_jobs_active_dedupe
  ON consolidation_jobs(user_id, kind, dedup_key)
  WHERE dedup_key IS NOT NULL AND status IN ('pending', 'running');
