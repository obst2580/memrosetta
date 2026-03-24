# MemRosetta

**Your AI keeps forgetting. MemRosetta fixes that.**

Every time you start a new AI session, context is lost. You re-explain the same things, re-make the same decisions, re-discover the same solutions. MemRosetta gives your AI tools persistent, searchable long-term memory that survives across sessions.

> Memory + Rosetta: Just as the Rosetta Stone unlocked ancient writing, MemRosetta unlocks AI memory.

## The Problem

```
Session 1: "Our API uses Spring Boot with PostgreSQL, deployed on Azure..."
Session 2: "What tech stack are we using?"  <- AI has no idea

Session 1: "Let's go with approach B for the auth system"
Session 2: "What did we decide about auth?"  <- Lost forever

Session 1: (3 hours of debugging) "The fix was changing the batch size to 4"
Session 2: (same bug) starts from scratch
```

## Quick Start

### Claude Code (recommended)

One command sets up everything:

```bash
npx @memrosetta/claude-code init
```

```
MemRosetta initialized successfully.

  What was set up:
  ----------------------------------------
  Config:     ~/.memrosetta/config.json
  Database:   ~/.memrosetta/memories.db
  Stop Hook:  ~/.claude/settings.json (auto-save on session end)
  CLAUDE.md:  ~/.claude/CLAUDE.md (memory instructions for Claude)
  MCP Server: ~/.mcp.json (search past memories)

  Restart Claude Code to activate.
```

That's it. Restart Claude Code and your AI remembers everything.

### How It Works with Claude Code

```
During session (Claude Code = LLM)
  |
  |  Claude encounters important fact/decision/preference
  |  -> stores it via MCP (mcp__memory-service__memrosetta_store)
  |
  |  Claude needs info not in current context
  |  -> searches past memories via MCP (mcp__memory-service__memrosetta_search)
  |
  v  Session ends
  |
  +-- [Stop Hook] backup extraction from transcript
  |   -> LLM-based (if API key available) or rule-based (fallback)
  |
  v
 ~/.memrosetta/memories.db (shared across all sessions)
```

Three layers of memory, in priority order:

| Layer | When | How | Quality |
|-------|------|-----|---------|
| **Claude stores directly** | During session | MCP store (Claude is the LLM) | Best -- full context understanding |
| **Stop Hook + LLM** | Session end | Transcript -> LLM extraction | Good (needs API key) |
| **Stop Hook + rules** | Session end | Transcript -> pattern matching | Basic (no API key needed) |

To check status or remove:

```bash
npx @memrosetta/claude-code status   # Show what's configured
npx @memrosetta/claude-code reset    # Remove all integrations
```

### Cursor / Other MCP-compatible tools

Add to your `.mcp.json`:

```json
{
  "mcpServers": {
    "memory-service": {
      "command": "npx",
      "args": ["-y", "@memrosetta/mcp"]
    }
  }
}
```

Available MCP tools:
- `memrosetta_search` -- search past memories with hybrid search
- `memrosetta_store` -- save an atomic memory
- `memrosetta_working_memory` -- get highest-priority context
- `memrosetta_relate` -- link related memories
- `memrosetta_invalidate` -- mark outdated facts
- `memrosetta_count` -- count stored memories

### CLI

```bash
npm install -g @memrosetta/cli

memrosetta store --user alice --content "Prefers TypeScript over JavaScript" --type preference
memrosetta store --user alice --content "Decided to use Tailwind CSS" --type decision

memrosetta search --user alice --query "tech stack choices" --format text
# [0.95] Decided to use Tailwind CSS (decision, 2026-03-24)
# [0.88] Prefers TypeScript over JavaScript (preference, 2026-03-24)
```

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
// Stores "prefers light mode" -> auto-creates contradicts relation with "prefers dark mode"

// Working memory (highest priority memories, fits in ~3K tokens)
const context = await engine.workingMemory('alice', 3000);

// Maintenance (recompute activation scores, compress old memories)
await engine.maintain('alice');

await engine.close();
```

## How It Works

MemRosetta stores **atomic memories** (one fact = one memory) in a local SQLite database and retrieves them using hybrid search (keywords + semantic similarity). No server, no cloud, no API keys required for core functionality.

```
Query: "What CSS framework did we choose?"
  |
  +-- FTS5 BM25 --> keyword match: "CSS", "framework", "choose"
  +-- Vector KNN --> semantic match: similar meaning
  +-- RRF Merge --> combined ranking (best of both)
      |
      +-- Activation Weight --> boost frequently used memories
```

### Not Another RAG

Traditional RAG chops documents into text chunks and searches by similarity. MemRosetta is fundamentally different:

| | RAG (chunk-based) | MemRosetta (atomic) |
|---|---|---|
| **Storage unit** | ~400 token text chunks | One fact = one memory |
| **Updates** | Re-index entire document | `updates` relation, old version preserved |
| **Contradictions** | Both versions returned, AI guesses | Auto-detected by NLI model |
| **Time awareness** | When was this said? No idea | 4 timestamps: learned, documented, event, invalidated |
| **Forgetting** | Everything equal weight | ACT-R: frequently used memories rank higher |

### Memory Lifecycle

```
Information arrives
  |
  +-- Classify: fact / preference / decision / event
  +-- Store as atomic memory with keywords + timestamps
  +-- Check contradictions (NLI model, local)
  |     -> auto-creates 'contradicts' relation if found
  |
  v
Search & Retrieval
  |
  +-- Hybrid search (FTS5 + vector + RRF)
  +-- Activation weighting (frequently accessed = higher rank)
  |
  v
Memory Tiers
  Hot  (working memory) -- always loaded, ~3K tokens
    |  high activation
  Warm (recent memory)  -- last 30 days
    |  activation decays (ACT-R: sigmoid(ln(sum(t^-0.5)) + salience))
  Cold (long-term)      -- compressed, low activation
```

### Relations

Memories are not isolated. They form a graph:

```
"Hourly rate is $50"  --[contradicts]--> "Hourly rate is $40"
"Uses React 18"       --[updates]------> "Uses React 19"
"Chose PostgreSQL"    --[derives]------> "Need pgvector extension"
"Prefers dark mode"   --[supports]-----> "Uses Dracula theme"
```

Relation types: `updates`, `extends`, `derives`, `contradicts`, `supports`

### Time Model

Four timestamps per memory, each serving a different purpose:

| Timestamp | Question it answers | Example |
|-----------|-------------------|---------|
| `learnedAt` | When was this stored? | 2026-03-24T12:00:00Z |
| `documentDate` | When did the conversation happen? | 2026-03-24 |
| `eventDateStart/End` | When did the actual event occur? | Meeting on 2026-03-20 |
| `invalidatedAt` | When did this become outdated? | Deprecated on 2026-04-01 |

## Packages

| Package | Description |
|---------|-------------|
| `@memrosetta/core` | Memory engine (SQLite + FTS5 + vector + NLI) |
| `@memrosetta/embeddings` | Local embeddings (bge-small-en-v1.5, 33M) + NLI contradiction (71M) |
| `@memrosetta/llm` | LLM fact extraction (OpenAI/Anthropic) -- optional |
| `@memrosetta/cli` | Command-line interface |
| `@memrosetta/mcp` | MCP server for AI tool integration |
| `@memrosetta/api` | REST API (Hono) |
| `@memrosetta/claude-code` | Claude Code integration (hooks + init) |
| `@memrosetta/obsidian` | Obsidian vault sync |

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

## Benchmarks

Evaluated on [LoCoMo](https://github.com/snap-research/locomo) (1,986 QA, 5,882 memories):

| Method | Precision@5 | MRR | Search p50 |
|--------|:-----------:|:---:|:----------:|
| FTS5 only | 0.0006 | 0.0026 | 0.2ms |
| Hybrid (FTS + Vector + RRF) | 0.0013 | 0.0037 | 3.4ms |
| Hybrid + Fact Extraction | **0.0074** | **0.0157** | 3.3ms |

Atomic memory + fact extraction = **+324% MRR improvement** over hybrid-only, validating the atomic memory design over traditional chunk-based RAG.

```bash
pnpm bench:sqlite                    # FTS-only
pnpm bench:hybrid                    # Hybrid search
pnpm bench:hybrid --converter fact --llm-provider openai  # With LLM extraction
```

## Why MemRosetta?

| | Mem0 | Zep | Letta | **MemRosetta** |
|---|---|---|---|---|
| Local-first | Cloud | Cloud | Cloud + Local | **Local (SQLite)** |
| LLM dependency | Required | Required | Required | **None (core)** |
| Contradiction detection | No | No | No | **Yes (NLI, local)** |
| Forgetting model | No | No | No | **Yes (ACT-R)** |
| Time model | No | No | No | **Yes (4 timestamps)** |
| Relational versioning | No | No | No | **Yes (5 relation types)** |
| Open protocol | API only | API only | API only | **CLI + MCP + API** |
| Install | Complex | Complex | Complex | **One command** |

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
- [x] Claude Code integration (hooks + MCP + CLAUDE.md)
- [x] Obsidian sync
- [x] Benchmark system (LoCoMo)
- [x] npm publish (@memrosetta/* v0.1.x)
- [ ] Embedding model selection (multilingual, Korean)
- [ ] PostgreSQL adapter (team/server use)
- [ ] Profile builder (stable + dynamic user profiles)

## License

[MIT](LICENSE)
