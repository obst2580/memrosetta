# MemRosetta

AI long-term memory engine. Brain-inspired architecture. Open source.

> Memory + Rosetta: Just as the Rosetta Stone was the key to ancient writing, MemRosetta is the key to AI memory.

## What is MemRosetta?

MemRosetta is a local-first memory engine that stores, connects, and retrieves knowledge for AI applications. It runs entirely on your machine with no external dependencies beyond npm.

**Core principle:** The engine stores and searches memories. It does not depend on any LLM — fact extraction is the client's responsibility.

## Features

- **Atomic memories** — One fact = one memory. Not text blobs, but independent knowledge units.
- **Hybrid search** — FTS5 keyword search + vector similarity + Reciprocal Rank Fusion.
- **Relational versioning** — `updates`, `extends`, `derives`, `contradicts`, `supports` relations between memories. Non-destructive: nothing is deleted, history is preserved.
- **Local embeddings** — all-MiniLM-L6-v2 runs on CPU. No API calls for search.
- **SQLite storage** — Single file database. `npm install` and go.
- **CLI interface** — `memrosetta store`, `search`, `ingest` from any tool or script.

## Quick Start

```bash
# Install
npm install @memrosetta/core @memrosetta/cli

# Initialize database
memrosetta init

# Store a memory
memrosetta store --user alice --content "Prefers TypeScript over JavaScript" --type preference

# Search
memrosetta search --user alice --query "programming language preference" --format text
# [0.92] Prefers TypeScript over JavaScript (preference, 2026-03-24)

# Store more and build connections
memrosetta store --user alice --content "Started a new React project" --type event
memrosetta relate --src mem-xxx --dst mem-yyy --type extends
```

## Packages

| Package | Description |
|---------|-------------|
| `@memrosetta/core` | Memory engine — SQLite + FTS5 + vector search |
| `@memrosetta/embeddings` | Local sentence embeddings (all-MiniLM-L6-v2) |
| `@memrosetta/cli` | Command-line interface |
| `@memrosetta/api` | REST API server (development/testing) |
| `@memrosetta/llm` | LLM provider abstraction for fact extraction |
| `@memrosetta/claude-code` | Claude Code integration (hooks) |

## Use as a Library

```typescript
import { SqliteMemoryEngine } from '@memrosetta/core';
import { HuggingFaceEmbedder } from '@memrosetta/embeddings';

// Initialize with embeddings for hybrid search
const embedder = new HuggingFaceEmbedder();
await embedder.initialize();

const engine = new SqliteMemoryEngine({
  dbPath: './memories.db',
  embedder,
});
await engine.initialize();

// Store
const memory = await engine.store({
  userId: 'alice',
  content: 'Prefers dark mode in all applications',
  memoryType: 'preference',
  keywords: ['dark-mode', 'ui'],
});

// Search (hybrid: keyword + semantic)
const results = await engine.search({
  userId: 'alice',
  query: 'UI theme preference',
});

// Connect memories
await engine.relate(memory.memoryId, otherMemory.memoryId, 'updates', 'Changed preference');

// Clean up
await engine.close();
```

## CLI Commands

```
memrosetta init                  Initialize database
memrosetta store                 Store a memory
memrosetta search                Search memories
memrosetta ingest                Ingest conversation from JSONL
memrosetta get <memoryId>        Get memory by ID
memrosetta count --user <id>     Count memories
memrosetta clear --user <id>     Clear user memories
memrosetta relate                Create relation between memories
memrosetta status                Show database status
```

Global options: `--db <path>`, `--format json|text`, `--no-embeddings`

## REST API

For development and testing, a REST API is available:

```bash
npm install @memrosetta/api
PORT=3100 npx memrosetta-api
```

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/memories` | Store a memory |
| POST | `/api/memories/batch` | Batch store |
| GET | `/api/memories/:id` | Get by ID |
| POST | `/api/search` | Hybrid search |
| POST | `/api/relations` | Create relation |
| GET | `/api/memories/count/:userId` | Count |
| DELETE | `/api/memories/user/:userId` | Clear user |
| GET | `/api/health` | Health check |

The API binds to `127.0.0.1` by default. Set `HOST=0.0.0.0` to expose on the network (add authentication first).

## Claude Code Integration

```bash
npm install -g @memrosetta/claude-code
memrosetta init
```

This registers hooks in Claude Code that automatically:
- **Save memories** when a session ends (Stop hook)
- **Recall relevant memories** when you type a prompt (UserPromptSubmit hook)

## Architecture

```
Client (your app, Claude Code, scripts)
  │
  │  store(memory)    search(query)    relate(a, b)
  ▼
MemRosetta Core (no LLM dependency)
  ├── SQLite + FTS5 (keyword search)
  ├── sqlite-vec (vector similarity)
  ├── Reciprocal Rank Fusion (hybrid ranking)
  └── Relation graph (updates/extends/contradicts)
```

## Search Strategy

MemRosetta uses a three-stage hybrid search:

1. **FTS5 BM25** — Keyword matching with TF-IDF ranking
2. **Vector KNN** — Semantic similarity via local embeddings
3. **RRF Merge** — Reciprocal Rank Fusion combines both result sets

Use `--no-embeddings` for keyword-only search (faster, no model download).

## Benchmarks

Evaluated on the [LoCoMo](https://github.com/snap-research/locomo) dataset (1,986 QA, 5,882 memories):

| Method | Precision@5 | MRR | Search p50 |
|--------|:-----------:|:---:|:----------:|
| FTS5 only | 0.0006 | 0.0026 | 0.2ms |
| Hybrid (FTS + Vector + RRF) | 0.0013 | 0.0037 | 3.4ms |
| Hybrid + Fact Extraction | 0.0074 | 0.0157 | 3.3ms |

Fact-based extraction shows **+324% MRR improvement** over turn-based storage, validating the atomic memory design.

Run benchmarks yourself:

```bash
pnpm bench:sqlite          # FTS-only
pnpm bench:hybrid          # Hybrid search
pnpm bench:hybrid --converter fact --llm-provider openai  # With fact extraction
```

## Development

```bash
git clone https://github.com/obst2580/memrosetta.git
cd memrosetta
pnpm install
pnpm test          # 427 tests
pnpm bench:mock    # Quick benchmark validation
```

## Roadmap

- [x] Atomic memory CRUD + SQLite + FTS5
- [x] Vector search + hybrid retrieval (RRF)
- [x] Benchmark system (LoCoMo)
- [x] LLM fact extraction (OpenAI/Anthropic providers)
- [x] REST API + CLI
- [x] Claude Code plugin
- [ ] Contradiction detection (NLI model)
- [ ] Time model (valid_from/to, invalidation)
- [ ] Compression (Hot/Warm/Cold tiers)
- [ ] Adaptive forgetting (activation scores)
- [ ] MCP server
- [ ] Obsidian sync

## License

[MIT](LICENSE)
