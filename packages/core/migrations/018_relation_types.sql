DROP TABLE IF EXISTS memory_relations_v18;

CREATE TABLE memory_relations_v18 (
  src_memory_id   TEXT NOT NULL,
  dst_memory_id   TEXT NOT NULL,
  relation_type   TEXT NOT NULL CHECK(relation_type IN (
    'updates', 'extends', 'derives', 'contradicts', 'supports', 'duplicates',
    'uses', 'prefers', 'decided', 'invalidates'
  )),
  created_at      TEXT NOT NULL,
  reason          TEXT,
  PRIMARY KEY (src_memory_id, dst_memory_id, relation_type),
  FOREIGN KEY (src_memory_id) REFERENCES memories(memory_id),
  FOREIGN KEY (dst_memory_id) REFERENCES memories(memory_id)
);

INSERT INTO memory_relations_v18 (src_memory_id, dst_memory_id, relation_type, created_at, reason)
SELECT src_memory_id, dst_memory_id, relation_type, created_at, reason
FROM memory_relations;

DROP TABLE memory_relations;
ALTER TABLE memory_relations_v18 RENAME TO memory_relations;
