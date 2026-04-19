<p align="center">
  <h1 align="center">MemRosetta</h1>
  <p align="center">Your brain, on every device. One memory shared across all your AI tools and machines.</p>
</p>

> 한국어 버전: [README.ko.md](README.ko.md)

```bash
npm install -g memrosetta && memrosetta init --claude-code
```

---

## Your Brain, Everywhere

```
  +---------------------------+
  |     All Your Devices      |
  +---------------------------+
  |                           |
  |  Home Mac -- Claude Code  |       Every device has its own
  |  Work PC --- Codex        |       local SQLite. Your AI tools
  |  Laptop ---- Cursor       |       store and recall memories
  |  Phone ----- App/Browser  |       through one shared brain.
  |                           |
  +------------+--------------+
               |
               v  (optional sync)
  +---------------------------+
  |     Self-Hosted Hub       |
  |  sync.your-domain.net     |
  +---------------------------+
  |  store / search / recall  |
  |  PostgreSQL op-log        |
  |  push + pull (400/batch)  |
  +------------+--------------+
               |
               v
  +---------------------------+
  |    memrosetta core        |
  |    (LLM-free engine)      |
  +---------------------------+
```

**What you decided at 2 AM on your home Mac? Your work PC's AI assistant knows it the next morning.**

```
Monday — Claude Code on Mac:
  You: "Use OAuth2 with PKCE for auth. JWT refresh tokens rotate."
  Claude: stores decision --> syncs to hub

Tuesday — Codex on Windows at work:
  You: "What's the auth setup?"
  Codex: searches memory --> "OAuth2 with PKCE, JWT rotating refresh."
         Found from Monday. Different machine. Different AI tool. Same brain.
```

**Local-first by default. Optional self-hosted sync for multiple devices. Your memories never leave infrastructure you control.**

---

## The Problem

Every AI tool forgets everything between sessions:

```
Without MemRosetta:
  Session 1: "Our API uses Spring Boot on Azure. Auth is OAuth2 with PKCE."
  Session 2: "What's our tech stack?"  →  AI has no idea

  Session 1: "Let's go with approach B for the auth refactor."
  Session 2: "What did we decide?"     →  Gone

  Session 1: (3 hours debugging) "The fix: set batch size to 4."
  Session 2: (same bug)               →  Starts from scratch
```

You re-explain, re-decide, re-debug. MemRosetta gives any AI tool persistent, searchable long-term memory.

## Quick Start

Requires **Node.js 22+**.

```bash
npm install -g memrosetta
```

```bash
# Base setup: database + MCP server
memrosetta init

# Claude Code: + hooks + CLAUDE.md instructions
memrosetta init --claude-code

# Cursor: + MCP config
memrosetta init --cursor

# Codex: + config.toml + AGENTS.md instructions
memrosetta init --codex

# Gemini: + settings.json + GEMINI.md instructions
memrosetta init --gemini
```

That's it. Restart your tool and it has memory.

## How Claude Code Integration Works

When you run `memrosetta init --claude-code`, three things are set up:

### 1. MCP Server (memory tools for Claude)

Claude gets 8 memory tools it can call during any session:

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

**memrosetta_feedback** -- Records good/bad signals on retrieved memories to tune future ranking.

**memrosetta_reconstruct_recall** (v0.10+) -- Reconstructive recall through the hippocampal
layer. Returns an episode + gist summary reassembled from stored bindings, not raw chunks.

### 2. Stop Hook — structured enforcement, not willpower

When a Claude Code session ends, the Stop hook runs
`memrosetta-enforce-claude-code`, which:

1. Reads the Stop hook event (stdin) and the session transcript (JSONL).
2. Extracts the last assistant turn and normalizes it.
3. Runs an LLM extractor (Claude Haiku → GPT-4o-mini → rule-based fallback →
   none) to decompose the turn into atomic facts.
4. Calls `memrosetta enforce stop`, which stores the resulting memories
   and returns a JSON envelope with `status`, counts, memory ids, and an
   audit footer (`STORED: ...`).
5. Deduplicates: the same session cannot inflate its own memories.

Why hooks instead of instructions in `CLAUDE.md`: instructions that say
"after every turn, decide what to store" only work if the model chooses
to run the checklist. v0.5.0 replaces that willpower loop with a
structural pipeline — capture is a side effect of the session ending,
not a thing the model has to remember to do. `memrosetta init --claude-code`
wires the Stop hook automatically on install.

`@memrosetta/core` remains LLM-free. All model calls live in the hook
layer because the hook caller already pays for them.

### 3. CLAUDE.md Instructions

Adds instructions to your global CLAUDE.md telling Claude:
- When to store memories (decisions, facts, preferences, events)
- When NOT to store (code itself, debugging steps, confirmations)
- How to search past memories when context is missing
- Always include keywords for better search quality

## Works With

All tools on the same device share one SQLite file. With sync enabled, all your devices share the same brain.

```
  Home Mac                              Work PC
  --------                              -------
  Claude Code --+                       Codex ------+
  Cursor -------+--> memories.db        Cursor -----+--> memories.db
  Claude Desktop+         |                         |         |
                          v (sync)                  v (sync)
                    +--sync hub--+
                    | PostgreSQL |
                    +------------+
```

| Tool | MCP | Setup |
|------|:---:|-------|
| Claude Code | Yes | `memrosetta init --claude-code` |
| Claude Desktop | Yes | `memrosetta init` |
| Cursor | Yes | `memrosetta init --cursor` |
| Windsurf | Yes | `memrosetta init` |
| Cline | Yes | `memrosetta init` |
| Codex | Yes | `memrosetta init --codex` |
| Gemini | Yes | `memrosetta init --gemini` |
| Continue | Yes | `memrosetta init` |
| ChatGPT / Copilot | -- | No MCP support. Use CLI or REST API. |

### Cross-Tool, Cross-Device Memory

```
Morning   Home Mac + Claude Code:  debug auth system    --> memories saved + synced
Afternoon Work PC + Codex:         "auth setup?"         --> finds morning's decisions
Evening   Home Mac + Cursor:       refactor middleware   --> full context from both sessions
```

Every decision, fact, and preference follows you. Not through copy-paste, not through markdown files -- through one synchronized memory that every AI tool on every machine can search.

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

The engine handles storage, search, relation expansion, and forgetting -- all locally, with zero API calls. Your AI decides WHAT to store. MemRosetta decides HOW to store and retrieve it.

### Atomic memories + FTS5 + activation-weighted ranking

MemRosetta stores **atomic memories** -- one fact per record, not text chunks -- in a local SQLite database. Retrieval uses SQLite FTS5 (BM25) keyword search, boosted by activation score, recency, relation graph adjacency, and Hebbian co-access edges.

```
Query: "What CSS framework did we choose?"
  |
  +-- FTS5 (BM25)        keyword + content match on memories + keywords
  +-- Activation boost   frequently accessed memories rank higher
  +-- Recency boost      recent memories rank higher (decay 0.99/hr)
  +-- Relation expansion pull in graph-adjacent memories of top hits
  +-- Hebbian co-access  memories recalled together get boosted
```

Vector / embedding-based semantic search was removed in **v0.11** -- the Hugging
Face dependency (~1.5 GB) was eliminated in favor of a pure SQLite install that
stays under 30 MB. FTS5 + activation weighting + Hebbian co-access does the
heavy lifting now.

### Memory Lifecycle

```
Store                      Search                     Maintain
-----                      ------                     --------
Classify (fact/pref/       FTS5 BM25                  Activation scoring
  decision/event)          Activation weighting       (ACT-R model)
Store atomically           Recency boost              Tier compression
autoRelate to neighbors    Relation expansion           Hot  -> always loaded
Link relations             Spreading activation         Warm -> last 30 days
                           Co-access boost              Cold -> compressed
```

### Not Another RAG

| | RAG (chunk-based) | MemRosetta (atomic) |
|---|---|---|
| **Unit** | ~400 token text chunks | One fact = one record |
| **Updates** | Re-index entire document | `updates` relation, old version kept |
| **Retrieval** | Vector similarity only | FTS5 + activation + relation graph + co-access |
| **Time** | None | 4 timestamps per memory |
| **Forgetting** | Everything weighted equally | ACT-R: used more = ranked higher |

## Reconstructive Memory (v0.10+)

In addition to search, v0.10 introduced a reconstructive-recall layer modeled on
hippocampal pattern separation / completion. `memrosetta recall` (CLI) and
`memrosetta_reconstruct_recall` (MCP) let an AI tool pull back a past episode
plus a gist summary, reconstructed from hippocampal bindings rather than raw
text chunks. See [docs/reconstructive-memory-spec.md](docs/reconstructive-memory-spec.md)
for the full spec.

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

**Search** -- SQLite FTS5 (BM25) keyword + content search, boosted by activation score, recency decay, relation-graph expansion, Hebbian co-access, and spreading activation on the memory graph.

**Reconstructive Recall (v0.10+)** -- `memrosetta recall` and the
`memrosetta_reconstruct_recall` MCP tool return a reconstructed episode + gist
from the hippocampal layer, not raw text chunks. Models human pattern
separation / completion.

**Adaptive Forgetting** -- ACT-R activation scoring. Frequently accessed memories rank higher. Unused memories fade but are never deleted.

**Memory Tiers** -- Hot (working memory, ~3K tokens), Warm (last 30 days), Cold (compressed long-term).

**Relations** -- `updates`, `extends`, `derives`, `contradicts`, `supports`. Memories form a graph, not a flat list.

**Time Model** -- Four timestamps: `learnedAt`, `documentDate`, `eventDateStart/End`, `invalidatedAt`.

**Non-destructive** -- Nothing is ever deleted. Old versions are preserved via relations and `isLatest` flags.

**Optional Multi-Device Sync** -- Local-first remains the default. When opted in, each device keeps its SQLite and syncs through an append-only operation log hosted on your own PostgreSQL. CRDT-free, idempotent, works offline.

**100 % local, zero ML dependency (v0.11+).** Install drops from ~1.5 GB to
~30 MB. No Hugging Face, no sqlite-vec, no local inference. FTS5 + activation
+ reconstructive recall is the whole stack.

**950+ tests across 75 test files.**

## MCP Tools

When connected via MCP, your AI tool gets these capabilities:

| Tool | Description |
|------|-------------|
| `memrosetta_store` | Save an atomic memory |
| `memrosetta_search` | FTS5 + activation + relation-expansion search |
| `memrosetta_working_memory` | Get highest-priority context (~3K tokens) |
| `memrosetta_relate` | Link related memories |
| `memrosetta_invalidate` | Mark a memory as outdated |
| `memrosetta_count` | Count stored memories |
| `memrosetta_feedback` | Record retrieval feedback (good/bad) to tune ranking |
| `memrosetta_reconstruct_recall` | Reconstructive recall (v0.10+): episode + gist reassembled from hippocampal bindings |

## REST API

> **Scope note.** `@memrosetta/api` is an **advanced, single-node
> self-host option**, not the recommended deployment model. It runs the
> local SQLite engine behind HTTP for callers on the same machine or
> trusted LAN — useful for connecting web UIs, CRON jobs, or services
> that cannot speak MCP directly.
>
> It is **not** a multi-tenant cloud API. For multi-device access keep
> the local SQLite primary and use the optional sync hub
> (`@memrosetta/sync-server`). A PostgreSQL-backed remote API is a future
> phase, not a current deployment target.

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

15 commands for full memory management. [Full CLI documentation](docs/CLI.md) | [CLI 한국어 문서](docs/CLI.ko.md)

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
| `sync` | Manage optional multi-device sync |

Global flags: `--db <path>` `--format json|text` `--no-embeddings`

## Multi-Device Sync (Optional)

MemRosetta is local-first. The CLI, MCP server, and SQLite engine all run
without any server. If you want the same memory graph across multiple
machines, there are **two paths**:

### Path A: Liliplanet Cloud (managed)

Zero-setup hosted sync. Log in with your existing Google, Kakao, Naver, or
email account. Memories sync automatically across all your devices.

```bash
memrosetta sync login                     # opens browser, log in once
memrosetta sync now                       # push + pull in one command
```

This is the recommended path for most users. The sync hub, database, and
backups are managed for you. A free tier is available; paid plans remove
usage limits.

> Liliplanet Cloud is a hosted convenience service. It is not required to
> use MemRosetta. Your local SQLite file works fully offline without it.

### Path B: Self-Hosted (full control)

Run your own sync hub on your own PostgreSQL. You control the
infrastructure; no external account needed.

```bash
memrosetta sync enable \
  --server https://your-sync-server.example.com \
  --key your-api-key \
  --user alice         # same logical user id on every device
```

See [Self-hosting the sync server](#self-hosting-the-sync-server) below
for setup instructions.

### Shared features (both paths)

- Disabled by default. Existing installs behave exactly as before.
- Every device keeps a full local SQLite copy. Sync is an append-only
  operation log — works offline, pushes when connected.
- **Genuinely bidirectional since v0.4.6.** `pull()` writes remote ops
  into your local `memories` graph, not just an inbox, so memories
  created on another device become searchable immediately after a pull.
- **All write paths participate since v0.4.7.** CLI `store / relate /
  invalidate / feedback` and the MCP adapter all enqueue ops to the
  sync outbox after the local SQLite write succeeds.
- **Same person, different OS usernames.** Use the same `--user <id>`
  (self-host) or log in with the same account (cloud) so all devices
  end up on the same sync partition.

### Enable sync (self-host, API key)

```bash
# 1. Set the key (pick the one that fits your environment)

# Option A — env variable (recommended for Windows PowerShell / CI)
export MEMROSETTA_SYNC_API_KEY="your-api-key"
memrosetta sync enable \
  --server https://your-sync-server.example.com \
  --user alice         # shared logical user id — use the SAME value on every device you own

# Option B — read from a file (never appears in shell history)
memrosetta sync enable \
  --server https://your-sync-server.example.com \
  --key-file /path/to/key

# Option C — inline (visible in history)
memrosetta sync enable \
  --server https://your-sync-server.example.com \
  --key your-api-key

# Option D — pipe via stdin (POSIX shells)
echo "your-api-key" | memrosetta sync enable \
  --server https://your-sync-server.example.com \
  --key-stdin
```

The flags are **mutually exclusive** — pass exactly one of `--key`,
`--key-stdin`, or `--key-file`, or set `MEMROSETTA_SYNC_API_KEY`. On a POSIX
TTY with none of the above, `sync enable` falls back to a hidden prompt.

### Inspect and operate

```bash
memrosetta sync status --format text   # enabled, cursor, pending ops, last push/pull
memrosetta sync now                    # push then pull right now
memrosetta sync now --push-only        # push only
memrosetta sync device-id               # print the local device id
memrosetta sync backfill --dry-run      # preview one-shot enqueue of existing local history
memrosetta sync backfill                # enqueue existing memories/relations into outbox
memrosetta sync disable                 # stop syncing (keeps config)
```

Use `sync backfill` once on a device that already had local memories before
you enabled sync. It enqueues the current SQLite contents into the outbox; it
does not push automatically, so run `memrosetta sync now` after the enqueue
step. `--dry-run` shows how many memories and relations would be queued.

Since v0.4.8, backfill is **idempotent**: op ids are derived deterministically
from `sha256(memory_id)` / `sha256(src|dst|type)`, and the outbox inserts use
`INSERT OR IGNORE`, so re-running `sync backfill` on the same device is a
no-op at every layer (local outbox, server op log, downstream inboxes).

### Self-hosting the sync server

The server is a Hono app that writes an append-only op log into any
PostgreSQL 15+ database. See [docs/sync-architecture.md](docs/sync-architecture.md)
for the full architecture and [docs/sync-api.md](docs/sync-api.md) for the
push/pull protocol.

Minimum runtime setup:

1. Create an empty PostgreSQL database.
2. Set `DATABASE_URL` and `MEMROSETTA_API_KEYS` (one or more comma-separated
   API keys).
3. Start `@memrosetta/sync-server` (Node 22+). It auto-runs the migration in
   `@memrosetta/postgres/migrations` on first start.

Verify with `GET /sync/health` — expect `{"status":"ok","db":"ok"}`.

> **Important:** `@memrosetta/sync-server` and `@memrosetta/postgres` are
> currently pre-1.0 (0.1.x). They are not published to the `latest` npm tag
> yet. Build them from the monorepo or pin explicitly until they stabilize.

## As a Library

```typescript
import { SqliteMemoryEngine } from '@memrosetta/core';

const engine = new SqliteMemoryEngine({ dbPath: './memories.db' });
await engine.initialize();

// Store
await engine.store({
  userId: 'alice',
  content: 'Prefers dark mode in all applications',
  memoryType: 'preference',
  keywords: ['dark-mode', 'ui'],
});

// Search (FTS5 BM25 + activation + relation expansion)
const results = await engine.search({
  userId: 'alice',
  query: 'UI theme preference',
  limit: 5,
});

// Relate
await engine.relate(memA.memoryId, memB.memoryId, 'updates', 'Changed preference');

// Working memory (~3K tokens of highest-priority context)
const context = await engine.workingMemory('alice', 3000);

// Reconstructive recall (v0.10+)
const recalled = await engine.reconstructRecall('alice', 'auth decisions');

// Maintenance (recompute activation scores, compress old memories)
await engine.maintain('alice');

await engine.close();
```

## Language Support

SQLite FTS5 handles any language out of the box. For Korean queries MemRosetta
applies natural-language FTS5 preprocessing (added in v0.5.2); no language
flag is required. Vector/embedding-based language models were removed in v0.11.

## Packages

| Package | Description |
|---------|-------------|
| `@memrosetta/core` | Memory engine: SQLite + FTS5 + relation graph + reconstructive recall. Zero LLM, zero ML deps. |
| `@memrosetta/cli` | Command-line interface (22 commands including `recall`, `search`, `sync`) |
| `@memrosetta/mcp` | MCP server for AI tool integration (8 tools) |
| `@memrosetta/api` | REST API (Hono) -- single-node self-host, not a multi-tenant cloud API |
| `@memrosetta/claude-code` | Claude Code integration (hooks + init) |
| `@memrosetta/llm` | LLM-based fact extraction (OpenAI/Anthropic) -- optional |
| `@memrosetta/sync-client` | Local outbox/inbox for optional multi-device sync |
| `@memrosetta/sync-server` | Self-hostable Hono sync hub (pre-1.0, not on `latest`) |
| `@memrosetta/postgres` | PostgreSQL adapter for the sync hub (pre-1.0, not on `latest`) |

## Benchmarks

Evaluated on [LoCoMo](https://github.com/snap-research/locomo) (1,986 QA pairs, 5,882 memories):

| Method | Precision@5 | MRR | Latency (p50) | LLM Required |
|--------|:-----------:|:---:|:-------------:|:------------:|
| FTS5 only | 0.0087 | 0.0298 | 0.4ms | No |
| **FTS + Fact Extraction** | **0.0311** | **0.0572** | **4.0ms** | **Yes (external)** |

On LoCoMo's conversation-turn data, FTS5 keyword matching provides the no-LLM
baseline. Fact extraction (atomic memory pre-processing) delivers the highest
accuracy with **single-hop 23.8%**.

Fact extraction uses an external LLM (e.g., OpenAI, Anthropic) to pre-process
conversation transcripts into atomic facts before storage. The core search
engine operates without any LLM.

> Hybrid vector+FTS benchmarks were retired in v0.11 when Hugging Face
> embeddings were removed. Legacy numbers are preserved in git history.

```bash
pnpm bench:sqlite                    # FTS only
pnpm bench:sqlite --converter fact --llm-provider openai  # With LLM extraction
```

## Comparison

| | Mem0 | Zep | Letta | **MemRosetta** |
|---|---|---|---|---|
| Runs locally | Cloud | Cloud | Cloud + Local | **SQLite, no server** |
| Core LLM dep | Yes | Yes | Yes | **None (AI tool is the client)** |
| Reconstructive recall | No | No | No | **Yes (hippocampal, v0.10+)** |
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
pnpm test              # 950+ tests across 75 test files
pnpm bench:mock        # Quick benchmark (no LLM needed)
```

> On a clean clone, `pnpm test` automatically runs `pnpm build` first so that
> workspace packages (`@memrosetta/types`, `@memrosetta/core`, etc.) are compiled
> before tests reference their `dist/` exports. If you only want to re-run tests
> without rebuilding, use `pnpm test:only`.

See [CONTRIBUTING.md](CONTRIBUTING.md) for contribution guidelines.

## Roadmap

- [x] Atomic memory CRUD + SQLite + FTS5
- [x] Time model (4 timestamps, invalidation)
- [x] Hierarchical compression (Hot/Warm/Cold)
- [x] Adaptive forgetting (ACT-R)
- [x] Working memory endpoint
- [x] CLI + REST API + MCP server
- [x] Claude Code integration
- [x] LoCoMo benchmarks
- [x] Codex integration
- [x] Gemini integration
- [x] CI pipeline (build + typecheck + test)
- [x] Optional multi-device sync (self-hosted op log hub)
- [x] Bidirectional sync (pull applies ops into the local graph, v0.4.6)
- [x] CLI write paths participate in sync (v0.4.7)
- [x] Shared `syncUserId` across a user's devices (v0.4.5)
- [x] Deterministic, idempotent backfill (v0.4.8)
- [x] Structural memory capture via `memrosetta enforce` + Stop hook (v0.5.0)
- [x] Sync push chunking for large backfills (v0.5.0)
- [x] Codex CLI Stop hook auto-registration (v0.5.1)
- [x] Canonical `user_id` migration + `duplicates report` (v0.5.2)
- [x] Korean natural-language FTS5 preprocessing (v0.5.2)
- [x] Pull pagination for large sync backlogs (v0.5.3)
- [x] Context-Dependent Retrieval + Hebbian Co-access (v0.7.0)
- [x] Spreading Activation Lite on relation + co-access graph (v0.8.0)
- [x] Liliplanet JWT auth integration + landing page redesign (v0.9.0)
- [x] Recency boost + autoRelate expansion + duplicate collapse (v0.9.1)
- [x] Reconstructive Memory kernel — Layer A + Layer B scaffolding (v0.10.0)
- [x] `memrosetta recall` + MCP `reconstruct_recall` + v1.0 benchmark suite (v0.10.0)
- [x] **Hugging Face removal — Core is 100% LLM-free + offline, 1.5 GB → 30 MB install** (v0.11.0)
- [x] Recall self-healing empty episodic layer (v0.12.0)
- [x] Status readiness scoring with user-scoped counts (v0.12.1 – v0.12.2)
- [ ] Sync server 1.0 (promotion from 0.1.x after production validation)
- [ ] Profile builder (stable + dynamic user profiles)
- [ ] Stable/volatile memory classification
- [ ] Ingest pipeline (URL, PDF, transcript extraction)
- [ ] Wiki synthesis (periodic cron-based summarization)
- [ ] Mobile/web client for browser-based recall

## Architecture Overview

```
+------------------------------------------------------------------+
|                        Your Devices                               |
+------------------------------------------------------------------+
|  Mac (Claude Code, Cursor)  |  PC (Codex, Cursor)  |  Phone/Web  |
+-----------------------------+----------------------+-------------+
              |                          |                   |
              v                          v                   v
       +-------------+          +-------------+      +-----------+
       | MCP Server  |          | MCP Server  |      | REST API  |
       | (8 tools)   |          | (8 tools)   |      | (Hono)    |
       +------+------+          +------+------+      +-----+-----+
              |                          |                   |
              v                          v                   v
       +-------------+          +-------------+      +-----------+
       | SQLite      |          | SQLite      |      | SQLite    |
       | memories.db |          | memories.db |      | or PG     |
       +------+------+          +------+------+      +-----------+
              |                          |
              +----------+   +-----------+
                         |   |
                         v   v
                 +------------------+
                 |   Sync Hub       |
                 |   (self-hosted)  |
                 +------------------+
                 | PostgreSQL       |
                 | push/pull ops    |
                 | 500/batch server |
                 | 400/batch client |
                 +------------------+
                         |
                         v
                 +------------------+
                 | memrosetta core  |
                 +------------------+
                 | SQLite + FTS5    |
                 | Relation graph   |
                 | Hebbian coaccess |
                 | Reconstructive   |
                 |   recall (v0.10) |
                 | ACT-R forgetting |
                 | Hot/Warm/Cold    |
                 | 0 LLM calls      |
                 +------------------+
```

### Package Structure

| Package | Role |
|---------|------|
| `@memrosetta/core` | Memory engine: store, search, relate, compress, reconstructive recall. SQLite + FTS5 + relation graph. Zero LLM, zero ML deps. |
| `@memrosetta/cli` | CLI tool (22 commands): store, search, recall, relate, maintain, compress, ingest, sync, migrate, dedupe, duplicates, feedback, update, enforce, init/reset, status, clear, count, get, invalidate, working-memory. |
| `@memrosetta/mcp` | MCP server: 8 tools (store, search, working_memory, relate, invalidate, count, feedback, reconstruct_recall). |
| `@memrosetta/sync-client` | Local-first sync: outbox/inbox in SQLite, push/pull through your sync hub. |
| `@memrosetta/sync-server` | Self-hosted hub: Hono + PostgreSQL, op-log replication, cursor-based pagination. |
| `@memrosetta/api` | REST API: Hono HTTP server for same-machine or LAN access. |
| `@memrosetta/types` | Shared TypeScript interfaces. |
| `memrosetta` | Umbrella npm package: installs core + cli + mcp + all binaries. |

### Design Principles

1. **Core is LLM-free.** The memory engine never calls an API. Memory extraction is the client's job. Your AI tool decides what to store; MemRosetta decides how to store and retrieve it.
2. **Local-first.** Everything works offline with one SQLite file. Sync is opt-in. Your data never leaves your infrastructure.
3. **Non-destructive.** Nothing is ever hard-deleted. Old versions live behind `isLatest` flags and relation edges. `invalidatedAt` marks retired facts.
4. **Neuroscience-inspired.** Storage, association, compression, and forgetting mirror how human memory works: ACT-R activation decay, hierarchical consolidation (Hot/Warm/Cold), working memory as a priority window.
5. **One identity, all devices.** A canonical `syncUserId` follows you across machines. Pin it once, and every AI tool on every device writes to the same brain.

## License

[MIT](LICENSE)
