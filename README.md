# MemRosetta

**Your AI keeps forgetting. MemRosetta fixes that.**

Every time you start a new AI session, context is lost. You re-explain the same things, re-make the same decisions, re-discover the same solutions. MemRosetta gives your AI tools persistent, searchable long-term memory that survives across sessions.

> Memory + Rosetta: Just as the Rosetta Stone unlocked ancient writing, MemRosetta unlocks AI memory.

## The Problem

```
Session 1: "Our API uses Spring Boot with PostgreSQL, deployed on Azure..."
Session 2: "What tech stack are we using?"  ← AI has no idea

Session 1: "Let's go with approach B for the auth system"
Session 2: "What did we decide about auth?"  ← Lost forever

Session 1: (3 hours of debugging) "The fix was changing the batch size to 4"
Session 2: (same bug) starts from scratch
```

## The Solution

```bash
# Install
npm install @memrosetta/cli

# Done. Now your AI remembers everything.
memrosetta search --user myproject --query "auth decision" --format text
# [0.95] Decided to go with approach B for auth system (decision, 2026-03-24)
# [0.82] Auth uses JWT with refresh token rotation (fact, 2026-03-23)
```

## How It Works

MemRosetta stores **atomic memories** (one fact = one memory) in a local SQLite database and retrieves them using hybrid search (keywords + semantic similarity). No server, no cloud, no API keys required for core functionality.

```
Your AI tool (Claude Code, Cursor, any chatbot)
  │
  │  store("User prefers TypeScript")
  │  search("programming language?")
  │
  ▼
MemRosetta (runs locally, no LLM dependency)
  ├── SQLite + FTS5 ── keyword search (2ms)
  ├── sqlite-vec ───── semantic search (3ms)
  ├── RRF fusion ───── combines both for best results
  ├── NLI model ────── auto-detects contradictions
  ├── ACT-R model ──── forgets irrelevant, keeps important
  └── Relations ────── updates / extends / contradicts
```

## Features

**Search**
- Hybrid search: FTS5 keyword matching + vector semantic similarity + Reciprocal Rank Fusion
- Local embeddings (bge-small-en-v1.5, 33M, CPU) -- no API calls needed
- Activation-weighted ranking: frequently accessed memories rank higher

**Memory Management**
- Atomic memories: one fact = one memory, not text blobs
- Relational versioning: `updates`, `extends`, `derives`, `contradicts`, `supports`
- Non-destructive: nothing is ever deleted, full history preserved

**Intelligence**
- NLI contradiction detection: auto-detects when new facts contradict existing ones (nli-deberta-v3-xsmall, local)
- Adaptive forgetting: ACT-R-based activation scores, rarely accessed memories fade naturally
- Hierarchical compression: Hot (working memory) / Warm (recent) / Cold (archived)

**Time Model**
- `learnedAt`: when the fact was stored
- `documentDate`: when the conversation happened
- `eventDateStart/End`: when the actual event occurred
- `invalidatedAt`: when a fact became outdated
- Time-aware search filters

**Integration**
- CLI: `memrosetta store/search/ingest` -- works with any tool
- MCP server: Claude Code, Cursor, and any MCP-compatible AI tool
- REST API: for custom integrations
- Obsidian sync: export memories as markdown

## Quick Start

### CLI (simplest)

```bash
npm install -g @memrosetta/cli

memrosetta init
memrosetta store --user alice --content "Prefers TypeScript over JavaScript" --type preference
memrosetta store --user alice --content "Working on a React dashboard project" --type event
memrosetta store --user alice --content "Decided to use Tailwind CSS" --type decision

memrosetta search --user alice --query "tech stack choices" --format text
# [0.95] Decided to use Tailwind CSS (decision, 2026-03-24)
# [0.88] Prefers TypeScript over JavaScript (preference, 2026-03-24)
# [0.72] Working on a React dashboard project (event, 2026-03-24)

memrosetta search --user alice --query "CSS framework" --format text
# [0.91] Decided to use Tailwind CSS (decision, 2026-03-24)
```

### MCP Server (for Claude Code / Cursor)

Add to your project's `.mcp.json`:

```json
{
  "mcpServers": {
    "memrosetta": {
      "command": "npx",
      "args": ["@memrosetta/mcp"],
      "env": {
        "MEMROSETTA_DB": "~/.memrosetta/memories.db"
      }
    }
  }
}
```

Now your AI can directly call:
- `memrosetta_store` -- save important facts during conversation
- `memrosetta_search` -- recall relevant memories from past sessions
- `memrosetta_relate` -- connect related memories
- `memrosetta_working_memory` -- get the most relevant context
- `memrosetta_invalidate` -- mark outdated facts

### As a Library

```typescript
import { SqliteMemoryEngine } from '@memrosetta/core';
import { HuggingFaceEmbedder } from '@memrosetta/embeddings';

const embedder = new HuggingFaceEmbedder();
await embedder.initialize();

const engine = new SqliteMemoryEngine({
  dbPath: './memories.db',
  embedder,
});
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

// Relate memories
await engine.relate(memoryA.memoryId, memoryB.memoryId, 'updates', 'Changed preference');

// Contradiction detection (automatic on store if NLI model loaded)
// Stores "prefers light mode" → auto-creates contradicts relation with "prefers dark mode"

// Working memory (highest priority memories, fits in ~3K tokens)
const context = await engine.workingMemory('alice', 3000);

// Maintenance (recompute activation scores, compress old memories)
await engine.maintain('alice');

await engine.close();
```

## CLI Reference

```
memrosetta init                              Initialize database
memrosetta store                             Store a memory
  --user <id>                                  User identifier (required)
  --content <text>                             Memory content (required)
  --type <fact|preference|decision|event>      Memory type (required)
  --keywords <k1,k2,...>                       Search keywords
  --namespace <ns>                             Category/namespace
  --confidence <0-1>                           Confidence score
  --event-start <ISO date>                     Event start date
  --event-end <ISO date>                       Event end date

memrosetta search                            Search memories
  --user <id>                                  User identifier (required)
  --query <text>                               Search query (required)
  --limit <n>                                  Max results (default: 5)
  --format <json|text>                         Output format
  --namespace <ns>                             Filter by namespace

memrosetta ingest                            Ingest JSONL transcript
  --user <id>                                  User identifier (required)
  --file <path>                                JSONL file path (or stdin)

memrosetta get <memoryId>                    Get memory by ID
memrosetta count --user <id>                 Count memories
memrosetta clear --user <id> --confirm       Clear all user memories
memrosetta relate                            Create relation
  --src <memoryId>                             Source memory
  --dst <memoryId>                             Destination memory
  --type <updates|extends|derives|contradicts|supports>
  --reason <text>                              Optional reason

memrosetta invalidate <memoryId>             Mark memory as outdated
memrosetta working-memory --user <id>        Show working memory
memrosetta maintain --user <id>              Run maintenance (scores + compression)
memrosetta compress --user <id>              Compress cold memories
memrosetta status                            Show database status

Global: --db <path>  --format json|text  --no-embeddings
```

## REST API

```bash
npx @memrosetta/api  # Starts on localhost:3100
```

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/memories` | Store a memory |
| `POST` | `/api/memories/batch` | Batch store (up to 1000) |
| `GET` | `/api/memories/:id` | Get by ID |
| `POST` | `/api/search` | Hybrid search |
| `POST` | `/api/relations` | Create relation |
| `GET` | `/api/memories/count/:userId` | Count |
| `DELETE` | `/api/memories/user/:userId` | Clear user memories |
| `GET` | `/api/health` | Health check |

## Brain-Inspired Architecture

### Hybrid Search (3-stage)

```
Query: "What CSS framework did we choose?"
  │
  ├── FTS5 BM25 ──→ keyword match: "CSS", "framework", "choose"
  ├── Vector KNN ──→ semantic match: similar meaning
  └── RRF Merge ───→ combined ranking (best of both)
      │
      └── Activation Weight ──→ boost frequently used memories
```

### Contradiction Detection

```
Existing: "Our hourly rate is $50"
New:      "Our hourly rate is $40"
  │
  └── NLI model (local, 71M) ──→ contradiction detected (score: 0.93)
      └── Auto-creates: new ──contradicts──→ existing
```

### Memory Tiers (like human memory)

```
Hot  (working memory)  ── always loaded, ~3K tokens
  ↕  high activation
Warm (recent memory)   ── last 30 days
  ↕  activation decays (ACT-R formula)
Cold (long-term)       ── compressed, low activation
```

### Adaptive Forgetting (ACT-R model)

```
activation = sigmoid( ln(sum(t^-0.5)) + salience )

Where t = days since each access

Frequently accessed → high activation → ranks higher in search
Rarely accessed → low activation → fades naturally (never deleted)
```

## Packages

| Package | Description | Size |
|---------|-------------|------|
| `@memrosetta/core` | Memory engine (SQLite + FTS5 + vector + NLI) | Core |
| `@memrosetta/embeddings` | Local embeddings (bge-small-en-v1.5) + NLI contradiction | 33M + 71M models |
| `@memrosetta/cli` | Command-line interface | Thin wrapper |
| `@memrosetta/mcp` | MCP server for AI tool integration | Thin wrapper |
| `@memrosetta/api` | REST API (dev/testing) | Hono |
| `@memrosetta/llm` | LLM provider abstraction (OpenAI/Anthropic) | Optional |
| `@memrosetta/claude-code` | Claude Code hooks adapter | Optional |
| `@memrosetta/obsidian` | Obsidian vault sync | Optional |

## Benchmarks

Evaluated on [LoCoMo](https://github.com/snap-research/locomo) (1,986 QA, 5,882 memories):

| Method | Precision@5 | MRR | Search p50 |
|--------|:-----------:|:---:|:----------:|
| FTS5 only | 0.0006 | 0.0026 | 0.2ms |
| Hybrid (FTS + Vector + RRF) | 0.0013 | 0.0037 | 3.4ms |
| Hybrid + Fact Extraction | **0.0074** | **0.0157** | 3.3ms |

Fact-based extraction shows **+324% MRR improvement**, validating the atomic memory design.

```bash
pnpm bench:sqlite                    # FTS-only
pnpm bench:hybrid                    # Hybrid search
pnpm bench:hybrid --converter fact --llm-provider openai  # With LLM extraction
```

## Development

```bash
git clone https://github.com/obst2580/memrosetta.git
cd memrosetta
pnpm install
pnpm test              # 588 tests
pnpm bench:mock        # Quick benchmark
```

## Roadmap

- [x] Atomic memory CRUD + SQLite + FTS5
- [x] Vector search + hybrid retrieval (RRF)
- [x] NLI contradiction detection (local, no LLM)
- [x] Time model (event dates, invalidation)
- [x] Hierarchical compression (Hot/Warm/Cold)
- [x] Adaptive forgetting (ACT-R activation scores)
- [x] Working memory endpoint
- [x] CLI + REST API + MCP server
- [x] Claude Code integration (hooks)
- [x] Obsidian sync
- [x] Benchmark system (LoCoMo)
- [ ] npm publish
- [ ] Embedding model selection (multilingual, Korean)
- [ ] PostgreSQL adapter (team/server use)
- [ ] Profile builder (stable + dynamic user profiles)

## Why MemRosetta?

| | Mem0 | Zep | Letta | **MemRosetta** |
|---|---|---|---|---|
| Local-first | Cloud | Cloud | Cloud + Local | **Local (SQLite)** |
| LLM dependency | Required | Required | Required | **None (core)** |
| Contradiction detection | No | No | No | **Yes (NLI, local)** |
| Forgetting model | No | No | No | **Yes (ACT-R)** |
| Open protocol | API only | API only | API only | **CLI + MCP + API** |
| Install | Complex | Complex | Complex | **`npm install`** |

## License

[MIT](LICENSE)
