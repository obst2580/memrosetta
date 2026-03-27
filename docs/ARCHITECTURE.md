# MemRosetta Architecture

> The definitive technical reference for MemRosetta's internals.
> All numbers, thresholds, formulas, and behaviors are derived from the actual source code.

## Table of Contents

- [Design Philosophy](#design-philosophy)
- [Memory Model](#memory-model)
- [Store Pipeline](#store-pipeline)
- [Search Pipeline](#search-pipeline)
- [Forgetting Model](#forgetting-model)
- [Contradiction Detection](#contradiction-detection)
- [Utility Feedback](#utility-feedback)
- [Memory Tiers](#memory-tiers)
- [State Model](#state-model)
- [Quality Metrics](#quality-metrics)
- [Integration Architecture](#integration-architecture)
- [Database Schema](#database-schema)
- [Embedding Models](#embedding-models)
- [Benchmarks](#benchmarks)

---

## Design Philosophy

### Brain-Inspired, Not Brain-Faithful

MemRosetta draws from neuroscience concepts -- Ebbinghaus forgetting curves, ACT-R activation theory, hippocampal memory consolidation -- but implements them as practical engineering. The goal is useful behavior, not biological accuracy.

### Core Has Zero LLM Dependency

The core engine (`@memrosetta/core`) performs storage, search, ranking, forgetting, and compression without any LLM API calls. All intelligence is local:

- **Embeddings**: HuggingFace Transformers.js models running on CPU (bge-small-en-v1.5, 33MB)
- **Contradiction detection**: NLI model running on CPU (nli-deberta-v3-xsmall, 71MB)
- **Fact extraction** is explicitly the client's responsibility (not in Core)

### Local-First: One SQLite File

The default storage is a single SQLite file with WAL mode. No external database, no network dependency, no Docker. `npm install` is all you need.

```
SQLite pragmas on initialization:
  journal_mode = WAL       (better concurrency)
  synchronous  = NORMAL    (performance without corruption risk)
  foreign_keys = ON        (referential integrity)
```

### Non-Destructive Versioning

Memories are never deleted. Updates create new memories and mark old ones as `is_latest=0`. Invalidation sets `invalidated_at` without removing the row. Like git, the full history is preserved.

---

## Memory Model

### Atomic Memory

Each memory is one independent knowledge fragment -- not a text blob. The schema enforces atomicity at the application level.

```
+-----------------------------------------------------------------------+
|                        Memory (Atomic Unit)                           |
+-----------------------------------------------------------------------+
| memory_id       TEXT    "mem-" + nanoid(16)                           |
| user_id         TEXT    owner of this memory                          |
| namespace       TEXT?   optional category/project                     |
| memory_type     TEXT    fact | preference | decision | event          |
| content         TEXT    the actual knowledge (required)               |
| raw_text        TEXT?   original unprocessed text                     |
| document_date   TEXT?   ISO 8601, when the source was created         |
| learned_at      TEXT    ISO 8601, when this was stored (auto-set)     |
| source_id       TEXT?   trace back to origin                          |
| confidence      REAL    0-1, default 1.0                              |
| salience        REAL    0-1, default 1.0 (dynamically updated)        |
| is_latest       INT     1=current, 0=superseded                       |
| embedding       BLOB?   Float32Array serialized                       |
| keywords        TEXT?   space-separated tokens for FTS/auto-relate    |
| event_date_start TEXT?  ISO 8601, when the event started              |
| event_date_end   TEXT?  ISO 8601, when the event ended                |
| invalidated_at   TEXT?  ISO 8601, when this fact became invalid       |
| tier             TEXT   hot | warm | cold (default: warm)             |
| activation_score REAL   0-1, default 1.0 (engine-managed)            |
| access_count     INT    search hit counter (default: 0)               |
| last_accessed_at TEXT?  ISO 8601, last search hit                     |
| compressed_from  TEXT?  memory_id of original if this is a summary    |
| use_count        INT    times used in context (default: 0)            |
| success_count    INT    times reported helpful (default: 0)           |
+-----------------------------------------------------------------------+
```

### Memory Types

| Type | Description | Example |
|------|-------------|---------|
| `fact` | An objective piece of knowledge | "User prefers TypeScript over JavaScript" |
| `preference` | A subjective preference or opinion | "Likes dark mode editors" |
| `decision` | A choice that was made | "Chose PostgreSQL over MySQL for the project" |
| `event` | Something that happened at a point in time | "Deployed v2.0 to production on 2024-01-15" |

### Memory States (Derived)

States are not stored as a column. They are derived from existing fields by `deriveMemoryState()`:

```
deriveMemoryState(memory):
  if invalidated_at IS NOT NULL  -->  'invalidated'
  if is_latest = 0               -->  'superseded'
  otherwise                      -->  'current'
```

| State | Condition | Meaning |
|-------|-----------|---------|
| `current` | `is_latest=1 AND invalidated_at IS NULL` | Active, valid memory |
| `superseded` | `is_latest=0` | Replaced by a newer version |
| `invalidated` | `invalidated_at IS NOT NULL` | Explicitly marked as no longer valid |

---

### Relations

Five relation types connect memories into a knowledge graph:

| Type | Meaning | Side Effect |
|------|---------|-------------|
| `updates` | New memory supersedes old | Sets `is_latest=0` on destination |
| `extends` | Adds detail to existing memory | None |
| `derives` | Inferred from existing memory | None |
| `contradicts` | Conflicts with existing memory | None (both remain) |
| `supports` | Corroborates existing memory | None |

**Auto-supersede on `updates`**: When a relation of type `updates` is created, the destination memory's `is_latest` is automatically set to `0`. This is the only relation type with a side effect.

**Auto-relate on shared keywords**: During `store()`, the engine checks the 10 most recent memories for the same user. If a new memory shares 3 or more keywords with an existing memory (and no relation already exists between them), an `extends` relation is auto-created.

```
autoRelate():
  1. Query 10 most recent memories for same user (is_latest=1, not invalidated)
  2. For each existing memory:
     a. Parse keywords (space-separated -> array)
     b. Count case-insensitive overlap with new memory's keywords
     c. If overlap >= 3 AND no existing relation between the pair:
        Create 'extends' relation with reason "Auto: N shared keywords (kw1, kw2, ...)"
```

---

## Store Pipeline

```
Input (MemoryInput)
  |
  v
[1] Validate + Generate ID
  |  memory_id = "mem-" + nanoid(16)
  |  learned_at = now()
  |  tier = "warm", activation_score = 1.0, access_count = 0
  |
  v
[2] Embed (optional, if embedder configured)
  |  embedding = embedder.embed(content)   // Float32Array[384]
  |  Store embedding in memories.embedding (BLOB)
  |  Store embedding in vec_memories (for KNN search)
  |
  v
[3] Insert into SQLite
  |  Single INSERT into memories table
  |  FTS5 sync trigger auto-populates memories_fts
  |
  v
[4] Check Contradictions (optional, if NLI detector configured)
  |  a. Embed new memory's content
  |  b. Search top 5 similar memories (skipAccessTracking=true)
  |  c. For each similar memory (skip self):
  |     Run NLI: detector.detect(existing.content, new.content)
  |     If label='contradiction' AND score >= 0.7:
  |       Create 'contradicts' relation
  |  d. Errors silently swallowed (never blocks storage)
  |
  v
[5] Check Duplicates (optional, if embedder configured)
  |  a. Embed new memory's content
  |  b. Brute-force cosine similarity against all user's latest memories
  |  c. For each candidate (skip self):
  |     If cosine_similarity > 0.95:
  |       Create 'updates' relation (new supersedes old)
  |       (This sets old.is_latest = 0)
  |  d. Errors silently swallowed
  |
  v
[6] Auto-Relate (keyword overlap)
  |  a. If new memory has keywords:
  |     Query 10 most recent memories for same user
  |     For each, if >= 3 shared keywords AND no existing relation:
  |       Create 'extends' relation
  |  b. Errors silently swallowed
  |
  v
Return Memory
```

**Batch store** (`storeBatch`): Embeddings are pre-computed for all inputs, then all inserts happen in a single SQLite transaction for atomicity. Contradiction and duplicate checks run only for batches of 50 or fewer memories (performance guard).

**Key thresholds**:
- Contradiction NLI score threshold: **0.7** (configurable via `contradictionThreshold`)
- Duplicate cosine similarity threshold: **>0.95**
- Auto-relate keyword overlap minimum: **3 keywords**
- Auto-relate candidate pool: **10 most recent memories**
- Batch contradiction/duplicate check limit: **<=50 memories**

---

## Search Pipeline

```
Query
  |
  v
[Stage 1] FTS5 Full-Text Search
  |
  v
[Stage 2] Vector Similarity Search (optional)
  |
  v
[Stage 3] Hybrid Merge (FTS-primary strategy)
  |
  v
[Stage 4] 3-Factor Reranking
  |
  v
[Stage 5] Keyword Boost
  |
  v
[Stage 6] Deduplication
  |
  v
[Stage 7] Access Tracking Update
  |
  v
Results (SearchResponse)
```

### Stage 1: FTS5 Full-Text Search

**Query building** (`buildFtsQuery`):
1. Lowercase and split by whitespace
2. Strip FTS5 special characters: `" * ( ) : ^ { } [ ] ? ! . , ; ' \`
3. Filter stop words (85 English stop words including common verbs like go/went/getting)
4. If all tokens are stop words, fall back to original tokens
5. Join strategy based on token count:
   - **1 token**: `"token"` (literal match)
   - **2-4 tokens**: `"a" AND "b" AND "c"` (high precision)
   - **5+ tokens**: `"a" OR "b" OR "c" OR ...` (avoid over-restriction)

**BM25 scoring**: FTS5 built-in BM25 with weights `(1.0, 0.5)` for `(content, keywords)` columns. Raw BM25 scores are negative (more negative = more relevant). Scores are min-max normalized to [0, 1] where 1.0 = most relevant.

**Filters applied in SQL**:
- `user_id` (required)
- `namespace` (optional)
- `memory_type IN (...)` (optional)
- `document_date` range (optional)
- `event_date_start/end` range (optional)
- `min_confidence` (optional)
- State filtering: `states` array supersedes legacy `onlyLatest`/`excludeInvalidated`
- Default: only `current` memories (is_latest=1 AND invalidated_at IS NULL)
- Default limit: **20**

### Stage 2: Vector Similarity Search

**Model**: bge-small-en-v1.5 via HuggingFace Transformers.js (384 dimensions, q8 quantized)

**Primary path**: sqlite-vec KNN query
```sql
SELECT rowid, distance
FROM vec_memories
WHERE embedding MATCH ?
AND k = ?
```
- Candidate limit: `min(limit * 5, 200)`
- Results are then filtered against the full memories table with the same state/type/date filters

**Fallback path**: Brute-force JavaScript cosine similarity
- Triggered when sqlite-vec extension is not available
- Loads all embeddings from memories table, computes cosine similarity in JS
- Cosine similarity formula: `dot(a,b) / (||a|| * ||b||)`
- Distance = `1 - cosine_similarity` (lower = more similar)

### Stage 3: Hybrid Merge (FTS-Primary Strategy)

The merge strategy depends on how many results FTS returned relative to the requested limit:

```
if (no queryVec provided):
    Return FTS-only results

if (FTS returned 0 results, vector has results):
    Return vector-only results
    score = 1 - distance (converted back to similarity)

if (vector returned 0 results):
    Return FTS-only results

if (FTS returned >= limit results):
    RE-RANK MODE
    +-------------------------------------------------+
    | Keep all FTS results as-is                      |
    | For FTS items that also appear in vector top-K: |
    |   score *= 1.3  (30% boost for overlap)         |
    | Re-sort by boosted score                        |
    +-------------------------------------------------+

if (FTS returned < limit results):
    FILL MODE
    +-------------------------------------------------+
    | Start with all FTS results                      |
    | Append vector-only results until limit reached  |
    |   vector-fill score = (1 - distance) * 0.5      |
    |   (deliberately lower than FTS scores)          |
    +-------------------------------------------------+
```

**Why FTS-primary?** FTS with BM25 tends to be more precise for memory search where exact keyword matches matter (names, project names, specific terms). Vector search fills semantic gaps when FTS alone is insufficient.

**RRF functions** (available but not used in the main pipeline):
- `rrfMerge()`: Standard RRF with `k=20` (sharper than web-search default of 60)
- `rrfMergeWeighted()`: Weighted RRF with `ftsWeight=2.0`, `vecWeight=1.0`
- RRF score formula: `sum over lists of weight / (k + rank + 1)`

### Stage 4: 3-Factor Reranking (Generative Agents-Inspired)

Inspired by the "Generative Agents" paper (Park et al., 2023), search results are reranked using three factors:

```
final_score = w_recency * norm(recency)
            + w_importance * norm(importance)
            + w_relevance * norm(relevance)
```

**Factor definitions**:

| Factor | Formula | Source |
|--------|---------|--------|
| Recency | `0.995 ^ max(0, hours_since_learned)` | Exponential decay from `memory.learnedAt` |
| Importance | `memory.salience` (0-1) | Defaults to 1.0, updated by feedback() |
| Relevance | `result.score` | Original search score from FTS/vector/hybrid |

**Normalization**: Min-max normalization with epsilon threshold.
```
NORM_EPSILON = 0.01

safeNormalize(values):
  range = max - min
  if range < 0.01:
    return all 1.0   // Avoid amplifying noise
  return (v - min) / range for each v
```

**Default weights**: `recency=1.0, importance=1.0, relevance=1.0` (all equal)

**Recency decay rate**: At 0.995 per hour:
- After 1 hour: 0.995 (negligible decay)
- After 24 hours: 0.887
- After 7 days: 0.431
- After 30 days: 0.027
- After 90 days: ~0.00002

### Stage 5: Keyword Boost

After reranking, results whose stored keywords overlap with query tokens get a bonus:

```
boost = min(overlap_count * 0.1, 0.5)
boosted_score = score * (1 + boost)
```

- **10% boost per matching keyword**, capped at **50% maximum boost**
- Keywords are compared case-insensitively
- Query tokens are extracted using the same logic as `buildFtsQuery` (stop words filtered)

### Stage 6: Deduplication

Removes duplicate results based on content identity:

```
key = memory.content.toLowerCase().trim()
Keep first (highest-scored) occurrence of each key
```

### Stage 7: Access Tracking

After returning results, the engine updates access tracking for all returned memories:

```sql
UPDATE memories
SET access_count = access_count + 1, last_accessed_at = ?
WHERE memory_id = ?
```

This feeds back into:
- Ebbinghaus forgetting curve (access_count = strength S)
- Tier determination (accessCount >= 10 auto-promotes to hot)
- 3-factor reranking (via activation_score in maintain())

---

## Forgetting Model

MemRosetta implements two forgetting models. **Ebbinghaus is the current default** (used in `maintain()`).

### Ebbinghaus Forgetting Curve

```
R = e^(-t/S)

Where:
  R = retention (0 to 1)
  t = days since last access (from last_accessed_at)
  S = strength = max(1, access_count)
```

- If never accessed (`last_accessed_at` is null): returns **0.1**
- If just accessed (`t <= 0`): returns **1.0**
- Works with existing DB fields (`access_count`, `last_accessed_at`) -- no access history table needed

**Decay examples** (access_count=1, i.e., S=1):
- After 1 day: 0.368
- After 3 days: 0.050
- After 7 days: 0.001

**Decay examples** (access_count=10, i.e., S=10):
- After 1 day: 0.905
- After 7 days: 0.497
- After 30 days: 0.050

### Blended Activation in maintain()

The `maintain()` function computes activation scores for all active memories:

```
activation_score = ebbinghaus * 0.8 + salience * 0.2

Where:
  ebbinghaus = computeEbbinghaus(access_count, last_accessed_at)
  salience   = memory.salience (0-1, from feedback or original input)
```

Ebbinghaus dominates at **80%** so that old unused memories decay properly. Salience contributes **20%** so that high-importance memories resist decay.

### ACT-R Base-Level Learning (Legacy)

Available via `computeActivation()` but not used in the default `maintain()` flow:

```
B_i = ln(sum(t_j^(-d))) + beta_i

Where:
  t_j    = days since j-th access
  d      = decay parameter (0.5)
  beta_i = salience (base-level constant)

activation = sigmoid(B_i) = 1 / (1 + e^(-B_i))
```

Requires a full access timestamp history (not just count), which is why Ebbinghaus was chosen as the practical default.

---

## Contradiction Detection

### Model

- **nli-deberta-v3-xsmall** (Xenova/nli-deberta-v3-xsmall)
- Size: 71MB, q8 quantized
- License: Apache 2.0
- Runs locally via HuggingFace Transformers.js
- Classification pipeline: `text-classification` task

### Detection Flow

```
On store():
  1. Embed new memory content
  2. Search top 5 similar memories (same user, is_latest=1)
     (uses skipAccessTracking=true to avoid inflating counts)
  3. For each similar memory (skip self):
     a. Run NLI: pipeline(existing_content, { text_pair: new_content, top_k: null })
     b. Parse result: find highest-scoring label
     c. Normalize label: "contradict*" -> contradiction, "entail*" -> entailment, else neutral
     d. If label = 'contradiction' AND score >= 0.7:
        Create 'contradicts' relation with reason "NLI confidence: 0.XXX"
```

### Behavior

- **Threshold**: 0.7 (configurable via `contradictionThreshold` engine option)
- **Batch limit**: Runs on `storeBatch` only for batches of 50 or fewer
- **Graceful degradation**: All errors are silently swallowed; storage is never blocked
- **Both memories persist**: Unlike `updates`, `contradicts` does not change `is_latest`

---

## Utility Feedback

Inspired by the Memento-Skills approach: "Memories that help rank higher. Memories that mislead fade."

### feedback(memoryId, helpful)

```
1. Increment use_count (always)
2. If helpful: increment success_count
3. Recalculate salience:
   success_rate = success_count / use_count
   salience = clamp(0.5 + 0.5 * success_rate, 0.1, 1.0)
```

**Salience range**: [0.1, 1.0]
- Memory always helpful (100% success rate): salience = 1.0
- Memory never helpful (0% success rate): salience = 0.5
- Mixed results: proportional between 0.5 and 1.0
- Floor of 0.1 prevents complete suppression

**Impact path**: salience feeds into 3-factor reranking via the `importance` factor, and into `maintain()` activation blending (20% weight).

---

## Memory Tiers

```
+------------------------------------------+
|  HOT (Working Memory)                    |
|  - Always loaded first                   |
|  - Target: ~3K tokens                    |
|  - Sticky: manual promotion stays hot    |
|  - Auto-promote: accessCount >= 10       |
+------------------------------------------+
         |                    ^
         | age > warmDays     | accessCount >= 10
         | AND low activation |
         v                    |
+------------------------------------------+
|  WARM (Recent Memory)                    |
|  - Within last 30 days, OR               |
|  - Older but activation >= 0.3           |
+------------------------------------------+
         |
         | age > warmDays AND activation < 0.3
         v
+------------------------------------------+
|  COLD (Long-term Archive)                |
|  - Older than 30 days                    |
|  - Low activation                        |
|  - Candidates for compression            |
+------------------------------------------+
```

### determineTier() Logic

```
1. If memory.tier == 'hot':          return 'hot'    // Sticky
2. If memory.accessCount >= 10:      return 'hot'    // Heat-based promotion
3. If age <= warmDays (30):          return 'warm'   // Recent
4. If activationScore >= 0.3:        return 'warm'   // Still active
5. Otherwise:                        return 'cold'
```

### Default Tier Configuration

| Parameter | Value | Description |
|-----------|-------|-------------|
| `hotMaxTokens` | 3000 | Token budget for working memory |
| `warmDays` | 30 | Days before a memory can go cold |
| `coldActivationThreshold` | 0.3 | Activation below which old memories go cold |

### Token Estimation

```
estimateTokens(content) = ceil(content.length / 4)
```

Rough heuristic: 1 token per 4 characters.

### Working Memory

`workingMemory(userId, maxTokens=3000)` returns memories ordered by tier priority, then activation score, fitting within the token budget:

```sql
SELECT * FROM memories
WHERE user_id = ? AND is_latest = 1 AND invalidated_at IS NULL
ORDER BY
  CASE tier WHEN 'hot' THEN 0 WHEN 'warm' THEN 1 ELSE 2 END,
  activation_score DESC
```

Memories are added until the estimated token count exceeds `maxTokens`.

### Compression

`compress(userId)` targets cold memories with very low activation:

```
1. SELECT cold memories WHERE activation_score < 0.1 AND is_latest = 1
2. Group by namespace
3. For groups with 2+ memories:
   a. Concatenate content with " | " separator
   b. Truncate to 500 chars (+ "...")
   c. Store as new 'fact' memory in cold tier
      (confidence=0.5, salience=0.5, activation=0.5)
   d. Set compressed_from to first original's memory_id
   e. Mark all originals as is_latest=0
```

### Maintenance

`maintain(userId)` runs a full maintenance cycle:

```
Phase 1: Recompute activation scores
  For each is_latest=1 memory:
    activation_score = ebbinghaus * 0.8 + salience * 0.2

Phase 2: Update tiers
  For each is_latest=1 memory:
    new_tier = determineTier(memory)
    If changed: UPDATE tier

Phase 3: Compress
  Run compress(userId) on cold low-activation memories

Returns: { activationUpdated, tiersUpdated, compressed, removed }
```

---

## State Model

### State Derivation

```
+--------------------+-----------------------------------+
| State              | Condition                         |
+--------------------+-----------------------------------+
| current            | is_latest=1 AND                   |
|                    | invalidated_at IS NULL            |
+--------------------+-----------------------------------+
| superseded         | is_latest=0                       |
+--------------------+-----------------------------------+
| invalidated        | invalidated_at IS NOT NULL        |
+--------------------+-----------------------------------+
```

### State Filtering in Search

The `states` filter in `SearchFilters` supersedes the legacy `onlyLatest`/`excludeInvalidated` booleans:

```
if filters.states is set:
  Apply state conditions as OR clauses
  e.g., states=['current','superseded'] -->
    (is_latest=1 AND invalidated_at IS NULL) OR (is_latest=0)

if filters.states is NOT set:
  onlyLatest (default: true)  --> WHERE is_latest = 1
  excludeInvalidated (default: true) --> WHERE invalidated_at IS NULL
```

**Default search returns only `current` memories.**

---

## Quality Metrics

`quality(userId)` returns a `MemoryQuality` snapshot:

| Metric | SQL | Description |
|--------|-----|-------------|
| `total` | `COUNT(*)` | All memories for user |
| `fresh` | `COUNT(*) WHERE is_latest=1 AND invalidated_at IS NULL` | Current, active memories |
| `invalidated` | `COUNT(*) WHERE invalidated_at IS NOT NULL` | Explicitly invalidated |
| `superseded` | `COUNT(*) WHERE is_latest=0` | Replaced by newer versions |
| `withRelations` | Distinct memory_ids in memory_relations | Memories with graph connections |
| `avgActivation` | `AVG(activation_score) WHERE is_latest=1` | Health indicator |

Shown in `memrosetta status` CLI command.

---

## Integration Architecture

```
+------------------+          +------------------+          +-------------------+
| Claude Code      |--hooks-->| memrosetta CLI   |--------->|                   |
| (on-stop hook)   |          | (direct engine)  |          |                   |
+------------------+          +------------------+          |                   |
                                                            |  MemRosetta Core  |
+------------------+          +------------------+          |  (@memrosetta/    |
| Claude Code      |--MCP---->|                  |          |   core)           |
| Cursor           |--MCP---->| MCP Server       |--------->|                   |
| Codex            |--MCP---->| (7 tools)        |          |                   |-----> SQLite
| Any MCP client   |--MCP---->|                  |          |                   |       (single file)
+------------------+          +------------------+          |                   |
                                                            |                   |
+------------------+          +------------------+          |                   |
| HTTP clients     |--REST--->| Hono REST API    |--------->|                   |
+------------------+          +------------------+          +-------------------+
```

### MCP Tools (7 tools)

| Tool | Description |
|------|-------------|
| `memrosetta_store` | Store an atomic memory |
| `memrosetta_search` | Hybrid search (keyword + semantic) |
| `memrosetta_relate` | Create relation between memories |
| `memrosetta_working_memory` | Get working memory (default 3K tokens) |
| `memrosetta_count` | Count stored memories |
| `memrosetta_invalidate` | Mark a memory as invalid |
| `memrosetta_feedback` | Record helpful/not-helpful feedback |

All MCP tools default `userId` to the system username (`os.userInfo().username`).

### CLI Commands

| Command | Description |
|---------|-------------|
| `memrosetta store` | Store memory |
| `memrosetta search` | Search memories |
| `memrosetta relate` | Create relation |
| `memrosetta get` | Get memory by ID |
| `memrosetta count` | Count memories |
| `memrosetta clear` | Clear all memories for user |
| `memrosetta invalidate` | Invalidate a memory |
| `memrosetta feedback` | Record feedback |
| `memrosetta working-memory` | Get working memory |
| `memrosetta maintain` | Run maintenance |
| `memrosetta compress` | Run compression |
| `memrosetta status` | Show status and quality metrics |
| `memrosetta init` | Initialize and configure integrations |
| `memrosetta ingest` | Bulk import memories |
| `memrosetta reset` | Reset database |
| `memrosetta update` | Self-update |

### Claude Code Hooks

MemRosetta integrates with Claude Code via hooks:
- **on-stop**: Extracts facts from conversation transcript and stores them
- **on-prompt**: Injects working memory into the prompt context

---

## Database Schema

### Schema Version: V5

The schema uses automatic migration (V1 -> V5). Fresh databases get all columns from V1 definition. Existing databases are migrated through ALTER TABLE statements.

### Tables

**memories** (main table):
```sql
CREATE TABLE memories (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  memory_id        TEXT NOT NULL UNIQUE,
  user_id          TEXT NOT NULL,
  namespace        TEXT,
  memory_type      TEXT NOT NULL CHECK(memory_type IN ('fact','preference','decision','event')),
  content          TEXT NOT NULL,
  raw_text         TEXT,
  document_date    TEXT,
  learned_at       TEXT NOT NULL,
  source_id        TEXT,
  confidence       REAL DEFAULT 1.0,
  salience         REAL DEFAULT 1.0,
  is_latest        INTEGER NOT NULL DEFAULT 1,
  embedding        BLOB,
  keywords         TEXT,
  event_date_start TEXT,
  event_date_end   TEXT,
  invalidated_at   TEXT,
  tier             TEXT DEFAULT 'warm' CHECK(tier IN ('hot','warm','cold')),
  activation_score REAL DEFAULT 1.0,
  access_count     INTEGER DEFAULT 0,
  last_accessed_at TEXT,
  compressed_from  TEXT,
  use_count        INTEGER DEFAULT 0,
  success_count    INTEGER DEFAULT 0
);
```

**memory_relations**:
```sql
CREATE TABLE memory_relations (
  src_memory_id TEXT NOT NULL,
  dst_memory_id TEXT NOT NULL,
  relation_type TEXT NOT NULL CHECK(relation_type IN
    ('updates','extends','derives','contradicts','supports')),
  created_at    TEXT NOT NULL,
  reason        TEXT,
  PRIMARY KEY (src_memory_id, dst_memory_id, relation_type),
  FOREIGN KEY (src_memory_id) REFERENCES memories(memory_id),
  FOREIGN KEY (dst_memory_id) REFERENCES memories(memory_id)
);
```

**memories_fts** (FTS5, content-sync mode):
```sql
CREATE VIRTUAL TABLE memories_fts USING fts5(
  content,
  keywords,
  content='memories',
  content_rowid='id'
);
```

Synchronized via triggers (INSERT/UPDATE/DELETE on memories auto-updates FTS).

**vec_memories** (sqlite-vec, optional):
```sql
CREATE VIRTUAL TABLE vec_memories USING vec0(
  embedding float[384]   -- dimension matches embedding model
);
```

### Indexes

```sql
idx_memories_user_id      ON memories(user_id)
idx_memories_namespace    ON memories(user_id, namespace)
idx_memories_memory_type  ON memories(memory_type)
idx_memories_is_latest    ON memories(is_latest)
idx_memories_source_id    ON memories(source_id)
idx_memories_learned_at   ON memories(learned_at)
idx_memories_event_date   ON memories(event_date_start, event_date_end)
idx_memories_invalidated  ON memories(invalidated_at)
idx_memories_tier         ON memories(tier)
idx_memories_activation   ON memories(activation_score)
```

---

## Embedding Models

### Presets

| Preset | Model | Size | Dimensions | Language | License |
|--------|-------|------|------------|----------|---------|
| `en` (default) | Xenova/bge-small-en-v1.5 | 33MB | 384 | English | MIT |
| `multilingual` | Xenova/multilingual-e5-small | 100MB | 384 | 94 languages | MIT |
| `ko` | Xenova/ko-sroberta-nli-multitask | 110MB | 768 | Korean | Apache 2.0 |

All models:
- Run via `@huggingface/transformers` (Transformers.js)
- Use `q8` quantized format for fast CPU inference
- Mean pooling with L2 normalization
- Downloaded on first use, cached locally

### Dimension Mismatch Handling

If the configured embedding dimension differs from what is stored in `schema_version.embedding_dimension`, the `vec_memories` table is dropped and recreated:

```
[memrosetta] Embedding dimension changed (384 -> 768). Recreating vector index...
```

---

## Benchmarks

### Dataset: LoCoMo

- 1,986 QA pairs
- 5,882 memories ingested
- Evaluates long-conversation memory retrieval

### Current Results (FTS-only)

| Metric | Value |
|--------|-------|
| P@5 | 0.0087 |
| MRR | 0.0298 |

Note: These are early-stage baseline numbers. Hybrid search (FTS + vector) and 3-factor reranking are expected to improve results significantly.
