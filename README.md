<p align="center">
  <h1 align="center">MemRosetta</h1>
  <p align="center">Persistent memory for AI tools. One SQLite file. Zero cloud.</p>
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

## Features

**Search** -- Hybrid retrieval combining FTS5 (BM25), vector similarity (bge-small-en-v1.5), and Reciprocal Rank Fusion.

**Contradiction Detection** -- Local NLI model (nli-deberta-v3-xsmall, 71MB) automatically detects when new facts contradict existing ones.

**Adaptive Forgetting** -- ACT-R activation scoring. Frequently accessed memories rank higher. Unused memories fade but are never deleted.

**Memory Tiers** -- Hot (working memory, ~3K tokens), Warm (last 30 days), Cold (compressed long-term).

**Relations** -- `updates`, `extends`, `derives`, `contradicts`, `supports`. Memories form a graph, not a flat list.

**Time Model** -- Four timestamps: `learnedAt`, `documentDate`, `eventDateStart/End`, `invalidatedAt`.

**Non-destructive** -- Nothing is ever deleted. Old versions are preserved via relations and `isLatest` flags.

**588+ tests.**

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

## CLI Reference

<details>
<summary>Full CLI commands</summary>

```
memrosetta init [options]                Initialize database and integrations
  --claude-code                            + Claude Code hooks + CLAUDE.md
  --cursor                                 + Cursor MCP config
  --mcp                                    + MCP server config only

memrosetta store                         Store a memory
  --user <id>                              User identifier
  --content <text>                         Memory content
  --type <fact|preference|decision|event>  Memory type
  --keywords <k1,k2>                       Search keywords
  --namespace <ns>                         Category
  --confidence <0-1>                       Confidence score

memrosetta search                        Search memories
  --user <id>                              User identifier
  --query <text>                           Search query
  --limit <n>                              Max results (default: 5)
  --format <json|text>                     Output format

memrosetta get <memoryId>                Get memory by ID
memrosetta count --user <id>             Count memories
memrosetta relate                        Create relation between memories
  --src <id> --dst <id>
  --type <updates|extends|derives|contradicts|supports>
memrosetta invalidate <memoryId>         Mark memory as outdated
memrosetta working-memory --user <id>    Get working memory context
memrosetta maintain --user <id>          Run maintenance (scores + compression)
memrosetta compress --user <id>          Compress cold memories
memrosetta ingest --user <id> --file <path>  Ingest JSONL transcript
memrosetta status                        Show status
memrosetta clear --user <id> --confirm   Clear all user memories
memrosetta reset --claude-code           Remove Claude Code integrations
memrosetta reset --all                   Remove everything

Global flags: --db <path>  --format json|text  --no-embeddings
```

</details>

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
| `@memrosetta/obsidian` | Obsidian vault sync |

## Benchmarks

Evaluated on [LoCoMo](https://github.com/snap-research/locomo) (1,986 QA pairs, 5,882 memories):

| Method | Precision@5 | MRR | Latency (p50) |
|--------|:-----------:|:---:|:-------------:|
| FTS5 only | 0.0006 | 0.0026 | 0.2ms |
| Hybrid (FTS + Vector + RRF) | 0.0013 | 0.0037 | 3.4ms |
| **Hybrid + Fact Extraction** | **0.0074** | **0.0157** | 3.3ms |

Atomic memory with fact extraction delivers **+324% MRR** over hybrid-only, validating the atomic memory design over chunk-based RAG.

```bash
pnpm bench:sqlite                    # FTS only
pnpm bench:hybrid                    # Hybrid search
pnpm bench:hybrid --converter fact --llm-provider openai  # With LLM extraction
```

## Comparison

| | Mem0 | Zep | Letta | **MemRosetta** |
|---|---|---|---|---|
| Runs locally | Cloud | Cloud | Cloud + Local | **SQLite, no server** |
| LLM required | Yes | Yes | Yes | **No** |
| Contradiction detection | No | No | No | **Yes (NLI, local)** |
| Forgetting model | No | No | No | **Yes (ACT-R)** |
| Time model | No | No | No | **4 timestamps** |
| Relational versioning | No | No | No | **5 relation types** |
| Protocol | REST API | REST API | REST API | **MCP + CLI + REST** |
| Setup | Complex | Complex | Complex | **One command** |

## Development

```bash
git clone https://github.com/obst2580/memrosetta.git
cd memrosetta
pnpm install
pnpm test              # 588+ tests
pnpm bench:mock        # Quick benchmark (no LLM needed)
```

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
- [x] Obsidian sync
- [x] LoCoMo benchmarks
- [ ] Multilingual embeddings (Korean, Japanese, etc.)
- [ ] PostgreSQL adapter (team/server use)
- [ ] Profile builder (stable + dynamic user profiles)

## License

[MIT](LICENSE)
