# MemRosetta Decisions Log

## 2026-03-23: Benchmark System Architecture

### Decision: Benchmark-First Development
- Build benchmark infrastructure before core engine
- Core interfaces defined in `packages/types`, benchmarks test against them
- Mock engine validates infrastructure without real core

### Decision: IMemoryEngine Interface Scope
- Include all: `store`, `storeBatch`, `search`, `getById`, `relate`, `count`, `clear`
- Reason: benchmarks need bulk ingest (`storeBatch`), reset between runs (`clear`), count verification (`count`)

### Decision: LoCoMo Conversion Strategy
- Phase 1: Turn-based conversion (each dialogue turn = 1 memory, no LLM needed)
- Phase 2: Fact-based extraction (LLM-assisted, for comparison)
- Reason: Turn-based is the simplest baseline; difference vs fact-based itself is meaningful data

### Decision: QA Evaluation
- Default: Exact Match + F1 (free, fast, deterministic)
- Optional: LLM-as-Judge via `--llm-judge` flag
- Reason: Avoid LLM cost/inconsistency for routine benchmarking

### Decision: Phase 2+ Benchmarks
- LongMemEval, BEIR, MemoryAgentBench: interface stubs only
- Implement when core engine reaches Phase 2+

### Decision: Tech Stack (Benchmarks)
- TypeScript 5.x, Vitest, tsup, zod, citty (CLI)
- Monorepo: pnpm workspaces

## 2026-03-23: Core Engine Architecture (Phase 1 MVP)

### Decision: SQLite Library -- better-sqlite3
- Synchronous API wrapped in async IMemoryEngine interface
- Reason: Fastest Node.js SQLite binding, native FTS5 support, no async overhead

### Decision: FTS5 Search Strategy
- content-sync mode with triggers (INSERT/DELETE/UPDATE auto-sync)
- BM25 ranking: content weight=1.0, keywords weight=0.5
- Query preprocessing: tokenize -> quote each token -> join with OR
- Score normalization: min-max within result set -> 0-1 range

### Decision: Memory ID -- nanoid
- Format: `mem-` prefix + nanoid(16)
- Reason: Shorter than UUID, URL-safe, sufficient collision resistance

### Decision: Schema Migration -- embedded version table
- schema_version table with version integer
- initialize() checks version and runs migrations
- Reason: No external migration tool needed for MVP

### Decision: Connection Management -- WAL mode single connection
- PRAGMA journal_mode=WAL, synchronous=NORMAL, foreign_keys=ON
- Reason: Best read/write concurrency for single-process use

### Decision: userId Issue in phase1-runner (RESOLVED)
- Fixed: phase1-runner now searches across all userIds and merges results
- Also added stopword filtering in FTS5 queries for better relevance

### Decision: FTS5 Stopword Filtering
- Added English stopwords filter in buildFtsQuery
- Reason: Common words (the, is, was, etc.) dominated FTS queries and returned noisy results
- Impact: search p95 improved from 1.0ms to 0.3ms

## 2026-03-23: Phase 1 MVP Baseline Results

### LoCoMo Benchmark (FTS5 only, no vector search)
- Precision@5: 0.0006, Recall@5: 0.0021, nDCG@10: 0.0042, MRR: 0.0026
- Search latency: p50=0.2ms, p95=0.3ms (excellent)
- Store: 5,882 memories in 230ms (batch transaction)
- These low retrieval numbers are expected -- FTS5 keyword matching alone cannot handle conversational QA well
- Phase 2 vector search expected to significantly improve retrieval quality

## 2026-03-24: Phase 2 -- Vector Search + Hybrid Retrieval

### Decision: Embedding Model -- all-MiniLM-L6-v2 via @huggingface/transformers
- q8 quantized (22MB), ~1ms/sentence on CPU
- Singleton pipeline pattern for model reuse
- Reason: Fastest option in Node.js, ESM compatible, auto-caches model

### Decision: Vector Storage -- sqlite-vec
- vec0 virtual table with float[384]
- KNN search via MATCH operator, 0.3ms for 5K vectors
- Reason: 10x faster than JS brute-force, native SQLite integration

### Decision: Hybrid Search -- Reciprocal Rank Fusion (RRF)
- FTS5 BM25 (top N) + Vector KNN (top N) → RRF merge
- Formula: score = 1/(k+rank_fts) + 1/(k+rank_vec), k=60
- Reason: Simple, proven, no tuning needed

### Decision: Backward Compatibility
- embedder is optional in SqliteEngineOptions
- No embedder → FTS-only search (Phase 1 behavior preserved)
- IMemoryEngine interface unchanged

### Decision: Float32 for embeddings
- Change existing Float64 serialization to Float32
- Reason: sqlite-vec uses Float32, half the storage, sufficient precision for embeddings

## 2026-03-24: LLM Provider + Fact Extraction

### Decision: LLM Provider Architecture
- packages/llm/ as separate package, packages/core/ does NOT depend on LLM
- openai and @anthropic-ai/sdk as optional peer dependencies
- Users install only what they need
- Dynamic import for graceful handling of missing SDKs

### Decision: Provider Selection
- OpenAI-compatible (covers OpenAI, Groq, Together, Ollama via baseURL)
- Anthropic (Claude API)
- No proprietary providers in open-source codebase

### Decision: Fact Extraction Caching
- JSONL file cache keyed by SHA-256(model + prompt_version + turn_texts)
- Prompt version string for cache invalidation on prompt changes
- Append-on-extract for crash-safe resume
- LoCoMo full run: ~588 chunks, ~$0.10 with GPT-4o-mini

### Decision: Benchmark Converter Strategy
- LoCoMoConverter interface for pluggable conversion
- TurnBasedConverter (default, no LLM) vs FactExtractionConverter (LLM-based)
- CLI: --converter turn|fact, --llm-provider openai|anthropic

## 2026-03-24: Distribution Strategy

### Decision: CLI as primary interface (not MCP, not HTTP server)
- `memrosetta store/search/ingest/status` shell commands
- Any tool calls CLI: Claude Code hooks, OpenClaw, Obsidian, scripts
- No server, no protocol dependency, no tool coupling
- Core stays a library, CLI is the universal adapter

### Decision: Fact extraction is client responsibility
- In Claude Code: Claude itself extracts (no extra LLM cost)
- In other tools: their LLM extracts
- CLI accepts pre-extracted facts, doesn't do LLM calls itself
- packages/llm/ stays as optional helper, not in core path
