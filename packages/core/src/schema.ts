import type Database from 'better-sqlite3';

const SCHEMA_V1 = `
-- memories table
CREATE TABLE memories (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  memory_id       TEXT NOT NULL UNIQUE,
  user_id         TEXT NOT NULL,
  namespace       TEXT,
  memory_type     TEXT NOT NULL CHECK(memory_type IN ('fact', 'preference', 'decision', 'event')),
  content         TEXT NOT NULL,
  raw_text        TEXT,
  document_date   TEXT,
  learned_at      TEXT NOT NULL,
  source_id       TEXT,
  confidence      REAL DEFAULT 1.0,
  salience        REAL DEFAULT 1.0,
  is_latest       INTEGER NOT NULL DEFAULT 1,
  keywords        TEXT,
  event_date_start TEXT,
  event_date_end   TEXT,
  invalidated_at   TEXT,
  tier             TEXT DEFAULT 'warm' CHECK(tier IN ('hot', 'warm', 'cold')),
  activation_score REAL DEFAULT 1.0,
  access_count     INTEGER DEFAULT 0,
  last_accessed_at TEXT,
  compressed_from  TEXT,
  use_count        INTEGER DEFAULT 0,
  success_count    INTEGER DEFAULT 0
);

CREATE INDEX idx_memories_user_id ON memories(user_id);
CREATE INDEX idx_memories_namespace ON memories(user_id, namespace);
CREATE INDEX idx_memories_memory_type ON memories(memory_type);
CREATE INDEX idx_memories_is_latest ON memories(is_latest);
CREATE INDEX idx_memories_source_id ON memories(source_id);
CREATE INDEX idx_memories_learned_at ON memories(learned_at);
CREATE INDEX idx_memories_event_date ON memories(event_date_start, event_date_end);
CREATE INDEX idx_memories_invalidated ON memories(invalidated_at);
CREATE INDEX idx_memories_tier ON memories(tier);
CREATE INDEX idx_memories_activation ON memories(activation_score);

-- relations table
CREATE TABLE memory_relations (
  src_memory_id   TEXT NOT NULL,
  dst_memory_id   TEXT NOT NULL,
  relation_type   TEXT NOT NULL CHECK(relation_type IN ('updates', 'extends', 'derives', 'contradicts', 'supports', 'duplicates')),
  created_at      TEXT NOT NULL,
  reason          TEXT,
  PRIMARY KEY (src_memory_id, dst_memory_id, relation_type),
  FOREIGN KEY (src_memory_id) REFERENCES memories(memory_id),
  FOREIGN KEY (dst_memory_id) REFERENCES memories(memory_id)
);

-- FTS5 full-text search (content-sync mode)
CREATE VIRTUAL TABLE memories_fts USING fts5(
  content,
  keywords,
  content='memories',
  content_rowid='id'
);

-- FTS sync triggers
CREATE TRIGGER memories_ai AFTER INSERT ON memories BEGIN
  INSERT INTO memories_fts(rowid, content, keywords) VALUES (new.id, new.content, new.keywords);
END;

CREATE TRIGGER memories_ad AFTER DELETE ON memories BEGIN
  INSERT INTO memories_fts(memories_fts, rowid, content, keywords) VALUES ('delete', old.id, old.content, old.keywords);
END;

CREATE TRIGGER memories_au AFTER UPDATE ON memories BEGIN
  INSERT INTO memories_fts(memories_fts, rowid, content, keywords) VALUES ('delete', old.id, old.content, old.keywords);
  INSERT INTO memories_fts(rowid, content, keywords) VALUES (new.id, new.content, new.keywords);
END;
`;

const SCHEMA_V5 = `
ALTER TABLE memories ADD COLUMN use_count INTEGER DEFAULT 0;
ALTER TABLE memories ADD COLUMN success_count INTEGER DEFAULT 0;
`;

/**
 * v6: supporting tables for v0.5.2 legacy user_id migration.
 *
 * `migration_version` is a lightweight audit log so repeatable
 * one-shot data fixups (not schema DDL) can be marked as applied
 * without piggy-backing on `schema_version`.
 *
 * `memory_legacy_scope` preserves the original `user_id` that was
 * written when `resolveUserId(cwd)` derived `personal/<dir>` or
 * `work/<dir>` style partitions from the current working directory.
 * When `memrosetta migrate legacy-user-ids` rewrites `memories.user_id`
 * to the canonical user, this table remembers what the row used to
 * look like so future tooling can re-derive project scope without
 * touching the `namespace` column (which already holds `session-XXXX`).
 */
const SCHEMA_V6 = `
CREATE TABLE IF NOT EXISTS migration_version (
  name        TEXT PRIMARY KEY,
  applied_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS memory_legacy_scope (
  memory_id         TEXT PRIMARY KEY,
  legacy_user_id    TEXT NOT NULL,
  legacy_namespace  TEXT,
  migrated_at       TEXT NOT NULL,
  FOREIGN KEY (memory_id) REFERENCES memories(memory_id)
);

CREATE INDEX IF NOT EXISTS idx_memory_legacy_scope_user
  ON memory_legacy_scope(legacy_user_id);

CREATE INDEX IF NOT EXISTS idx_memory_legacy_scope_user_ns
  ON memory_legacy_scope(legacy_user_id, legacy_namespace);
`;

/**
 * v7: Brain-inspired retrieval enhancements (v0.7.0).
 *
 * 1. Encoding context columns on `memories` — stores the project and
 *    activity type at encoding time so context-dependent retrieval
 *    (Tulving 1973) can boost memories whose encoding context matches
 *    the current search context.
 *
 * 2. `memory_coaccess` table — Hebbian co-access graph. When two
 *    memories appear together in search results, their co-access
 *    strength is incremented. Future searches boost co-accessed
 *    neighbors. This builds an implicit associative layer on top of
 *    the sparse explicit relation graph.
 */
const SCHEMA_V7 = `
ALTER TABLE memories ADD COLUMN project TEXT;
ALTER TABLE memories ADD COLUMN activity_type TEXT;

CREATE INDEX IF NOT EXISTS idx_memories_project ON memories(project);

CREATE TABLE IF NOT EXISTS memory_coaccess (
  memory_a_id         TEXT NOT NULL,
  memory_b_id         TEXT NOT NULL,
  co_access_count     INTEGER NOT NULL DEFAULT 1,
  last_co_accessed_at TEXT NOT NULL,
  strength            REAL NOT NULL DEFAULT 1.0,
  PRIMARY KEY (memory_a_id, memory_b_id),
  FOREIGN KEY (memory_a_id) REFERENCES memories(memory_id),
  FOREIGN KEY (memory_b_id) REFERENCES memories(memory_id)
);

CREATE INDEX IF NOT EXISTS idx_memory_coaccess_a
  ON memory_coaccess(memory_a_id, strength DESC);
CREATE INDEX IF NOT EXISTS idx_memory_coaccess_b
  ON memory_coaccess(memory_b_id, strength DESC);
`;

/**
 * v8: allow explicit duplicate relations for the destructive dedupe pass.
 *
 * SQLite cannot ALTER an existing CHECK constraint, so we rebuild the
 * `memory_relations` table in-place for upgraded databases.
 */
const SCHEMA_V8 = `
CREATE TABLE memory_relations_v8 (
  src_memory_id   TEXT NOT NULL,
  dst_memory_id   TEXT NOT NULL,
  relation_type   TEXT NOT NULL CHECK(relation_type IN ('updates', 'extends', 'derives', 'contradicts', 'supports', 'duplicates')),
  created_at      TEXT NOT NULL,
  reason          TEXT,
  PRIMARY KEY (src_memory_id, dst_memory_id, relation_type),
  FOREIGN KEY (src_memory_id) REFERENCES memories(memory_id),
  FOREIGN KEY (dst_memory_id) REFERENCES memories(memory_id)
);

INSERT INTO memory_relations_v8 (src_memory_id, dst_memory_id, relation_type, created_at, reason)
SELECT src_memory_id, dst_memory_id, relation_type, created_at, reason
FROM memory_relations;

DROP TABLE memory_relations;
ALTER TABLE memory_relations_v8 RENAME TO memory_relations;
`;

/**
 * v9: structured source attestations for reconstructive-memory v1.0.
 *
 * Each memory can carry 0..N attestations describing where the fact
 * came from (chat turn, document, observation, reflection, tool output).
 * Legacy `memories.source_id` stays put as a denormalized single-source
 * reference; new code uses this table for first-class provenance.
 *
 * Attestations are additive: they are not deleted when the parent
 * memory is invalidated or superseded — the audit trail is permanent.
 * PK (memory_id, source_kind, source_ref) lets the same source_ref
 * appear under different kinds if that is semantically meaningful.
 */
const SCHEMA_V9 = `
CREATE TABLE IF NOT EXISTS source_attestations (
  memory_id        TEXT NOT NULL,
  source_kind      TEXT NOT NULL CHECK(source_kind IN ('chat', 'document', 'observation', 'reflection', 'tool_output')),
  source_ref       TEXT NOT NULL,
  source_speaker   TEXT,
  confidence       REAL,
  attested_at      TEXT NOT NULL,
  PRIMARY KEY (memory_id, source_kind, source_ref),
  FOREIGN KEY (memory_id) REFERENCES memories(memory_id)
);

CREATE INDEX IF NOT EXISTS idx_source_attestations_memory
  ON source_attestations(memory_id);
CREATE INDEX IF NOT EXISTS idx_source_attestations_ref
  ON source_attestations(source_kind, source_ref);
`;

/**
 * v10: episodes + segments + memory_episodic_bindings for event
 * segmentation and hippocampal indexing (v4 reconstructive-memory spec).
 *
 * episodes: coarse boundaries (session/repo/gap/goal_reset/explicit).
 *   episode_gist is populated later by the background consolidation loop.
 *   dominant_goal_id is the representative goal during the episode; the
 *   full set is in all_goal_ids_json.
 *
 * segments: fine-grained chunks inside an episode. boundary_reason
 *   captures intra-episode shifts (task_mode/intent/branch/tool/
 *   prediction_error). state_vector_json stores the structured
 *   retrieval input (active_goals, task_mode, tool_regime, etc.) —
 *   first-class per v4 spec so recall can match on state, not only cues.
 *
 * memory_episodic_bindings: N:M between memories and episodes. A memory
 *   may belong to several episodes after replay/consolidation stitches
 *   adjacent episodes. binding_strength is the Hebbian weight used by
 *   the recall kernel to amplify co-activated traces.
 */
const SCHEMA_V10 = `
CREATE TABLE IF NOT EXISTS episodes (
  episode_id            TEXT PRIMARY KEY,
  user_id               TEXT NOT NULL,
  started_at            TEXT NOT NULL,
  ended_at              TEXT,
  boundary_reason       TEXT,
  episode_gist          TEXT,
  dominant_goal_id      TEXT,
  all_goal_ids_json     TEXT,
  context_snapshot      TEXT,
  source_artifact_ids   TEXT
);

CREATE INDEX IF NOT EXISTS idx_episodes_user ON episodes(user_id);
CREATE INDEX IF NOT EXISTS idx_episodes_started_at ON episodes(started_at);
CREATE INDEX IF NOT EXISTS idx_episodes_open ON episodes(user_id, ended_at);

CREATE TABLE IF NOT EXISTS segments (
  segment_id            TEXT PRIMARY KEY,
  episode_id            TEXT NOT NULL,
  started_at            TEXT NOT NULL,
  ended_at              TEXT,
  segment_position      INTEGER,
  boundary_reason       TEXT,
  task_mode             TEXT,
  dominant_goal_id      TEXT,
  state_vector_json     TEXT,
  FOREIGN KEY (episode_id) REFERENCES episodes(episode_id)
);

-- UNIQUE ordering guarantee (Codex Step 2 review, must-fix #2):
-- segment_position is used as an ordering key, so the DB enforces
-- uniqueness per episode instead of leaving it to application code.
CREATE UNIQUE INDEX IF NOT EXISTS idx_segments_episode_position
  ON segments(episode_id, segment_position);
CREATE INDEX IF NOT EXISTS idx_segments_started_at ON segments(started_at);
CREATE INDEX IF NOT EXISTS idx_segments_task_mode ON segments(task_mode);

CREATE TABLE IF NOT EXISTS memory_episodic_bindings (
  memory_id             TEXT NOT NULL,
  episode_id            TEXT NOT NULL,
  segment_id            TEXT,
  segment_position      INTEGER,
  binding_strength      REAL NOT NULL DEFAULT 1.0,
  PRIMARY KEY (memory_id, episode_id),
  FOREIGN KEY (memory_id) REFERENCES memories(memory_id),
  FOREIGN KEY (episode_id) REFERENCES episodes(episode_id),
  FOREIGN KEY (segment_id) REFERENCES segments(segment_id)
);

CREATE INDEX IF NOT EXISTS idx_meb_episode ON memory_episodic_bindings(episode_id);
CREATE INDEX IF NOT EXISTS idx_meb_segment ON memory_episodic_bindings(segment_id);
`;

/**
 * v11: goal-state memory for reconstructive-memory v1.0.
 *
 * "What problem was being solved" is stored as first-class state.
 * Without goals, reuse_mode recall collapses into similarity retrieval:
 * the system cannot tell the difference between "this fact is about
 * TypeScript reviews" and "this fact was captured while trying to solve
 * code-review automation for TypeScript".
 *
 * Per v4 합의안 section 17.1, goals carry explicit lifecycle (horizon,
 * priority, blocked_by, abandon_reason, reopened_at), owner identity,
 * and structured success criteria. Free-text success_criteria_text is
 * kept alongside the structured success_criteria_json for human-friendly
 * summaries.
 *
 * goal_memory_links is N:M with link_role and link_weight so a memory
 * can be "step evidence" for one goal and "side effect" of another,
 * each with its own centrality.
 */
const SCHEMA_V11 = `
CREATE TABLE IF NOT EXISTS goals (
  goal_id                TEXT PRIMARY KEY,
  user_id                TEXT NOT NULL,
  parent_goal_id         TEXT,

  goal_text              TEXT NOT NULL,
  goal_gist              TEXT,
  goal_type              TEXT CHECK(goal_type IS NULL OR goal_type IN (
    'explore', 'solve', 'learn', 'decide', 'build', 'ship'
  )),

  goal_horizon           TEXT NOT NULL CHECK(goal_horizon IN (
    'turn', 'session', 'project', 'long_running'
  )),
  priority               INTEGER NOT NULL DEFAULT 3 CHECK(priority BETWEEN 1 AND 5),
  state                  TEXT NOT NULL CHECK(state IN (
    'active', 'achieved', 'abandoned', 'blocked', 'paused'
  )),
  blocked_by_json        TEXT,
  abandon_reason         TEXT,

  constraints_json       TEXT,
  success_criteria_text  TEXT,
  success_criteria_json  TEXT,
  failure_signals_json   TEXT,

  started_at             TEXT NOT NULL,
  ended_at               TEXT,
  reopened_at            TEXT,
  last_touched_at        TEXT NOT NULL,

  owner_agent            TEXT CHECK(owner_agent IS NULL OR owner_agent IN (
    'user', 'claude-code', 'codex', 'cursor', 'gemini', 'shared'
  )),
  owner_mode             TEXT CHECK(owner_mode IS NULL OR owner_mode IN (
    'explicit', 'inferred', 'system_generated'
  )),

  context_snapshot       TEXT,
  outcome_summary        TEXT,

  FOREIGN KEY (parent_goal_id) REFERENCES goals(goal_id)
);

CREATE INDEX IF NOT EXISTS idx_goals_user ON goals(user_id);
CREATE INDEX IF NOT EXISTS idx_goals_user_state ON goals(user_id, state);
CREATE INDEX IF NOT EXISTS idx_goals_parent ON goals(parent_goal_id);
CREATE INDEX IF NOT EXISTS idx_goals_last_touched ON goals(last_touched_at);

CREATE TABLE IF NOT EXISTS goal_memory_links (
  goal_id                TEXT NOT NULL,
  memory_id              TEXT NOT NULL,
  link_role              TEXT NOT NULL CHECK(link_role IN (
    'step', 'evidence', 'decision', 'side_effect'
  )),
  link_weight            REAL NOT NULL DEFAULT 1.0,
  created_at             TEXT NOT NULL,
  PRIMARY KEY (goal_id, memory_id, link_role),
  FOREIGN KEY (goal_id) REFERENCES goals(goal_id),
  FOREIGN KEY (memory_id) REFERENCES memories(memory_id)
);

CREATE INDEX IF NOT EXISTS idx_gml_memory ON goal_memory_links(memory_id);
CREATE INDEX IF NOT EXISTS idx_gml_goal ON goal_memory_links(goal_id, link_role);
`;

/**
 * v12: Dual Representation (verbatim + gist) for reconstructive-memory v1.0.
 *
 * Fuzzy Trace Theory (Reyna & Brainerd 1995): robust transfer and
 * context preservation require BOTH the raw verbatim trace AND a
 * compressed gist. Storing only one collapses to either a keyword
 * bag (gist-only) or to rigid verbatim recall that cannot generalize.
 *
 * memories gains:
 *   - verbatim_content: immutable raw text (starts = content on insert)
 *   - gist_content: compressed/abstracted form; populated initially if
 *     provided, otherwise refined by the background consolidation loop
 *   - gist_confidence: 0..1 confidence in the gist
 *   - gist_extracted_at: when the current gist was produced
 *   - gist_extracted_model: which model/heuristic produced it
 *
 * memory_gists_versions captures the full history of gist rewrites
 * (reconsolidation trace). Every gist update pushes the previous
 * value here before the columns on memories are overwritten. This is
 * how the system proves which gist was believed at a given time
 * without freezing the current gist as immutable.
 */
const SCHEMA_V12 = `
ALTER TABLE memories ADD COLUMN verbatim_content TEXT;
ALTER TABLE memories ADD COLUMN gist_content TEXT;
ALTER TABLE memories ADD COLUMN gist_confidence REAL;
ALTER TABLE memories ADD COLUMN gist_extracted_at TEXT;
ALTER TABLE memories ADD COLUMN gist_extracted_model TEXT;

UPDATE memories SET verbatim_content = content WHERE verbatim_content IS NULL;

CREATE INDEX IF NOT EXISTS idx_memories_gist_extracted_at
  ON memories(gist_extracted_at);

CREATE TABLE IF NOT EXISTS memory_gists_versions (
  memory_id            TEXT NOT NULL,
  version              INTEGER NOT NULL,
  gist_content         TEXT NOT NULL,
  gist_confidence      REAL,
  extracted_at         TEXT NOT NULL,
  extracted_model      TEXT,
  reason               TEXT,
  PRIMARY KEY (memory_id, version),
  FOREIGN KEY (memory_id) REFERENCES memories(memory_id)
);

CREATE INDEX IF NOT EXISTS idx_mgv_memory ON memory_gists_versions(memory_id);
`;

/**
 * v13: Tulving 2-axis type system + memory_aliases (v4 §5 / §9).
 *
 * memory_type (legacy) stays as the role axis — `fact/preference/
 * decision/event` remain valid roles alongside newer ones like
 * `pattern/procedure/heuristic/schema/observation/review_prompt`.
 * memory_system is the new cognitive-routing axis from Tulving:
 *   - episodic: time+space+source-bound memories
 *   - semantic: abstracted facts/concepts/rules
 *   - procedural: reusable prompts/workflows/skills
 *
 * Backfill rule on migration (and default when storeMemory omits the
 * explicit axis) uses the legacy memory_type:
 *   - event                     -> episodic
 *   - fact | preference         -> semantic
 *   - decision                  -> semantic (default; can be episodic
 *                                   when derived from a specific event)
 *
 * memory_aliases records the "same memory, alternate cognitive path"
 * relationship — e.g. a decision event (episodic) that also reads as
 * a semantic rule. Governance rules (Codex Step 1+2 review):
 *   - confidence >= 0.7
 *   - created_by_kernel = 'consolidation' only (synchronous write path
 *     is blocked; aliases are background-generated)
 *   - at most 3 aliases per memory (enforced at the helper level)
 */
const SCHEMA_V13 = `
ALTER TABLE memories ADD COLUMN memory_system TEXT
  CHECK(memory_system IS NULL OR memory_system IN ('episodic', 'semantic', 'procedural'));
ALTER TABLE memories ADD COLUMN memory_role TEXT;

-- Backfill legacy rows so every historical memory has a system axis
-- consistent with its role. memory_type is copied verbatim into
-- memory_role (the role taxonomy is a superset of memory_type).
UPDATE memories SET memory_role = memory_type WHERE memory_role IS NULL;
UPDATE memories SET memory_system = 'episodic' WHERE memory_system IS NULL AND memory_type = 'event';
UPDATE memories SET memory_system = 'semantic' WHERE memory_system IS NULL AND memory_type IN ('fact', 'preference', 'decision');

CREATE INDEX IF NOT EXISTS idx_memories_memory_system ON memories(memory_system);
CREATE INDEX IF NOT EXISTS idx_memories_memory_role ON memories(memory_role);

CREATE TABLE IF NOT EXISTS memory_aliases (
  memory_id            TEXT NOT NULL,
  alias_system         TEXT CHECK(alias_system IS NULL OR alias_system IN ('episodic', 'semantic', 'procedural')),
  alias_role           TEXT,
  derivation_type      TEXT NOT NULL CHECK(derivation_type IN (
    'generalized_from', 'episodic_instance_of', 'procedural_distillation', 'semantic_extraction'
  )),
  confidence           REAL NOT NULL CHECK(confidence >= 0.7 AND confidence <= 1.0),
  created_by_kernel    TEXT NOT NULL CHECK(created_by_kernel IN ('consolidation', 'manual')),
  created_at           TEXT NOT NULL,
  PRIMARY KEY (memory_id, alias_system, alias_role),
  FOREIGN KEY (memory_id) REFERENCES memories(memory_id)
);

CREATE INDEX IF NOT EXISTS idx_memory_aliases_memory ON memory_aliases(memory_id);
CREATE INDEX IF NOT EXISTS idx_memory_aliases_alias ON memory_aliases(alias_system, alias_role);

-- Codex Step 5 review must-fix: the app-level cap is too weak once
-- Step 6 background kernels start generating aliases concurrently.
-- BEFORE INSERT trigger enforces cap=3 atomically at the DB layer.
CREATE TRIGGER IF NOT EXISTS memory_aliases_cap_guard
BEFORE INSERT ON memory_aliases
WHEN (SELECT COUNT(*) FROM memory_aliases WHERE memory_id = NEW.memory_id) >= 3
BEGIN
  SELECT RAISE(ABORT, 'memory_aliases: max 3 aliases per memory');
END;
`;

/**
 * v14: Hippocampal Indexing (v4 §5, Teyler & DiScenna 1986).
 *
 * episodic_index: sparse cue bindings that point at episodes.
 *   - feature_type restricted to the FeatureFamily enum
 *   - feature_value stores only canonical forms (normalized via
 *     cue_aliases before insert)
 *   - polarity is bipolar (+1 cue, -1 anti-cue). PK includes polarity
 *     so the same value can appear as both a positive and an anti-cue
 *     if semantically meaningful, each with its own strength curve.
 *   - binding_strength and last_activated_at feed bounded Hebbian
 *     decay (Codex Step 2 review formula):
 *         decayed = old * exp(-lambda * delta_t)
 *         new = decayed + alpha * activation * (1 - decayed)
 *               + beta * successful_recall
 *
 * cue_aliases: canonical-form normalizer. Repo nicknames, tool slugs,
 *   Korean morpheme-stripped topics all resolve to a single canonical
 *   form here before they touch episodic_index, which keeps the
 *   sparse index from fragmenting across surface variants.
 */
const SCHEMA_V14 = `
CREATE TABLE IF NOT EXISTS episodic_index (
  episode_id           TEXT NOT NULL,
  feature_type         TEXT NOT NULL CHECK(feature_type IN (
    'who', 'project', 'repo', 'tool', 'goal', 'task_mode',
    'topic', 'entity', 'concept', 'constraint', 'decision_subject',
    'language', 'framework'
  )),
  feature_value        TEXT NOT NULL,
  polarity             INTEGER NOT NULL DEFAULT 1 CHECK(polarity IN (1, -1)),
  binding_strength     REAL NOT NULL DEFAULT 1.0,
  last_activated_at    TEXT,
  PRIMARY KEY (episode_id, feature_type, feature_value, polarity),
  FOREIGN KEY (episode_id) REFERENCES episodes(episode_id)
);

CREATE INDEX IF NOT EXISTS idx_episodic_index_feature
  ON episodic_index(feature_type, feature_value, polarity);
CREATE INDEX IF NOT EXISTS idx_episodic_index_last_activated
  ON episodic_index(last_activated_at);

CREATE TABLE IF NOT EXISTS cue_aliases (
  canonical_form       TEXT NOT NULL,
  alias_form           TEXT NOT NULL,
  feature_family       TEXT NOT NULL CHECK(feature_family IN (
    'who', 'project', 'repo', 'tool', 'goal', 'task_mode',
    'topic', 'entity', 'concept', 'constraint', 'decision_subject',
    'language', 'framework'
  )),
  source               TEXT CHECK(source IS NULL OR source IN ('manual', 'learned', 'derived')),
  confidence           REAL,
  PRIMARY KEY (canonical_form, alias_form, feature_family)
);

CREATE INDEX IF NOT EXISTS idx_cue_aliases_alias
  ON cue_aliases(alias_form, feature_family);
`;

/**
 * v15: Layer B scaffolding — memory_constructs + construct_exemplars
 * (v4 §7, §10, §13).
 *
 * These tables exist Day-one so the schema is stable; actual write
 * behavior (prototype induction, exemplar linking, anti-pattern
 * surfacing) lives behind Layer B feature flags. This matches the
 * v4 spec §2: Layer B tables are present from Day-one, runtime code
 * paths stay OFF until Layer A usage data justifies turning them on.
 *
 * memory_constructs — procedural/semantic memory ascended to
 * "construct" status with structured slots + anti-patterns. Step 7
 * (recall) already has abstraction_level gating in its Intent
 * routing, but no constructs exist yet; this table populates that
 * slot in Layer B.
 *
 * construct_exemplars — links a construct back to the concrete
 * memories that support it. Role enum:
 *   - positive: supports the construct (the usual instance)
 *   - negative: anti-example / known failure case
 *   - edge_case: boundary behaviour worth remembering explicitly
 */
const SCHEMA_V15 = `
CREATE TABLE IF NOT EXISTS memory_constructs (
  memory_id            TEXT PRIMARY KEY,
  canonical_form       TEXT NOT NULL,
  slots_json           TEXT,
  constraints_json     TEXT,
  anti_patterns_json   TEXT,
  success_signals_json TEXT,
  applicability_json   TEXT,
  abstraction_level    INTEGER NOT NULL DEFAULT 3 CHECK(abstraction_level BETWEEN 1 AND 5),
  construct_confidence REAL,
  reuse_count          INTEGER NOT NULL DEFAULT 0,
  reuse_success_count  INTEGER NOT NULL DEFAULT 0,
  last_reindex_at      TEXT,
  FOREIGN KEY (memory_id) REFERENCES memories(memory_id)
);

CREATE INDEX IF NOT EXISTS idx_memory_constructs_abstraction
  ON memory_constructs(abstraction_level);
CREATE INDEX IF NOT EXISTS idx_memory_constructs_reuse
  ON memory_constructs(reuse_count DESC);

CREATE TABLE IF NOT EXISTS construct_exemplars (
  construct_memory_id  TEXT NOT NULL,
  exemplar_memory_id   TEXT NOT NULL,
  exemplar_role        TEXT NOT NULL CHECK(exemplar_role IN ('positive', 'negative', 'edge_case')),
  support_score        REAL,
  created_at           TEXT NOT NULL,
  PRIMARY KEY (construct_memory_id, exemplar_memory_id, exemplar_role),
  FOREIGN KEY (construct_memory_id) REFERENCES memories(memory_id),
  FOREIGN KEY (exemplar_memory_id) REFERENCES memories(memory_id)
);

CREATE INDEX IF NOT EXISTS idx_construct_exemplars_construct
  ON construct_exemplars(construct_memory_id);
CREATE INDEX IF NOT EXISTS idx_construct_exemplars_exemplar
  ON construct_exemplars(exemplar_memory_id);
`;

// v0.11: SchemaOptions (vectorEnabled, embeddingDimension) removed
// together with the HF embedder and sqlite-vec integration.
export interface SchemaOptions {
  // reserved for future options; intentionally empty after HF removal.
}

/**
 * v16: Drop the sqlite-vec virtual table and the `memories.embedding`
 * BLOB column. These existed to support HF-based vector search via
 * sqlite-vec. v0.11 removes that entire code path — Core is now
 * LLM-free and offline-capable; the hippocampal index + Tulving
 * type system + pattern completion do the retrieval work instead.
 *
 * Applied imperatively (not as a static SQL blob) because the
 * `embedding` column may not exist on fresh installs (post-v0.11
 * SCHEMA_V1 has no embedding column), and SQLite does not support
 * `ALTER TABLE ... DROP COLUMN IF EXISTS`.
 */
function applySchemaV16(db: Database.Database): void {
  try {
    db.exec('DROP TABLE IF EXISTS vec_memories');
  } catch {
    // vec_memories may be a VIRTUAL TABLE with sqlite-vec not loaded —
    // swallow so the migration keeps moving.
  }
  const hasEmbedding = (db.prepare('PRAGMA table_info(memories)').all() as readonly { name: string }[])
    .some((col) => col.name === 'embedding');
  if (hasEmbedding) {
    db.exec('ALTER TABLE memories DROP COLUMN embedding');
  }
}

const SCHEMA_V3 = `
ALTER TABLE memories ADD COLUMN event_date_start TEXT;
ALTER TABLE memories ADD COLUMN event_date_end TEXT;
ALTER TABLE memories ADD COLUMN invalidated_at TEXT;

CREATE INDEX idx_memories_event_date ON memories(event_date_start, event_date_end);
CREATE INDEX idx_memories_invalidated ON memories(invalidated_at);
`;

const SCHEMA_V4 = `
ALTER TABLE memories ADD COLUMN tier TEXT DEFAULT 'warm' CHECK(tier IN ('hot', 'warm', 'cold'));
ALTER TABLE memories ADD COLUMN activation_score REAL DEFAULT 1.0;
ALTER TABLE memories ADD COLUMN access_count INTEGER DEFAULT 0;
ALTER TABLE memories ADD COLUMN last_accessed_at TEXT;
ALTER TABLE memories ADD COLUMN compressed_from TEXT;

CREATE INDEX idx_memories_tier ON memories(tier);
CREATE INDEX idx_memories_activation ON memories(activation_score);
`;

export function ensureSchema(db: Database.Database, _options?: SchemaOptions): void {
  const hasVersionTable = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='schema_version'"
  ).get();

  if (!hasVersionTable) {
    // v0.11: schema_version no longer stores embedding_dimension — the
    // vec_memories virtual table and HF embedder paths were removed.
    db.exec('CREATE TABLE schema_version (version INTEGER NOT NULL)');
    db.exec(SCHEMA_V1);

    let version = 1;
    // Fresh install skips v2 (vec_memories) — removed in v0.11.
    db.exec(SCHEMA_V6);
    db.exec(SCHEMA_V7);
    db.exec(SCHEMA_V9);
    db.exec(SCHEMA_V10);
    db.exec(SCHEMA_V11);
    db.exec(SCHEMA_V12);
    db.exec(SCHEMA_V13);
    db.exec(SCHEMA_V14);
    db.exec(SCHEMA_V15);
    applySchemaV16(db);
    version = 16;
    db.prepare('INSERT INTO schema_version (version) VALUES (?)').run(version);
    return;
  }

  const row = db.prepare('SELECT version FROM schema_version').get() as { version: number } | undefined;
  const currentVersion = row?.version ?? 0;

  if (currentVersion < 1) {
    db.exec(SCHEMA_V1);
    db.prepare('UPDATE schema_version SET version = ?').run(1);
  }

  // v2 (vec_memories) skipped — removed in v0.11. Existing DBs get the
  // drop migration in v16 below.

  if (currentVersion < 3) {
    // Only run ALTER TABLE for pre-v3 databases.
    // Fresh databases already have these columns in SCHEMA_V1.
    if (currentVersion >= 1) {
      db.exec(SCHEMA_V3);
    }
    db.prepare('UPDATE schema_version SET version = ?').run(3);
  }

  if (currentVersion < 4) {
    // Only run ALTER TABLE for pre-v4 databases.
    // Fresh databases already have these columns in SCHEMA_V1.
    if (currentVersion >= 1) {
      db.exec(SCHEMA_V4);
    }
    db.prepare('UPDATE schema_version SET version = ?').run(4);
  }

  if (currentVersion < 5) {
    // Only run ALTER TABLE for pre-v5 databases.
    // Fresh databases already have these columns in SCHEMA_V1.
    if (currentVersion >= 1) {
      db.exec(SCHEMA_V5);
    }
    db.prepare('UPDATE schema_version SET version = ?').run(5);
  }

  if (currentVersion < 6) {
    db.exec(SCHEMA_V6);
    db.prepare('UPDATE schema_version SET version = ?').run(6);
  }

  if (currentVersion < 7) {
    // v7 adds encoding context columns (project, activity_type) to
    // memories and the memory_coaccess Hebbian co-access table.
    // ALTER TABLE for pre-v7 databases only; fresh installs already
    // have these from SCHEMA_V1 + SCHEMA_V7 in the fresh-install
    // path above.
    if (currentVersion >= 1) {
      try {
        db.exec(SCHEMA_V7);
      } catch {
        // Columns/tables may already exist from a partial upgrade
        // or manual intervention — safe to ignore.
      }
    }
    db.prepare('UPDATE schema_version SET version = ?').run(7);
  }

  if (currentVersion < 8) {
    db.exec(SCHEMA_V8);
    db.prepare('UPDATE schema_version SET version = ?').run(8);
  }

  if (currentVersion < 9) {
    db.exec(SCHEMA_V9);
    db.prepare('UPDATE schema_version SET version = ?').run(9);
  }

  if (currentVersion < 10) {
    db.exec(SCHEMA_V10);
    db.prepare('UPDATE schema_version SET version = ?').run(10);
  }

  if (currentVersion < 11) {
    db.exec(SCHEMA_V11);
    db.prepare('UPDATE schema_version SET version = ?').run(11);
  }

  if (currentVersion < 12) {
    db.exec(SCHEMA_V12);
    db.prepare('UPDATE schema_version SET version = ?').run(12);
  }

  if (currentVersion < 13) {
    db.exec(SCHEMA_V13);
    db.prepare('UPDATE schema_version SET version = ?').run(13);
  }

  if (currentVersion < 14) {
    db.exec(SCHEMA_V14);
    db.prepare('UPDATE schema_version SET version = ?').run(14);
  }

  if (currentVersion < 15) {
    db.exec(SCHEMA_V15);
    db.prepare('UPDATE schema_version SET version = ?').run(15);
  }

  if (currentVersion < 16) {
    applySchemaV16(db);
    db.prepare('UPDATE schema_version SET version = ?').run(16);
  }
}
