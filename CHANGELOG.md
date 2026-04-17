# Changelog

All notable changes to MemRosetta will be documented in this file.

## [0.11.0] - 2026-04-17

**BREAKING. Core is now 100% LLM-free and offline.**

The Hugging Face Transformers.js integration is gone. Every code path
that depended on it — vector search, contradiction detection, the
propositionizer-based fact extractor, `sqlite-vec` — has been removed
together with the model downloads, the `onnxruntime-node` native
binary, and the ~1.5 GB install footprint that came with them.

v1.0 reconstructive memory stays intact: **Layer A** (source
monitoring, event segmentation, goal-state memory, dual
representation, 2-axis type system, hippocampal indexing, pattern
completion, recall) runs on every store and recall exactly as before.
The hippocampal index + cue-driven pattern completion do the
retrieval work that the HF embedder used to do — without calling out
to model servers, without needing an internet connection, and
without an `ERR_UNSUPPORTED_ESM_URL_SCHEME` on Windows.

### Removed

- `@memrosetta/embeddings` package (HuggingFaceEmbedder + NLI
  ContradictionDetector). Deleted from the workspace.
- `@memrosetta/extractor` package (propositionizer ONNX decomposer).
  Deleted from the workspace.
- `sqlite-vec`, `@huggingface/transformers`, `onnxruntime-node`
  dependencies.
- `storeMemoryAsync`, `storeBatchAsync` — no more async/embedding
  variants; `storeMemory` is the single sync entry point.
- `bruteForceVectorSearch`, `vectorSearch`, `rrfMerge`,
  `rrfMergeWeighted`, `convexCombinationMerge`, `serializeEmbedding`
  from `@memrosetta/core` exports.
- `memories.embedding` BLOB column and the `vec_memories` virtual
  table (schema v16 migration drops them idempotently).
- `SchemaOptions.vectorEnabled` / `SchemaOptions.embeddingDimension`
  and the `schema_version.embedding_dimension` column.
- `SqliteEngineOptions.embedder` /
  `SqliteEngineOptions.contradictionDetector` — Core API no longer
  accepts ML models.
- `HuggingFaceEmbedder` fallback paths in CLI / MCP / API / benchmarks.
- `Memory.embedding: readonly number[]` field.

### Changed

- `engine.search()` is FTS-only with hippocampal cue boost + 3-factor
  reranking. No queryVec / useVecTable parameters.
- `checkDuplicates()` uses exact-content match; cosine similarity
  path removed.
- `autoRelate()` triggers on ≥ 2 shared keywords only. Cosine
  similarity branch removed.
- CLI `--no-embeddings` flag kept as a no-op for backwards
  compatibility (so existing scripts don't break). Actual embeddings
  are always off.
- Schema migrates to v16. Upgrade path is additive for existing DBs:
  the migration drops `vec_memories` + `memories.embedding` if they
  exist, otherwise it is a no-op. Fresh installs never create those
  objects.

### Why

1. Windows + Codex users kept hitting `TypeError: fetch failed` during
   HF model fetch, which killed the MCP process before handshake.
2. Install size dropped from ~1.5 GB to ~30 MB.
3. Core LLM-free principle (CLAUDE.md #1) is now enforced: fact
   extraction, compression, and contradiction detection are all the
   client's responsibility.
4. v1.0 kernel does not need embeddings — hippocampal indexing +
   pattern completion provide structural retrieval that is more
   interpretable and provenance-aware than semantic similarity.

### Migration

For users running v0.10.x:

- Existing DBs upgrade cleanly on next open (schema v16 runs).
- `engine.store()` / `engine.search()` / `engine.reconstructRecall()`
  keep the same signatures sans the removed optional params.
- If you depended on semantic similarity search, inject cues
  explicitly via the `cues` field on `MemoryInput` or pass them to
  `reconstructRecall({ cues: [...] })`. Pattern completion will
  recover missing features from the episode index.
- If you need semantic similarity for a specific use case, run an
  external embedder client-side and pass the result through your
  own pipeline before calling `store()`. Core remains pluggable but
  no longer ships an embedder.

### Tests

Workspace: **1059 tests passing**. Core: 22 files / 435 tests.

### Versions

- `memrosetta`, `@memrosetta/cli`, `@memrosetta/core`,
  `@memrosetta/types`, `@memrosetta/mcp`: 0.11.0 (aligned).

---

## [0.10.0] - 2026-04-17

**Reconstructive Memory kernel — Layer A + Layer B scaffolding.**

A substantial architectural addition implementing the v4 agreement
(see `docs/reconstructive-memory-spec.md`). Every store and recall
now routes through brain-inspired primitives instead of a bag of
FTS tricks.

### Added — Layer A (Day-one, always on)

- **Source Monitoring** — `source_attestations` table captures
  provenance per memory (chat / document / observation / reflection /
  tool_output) with structured speaker + confidence. Attestations
  are audit-permanent (never deleted on memory invalidation).
  Schema v9.
- **Event Segmentation** — `episodes` + `segments` +
  `memory_episodic_bindings` with coarse boundaries (session, repo,
  gap, goal_reset) and fine boundaries (task_mode, intent, branch,
  tool, prediction_error). `state_vector_json` on segments is a
  first-class retrieval input. Schema v10.
- **Goal-State Memory** — `goals` + `goal_memory_links`. Captures
  "what problem was being solved" alongside every memory with full
  lifecycle (horizon, priority, blocked_by, abandon_reason,
  reopened_at, owner_agent) and structured success criteria.
  Schema v11.
- **Dual Representation** — verbatim (immutable raw trace) + gist
  (mutable abstraction) columns on memories, with
  `memory_gists_versions` archive for every gist rewrite.
  Schema v12.
- **Tulving 2-axis Type System** — `memory_system` ∈ {episodic,
  semantic, procedural} × `memory_role` (open union). Legacy
  `memory_type` remains as compatibility backfill. `memory_aliases`
  with DB-level cap trigger (max 3 per memory, confidence ≥ 0.7).
  Schema v13.
- **Hippocampal Indexing** — `episodic_index` with bipolar cues (+1
  positive, -1 anti-cue), bounded Hebbian decay per feature family,
  canonical cue normalisation via `cue_aliases`, and family-specific
  caps (who 1-2, topic 3-6, entity 4-8, …). Schema v14.
- **Pattern Completion + Reconstructive Recall** — MINERVA-free
  kernel that scores episodes by positive/negative cue overlap,
  applies recency + goal-fit boost, completes missing features from
  retrieved episodes, and emits evidence-bound artifacts. 5-intent
  routing: `reuse`, `explain`, `decide`, `browse`, `verify`. 4 hook
  seams reserved for Layer C.

### Added — Layer B (Day-one, flags OFF)

- **memory_constructs + construct_exemplars** with structured slots,
  anti-patterns, `abstraction_level` 1-5. Schema v15.
- **Pattern Separation** — two-threshold exemplar classification on
  store.
- **Novelty / Prediction Error** — Jaccard-based language-agnostic
  scoring with density penalty.
- **Consolidation Queue** — abstraction + maintenance subqueues.
- **Full Anti-Interference** — diversity penalty, goal compatibility,
  abstraction gating.
- **Engine LayerB flags**: `enableNoveltyScoring`,
  `enablePatternSeparation`, `enableConsolidation` (all default OFF).

### Added — Surface

- **`memrosetta recall`** CLI command with 5 intents, state-vector
  flags (`--project/--repo/--language/--framework/--task-mode/
  --actor/--topic`), and a custom text formatter (confidence bar,
  warnings, evidence table, completed features).
- **`memrosetta_reconstruct_recall`** MCP tool with zod-validated
  13-family cue enum + full StateVector schema.
- **`engine.reconstructRecall(input, hooks?)`** on `IMemoryEngine`.
  Automatically increments construct `reuse_count` on recall.

### Added — Benchmarks

- **v1.0 reconstructive recall suite** (benchmarks/src/scenarios/
  v1-recall/): `goal_state_preservation`, `source_fidelity`,
  `reuse_fit`, `context_preserving_transfer`. Baseline behavioural
  guarantees only — stress / scale / cross-user / query-native
  scenarios remain future work.

### Changed

- Version bumps: core 0.7.0 → 0.10.0, cli 0.9.1 → 0.10.0,
  types 0.4.0 → 0.10.0, umbrella 0.9.1 → 0.10.0, mcp 0.4.6 → 0.5.0.
- Schema versions v9 → v15. Migrations are additive — the legacy
  `memories.source_id`, `memory_type`, and `content` columns all
  remain populated.
- 12 Codex review rounds across Layer A / Layer B / surface /
  benchmarks. Every must-fix addressed (notably: INSERT OR IGNORE →
  ON CONFLICT DO NOTHING, atomicity across all `storeMemory`
  variants, segment/episode FK consistency, DB-level alias cap
  trigger, cue extraction pipeline, construct reuse accounting).

### Tests

- Core: 22 test files, 485 tests (baseline 332 → +153).
- Workspace: 1118 tests passing, typecheck clean.

### Obsidian source of truth

- `2026-04-17-1054-v1.0-합의안-v4-최종.md` (approved-by-self-judgment)
- `docs/reconstructive-memory-spec.md` (repo mirror)

---

## [0.9.1] - 2026-04-16

### Added
- **Recency boost tuning**: weight 1.0 -> 2.0, decay 0.995 -> 0.99 per hour
  (3 days = 49%, 7 days = 19%). Recent memories surface more aggressively.
- **autoRelate expansion**: candidate window 10 -> 50, keyword overlap
  threshold 3 -> 2, embedding cosine > 0.7 auto-creates `extends` relation.
- **`memrosetta dedupe [--dry-run]`** command: exact content + type grouping,
  loser invalidated with `duplicates` relation edge.
- **Schema v8**: `duplicates` added to `relation_type` CHECK constraint.
- New files: `packages/core/src/dedupe.ts`,
  `packages/cli/src/commands/dedupe.ts`.

### Changed
- **Version bumps**: `@memrosetta/core` 0.6.0 -> 0.7.0,
  `@memrosetta/cli` 0.8.0 -> 0.9.1, `memrosetta` 0.8.0 -> 0.9.1.

### Tests
- 938 tests green.

## [0.9.0] - 2026-04-16

### Added
- **Liliplanet JWT auth rework**: `sync login` opens browser + localhost
  callback for JWT capture, replacing the device-code flow.
- **`sync logout` / `sync status`**: shows auth mode, account email, token
  expiry.
- **sync-server JWKS JWT verification** via `jose`, dual-auth middleware
  (JWT + API key).
- **push/pull JWT mode** uses auth context `ownerUserId`; API key mode
  preserves request `userId`.
- **Landing page redesign**: Bricolage Grotesque + Source Serif 4 fonts,
  auth callback page, Login/Logout state toggle in header.
- **PostgreSQL migration**: additive-first split (002a additive, 002b
  cleanup).

### Removed
- Self-built OAuth broker (`providers.ts`, `tokens.ts`,
  `sessions` / `auth_device_requests` tables).

### Changed
- **Version bumps**: `@memrosetta/cli` 0.8.0 -> 0.9.0,
  `memrosetta` 0.8.0 -> 0.9.0.
- README: Hosted Cloud vs Self-Host sync paths separated.

## [0.8.0] - 2026-04-16

### Added
- **Spreading Activation Lite** on relation + co-access graph
  (HippoRAG-inspired). After search, top-5 seed results spread activation
  through explicit relations (`supports` +0.35, `extends` +0.25,
  `derives` +0.20, `updates` +0.10, `contradicts` -0.40) and co-access
  edges (`strength * 0.15`). Hop decay: 1-hop 0.5x, 2-hop 0.2x.
- `spreading.ts`: `spreadActivation()` function.
- v0.8.0-lite boosts existing results only (no new candidate fetch --
  that is planned for v0.9.0).
- Search pipeline order: rerank -> keyword -> context -> co-access ->
  spreading -> dedup.

### Changed
- **Version bumps**: `@memrosetta/core` 0.5.0 -> 0.6.0,
  `@memrosetta/cli` 0.7.0 -> 0.8.0, `memrosetta` 0.7.0 -> 0.8.0.

## [0.7.0] - 2026-04-16

### Added
- **Context-Dependent Retrieval** (Tulving 1973): memories encoded in a
  specific project/session context are boosted when searched from the
  same context. `MemoryInput` gains `project` and `activityType` fields.
  `searchMemories()` accepts `contextFilters: { project?, namespace?,
  sessionId? }`. Boost: same project +0.25, same namespace +0.15, same
  session +0.10.
- **Hebbian Co-access** (Hebb 1949): when memories appear together in
  search results, pair-wise co-access strength increments in
  `memory_coaccess` table. Future searches boost co-accessed neighbors
  (`strength * 0.15`). Separate from the semantic relation graph.
- **Schema v7**: `project TEXT` and `activity_type TEXT` columns on
  `memories` + `memory_coaccess` table with indexes.
- `coaccess.ts`: `recordCoAccess`, `getCoAccessNeighbors`,
  `decayCoAccess`.
- Search pipeline order: rerank -> keyword -> context boost -> co-access
  boost -> dedup.

### Changed
- **Version bumps**: `@memrosetta/core` 0.4.1 -> 0.5.0,
  `@memrosetta/cli` 0.5.4 -> 0.7.0, `memrosetta` 0.5.4 -> 0.7.0.

## [0.5.4] - 2026-04-16

### Fixed
- **Windows CRLF bug in `resolve-command.ts`.** The `where` command on
  Windows emits `\r\n` line endings. `.split('\n')[0]` left `\r` inside
  a TOML literal string, pushing the closing quote to the next line and
  producing an invalid config file. Fixed with `.split(/\r?\n/)[0]?.trim()`.

## [0.5.3] - 2026-04-16

### Changed
- Bumped `@memrosetta/cli` and the `memrosetta` umbrella package to pick
  up `@memrosetta/sync-client@0.1.7`.

### Fixed
- **`SyncClient.pull()` fetched only the first page.** The previous
  implementation returned after the first 500 ops, so a new device
  joining a hub with >500 ops (e.g. 37 k) required dozens of manual
  `sync now` runs to catch up. `pull()` now loops through all pages
  (`PULL_PAGE_SIZE=1000`, `while hasMore`) and applies each page before
  requesting the next. New devices reach a consistent state in a single
  `memrosetta sync now`.

## [0.5.2] - 2026-04-16

### Added
- **`memrosetta migrate legacy-user-ids`** — one-shot client-side fixup
  for the historical `user_id` fragmentation. Pre-v0.4 versions of
  `resolveUserId(cwd)` wrote `personal/<dir>`, `work/<dir>`, `general`,
  etc. as `user_id`, so a single user ended up with 30+ partitions on
  a single device and cross-device search missed most memories.
  The new command is non-destructive:
  (a) snapshots legacy rows into `memory_legacy_scope(memory_id,
      legacy_user_id, legacy_namespace, migrated_at)`,
  (b) rewrites `memories.user_id` to the canonical user (from
      `config.syncUserId ?? username`), leaving `namespace` untouched,
  (c) clears `sync_outbox` / `sync_inbox` and resets the sync cursor
      so stale legacy ops do not re-upload after migration, and
  (d) records the migration in the new `migration_version` table so
      re-runs are idempotent. `--dry-run` prints an impact report
      with legacy row counts, distinct legacy partitions, queue
      pending, and cross-partition duplicate group count.
- **`memrosetta duplicates report`** — read-only audit of exact-content
  duplicate groups across `user_id` partitions. Shows group counts,
  member memory ids, and priority hints (canonical user > higher
  `success_count` > higher `use_count` > newer `learned_at`). This is
  the feeder for the v0.5.3 destructive dedupe pass.
- **Schema v6** (`@memrosetta/core`): adds `migration_version` and
  `memory_legacy_scope` tables plus their supporting indexes. Fresh
  installs start at v6; upgrading installs run the v5 → v6 migration
  automatically on next engine open.
- **`resolveCanonicalUserId(explicit?, configLoader?)`** helper in
  `@memrosetta/cli` that enforces the identity priority
  `explicit → config.syncUserId → OS username`. Every CLI command,
  MCP tool handler, hook extractor, and enforce pipeline now routes
  through this helper, so pinning `syncUserId` once survives every
  write and read path on every host.

### Fixed
- **FTS5 search returned zero results for natural-language queries
  with Korean tokens.** `buildFtsQuery` joined tokens with AND, so
  `"hermes github 주소가 뭐지 ?"` required every Korean question
  particle to appear in the target document. `@memrosetta/core`
  now runs a `preprocessQuery` step that normalises with NFKC,
  strips question marks and other query-killing punctuation, drops
  Korean stopwords (`뭐지`, `뭐야`, `어디`, `왜`, `어떻게`, …) alongside
  the existing English stopwords, and switches the FTS connective to
  OR for queries with 3+ tokens so reranking handles precision.
- **`SyncClient.push()` could re-upload legacy user_id ops.** The
  outbox transport did not filter by configured user, so after a
  partial migration the next push would ship legacy-tagged ops back
  to the hub. `Outbox.getPending(userId)` / `countPending(userId)`
  now accept an optional user filter and `SyncClient` passes its
  configured user every call, so only canonical-partition ops
  leave the device.
- **MCP server default user ignored `config.syncUserId`.** Tools
  previously fell back to the OS username directly, so on hosts
  where the OS username differed from the canonical user every
  memory stored via MCP split off into a fresh partition.
  `registerTools(server, engine, syncRecorder, { canonicalUserId })`
  now pins the canonical user on startup and every handler defaults
  to it.

### Migration notes
After upgrading on every device you already use, run:

```
memrosetta migrate legacy-user-ids --dry-run       # preview
memrosetta migrate legacy-user-ids                  # apply (prompts)
memrosetta sync backfill --user <canonical>        # republish
memrosetta sync now                                 # push to hub
memrosetta duplicates report                        # audit dupes
```

The migration is non-destructive: the pre-migration `user_id` is
preserved in `memory_legacy_scope` and the on-disk SQLite file is
never dropped. Back up `~/.memrosetta/memories.db` if you want a
restore point anyway.

## [0.5.1] - 2026-04-16

### Added
- **Codex CLI Stop hook auto-registration.** `memrosetta init --codex`
  now wires the `memrosetta-enforce-codex` binary into
  `~/.codex/hooks.json` under the `Stop` event and flips
  `[features] codex_hooks = true` in `~/.codex/config.toml`, so Codex
  CLI users get the same enforce pipeline as Claude Code without
  hand-editing config files. `memrosetta reset --codex` reverses the
  change: it strips the memrosetta hook entries, preserves any other
  user-defined hooks, and turns the feature flag back off only if
  nothing else is registered. Skipped on Windows, where Codex hooks
  are still disabled upstream.
- **`memrosetta-enforce-codex` binary** (Codex Stop hook wrapper).
  Reads the Codex Stop event from stdin (`last_assistant_message` is
  available directly — no transcript walking), exec()s
  `memrosetta enforce stop --client codex`, and maps the enforce
  envelope back to Codex's continuation protocol: `stored` / `noop` →
  `{}`, `needs-continuation` → `{ "decision": "block", "reason": "..." }`
  so Codex re-prompts the model. Respects `stop_hook_active` to
  prevent runaway loops and fails open on any error.

### Fixed
- `packages/cli/src/integrations/codex.ts` now also recognizes
  `memrosetta-enforce-claude-code` and `memrosetta-on-stop` command
  strings as memrosetta-owned hook entries, so re-running
  `memrosetta init --codex` on a machine that was wired up with an
  older wrapper name cleanly replaces the entry instead of leaving
  duplicates.

## [0.5.0] - 2026-04-15

### Added
- **`memrosetta enforce stop`** — shared backend for client-side Stop
  hooks (option 0 + 1 + 5). Loads a normalized event JSON, runs the
  LLM extractor, stores atomic memories via the engine, and returns a
  JSON envelope with `status` (`stored | needs-continuation | noop`),
  memory ids, attempt/max-attempts, and an audit footer
  (`STORED: ...`). Max 2 attempts per turn to prevent continuation
  loops.
- **Client-side LLM extractor** (`packages/cli/src/hooks/llm-extractor.ts`)
  with fallback chain: `ANTHROPIC_API_KEY` -> Claude Haiku 4.5 ->
  `OPENAI_API_KEY` -> GPT-4o-mini -> optional `@memrosetta/extractor`
  propositionizer ONNX -> none. `@memrosetta/core` stays LLM-free; the
  extractor lives in the hook layer because hook callers already pay for
  model calls.
- **`memrosetta-enforce-claude-code` binary** — Claude Code Stop hook
  wrapper. Reads Claude Code's Stop event from stdin, locates the last
  assistant turn in the transcript, normalizes it, and exec()s
  `memrosetta enforce stop`. `init --claude-code` now registers this
  binary as the Stop hook (with a 30 s timeout) and cleans up the legacy
  `memrosetta-on-stop` registration on re-install.

### Fixed
- **`SyncClient.push()` blew up on large backfills.** The server caps
  each `/sync/push` at 500 ops, so a 2k-memory backfill returned
  `400 Bad Request`. Push now chunks pending ops into batches of
  `MAX_OPS_PER_PUSH = 400`, marks each successful batch pushed before
  moving to the next, and re-reads the cursor per batch. A mid-run
  failure keeps the batches that already succeeded, so retries make
  forward progress instead of rolling back the whole run.
- **Codex `~/.codex/config.toml` mangled Windows paths.** The previous
  `escapeTomlString` emitted TOML basic strings (`"..."`), whose
  backslash escapes mutated `C:\Users\jhlee13\...` into `\\`-doubled or
  `\U`-unicode-escape errors. Replaced with `tomlLiteral()`, which emits
  TOML literal strings (`'...'`) with no escape processing. Every
  register / reset path now also strips legacy
  `[mcp_servers.memrosetta]` blocks written by older `memrosetta init`
  versions, so re-install no longer leaves duplicate MCP entries.

## [0.4.8] - 2026-04-15

### Fixed
- **Pulled / backfilled keywords were stored as JSON** while the rest of
  `@memrosetta/core` stores them as a space-joined string, breaking FTS
  recall for synced memories. Both the applier and `sync backfill` now
  use the canonical space-joined format.
- **`memrosetta sync backfill` blew up on real local DBs** because it
  did `JSON.parse` on `memories.keywords`. Switched to the same
  space-split path the engine uses, so backfill actually runs.
- **Re-running `sync backfill` inflated outbox / server log.** Backfill
  now generates deterministic op ids
  (`op-<sha256(memory_id)[:16]>`,
   `op-<sha256(src|dst|type)[:16]>`) and `Outbox.addOp` switched to
  `INSERT OR IGNORE`, so re-runs are no-ops.
- **Pulled `feedback_given` ops did not recompute salience.** The
  applier now mirrors `engine.feedback()`'s salience formula
  (`0.5 + 0.5 * success_rate`, clamped to `[0.1, 1.0]`), so
  cross-device ranking does not drift.
- **`SyncClient.pull()` overstated success when apply skipped ops.** It
  still advances the cursor (so we don't redownload), but
  `last_pull_success_at` is only updated when zero ops were skipped, and
  every skip is logged to stderr. Skipped ops stay pending in
  `sync_inbox` for retry.
- **MCP background sync only pushed.** The 5-minute interval now runs
  push *and* pull sequentially with separated logging, so MCP-only
  devices receive remote updates without manual `sync now`.
- **MCP server reported a stale `0.3.0` version.** Now resolves the
  version from `@memrosetta/mcp/package.json` via `createRequire`.

### Docs
- README / README.ko.md: added `sync backfill` to the multi-device sync
  section.
- RELEASE_NOTES.md: filled in v0.4.5 / v0.4.6 / v0.4.7 entries.

## [0.4.7] - 2026-04-15

### Added
- **CLI write commands now feed the sync outbox.** `memrosetta store`,
  `relate`, `invalidate`, and `feedback` enqueue the appropriate op into
  `sync_outbox` when sync is enabled, matching the existing MCP path.
  Previously anything stored via the CLI was silently excluded from sync.
- **`memrosetta sync backfill`**: one-shot ingestion of the existing local
  history into the outbox. Supports `--user`, `--namespace`,
  `--memories-only`, and `--dry-run`. Only emits `relation_created` ops
  whose endpoints are both in the filtered backfill set so remote apply
  does not break on missing foreign keys.
- Shared `packages/cli/src/sync/cli-sync.ts` module with `openCliSyncContext`
  and op builder helpers used by every write command.

### Changed
- `SqliteMemoryEngine.invalidate(memoryId, reason?)`: CLI `invalidate`
  command now passes an optional `--reason`, symmetric with the MCP tool.

## [0.4.6] - 2026-04-15

### Fixed
- **Pull was effectively a no-op.** `SyncClient.pull()` landed incoming
  ops in `sync_inbox` and advanced the cursor, but never wrote them back
  into the local `memories` / `memory_relations` tables. Devices showed
  "pulled=N" yet searched zero matches, because nothing had actually been
  applied. This broke the core promise of multi-device sync for every
  release from 0.4.0 up to 0.4.5.

### Added
- **`applyInboxOps(db, ops)` applier module** in
  `@memrosetta/sync-client`. Idempotent, transaction-wrapped, separate
  from the transport layer so the engine schema stays out of
  `SyncClient`. Handles `memory_created`, `relation_created`
  (including the `updates` -> `is_latest = 0` side effect),
  `memory_invalidated`, `feedback_given`, and `memory_tier_set`.
- `SyncClient.pull()` now calls the applier after inbox insert and
  advances the cursor only once ops are both inboxed and folded into
  local state.
- `SyncClient.applyPendingInbox()` helper for tests and advanced
  callers that want to replay existing inbox rows without a network
  fetch.

### Upgrade note
- Existing devices on 0.4.0-0.4.5 with stale `sync_inbox` rows will
  have them auto-applied on the first `sync now` after upgrading.
  Reset `last_cursor` and `pull_cursor` to `0` in `sync_state` if you
  want to replay everything the server has.

## [0.4.5] - 2026-04-15

### Fixed
- **Devices of the same person did not see each other's memories.** The
  sync client was picking `userId` from the OS username, so a Mac user
  `obst` and a Windows user `jhlee13` landed in two different server-side
  op streams despite being the same human. The server partitions by
  `user_id`, so ops never crossed.
- Config now tracks `syncUserId` as first-class. `SyncClient.getStatus()`
  returns it, and both CLI (`memrosetta sync status --format text`) and
  the MCP adapter respect it when populating the sync client.

### Added
- **`memrosetta sync enable --user <id>`**: explicitly set the logical
  user id shared across devices. Defaults to the OS username when no
  flag and no existing config value.
- `sync status` now prints the active `UserId` so cross-device mismatches
  are obvious at a glance.

### Upgrade note
- **Both devices must use the same `syncUserId`** for cross-device sync
  to work. On each device, run:
  `memrosetta sync enable --server https://your-sync --user <shared-id>`.
  This rewrites `syncUserId` in `~/.memrosetta/config.json`.

## [0.4.4] - 2026-04-15

### Added
- **`--key-file <path>`**: read the sync API key from a file. The file is
  trimmed and control-character validated. Recommended for Windows and
  anywhere a shell-history leak is unacceptable.
- **`MEMROSETTA_SYNC_API_KEY` environment variable**: used automatically
  when no explicit key source is given. Name is deliberately different from
  the server-side `MEMROSETTA_API_KEYS` to avoid confusion.

### Changed
- **`memrosetta sync enable` key sources are now mutually exclusive.**
  Supplying more than one of `--key`, `--key-stdin`, `--key-file` is an
  error. Resolution order: explicit flag -> env var -> hidden prompt.
- **Hidden prompt is POSIX TTY only.** On Windows (where PowerShell + npm
  shims cannot reliably mask input or forward stdin) the CLI now fails fast
  with a hint listing every supported key source.
- `--help` and the CHANGELOG document all four key sources.

### Fixed
- Windows users who hit "Error: API key is required" or "fetch failed" in
  0.4.1-0.4.3 now have a working path: `--key`, `--key-file`, or
  `MEMROSETTA_SYNC_API_KEY`.
- The control-character recovery message in `withSyncClient` now points to
  `--key`, `--key-file`, and the env variable instead of the old
  `--key-stdin` instructions.

## [0.4.3] - 2026-04-15

### Fixed
- **`memrosetta update` showed "Current version: unknown"**: the command
  parsed `npm list -g` output but did not tolerate the warning lines npm
  occasionally prints before the JSON body, and it had no fallback when
  neither `memrosetta` nor `@memrosetta/cli` was listed at the global level
  (for example when running from `npx` or a workspace). It now parses
  tolerantly, resolves the running binary's version via a shared
  `resolveCliVersion()` helper, and shows both the installed version and the
  running binary version when they disagree.

### Changed
- Extracted `packages/cli/src/version.ts::resolveCliVersion()` so both
  `status` and `update` read the current binary version through the same
  three-strategy lookup (dev tsx, exports map, directory walk). No public
  API impact.

## [0.4.2] - 2026-04-15

### Fixed
- **`memrosetta sync enable` on Windows**: the previous raw-mode hidden input
  captured control characters (e.g. U+0016 / SYN) from Windows PowerShell and
  wrote them to `~/.memrosetta/config.json`, which then caused every sync
  request to fail with `fetch failed` because the `Authorization` header was
  invalid. The hidden prompt is now implemented with `readline` + a muted
  output stream, which works consistently on POSIX and Windows.

### Added
- Control-character validation on captured API keys. If anything slips
  through, the CLI tells the user to re-run with `--key-stdin`.
- Windows-specific hint on `sync enable` encouraging `--key-stdin` when the
  terminal does not mask input reliably.
- Recovery path in `withSyncClient`: if the stored API key contains control
  characters (upgrading from a broken 0.4.1 install), `sync now` / `sync
  status` now returns a readable error with the exact fix command instead of
  bubbling up `fetch failed`.

## [0.4.1] - 2026-04-15

### Added
- **`memrosetta sync` CLI**: `enable`, `disable`, `status`, `now`, `device-id`
  subcommands. Hidden API key prompt (TTY raw mode), `--key-stdin` for
  automation, `--no-test` to skip the health check, `--push-only`/`--pull-only`
  for `sync now`.
- **`SyncClient.getStatus()`** and sync timestamp tracking
  (`last_push_attempt_at`, `last_push_success_at`, `last_pull_attempt_at`,
  `last_pull_success_at`, `last_cursor`).

### Fixed
- **`SyncClientConfig.userId` required**: pull was failing with HTTP 400
  because the server query schema requires `userId`. The client now sends it
  and the CLI/MCP adapter both supply the current OS user.

### Security
- CLI `writeConfig` now also applies `0600` permissions on
  `~/.memrosetta/config.json` and `0700` on the parent directory (MCP adapter
  already did this in 0.4.0; now they are consistent).

## [0.4.0] - 2026-04-15

### Added
- **Optional sync layer**: local SQLite remains primary; sync is opt-in via
  `~/.memrosetta/config.json`. No public sync server — users self-host.
- **`@memrosetta/sync-client`**: outbox/inbox with push/pull, idempotent apply,
  and background push when MCP detects `syncEnabled: true`.
- **Operation log schema**: `memory_created`, `relation_created`,
  `memory_invalidated`, `feedback_given`, `memory_tier_set`; append-only,
  idempotent by `(user_id, op_id)`.
- **Brain Spec documents**: `docs/brain-spec.md`, `docs/memory-types.md`,
  `docs/recall-modes.md`, `docs/sync-architecture.md`, `docs/sync-api.md`,
  including a self-hosting guide.
- **API expansion**: `/api/memories/:id/invalidate`, `/feedback`,
  `/api/working-memory`, `/api/memories/:id/quality`, and API key auth
  (`MEMROSETTA_API_KEYS` or `SERVICE_KEY`) with constant-time comparison.
- **`@memrosetta/extractor`**: multilingual fact decomposition using the
  Propositionizer-mT5-small ONNX model.

### Security
- `~/.memrosetta/config.json` is written with `0600` and the parent directory
  with `0700` on POSIX systems (best-effort on Windows).

### Changed
- MCP tool pipeline now takes an optional `SyncRecorder`; enqueue failures are
  non-fatal so SQLite writes always succeed.
- Relation error handling and CI cleanups from the 0.3.x line are rolled
  forward.

### Notes
- `@memrosetta/sync-server` and `@memrosetta/postgres` ship as 0.1.0 building
  blocks for self-hosted deployments; they are not published to `latest` yet.

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
