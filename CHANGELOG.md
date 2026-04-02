# Changelog

All notable changes to MemRosetta will be documented in this file.

## [0.3.0] - 2026-04-01

### Added
- **Gemini integration**: `memrosetta init --gemini` registers MCP server in `~/.gemini/settings.json` + GEMINI.md instructions; `memrosetta reset --gemini` to remove
- **CI workflow**: build + typecheck + test on every push and pull request
- **Codex integration**: `memrosetta init --codex` sets up MCP server in `~/.codex/config.toml` + AGENTS.md
- **CONTRIBUTING.md, SECURITY.md, CODE_OF_CONDUCT.md**: community health files

### Changed
- **Node 22+ required**: unified minimum Node version across all packages (was mixed 20+/22+)
- **Convex combination score fusion**: replaced ad-hoc FTS-primary hybrid strategy with principled convex combination for search ranking

### Fixed
- **Relation API 404 errors**: consistent `MemoryNotFoundError` when referenced memories do not exist
- **Multi-user vector search**: brute-force fallback when KNN yields too few results for a user's subset

### Tests
- 696+ tests (up from 610+)

## [0.2.19] - 2026-03-27

### Added
- **3-Factor Search Reranking** (Generative Agents): `score = recency + importance + relevance`, min-max normalized
- **Ebbinghaus Forgetting Curve** (MemoryBank): `R = e^(-t/S)` blended with salience in maintain()
- **Heat-Based Tier Auto-Promotion** (MemoryOS): `accessCount >= 10` auto-promotes to hot tier
- **Duplicate Detection**: store() checks cosine similarity > 0.95 and auto-creates `updates` relation
- **storeBatch NLI**: contradiction detection now runs on storeBatch (<=50 items)

### Improved
- FTS benchmark: P@5 0.0080→0.0087 (+8.8%), MRR 0.0286→0.0298 (+4.2%), zero latency increase

## [0.2.18] - 2026-03-27

### Fixed
- **Codex init replaces stale config**: init --codex now removes existing MCP section before adding fresh one
- Global install must use `memrosetta` wrapper package (not `@memrosetta/cli`) to get `memrosetta-mcp` binary

## [0.2.17] - 2026-03-27

### Fixed
- **status version**: walks up from `import.meta.url` to find package.json in any install context

## [0.2.16] - 2026-03-27

### Fixed
- **status --format json crash**: version lookup fallback when `../../package.json` path breaks in bundled builds
- **Path spaces safety**: hook commands now quote absolute paths (`node "${path}"`) to prevent shell splitting
- **Windows TOML escaping**: Codex config backslash paths escaped correctly (`C:\` → `C:\\`)
- **Source checkout binary resolution**: `findUpwards` walks up to `pnpm-workspace.yaml` and resolves `adapters/mcp/dist/index.js` directly

## [0.2.15] - 2026-03-27

### Fixed
- **Config propagation**: `--db`, `--lang`, `--no-embeddings` now persist to `config.json` and are read by ALL runtime paths (CLI, hooks, MCP server)
- **Smart binary resolution**: `init` checks PATH first, falls back to `node` + absolute path for source checkouts and local installs
- **MCP server reads config**: `dbPath`, `enableEmbeddings`, `embeddingPreset` from `~/.memrosetta/config.json`
- **Status shows Codex**: `memrosetta status` now displays Codex integration state
- **Cursor/Codex register returns actual boolean**: no more hardcoded `true` for cursorrules/AGENTS.md status

### Added
- `resolve-command.ts`: shared binary resolver for all integrations (cross-platform)
- `--codex` added to `docs/CLI.md` and `docs/CLI.ko.md` init options table

### Removed
- Phantom `--mcp` flag from README (MCP is always included in base init)

## [0.2.14] - 2026-03-27

### Added
- **Codex integration**: `memrosetta init --codex` sets up AGENTS.md for OpenAI Codex
- Codex MCP server configuration support
- AGENTS.md template with memory checklist for Codex agents

### Fixed
- MCP server binary (`memrosetta-mcp`) startup via global install
- Executable permissions on all bin files

## [0.2.13] - 2026-03-27

### Added
- **Codex CLI flag**: `memrosetta init --codex` for OpenAI Codex setup
- `packages/cli/src/integrations/codex.ts` integration module
- Codex support in landing page and README

## [0.2.12] - 2026-03-26

### Fixed
- MCP server startup: `memrosetta-mcp` binary now resolves `@memrosetta/mcp` correctly via `createRequire`

## [0.2.11] - 2026-03-26

### Changed
- **MCP uses global binary instead of npx**: `.mcp.json` now registers `memrosetta-mcp` instead of `npx -y @memrosetta/mcp`
- Faster MCP server startup (no npx download)
- Windows compatible (no more npx.cmd issues)

### Added
- `memrosetta-mcp` bin in the `memrosetta` wrapper package
- `@memrosetta/mcp` as dependency of wrapper package

## [0.2.10] - 2026-03-26

### Fixed
- Windows MCP support: use `npx.cmd` on `win32` platform

## [0.2.9] - 2026-03-25

### Changed
- **Default output format changed from JSON to text** for all CLI commands
- More readable output for `memrosetta init`, `memrosetta status`, etc.

### Fixed
- Stop hook command updated from `npx -y @memrosetta/cli memrosetta-on-stop` to `memrosetta-on-stop` (direct binary)
- Updated test expectations for new hook format

## [0.2.8] - 2026-03-25

### Fixed
- Claude Code Stop hook: use direct binary (`memrosetta-on-stop`) instead of `npx` to avoid "could not determine executable" errors

## [0.2.7] - 2026-03-25

### Fixed
- `memrosetta update` command: use `npm list` instead of `package.json` (path resolution issue in bundled builds)

## [0.2.6] - 2026-03-25

### Added
- **`memrosetta update` command**: self-update to latest npm version

## [0.2.5] - 2026-03-25

### Fixed
- Auto-create `vec_memories` table for existing databases without vector support
- Graceful fallback if `sqlite-vec` module is unavailable

## [0.2.4] - 2026-03-25

### Fixed
- **Embeddings enabled by default**: removed `MEMROSETTA_EMBEDDINGS=false` from MCP server config
- Users now get hybrid search (FTS + vector) from first use

### Changed
- `memrosetta init` always registers MCP server as base functionality (`--mcp` flag removed)

## [0.2.3] - 2026-03-25

### Fixed
- Korean preset (768-dim) now works with sqlite-vec: schema parameterized by embedding dimension
- Benchmark `engineVersion` reads from `@memrosetta/core/package.json` (no more hardcoding)
- Custom embedding models require explicit `dimension` parameter (prevents silent 384-dim assumption)
- Version strings read from `package.json` everywhere (no hardcoded `'0.1.0'`)

## [0.2.2] - 2026-03-25

### Fixed
- **npm publish**: use `pnpm publish` to resolve `workspace:*` protocol (was breaking `npm install`)

## [0.2.1] - 2026-03-25

### Changed
- Removed all `any` types from production code (OpenAI/Anthropic providers, embedder, contradiction detector)

## [0.2.0] - 2026-03-25

### Added
- **Multilingual embedding support**: `--lang en|multi|ko` flag
  - `en`: bge-small-en-v1.5 (33MB, 384dim, MIT) -- default
  - `multi`: multilingual-e5-small (100MB, 384dim, 94 languages, MIT)
  - `ko`: ko-sroberta-multitask (110MB, 768dim, Apache 2.0)
- Embedding preset saved to `~/.memrosetta/config.json`

### Fixed
- Clean-clone build/test: `pnpm test` now runs `pnpm build` first
- `.tsbuildinfo` added to `.gitignore`
- Benchmark latency numbers corrected to actual measured values

### Changed
- Default embedding model: all-MiniLM-L6-v2 -> **bge-small-en-v1.5**

## [0.1.0] - 2026-03-24

### Added
- Initial release
- **Core engine**: SQLite + FTS5 + sqlite-vec hybrid search with RRF
- **NLI contradiction detection**: nli-deberta-v3-xsmall (local, no LLM)
- **ACT-R adaptive forgetting**: activation scoring based on access frequency
- **Memory tiers**: Hot (working memory) / Warm (30 days) / Cold (compressed)
- **Time model**: 4 timestamps (learnedAt, documentDate, eventDateStart/End, invalidatedAt)
- **Relations**: updates, extends, derives, contradicts, supports
- **CLI**: 14 commands (store, search, ingest, get, count, clear, relate, invalidate, working-memory, maintain, compress, status, init, reset)
- **MCP server**: 6 tools for AI tool integration
- **REST API**: Hono-based development/testing server
- **Claude Code integration**: Stop hook + MCP + CLAUDE.md
- **Cursor integration**: MCP + .cursorrules
- **Benchmarks**: LoCoMo dataset (1,986 QA, 5,882 memories)
- **Landing page**: https://memrosetta.liliplanet.net (EN/KR)
- 726+ tests, MIT license
