CREATE TABLE source_attestations_v19 (
  memory_id        TEXT NOT NULL,
  source_kind      TEXT NOT NULL,
  source_ref       TEXT NOT NULL,
  source_speaker   TEXT,
  confidence       REAL,
  attested_at      TEXT NOT NULL,
  PRIMARY KEY (memory_id, source_kind, source_ref),
  FOREIGN KEY (memory_id) REFERENCES memories(memory_id)
);

INSERT INTO source_attestations_v19
  (memory_id, source_kind, source_ref, source_speaker, confidence, attested_at)
SELECT memory_id, source_kind, source_ref, source_speaker, confidence, attested_at
FROM source_attestations;

DROP TABLE source_attestations;
ALTER TABLE source_attestations_v19 RENAME TO source_attestations;

CREATE INDEX IF NOT EXISTS idx_source_attestations_memory
  ON source_attestations(memory_id);
CREATE INDEX IF NOT EXISTS idx_source_attestations_ref
  ON source_attestations(source_kind, source_ref);
