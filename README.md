<p align="center">
  <h1 align="center">MemRosetta</h1>
  <p align="center">One persistent memory shared across all your AI tools. Local SQLite. Zero cloud.</p>
</p>

```bash
npm install -g @memrosetta/cli
memrosetta init --claude-code
# Done. Your AI remembers everything now.
```

---

## The Problem

```
Session 1: "Our API uses Spring Boot on Azure. Auth is OAuth2 with PKCE."
Session 2: "What's our tech stack?" -- AI has no idea

Session 1: "Let's go with approach B for the auth refactor."
Session 2: "What did we decide?" -- gone

Session 1: (3 hours debugging) "The fix: set batch size to 4."
Session 2: (same bug) starts from scratch
```

Every AI tool forgets everything between sessions. You re-explain, re-decide, re-debug. MemRosetta is a local memory engine that gives any AI tool persistent, searchable long-term memory -- stored in a single SQLite file on your machine.

## Quick Start

```bash
npm install -g @memrosetta/cli
```

```bash
# Base setup: database + MCP server
memrosetta init

# Claude Code: + hooks + CLAUDE.md instructions
memrosetta init --claude-code

# Cursor: + MCP config
memrosetta init --cursor
```

That's it. Restart your tool and it has memory.

## How Claude Code Integration Works

When you run `memrosetta init --claude-code`, three things are set up:

### 1. MCP Server (memory tools for Claude)

Claude gets 6 memory tools it can call during any session:

**memrosetta_store** -- Claude calls this when it encounters important information:
- Technical decisions ("We chose PostgreSQL over MySQL because...")
- User preferences ("The user prefers functional style over OOP")
- Project facts ("The API runs on port 8080 with JWT auth")
- Completed work ("Migrated user table to new schema, 3 columns added")

**memrosetta_search** -- Claude calls this when it needs context:
- "What did we decide about the auth system?" --> searches past memories
- "How is the API configured?" --> finds technical facts from previous sessions
- "What does the user prefer for error handling?" --> recalls preferences

**memrosetta_working_memory** -- Claude calls this to load relevant context:
- Returns the highest-activation memories (~3K tokens)
- Prioritizes frequently accessed and recent memories
- Acts as a "what do I need to know right now?" summary

**memrosetta_relate** -- Claude links related memories:
- "The auth approach changed" --> creates `updates` relation
- "This contradicts what we decided before" --> creates `contradicts` relation

**memrosetta_invalidate** -- Claude marks outdated facts:
- "We're no longer using React, switched to Vue" --> invalidates the React fact

**memrosetta_count** -- Quick check: "How many memories do I have for this project?"

### 2. Stop Hook (automatic backup on session end)

When a Claude Code session ends, a hook automatically:
1. Reads the session transcript (JSONL)
2. Extracts meaningful turns (skips confirmations, code blocks, tool calls)
3. Stores them as memories in the database
4. Deduplicates: if the same session is saved twice, old entries are replaced

This is a safety net. Claude stores important things via MCP during the session,
but the Stop Hook catches anything that was missed.

### 3. CLAUDE.md Instructions

Adds instructions to your global CLAUDE.md telling Claude:
- When to store memories (decisions, facts, preferences, events)
- When NOT to store (code itself, debugging steps, confirmations)
- How to search past memories when context is missing
- Always include keywords for better search quality

## Works With

All tools share the same local database. Memories stored from one tool are instantly available in another.

```
Claude Code ----+
Claude Desktop --+--> ~/.memrosetta/memories.db <--+-- Cursor
Windsurf -------+     (one local SQLite file)      +-- Cline
                                                   +-- Continue
```

| Tool | MCP | Setup |
|------|:---:|-------|
| Claude Code | Yes | `memrosetta init --claude-code` |
| Claude Desktop | Yes | `memrosetta init --mcp` |
| Cursor | Yes | `memrosetta init --cursor` |
| Windsurf | Yes | `memrosetta init --mcp` |
| Cline | Yes | `memrosetta init --mcp` |
| Continue | Yes | `memrosetta init --mcp` |
| ChatGPT / Copilot | -- | No MCP support. Use CLI or REST API. |

### Cross-Tool Memory Sharing

```
Morning   Claude Code: debug auth system         --> memories saved
Afternoon Cursor: build login UI                  --> searches "auth" --> finds morning's decisions
Evening   Claude Desktop: write architecture doc  --> has full context from both sessions
```

No sync. No cloud. No config. One local file.

## How It Works

### Your AI is the client. MemRosetta is the memory.

MemRosetta does not call any LLM. Instead, your AI tool (Claude Code, Cursor, etc.) calls MemRosetta:

```
Your AI tool                    MemRosetta
-----------                     ----------
"This is important,             store() --> SQLite
 let me save it"

"I need context about           search() --> hybrid retrieval
 the auth system"

"This contradicts what          relate() --> contradiction graph
 we said before"
```

The engine handles storage, search, contradiction detection, and forgetting -- all locally, with zero API calls. Your AI decides WHAT to store. MemRosetta decides HOW to store and retrieve it.

### Atomic memories + hybrid search

MemRosetta stores **atomic memories** -- one fact per record, not text chunks -- in a local SQLite database. Retrieval uses hybrid search that combines keyword matching, semantic similarity, and activation-based ranking.

```
Query: "What CSS framework did we choose?"
  |
  +-- FTS5 (BM25)     keyword match: "CSS", "framework"
  +-- Vector (KNN)     semantic match: similar meaning
  +-- RRF Merge        combined ranking
  |
  +-- Activation       boost frequently accessed memories
  +-- Time decay       recent memories rank higher
```

### Memory Lifecycle

```
Store                      Search                     Maintain
-----                      ------                     --------
Classify (fact/pref/       Hybrid search              Activation scoring
  decision/event)            (FTS + vector + RRF)       (ACT-R model)
Store atomically           Activation weighting       Tier compression
Detect contradictions      Relation expansion           Hot  -> always loaded
  (NLI model, local)      Time filtering               Warm -> last 30 days
Link relations                                         Cold -> compressed
```

### Not Another RAG

| | RAG (chunk-based) | MemRosetta (atomic) |
|---|---|---|
| **Unit** | ~400 token text chunks | One fact = one record |
| **Updates** | Re-index entire document | `updates` relation, old version kept |
| **Contradictions** | Both returned, AI guesses | Auto-detected by NLI model |
| **Time** | None | 4 timestamps per memory |
| **Forgetting** | Everything weighted equally | ACT-R: used more = ranked higher |

## Search Architecture

MemRosetta uses a three-stage hybrid search pipeline:

### Stage 1: FTS5 Full-Text Search (BM25)

SQLite's built-in full-text search with BM25 ranking:
- Tokenizes query into keywords
- Filters common stop words (the, is, are...)
- Matches against memory content and keywords
- Ranks by term frequency * inverse document frequency
- Speed: ~0.2ms for 13K memories

### Stage 2: Vector Similarity Search (KNN)

Local embedding model (bge-small-en-v1.5, 33MB, MIT license):
- Converts query and memories to 384-dimensional vectors
- Uses sqlite-vec for KNN search
- Catches semantic matches that keywords miss ("UI theme" matches "prefers dark mode" even without shared keywords)
- Speed: ~3ms for 13K memories

### Stage 3: Reciprocal Rank Fusion (RRF)

Combines results from FTS5 and vector search:
- `score = 1/(k + rank_fts) + 1/(k + rank_vec)` where `k = 60`
- Memories found by both methods get boosted
- Final results weighted by activation score (ACT-R)
- Frequently accessed memories rank higher

## Contradiction Detection

When a new memory is stored, MemRosetta automatically checks for contradictions:

1. Compute embedding for the new memory
2. Search for similar existing memories (top 5)
3. Run NLI (Natural Language Inference) check on each pair
4. If contradiction score >= 0.7, auto-create `contradicts` relation

```
Example:
  Existing: "Our hourly rate is $50"
  New:      "Our hourly rate is $40"
  Result:   contradiction detected (score: 0.93)
            --> auto-creates: new --[contradicts]--> existing
```

The NLI model (nli-deberta-v3-xsmall) runs entirely locally:
- Size: 71MB
- License: Apache 2.0
- No API calls, no LLM needed
- Detects logical negation well (0.92+ accuracy on MNLI)
- Numeric contradictions may not always be caught (model limitation)

## Memory Tiers & Adaptive Forgetting

Inspired by human memory consolidation:

### Tiers

| Tier | Contents | Behavior |
|------|----------|----------|
| **Hot** | Working memory (~3K tokens) | Always loaded. Highest activation. |
| **Warm** | Last 30 days | Active memories. Normal search ranking. |
| **Cold** | Older than 30 days | Low activation. Compressed. Still searchable. |

### ACT-R Activation Formula

Each memory has an activation score computed using the ACT-R base-level learning equation:

```
activation = sigmoid( ln( sum( t_j ^ -0.5 ) ) + salience )
```

Where:
- `t_j` = days since the j-th access
- `salience` = memory importance (0-1)
- More accesses --> higher activation
- Recent accesses --> higher activation
- High salience --> base activation boost

### Compression

Cold memories with very low activation (< 0.1) are eligible for compression:
- Grouped by namespace (session/project)
- Content concatenated into a summary
- Original memories marked as not-latest (preserved, not deleted)
- Summary becomes the new searchable entry

Run maintenance manually:

```bash
memrosetta maintain
```

## Features

**Search** -- Hybrid retrieval combining FTS5 (BM25), vector similarity (bge-small-en-v1.5), and Reciprocal Rank Fusion. Better recall than either approach alone.

**Contradiction Detection** -- Local NLI model (nli-deberta-v3-xsmall, 71MB) automatically detects when new facts contradict existing ones. No LLM needed.

**Adaptive Forgetting** -- ACT-R activation scoring. Frequently accessed memories rank higher. Unused memories fade but are never deleted.

**Memory Tiers** -- Hot (working memory, ~3K tokens), Warm (last 30 days), Cold (compressed long-term).

**Relations** -- `updates`, `extends`, `derives`, `contradicts`, `supports`. Memories form a graph, not a flat list.

**Time Model** -- Four timestamps: `learnedAt`, `documentDate`, `eventDateStart/End`, `invalidatedAt`.

**Non-destructive** -- Nothing is ever deleted. Old versions are preserved via relations and `isLatest` flags.

**610+ tests.**

## MCP Tools

When connected via MCP, your AI tool gets these capabilities:

| Tool | Description |
|------|-------------|
| `memrosetta_store` | Save an atomic memory |
| `memrosetta_search` | Hybrid search across past memories |
| `memrosetta_working_memory` | Get highest-priority context (~3K tokens) |
| `memrosetta_relate` | Link related memories |
| `memrosetta_invalidate` | Mark a memory as outdated |
| `memrosetta_count` | Count stored memories |

## REST API

### Store a memory

```http
POST /api/memories
Content-Type: application/json

{
  "userId": "alice",
  "content": "Prefers dark mode in all applications",
  "memoryType": "preference",
  "keywords": ["dark-mode", "ui"],
  "confidence": 0.95
}
```

Response:

```json
{
  "success": true,
  "data": {
    "memoryId": "mem-WL5IFdnKmMjx9_ES",
    "userId": "alice",
    "content": "Prefers dark mode in all applications",
    "memoryType": "preference",
    "learnedAt": "2026-03-24T06:42:00Z",
    "tier": "warm",
    "activationScore": 1.0
  }
}
```

### Search memories

```http
POST /api/search
Content-Type: application/json

{
  "userId": "alice",
  "query": "UI preferences",
  "limit": 5,
  "filters": {
    "onlyLatest": true,
    "minConfidence": 0.5
  }
}
```

Response:

```json
{
  "success": true,
  "data": {
    "results": [
      {
        "memory": {
          "memoryId": "mem-WL5IFdnKmMjx9_ES",
          "content": "Prefers dark mode in all applications",
          "memoryType": "preference",
          "activationScore": 0.87
        },
        "score": 0.92,
        "matchType": "hybrid"
      }
    ],
    "totalCount": 1,
    "queryTimeMs": 3.2
  }
}
```

### Working memory

```http
GET /api/working-memory?userId=alice&maxTokens=3000
```

Response:

```json
{
  "success": true,
  "data": {
    "memories": [
      {
        "content": "Prefers dark mode in all applications",
        "memoryType": "preference",
        "activationScore": 0.87
      }
    ],
    "totalTokens": 2847,
    "memoryCount": 12
  }
}
```

### Create relation

```http
POST /api/relations
Content-Type: application/json

{
  "srcMemoryId": "mem-abc123",
  "dstMemoryId": "mem-def456",
  "relationType": "updates",
  "reason": "Hourly rate changed from $50 to $40"
}
```

### Invalidate a memory

```http
POST /api/memories/mem-abc123/invalidate
```

## CLI Reference

14 commands for full memory management. [Full CLI documentation](docs/CLI.md) | [CLI 한국어 문서](docs/CLI.ko.md)

| Command | Description |
|---------|-------------|
| `init` | Initialize database + integrations |
| `store` | Store an atomic memory |
| `search` | Hybrid search across memories |
| `get` | Get memory by ID |
| `count` | Count memories for a user |
| `clear` | Clear all memories for a user |
| `relate` | Create a relation between memories |
| `invalidate` | Mark a memory as invalidated |
| `ingest` | Ingest conversation from JSONL transcript |
| `working-memory` | Show working memory for a user |
| `maintain` | Run maintenance (scores + tiers + compression) |
| `compress` | Run compression only |
| `status` | Show database and integration status |
| `reset` | Remove integrations |

Global flags: `--db <path>` `--format json|text` `--no-embeddings`

## As a Library

```typescript
import { SqliteMemoryEngine } from '@memrosetta/core';
import { HuggingFaceEmbedder } from '@memrosetta/embeddings';

const embedder = new HuggingFaceEmbedder();
await embedder.initialize();

const engine = new SqliteMemoryEngine({ dbPath: './memories.db', embedder });
await engine.initialize();

// Store
await engine.store({
  userId: 'alice',
  content: 'Prefers dark mode in all applications',
  memoryType: 'preference',
  keywords: ['dark-mode', 'ui'],
});

// Search (hybrid: keyword + semantic)
const results = await engine.search({
  userId: 'alice',
  query: 'UI theme preference',
  limit: 5,
});

// Relate
await engine.relate(memA.memoryId, memB.memoryId, 'updates', 'Changed preference');

// Working memory (~3K tokens of highest-priority context)
const context = await engine.workingMemory('alice', 3000);

// Maintenance (recompute activation scores, compress old memories)
await engine.maintain('alice');

await engine.close();
```

## Language Support

MemRosetta supports multiple embedding models for different languages:

| Language | Flag | Model | Dimension |
|----------|------|-------|-----------|
| English (default) | -- | bge-small-en-v1.5 (33MB) | 384 |
| Multilingual (94 langs) | `--lang multi` | multilingual-e5-small (100MB) | 384 |
| Korean | `--lang ko` | ko-sroberta-multitask (110MB) | 768* |

*Korean model uses 768 dimensions. Requires a fresh database if switching from English/multilingual (384 dim).

```bash
memrosetta init --claude-code                # English (default)
memrosetta init --claude-code --lang multi   # Multilingual
memrosetta init --claude-code --lang ko      # Korean
```

As a library:

```typescript
import { HuggingFaceEmbedder } from '@memrosetta/embeddings';

// Preset
const embedder = new HuggingFaceEmbedder({ preset: 'multilingual' });

// Custom model
const custom = new HuggingFaceEmbedder({ modelId: 'Xenova/some-model' });
```

## Packages

| Package | Description |
|---------|-------------|
| `@memrosetta/core` | Memory engine: SQLite + FTS5 + vector + NLI |
| `@memrosetta/embeddings` | Local embeddings (bge-small-en-v1.5) + NLI (nli-deberta-v3-xsmall) |
| `@memrosetta/cli` | Command-line interface |
| `@memrosetta/mcp` | MCP server for AI tool integration |
| `@memrosetta/api` | REST API (Hono) |
| `@memrosetta/claude-code` | Claude Code integration (hooks + init) |
| `@memrosetta/llm` | LLM-based fact extraction (OpenAI/Anthropic) -- optional |

## Benchmarks

Evaluated on [LoCoMo](https://github.com/snap-research/locomo) (1,986 QA pairs, 5,882 memories):

| Method | Precision@5 | MRR | Latency (p50) | LLM Required |
|--------|:-----------:|:---:|:-------------:|:------------:|
| FTS5 only | 0.0080 | 0.0286 | 0.4ms | No |
| Hybrid (FTS + Vector + RRF) | 0.0130 | 0.0370 | 3.1ms | No |
| **Hybrid + Fact Extraction** | **0.0740** | **0.1570** | **3.3ms** | **Yes (external)** |

v0.2.0 search improvements (AND mode for short queries, keyword boost, dedup) delivered **+1000% MRR** on FTS-only compared to v0.1.0. Fact extraction adds another order of magnitude.

Fact extraction uses an external LLM (e.g., OpenAI, Anthropic) to pre-process conversation transcripts into atomic facts before storage. The core search engine operates without any LLM.

> Benchmark results may vary slightly across environments due to differences in
> SQLite versions, embedding model quantization, and hardware. Run `pnpm bench:*`
> to reproduce on your machine.

```bash
pnpm bench:sqlite                    # FTS only
pnpm bench:hybrid                    # Hybrid search
pnpm bench:hybrid --converter fact --llm-provider openai  # With LLM extraction
```

## Comparison

| | Mem0 | Zep | Letta | **MemRosetta** |
|---|---|---|---|---|
| Runs locally | Cloud | Cloud | Cloud + Local | **SQLite, no server** |
| Core LLM dep | Yes | Yes | Yes | **None (AI tool is the client)** |
| Contradiction detection | No | No | No | **Yes (NLI, local)** |
| Forgetting model | No | No | No | **Yes (ACT-R)** |
| Time model | No | No | No | **4 timestamps** |
| Relational versioning | No | No | No | **5 relation types** |
| Cross-tool sharing | No | No | No | **Yes, one local DB** |
| Protocol | REST API | REST API | REST API | **MCP + CLI + REST** |
| Setup | Complex | Complex | Complex | **One command** |

## Development

```bash
git clone https://github.com/obst2580/memrosetta.git
cd memrosetta
pnpm install
pnpm build             # Build all packages (required before first test)
pnpm test              # 610+ tests
pnpm bench:mock        # Quick benchmark (no LLM needed)
```

> On a clean clone, `pnpm test` automatically runs `pnpm build` first so that
> workspace packages (`@memrosetta/types`, `@memrosetta/core`, etc.) are compiled
> before tests reference their `dist/` exports. If you only want to re-run tests
> without rebuilding, use `pnpm test:only`.

## Roadmap

- [x] Atomic memory CRUD + SQLite + FTS5
- [x] Vector search + hybrid retrieval (RRF)
- [x] NLI contradiction detection
- [x] Time model (4 timestamps, invalidation)
- [x] Hierarchical compression (Hot/Warm/Cold)
- [x] Adaptive forgetting (ACT-R)
- [x] Working memory endpoint
- [x] CLI + REST API + MCP server
- [x] Claude Code integration
- [x] LoCoMo benchmarks
- [x] Multilingual embeddings (Korean, multilingual, configurable presets)
- [ ] PostgreSQL adapter (team/server use)
- [ ] Profile builder (stable + dynamic user profiles)

## License

[MIT](LICENSE)
