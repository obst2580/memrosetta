# Reconstructive Memory — v1.0 Implementation Spec

> Status: ready-for-implementation
> Based on: `/Users/obst/Documents/obst/개인프로젝트/memrosetta/2026-04-17-1054-v1.0-합의안-v4-최종.md`
> Review chain: Codex 1st (694 lines) → Claude v2 → Codex 2nd (655 lines) → Claude v3 → Codex 3rd (943 lines) → Claude v4 final

## Purpose

Implement a closed reconstructive memory kernel that preserves human-brain-like context. Not a better RAG — an actual reconstructive kernel over provenance-preserved traces.

## Non-Goals

- Not a drop-in RAG replacement
- Not a general knowledge base
- Not an LLM wrapper that synthesizes freely
- Not a memory system that silently rewrites on recall (Layer C behind flags)

## Architecture at a glance

```
┌───────────────────────────────────────────────────────────────┐
│ Layer A (Day-one, closed kernel)                              │
├───────────────────────────────────────────────────────────────┤
│ 1. Source Monitoring + raw trace persistence                  │
│ 2. Event Segmentation (coarse + fine)                         │
│ 3. Goal-State Memory + Context State Vector                   │
│ 4. Dual Representation (verbatim + gist)                      │
│ 5. Type System (memory_system × memory_role)                  │
│ 6. Hippocampal Indexing (sparse + canonical + negative cue)   │
│ 7. Reconstructive Recall + Pattern Completion Primitive       │
└───────────────────────────────────────────────────────────────┘
┌───────────────────────────────────────────────────────────────┐
│ Layer B (Day-one, flags OFF by default)                       │
├───────────────────────────────────────────────────────────────┤
│  8. Pattern Separation refinement                             │
│  9. Systems Consolidation / Replay                            │
│ 10. Prediction Error / Novelty weighting                      │
│ 11. Prototype / Exemplar induction                            │
└───────────────────────────────────────────────────────────────┘
┌───────────────────────────────────────────────────────────────┐
│ Layer C (v1.x, interface seam only in v1.0)                   │
├───────────────────────────────────────────────────────────────┤
│ 12. Reconsolidation write-back                                │
│ 13. MINERVA 2 Echo synthesis (plug-in at pre_synthesis hook)  │
│ 14. Active self-updating dynamics                             │
└───────────────────────────────────────────────────────────────┘
```

## Implementation Order (internal, within single external release)

Build in this order. Do not skip forward. Each step depends on previous:

1. Source Monitoring + raw trace persistence
2. Event Segmentation + episode/segment scaffolding
3. Goal-State Memory + Context State Vector
4. Dual Representation
5. Type System
6. Hippocampal Indexing
7. Reconstructive Recall + Pattern Completion Primitive

## Schema

### 1. memories (rebuilt)

```sql
CREATE TABLE memories (
  memory_id            TEXT PRIMARY KEY,
  user_id              TEXT NOT NULL,
  namespace            TEXT,

  -- Type axes (2-axis)
  memory_system        TEXT NOT NULL CHECK(memory_system IN ('episodic','semantic','procedural')),
  memory_role          TEXT NOT NULL,

  -- Dual representation
  verbatim_content     TEXT NOT NULL,
  gist_content         TEXT,
  gist_confidence      REAL,
  gist_extracted_at    TEXT,
  gist_extracted_model TEXT,

  -- Source monitoring (denormalized for fast filter; full details in source_attestations)
  source_type          TEXT,
  source_artifact_id   TEXT,
  source_speaker       TEXT,

  -- Episodic binding (full graph in memory_episodic_bindings)
  primary_episode_id   TEXT,
  primary_segment_id   TEXT,

  -- Goal binding
  primary_goal_id      TEXT,

  -- Temporal
  learned_at           TEXT NOT NULL,
  document_date        TEXT,
  event_date_start     TEXT,
  event_date_end       TEXT,
  invalidated_at       TEXT,
  invalidated_by_memory_id TEXT,

  -- Activation (ACT-R base + salience)
  base_activation      REAL DEFAULT 0,
  salience             REAL DEFAULT 0.5,
  novelty_score        REAL DEFAULT 0.5,
  access_count         INTEGER DEFAULT 0,
  last_accessed_at     TEXT,

  -- Meta
  confidence           REAL DEFAULT 1.0,
  is_latest            INTEGER DEFAULT 1,
  embedding            BLOB
);
```

### 2. source_attestations

```sql
CREATE TABLE source_attestations (
  memory_id            TEXT NOT NULL,
  source_kind          TEXT NOT NULL,       -- chat | document | observation | reflection | tool_output
  source_ref           TEXT,                 -- URL, artifact_id, turn_id, etc.
  source_speaker       TEXT,
  confidence           REAL,
  attested_at          TEXT NOT NULL,
  PRIMARY KEY (memory_id, source_kind, source_ref)
);
```

### 3. episodes + segments (2-level)

```sql
CREATE TABLE episodes (
  episode_id           TEXT PRIMARY KEY,
  user_id              TEXT NOT NULL,
  started_at           TEXT NOT NULL,
  ended_at             TEXT,
  boundary_reason      TEXT,                 -- coarse: session | repo_switch | gap | goal_reset | explicit
  episode_gist         TEXT,
  dominant_goal_id     TEXT,
  all_goal_ids_json    TEXT,
  context_snapshot     TEXT,
  source_artifact_ids  TEXT
);

CREATE TABLE segments (
  segment_id           TEXT PRIMARY KEY,
  episode_id           TEXT NOT NULL,
  started_at           TEXT NOT NULL,
  ended_at             TEXT,
  segment_position     INTEGER,
  boundary_reason      TEXT,                 -- fine: task_mode | intent | branch | tool | prediction_error
  task_mode            TEXT,                 -- debug | implement | review | design | ship | explore
  dominant_goal_id     TEXT,
  state_vector_json    TEXT                  -- first-class retrieval input
);

CREATE TABLE memory_episodic_bindings (
  memory_id            TEXT NOT NULL,
  episode_id           TEXT NOT NULL,
  segment_id           TEXT,
  segment_position     INTEGER,
  binding_strength     REAL DEFAULT 1.0,
  PRIMARY KEY (memory_id, episode_id)
);
```

### 4. goals + goal_memory_links

```sql
CREATE TABLE goals (
  goal_id              TEXT PRIMARY KEY,
  user_id              TEXT NOT NULL,
  parent_goal_id       TEXT,

  goal_text            TEXT NOT NULL,
  goal_gist            TEXT,
  goal_type            TEXT,                 -- explore | solve | learn | decide | build | ship

  -- Lifecycle (v4)
  goal_horizon         TEXT NOT NULL,        -- turn | session | project | long_running
  priority             INTEGER DEFAULT 3,    -- 1(highest) ~ 5(lowest)
  state                TEXT NOT NULL,        -- active | achieved | abandoned | blocked | paused
  blocked_by_json      TEXT,
  abandon_reason       TEXT,

  -- Criteria
  constraints_json     TEXT,
  success_criteria_text TEXT,
  success_criteria_json TEXT,                -- structured: [{criterion, threshold, measurement}]
  failure_signals_json TEXT,

  -- Temporal
  started_at           TEXT NOT NULL,
  ended_at             TEXT,
  reopened_at          TEXT,
  last_touched_at      TEXT NOT NULL,

  -- Ownership (v4)
  owner_agent          TEXT,                 -- user | claude-code | codex | cursor | gemini | shared
  owner_mode           TEXT,                 -- explicit | inferred | system_generated

  context_snapshot     TEXT,
  outcome_summary      TEXT
);

CREATE TABLE goal_memory_links (
  goal_id              TEXT NOT NULL,
  memory_id            TEXT NOT NULL,
  link_role            TEXT NOT NULL,        -- step | evidence | decision | side_effect
  link_weight          REAL DEFAULT 1.0,
  created_at           TEXT NOT NULL,
  PRIMARY KEY (goal_id, memory_id, link_role)
);
```

### 5. Hippocampal Indexing

```sql
CREATE TABLE episodic_index (
  episode_id           TEXT NOT NULL,
  feature_type         TEXT NOT NULL,        -- who | where | project | repo | tool | task_mode | goal | topic | entity | concept | constraint | decision_subject | language | framework
  feature_value        TEXT NOT NULL,        -- canonical form only
  polarity             INTEGER DEFAULT 1 CHECK(polarity IN (1, -1)),
  binding_strength     REAL NOT NULL DEFAULT 1.0,
  last_activated_at    TEXT,
  PRIMARY KEY (episode_id, feature_type, feature_value, polarity)
);

CREATE INDEX idx_episodic_index_feature ON episodic_index(feature_type, feature_value, polarity);

CREATE TABLE cue_aliases (
  canonical_form       TEXT NOT NULL,
  alias_form           TEXT NOT NULL,
  feature_family       TEXT NOT NULL,
  source               TEXT,                 -- manual | learned | derived
  confidence           REAL,
  PRIMARY KEY (canonical_form, alias_form, feature_family)
);

CREATE INDEX idx_cue_aliases_alias ON cue_aliases(alias_form, feature_family);
```

### 6. memory_relations (extended)

```sql
CREATE TABLE memory_relations (
  src_memory_id        TEXT NOT NULL,
  dst_memory_id        TEXT NOT NULL,
  relation_type        TEXT NOT NULL CHECK(relation_type IN (
    'supports','extends','updates','contradicts','derives','duplicates',
    'generalizes','instantiates','exemplifies',
    'precedes','co_occurs','reconsolidates'
  )),
  strength             REAL DEFAULT 1.0,
  last_activated_at    TEXT,
  created_at           TEXT NOT NULL,
  reason               TEXT,
  PRIMARY KEY (src_memory_id, dst_memory_id, relation_type)
);
```

### 7. memory_aliases (Tulving 2-axis governance)

```sql
CREATE TABLE memory_aliases (
  memory_id            TEXT NOT NULL,
  alias_system         TEXT,
  alias_role           TEXT,
  derivation_type      TEXT,                 -- generalized_from | episodic_instance_of | ...
  confidence           REAL NOT NULL CHECK(confidence >= 0.7),
  created_by_kernel    TEXT NOT NULL CHECK(created_by_kernel IN ('consolidation', 'manual')),
  created_at           TEXT NOT NULL,
  PRIMARY KEY (memory_id, alias_system, alias_role)
);
```

### 8. memory_constructs + construct_exemplars (Layer B, Day-one tables exist, logic flag-gated)

```sql
CREATE TABLE memory_constructs (
  memory_id            TEXT PRIMARY KEY,
  canonical_form       TEXT NOT NULL,
  slots_json           TEXT,                 -- [{name, value, confidence, evidence_memory_ids, extraction_source, alternatives?}]
  constraints_json     TEXT,
  anti_patterns_json   TEXT,
  success_signals_json TEXT,
  applicability_json   TEXT,
  abstraction_level    INTEGER,              -- 1(concrete) ~ 5(abstract)
  construct_confidence REAL,
  reuse_count          INTEGER DEFAULT 0,
  reuse_success_count  INTEGER DEFAULT 0,
  last_reindex_at      TEXT
);

CREATE TABLE construct_exemplars (
  construct_memory_id  TEXT NOT NULL,
  exemplar_memory_id   TEXT NOT NULL,
  exemplar_role        TEXT,                 -- positive | negative | edge_case
  support_score        REAL,
  PRIMARY KEY (construct_memory_id, exemplar_memory_id)
);
```

### 9. memory_gists_versions (reconsolidation trace)

```sql
CREATE TABLE memory_gists_versions (
  memory_id            TEXT NOT NULL,
  version              INTEGER NOT NULL,
  gist_content         TEXT NOT NULL,
  gist_confidence      REAL,
  extracted_at         TEXT NOT NULL,
  extracted_model      TEXT,
  reason               TEXT,                 -- initial | refinement | contradiction_fix | reconsolidation
  PRIMARY KEY (memory_id, version)
);
```

## Write Kernel (sync, inline)

```ts
function storeMemory(input: StoreInput): MemoryId {
  // Step 1: Event segmentation
  const { episode, segment, state_vector } = resolveSegmentation(input, sessionContext);

  // Step 2: Source monitoring
  const source = extractSourceAttestation(input);

  // Step 3: Goal binding
  const goal = resolveActiveGoal(input, sessionContext);
  const linkWeight = computeLinkWeight(input, goal);

  // Step 4: Dual representation (draft gist only; refinement is background)
  const verbatim = input.content;
  const draftGist = extractDraftGist(verbatim); // cheap rule-based + small LLM

  // Step 5: Type routing (primary only; aliases forbidden here)
  const { memory_system, memory_role } = routeType(input, goal);

  // Step 6: Persist (atomic transaction)
  const memory_id = persistMemory({
    verbatim, draftGist, memory_system, memory_role,
    episode_id: episode.id, segment_id: segment.id,
    goal_id: goal?.id, source
  });

  // Step 7: Update episodic index (sparse, canonicalized, with polarity)
  updateEpisodicIndex(episode, segment, extractFeatures(input, state_vector));

  return memory_id;
}
```

### Sparse Coding Caps (family-specific)

```ts
const FEATURE_CAPS: Record<string, [number, number]> = {
  who: [1, 2],
  project: [1, 3],
  repo: [1, 3],
  tool: [1, 3],
  goal: [1, 3],
  task_mode: [1, 2],
  language: [1, 3],
  framework: [1, 3],
  topic: [3, 6],
  entity: [4, 8],
  concept: [4, 8],
  constraint: [2, 5],
  decision_subject: [1, 3],
};
```

### Hebbian Update (bounded)

```ts
function updateBinding(
  episode_id: string,
  feature_type: string,
  feature_value: string,
  activation: number,
  successful_recall: number = 0
) {
  const now = Date.now();
  const prev = readBinding(episode_id, feature_type, feature_value);
  const deltaT = prev ? (now - prev.last_activated_at) / 3600_000 : 0; // hours
  const lambda = halfLifeToLambda(HALF_LIFE_HOURS[feature_type] ?? 24);
  const decayed = prev ? prev.binding_strength * Math.exp(-lambda * deltaT) : 0;
  const alpha = 0.5, beta = 0.1;
  const new_strength = decayed + alpha * activation * (1 - decayed) + beta * successful_recall;

  upsertBinding(episode_id, feature_type, feature_value, new_strength, now);
  normalizeWithinFamily(episode_id, feature_type);
}

const HALF_LIFE_HOURS: Record<string, number> = {
  who: 90 * 24,
  project: 90 * 24,
  repo: 90 * 24,
  tool: 14 * 24,
  task_mode: 14 * 24,
  framework: 14 * 24,
  language: 60 * 24,
  topic: 3 * 24,
  entity: 3 * 24,
  concept: 3 * 24,
  constraint: 7 * 24,
  decision_subject: 30 * 24,
};
```

## Recall Kernel (sync, read-only by default)

### API

```ts
function reconstructRecall(input: {
  query: string;
  context: StateVector;
  intent: 'reuse' | 'explain' | 'decide' | 'browse' | 'verify';
  strict?: boolean;
  source_types?: ('episodic' | 'semantic' | 'procedural')[];
  max_evidence?: number;
  include_exemplars?: boolean;
}): {
  artifact: string;
  artifact_format: string;
  evidence: Array<{
    memory_id: string;
    episode_id: string;
    role: string;
    confidence: number;
  }>;
  completed_features: Record<string, number>;
  supporting_episodes: string[];
  confidence: number;
  warnings: string[];
  slots?: Array<{
    name: string;
    value: string;
    confidence: number;
    evidence_memory_ids: string[];
    alternatives?: Array<{ value: string; confidence: number }>;
  }>;
};
```

### Algorithm

```ts
function reconstructRecall(input): RecallResult {
  // Hooks: on_evidence_assembly, pre_synthesis, post_synthesis, on_recall
  const state_vector = assembleStateVector(input.context);

  // Step 1: Cue expansion (canonicalized)
  const cues = canonicalizeCues(expandCues(input.query, state_vector));

  // Step 2: Pattern completion primitive (Layer A core)
  const evidence = patternComplete(cues, state_vector, input.intent);
  runHook('on_evidence_assembly', { evidence, intent: input.intent, state_vector });

  // Step 3: Anti-interference
  const filtered = applyAntiInterference(evidence, input.intent, state_vector);

  // Step 4: Reconstructive synthesis
  runHook('pre_synthesis', { evidence: filtered, intent: input.intent, strict: input.strict });
  const artifact = synthesize(filtered, input.intent, input.strict);
  runHook('post_synthesis', { artifact, evidence: filtered, confidence: artifact.confidence });

  // Step 5: Return + on_recall hook (Layer C reconsolidation plugs here)
  const result = buildResult(artifact, filtered);
  runHook('on_recall', { artifact: result.artifact, evidence: result.evidence });

  return result;
}
```

### Pattern Completion Primitive

```ts
function patternComplete(
  cues: CanonicalCue[],
  state_vector: StateVector,
  intent: Intent
): PatternCompletionResult {
  // 1. Find candidate episodes via index
  const positiveCues = cues.filter(c => c.polarity === 1);
  const negativeCues = cues.filter(c => c.polarity === -1);
  const episodeCandidates = queryEpisodicIndex(positiveCues);

  // 2. Score candidates (overlap * recency * goal_fit)
  const scored = episodeCandidates.map(ep => {
    const overlap = scoreOverlap(ep, positiveCues);
    const negative_penalty = scoreNegativePenalty(ep, negativeCues);
    const recency = recencyBoost(ep.last_activated_at);
    const goal_fit = goalCompatibility(ep.dominant_goal_id, state_vector.active_goals);
    return {
      episode: ep,
      score: (overlap - negative_penalty) * recency * goal_fit,
    };
  });
  const top = topK(scored, 5);

  // 3. Completion — pull missing features from top episodes
  const completed_features: Record<string, number> = {};
  for (const { episode, score } of top) {
    for (const feat of episode.features) {
      const key = `${feat.feature_type}:${feat.feature_value}`;
      if (!cues.some(c => c.key === key)) {
        completed_features[key] = (completed_features[key] ?? 0) + score * feat.binding_strength;
      }
    }
  }

  // 4. Expand to memories
  const memories = expandFromEpisodes(top.map(t => t.episode.id));

  // 5. Type-aware filter
  const filtered = filterByIntent(memories, intent);

  return {
    memories: filtered,
    completed_features,
    supporting_episodes: top.map(t => t.episode.id),
    confidence: aggregateConfidence(top),
  };
}
```

### Intent Routing

```ts
const INTENT_ROUTING: Record<Intent, {
  preferred_systems: MemorySystem[];
  abstraction_level: 'low' | 'mid' | 'high' | 'lowest' | 'all';
  strict_provenance: boolean;
  output_format: string;
}> = {
  reuse:   { preferred_systems: ['procedural','semantic'], abstraction_level: 'mid',    strict_provenance: false, output_format: 'artifact' },
  explain: { preferred_systems: ['episodic','semantic'],   abstraction_level: 'low',    strict_provenance: false, output_format: 'narrative' },
  decide:  { preferred_systems: ['semantic','episodic'],   abstraction_level: 'high',   strict_provenance: false, output_format: 'evidence_list' },
  browse:  { preferred_systems: ['episodic','semantic','procedural'], abstraction_level: 'all', strict_provenance: false, output_format: 'ranked_list' },
  verify:  { preferred_systems: ['episodic','semantic','procedural'], abstraction_level: 'lowest', strict_provenance: true, output_format: 'verbatim_with_sources' },
};
```

### Anti-Interference

```ts
function applyAntiInterference(
  evidence: Evidence[],
  intent: Intent,
  state_vector: StateVector
): Evidence[] {
  return evidence
    .map(e => ({ ...e, score: e.score * goalCompatibilityScore(e, state_vector) }))
    .map(e => ({ ...e, score: e.score * abstractionLevelGate(e, intent) }))
    .reduce(diversityPenaltyReduce, [])
    .map(e => ({ ...e, score: e.score * prototypeOveruseCheck(e) }))
    .sort((a, b) => b.score - a.score);
}
```

## Background Consolidation Loop

### Abstraction Queue (nightly or idle-triggered)

1. `gist_refinement` — high-quality LLM gist extraction
2. `prototype_induction` — cluster procedural memories by goal_type
3. `schema_induction` — aggregate semantic memories per domain
4. `alias_generation` — create memory_aliases when confidence ≥ 0.7

### Maintenance Queue (periodic, 1h or episode-close)

1. `novelty_rescoring`
2. `episodic_index_reinforcement` — Hebbian decay + normalization
3. `stale_construct_detection`
4. `cue_alias_learning`
5. `pattern_separation_refinement`

Each job must be:
- Resumable (checkpoint via `generation_version` + `status`)
- Idempotent (same input produces same side effects)
- Never blocking write/recall kernels

## Adaptive Loop (v1.0 OFF, interface seam only)

Hooks registered but no-op by default:

```ts
type HookName = 'on_evidence_assembly' | 'pre_synthesis' | 'post_synthesis' | 'on_recall';

interface HookContext {
  on_evidence_assembly: { evidence: Evidence[]; intent: Intent; state_vector: StateVector };
  pre_synthesis:        { evidence: Evidence[]; intent: Intent; strict?: boolean };
  post_synthesis:       { artifact: Artifact; evidence: Evidence[]; confidence: number };
  on_recall:            { artifact: Artifact; evidence: Evidence[] };
}

function registerHook<K extends HookName>(name: K, handler: (ctx: HookContext[K]) => void): void;
```

v1.x plugins (MINERVA 2 Echo, reconsolidation) register via these hooks.

## Benchmarks (v1.0 quality gate)

External (adopt):
- LongMemEval
- MemoryAgentBench

MemRosetta-specific (build):
1. `goal_state_preservation_test.ts` — goal 변경 후 recall 정확성
2. `source_fidelity_test.ts` — verbatim vs gist 충돌 시나리오
3. `reuse_fit_test.ts` — procedural memory 를 다른 context 에 적용 시 성공률
4. `context_preserving_transfer_test.ts` — A 저장 → B 상황 재구성

Each benchmark must:
- Be deterministic (no LLM randomness in scoring)
- Output JSON metrics suitable for CI gate
- Cover 5-intent recall modes

## Out of scope (rejected forever)

- Verbatim stripping / 어미 제거 storage
- RAG chunking
- Destructive automatic GC
- Evidence-free LLM freeform synthesis
- Replacing `memory_role` with Tulving alone (keep 2 axes)
- MINERVA 2 as central v1.0 model (interface seam only)

## Open risks (monitor during implementation)

1. Ontology lock-in on `memory_system × memory_role` boundary
2. Prediction error scoring heuristic vs LLM tradeoff
3. Alias governance threshold (confidence ≥ 0.7) effectiveness
4. Pattern completion feature overlap sensitivity
5. State vector size growth
6. Benchmark coverage gaps
7. Self-confirmation loop when Layer C activates

## Source of truth

Obsidian agreement doc (authoritative narrative):
`/Users/obst/Documents/obst/개인프로젝트/memrosetta/2026-04-17-1054-v1.0-합의안-v4-최종.md`

Codex review chain (reference):
- 1st: `/tmp/reconstructive-memory-review.md`
- 2nd: `/tmp/pure-perf-review-result.md`
- 3rd: `/tmp/v3-review-result.md`
