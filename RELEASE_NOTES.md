# Release Notes

This file summarises user-facing changes per release.
For the full machine-readable history see [CHANGELOG.md](CHANGELOG.md).

---

## v0.12.0 — 2026-04-17

**`recall` is no longer silently empty after upgrading.**

If you upgraded from v0.10/v0.11 and `memrosetta recall` always returned
a blank artifact with a `no_episodes_matched` warning while `search`
and `working-memory` worked fine, you hit the write-side gap fixed in
this release.

### What was broken

`recall` runs through the v1.0 reconstructive kernel: cues →
hippocampal pattern completion → anti-interference → evidence. That
path requires the `episodes` and `memory_episodic_bindings` tables to
exist for the user. But `store()` only populated those tables if the
caller threaded an explicit `episodeId` through every single write.
In practice nobody did, so every user's episodic layer stayed empty
forever and `recall` had nothing to complete against — even with tens
of thousands of memories in the same DB.

### What v0.12 does

1. **Detects the empty state.** `recall` now emits a dedicated
   `episodic_layer_empty` warning (distinct from a real
   `no_episodes_matched`) with an actionable hint pointing at the
   backfill command.
2. **Shows readiness in `status`.** `memrosetta status` has a new
   `Recall readiness` section with episode/binding/index counts and a
   single verdict: `ready` / `degraded` / `empty`.
3. **Backfills existing memories into episodes.**
   `memrosetta maintain --build-episodes` groups your pre-existing
   memories by `project` + `YYYY-MM-DD` and creates the episodes,
   bindings, and sparse cue index the recall kernel needs.
   Idempotent, supports `--dry-run`.
4. **Stops creating new orphans.** `store()` now auto-binds to the
   user's currently-open episode (via `openEpisode()`), so memories
   stored *after* the upgrade won't need a second backfill pass.
5. **Optional degraded fallback.** Pass `--allow-degraded` to
   `recall` (`browse` intent only) and the engine serves lexical
   search results wrapped as evidence, with confidence capped and
   the artifact header explicitly marked `[degraded: ...]`. Strict
   `verify` intent still fails closed.

### Upgrade in 30 seconds

```bash
npm i -g memrosetta@0.12.0
memrosetta maintain --build-episodes --dry-run
memrosetta maintain --build-episodes
memrosetta status                 # expect readiness=ready
memrosetta recall --query "..."   # now returns evidence
```

### Behavior change worth flagging

`store()` auto-binds by default now. If you have tooling that
deliberately creates orphan memories (bulk ingestion, migration
scripts) and you don't want them folded into whatever open episode
happens to be active, pass `autoBindEpisode: false` to the
`MemoryInput`.

Credit to Codex (Windows session) for the clean diagnostic writeup
that pinpointed `episodes=0 + bindings=0` as the missing piece.

---

## v0.11.0 — 2026-04-17

**BREAKING. Core is now 100% LLM-free and offline.**

v0.11 removes Hugging Face Transformers.js entirely — no vector
search, no NLI contradiction detector, no propositionizer, no
`sqlite-vec`, no `onnxruntime-node`, no ~1.5 GB install footprint.
Every HF code path is deleted along with `@memrosetta/embeddings`
and `@memrosetta/extractor` packages.

### Why

Windows users kept crashing with `TypeError: fetch failed` during
HF model download. On constrained networks that Codex / Claude Code
often run on (corporate proxies, captive portals, first-run
offline), memrosetta was effectively unusable until the model was
cached. The tradeoff — a >1 GB binary download before the first
successful `store()` — did not match the project's Core LLM-free
principle.

### What stays (the whole v1.0 kernel)

- Source Monitoring + episodes/segments/goals
- Dual representation (verbatim + gist) + audit versions
- Tulving 2-axis type system + memory_aliases
- **Hippocampal indexing** — the retrieval backbone
- **Pattern Completion** with 5 intents (reuse/explain/decide/browse/verify)
- `reconstructRecall` + Progressive-disclosure-friendly evidence return
- Layer B scaffolding (pattern separation, novelty, consolidation queue)
- Full Anti-Interference (diversity + goal_compat + abstraction)
- engine LayerB flags
- CLI `memrosetta recall --format text` human-readable renderer
- MCP `memrosetta_reconstruct_recall` tool
- All v1.0 reconstructive benchmarks (goal_state_preservation,
  source_fidelity, reuse_fit, context_preserving_transfer)

### What's gone

- `@memrosetta/embeddings` (HuggingFaceEmbedder, ContradictionDetector)
- `@memrosetta/extractor` (propositionizer)
- `sqlite-vec` dependency + `vec_memories` virtual table
- `memories.embedding` BLOB column
- `storeMemoryAsync`, `storeBatchAsync`, `bruteForceVectorSearch`,
  `vectorSearch`, `rrfMerge*`, `convexCombinationMerge`
- Engine options `embedder`, `contradictionDetector`, `contradictionThreshold`
- `ENABLE_EMBEDDINGS` / `MEMROSETTA_EMBEDDINGS` env vars (ignored)
- CLI `--no-embeddings` is now a no-op (kept for script compat)

### How retrieval still works without embeddings

Pattern completion uses the hippocampal episodic index — sparse cue
bundles (13 feature families, canonicalized, bipolar polarity,
Hebbian-decayed) that point back at memories through
`memory_episodic_bindings`. Recall takes natural-language query +
structured state vector, decomposes into cues, scores episodes by
cue overlap with recency + goal-fit boosts, expands to memories,
and completes missing features from the neighbor episodes. No
vector math, no model inference, fully deterministic.

For workloads that genuinely want semantic similarity, run an
embedder client-side (OpenAI, Voyage, local) and drive recall via
the `cues` / `state_vector` inputs. Core stays pluggable.

### Install

```bash
npm install -g memrosetta@0.11.0     # ~30 MB. No postinstall downloads.
memrosetta init --codex              # or --claude-code, --cursor, --gemini
memrosetta recall --query "…" --intent reuse --format text
```

### Migration from v0.10

- Existing DBs: schema v16 runs on next open. Drops
  `vec_memories` and `memories.embedding` if present. Additive,
  no data loss beyond the dropped vectors (which were regeneratable
  anyway).
- API compatibility: `engine.store()` / `engine.search()` /
  `engine.reconstructRecall()` keep the same signatures minus the
  removed optional ML params. `engine.search()` no longer takes
  a query-vector — just pass a `SearchQuery`.
- `Memory` objects no longer carry an `embedding` field.

### Tests

Workspace: **1059 tests passing**. Core: 22 files / 435 tests.

### Aligned versions

`memrosetta`, `@memrosetta/cli`, `@memrosetta/core`,
`@memrosetta/types`, `@memrosetta/mcp` = **0.11.0**.

---

## v0.10.0 — 2026-04-17

**Reconstructive Memory kernel.**

v0.10.0 is the first release where MemRosetta is no longer "FTS with
extra tricks." Store and recall now route through a brain-inspired
architecture grounded in:

- **Hippocampal Memory Indexing Theory** (Teyler & DiScenna 1986) —
  sparse cues that point at episodes
- **Fuzzy Trace Theory** (Reyna & Brainerd 1995) — verbatim + gist
  dual representation
- **Tulving 3-system** — episodic / semantic / procedural as an
  orthogonal axis next to product roles
- **Goal-State Preservation** — every memory carries *what problem
  was being solved*

### The big new thing: `memrosetta recall`

```bash
memrosetta recall \
    --query "code review prompt for typescript" \
    --intent reuse \
    --language typescript \
    --topic code-review \
    --format text
```

Pick one of five intents:
- `reuse` — adapt procedural patterns to a new context
- `explain` — narrative of what happened and why
- `decide` — evidence list for a pending decision
- `browse` — everything related, ranked
- `verify` — strict verbatim + source only

The CLI has a dedicated text renderer (confidence bar, warnings
above the artifact, evidence table with system/role/confidence/
binding). The same kernel is exposed as the MCP tool
`memrosetta_reconstruct_recall`.

### Layer A is always on; Layer B is opt-in

Layer A (source monitoring, event segmentation, goal-state memory,
dual representation, 2-axis type system, hippocampal indexing,
pattern completion) runs on every `store()` / `reconstructRecall()`.
Layer B (pattern separation, novelty scoring, consolidation queue,
prototype induction scaffolding) ships the tables and helpers but
keeps runtime behaviour behind engine flags:

```ts
createEngine({
  dbPath: '/path/to/db',
  layerB: {
    enableNoveltyScoring: true,
    enablePatternSeparation: true,
    enableConsolidation: true,
  },
});
```

### Benchmarks

A new v1.0 reconstructive recall suite ships under
`benchmarks/src/scenarios/v1-recall/`:
- `goal_state_preservation` — same cue under different goal types
- `source_fidelity` — verify intent surfaces verbatim
- `reuse_fit` — procedural memory survives state-vector shift
- `context_preserving_transfer` — shared topic cue carries across
  state vectors

These cover the baseline behavioural guarantees for the v1.0 kernel.
Stress, scale, cross-user, and query-native scenarios remain future
work.

### Schema migration

Additive only. Schema versions v9 → v15 all add new tables /
columns; `memories.source_id`, `memory_type`, and `content` stay
populated so existing search paths continue to work. Run once and
you're on v15.

### Numbers

- 22 new core test files, 485 core tests (baseline 332 → +153)
- Workspace: 1118 tests passing, typecheck clean
- 12 external review rounds (Codex), every must-fix addressed

---

## v0.9.1 — 2026-04-16

**Search quality + duplicate cleanup.**

Recency boost tuned (weight 2.0, decay 0.99/hr -- 3 days = 49%,
7 days = 19%). autoRelate expanded (50 candidates, keyword overlap 2,
cosine > 0.7 auto-extends). New `memrosetta dedupe [--dry-run]` collapses
exact-content duplicates with `duplicates` relation. Schema v8.

**Key changes**
- `packages/core/src/dedupe.ts`, `packages/cli/src/commands/dedupe.ts`.
- `duplicates` added to `relation_type` CHECK constraint.
- 938 tests green.

**Version bumps**: `@memrosetta/core` 0.6.0 -> 0.7.0,
`@memrosetta/cli` 0.8.0 -> 0.9.1, `memrosetta` 0.8.0 -> 0.9.1.

---

## v0.9.0 — 2026-04-16

**Liliplanet JWT auth integration + landing page redesign.**

`sync login` now opens the browser for a localhost callback JWT capture,
replacing the device-code flow. `sync logout` / `sync status` show auth
mode, account email, and token expiry. The sync-server verifies JWTs via
JWKS (`jose`) with dual-auth middleware (JWT + API key). push/pull in JWT
mode uses the auth context `ownerUserId`.

**Key changes**
- Removed self-built OAuth broker (providers.ts, tokens.ts,
  sessions/auth_device_requests tables).
- PostgreSQL migration: additive-first split (002a additive, 002b cleanup).
- Landing page: Bricolage Grotesque + Source Serif 4 fonts, auth callback
  page, Login/Logout state toggle in header.
- README: Hosted Cloud vs Self-Host sync paths separated.

**Version bumps**: `@memrosetta/cli` 0.8.0 -> 0.9.0,
`memrosetta` 0.8.0 -> 0.9.0.

---

## v0.8.0 — 2026-04-16

**Spreading Activation Lite on relation + co-access graph.**

After search, top-5 seed results spread activation through explicit
relations (supports +0.35, extends +0.25, derives +0.20, updates +0.10,
contradicts -0.40) and co-access edges (strength * 0.15). Hop decay:
1-hop 0.5x, 2-hop 0.2x. v0.8.0-lite boosts existing results only; new
candidate fetch is planned for v0.9.0.

**Key changes**
- `spreading.ts`: `spreadActivation()` function.
- Pipeline: rerank -> keyword -> context -> co-access -> spreading -> dedup.

**Version bumps**: `@memrosetta/core` 0.5.0 -> 0.6.0,
`@memrosetta/cli` 0.7.0 -> 0.8.0, `memrosetta` 0.7.0 -> 0.8.0.

---

## v0.7.0 — 2026-04-16

**Brain-inspired retrieval: Context-Dependent Retrieval + Hebbian Co-access.**

Memories encoded in a specific project/session context are boosted when
searched from the same context (Tulving 1973). When memories appear
together in search results, pair-wise co-access strength increments in
`memory_coaccess` (Hebb 1949), boosting co-accessed neighbors in future
searches.

**Key changes**
- `MemoryInput` gains `project` and `activityType` fields.
- `searchMemories()` accepts `contextFilters: { project?, namespace?, sessionId? }`.
  Boost: same project +0.25, same namespace +0.15, same session +0.10.
- Schema v7: `project TEXT` and `activity_type TEXT` columns on `memories` +
  `memory_coaccess` table with indexes.
- `coaccess.ts`: `recordCoAccess`, `getCoAccessNeighbors`, `decayCoAccess`.
- Pipeline: rerank -> keyword -> context boost -> co-access boost -> dedup.

**Version bumps**: `@memrosetta/core` 0.4.1 -> 0.5.0,
`@memrosetta/cli` 0.5.4 -> 0.7.0, `memrosetta` 0.5.4 -> 0.7.0.

---

## v0.5.4 — 2026-04-16

**Fixed: Windows CRLF in TOML config generation.**

The `where` command on Windows outputs `\r\n` line endings.
`resolve-command.ts` split on `\n` only, leaving `\r` inside a TOML
literal string. The closing quote landed on the next line, producing an
invalid config file. Fixed with `.split(/\r?\n/)[0]?.trim()`.

---

## v0.5.3 — 2026-04-16

**Fixed: pull pagination for large sync backlogs.**

Bumped to `@memrosetta/sync-client@0.1.7`. `pull()` previously fetched
only the first 500 ops and returned, so a new device joining a hub with
37 k+ ops needed ~74 manual `sync now` runs to converge. `pull()` now
loops through all pages (`PULL_PAGE_SIZE=1000`, `while hasMore`) in a
single call, applying each page before requesting the next. One
`memrosetta sync now` is enough for a fresh device.

---

## v0.5.2 — 2026-04-16

**Headline: Single-brain identity + Korean search fix.**

Two bugs caused by early-era design decisions landed at once:

1. **`memrosetta search` returned no results for natural-language
   Korean queries** like `"hermes github 주소가 뭐지 ?"` because FTS5
   treated every token as AND and required `주소가` / `뭐지` to appear
   in every hit. Core now preprocesses queries (NFKC, punctuation
   strip, Korean stopword removal) and relaxes 3+ token queries to
   OR so reranking handles precision.
2. **One user's memories were scattered across ~35 `user_id`
   partitions** on a single device because pre-v0.4
   `resolveUserId(cwd)` wrote `personal/<dir>` / `work/<dir>` /
   `general` as the user identity. The new
   `memrosetta migrate legacy-user-ids` command folds them all back
   onto the canonical user without touching `namespace`, clears the
   sync transport queues, and leaves a non-destructive snapshot
   behind in the new `memory_legacy_scope` table.

**New commands**
- `memrosetta migrate legacy-user-ids [--dry-run] [--canonical <user>] [--yes]`
  — one-shot, idempotent, client-only. Dry-run prints an impact
  report (legacy rows, distinct partitions, queue pending,
  cross-partition duplicate groups). Apply with `--yes` to skip the
  interactive confirm.
- `memrosetta duplicates report [--format json|text] [--limit <n>] [--verbose]`
  — read-only audit of exact-content duplicate groups across
  `user_id` partitions. Feeds the v0.5.3 destructive dedupe pass.

**Added**
- Schema v6 in `@memrosetta/core`: `migration_version` table (so
  one-shot data fixups can track themselves without piggy-backing on
  `schema_version`) and `memory_legacy_scope` supporting table. Fresh
  installs start at v6; existing installs run v5 → v6 on first open.
- `resolveCanonicalUserId(explicit?, configLoader?)` helper in
  `@memrosetta/cli`. Priority: explicit arg > `config.syncUserId` > OS
  username. Every CLI command, MCP tool handler, hook extractor, and
  enforce call now routes through this helper. Pin `syncUserId` once
  via `memrosetta sync enable --user <id>` and every device stays on
  the same identity regardless of OS username.
- Korean stopword list in `buildFtsQuery` / `preprocessQuery`.

**Fixed**
- `SyncClient.push()` no longer ships ops tagged with a legacy
  `user_id` to the hub. `Outbox.getPending(userId)` and
  `countPending(userId)` now accept an optional user filter and
  `SyncClient` always passes its configured user — so after a
  partial migration the queue stays clean.
- MCP server default user resolves through `config.syncUserId`, not
  just the OS username. `registerTools(..., { canonicalUserId })`
  pins the identity at startup.

**Deferred to v0.5.3**
- Destructive duplicate collapse. v0.5.2 only audits; v0.5.3 will
  merge or soft-invalidate duplicate rows using the priority hints
  (canonical user > higher success_count > higher use_count > newer
  learned_at) and `duplicates` relation edges.

**Upgrade path**
Every device needs the same sequence:

```
npm i -g memrosetta@0.5.2
memrosetta migrate legacy-user-ids --dry-run
memrosetta migrate legacy-user-ids
memrosetta sync backfill --user <canonical>
memrosetta sync now
memrosetta duplicates report
```

Server-side old partitions stay orphaned; they will be pruned by a
separate server tool in a later release. Back up
`~/.memrosetta/memories.db` before the migration if you want a
restore point (the CLI does not delete any rows, but a backup is
cheap).

---

## v0.5.1 — 2026-04-16

**Headline: Codex CLI gets the same enforced memory capture as Claude Code.**

`memrosetta init --codex` now writes an auto-enabled Stop hook into
`~/.codex/hooks.json` + flips `[features] codex_hooks = true`, so
Codex CLI users no longer have to hand-wire the pipeline.

**Added**
- `memrosetta-enforce-codex` bin: Codex Stop hook wrapper. Unlike the
  Claude Code counterpart, it reads `last_assistant_message` directly
  from the Codex hook event — no transcript walking. Maps the
  `memrosetta enforce stop` envelope to Codex's continuation protocol:
  `needs-continuation` becomes `{ "decision": "block", "reason": ... }`
  so Codex re-prompts the model, other statuses let the session end.
- `registerCodexHooks()` / `removeCodexHooks()` in
  `@memrosetta/cli` wire the Stop hook end-to-end: hooks.json entry,
  `[features] codex_hooks = true` in config.toml, legacy entry
  cleanup, and Windows detection (skipped upstream).
- 16 new tests in `packages/cli/__tests__/integrations/codex.test.ts`
  cover happy-path install, re-install idempotency, legacy entry
  stripping, feature-flag merging, and feature-flag tear-down on
  reset.

**Fixed**
- The hook matcher in `codex.ts` now recognizes the full set of
  memrosetta wrapper names (`memrosetta-on-stop`,
  `memrosetta-enforce-claude-code`, `memrosetta-enforce-codex`) so
  re-installing from any earlier version cleans up cleanly.

---

## v0.5.0 — 2026-04-15

**Headline: `memrosetta enforce` — structural enforcement of memory capture.**

CLAUDE.md instructions that say "after every turn, decide what to store"
only work if the model remembers to check the checklist. v0.5.0 replaces
that willpower loop with a concrete hook-driven pipeline so capture is
structural, not aspirational.

**Added**
- `memrosetta enforce stop`: new CLI subcommand that accepts a normalized
  event JSON on stdin, runs a client-side LLM extractor, stores the
  resulting atomic memories, and prints a JSON envelope:
  ```
  {
    "status": "stored | needs-continuation | noop",
    "structuredCount": N,
    "extractedCount": N,
    "memories": [{ "type": "decision", "memoryId": "mem-..." }],
    "footer": "STORED: decision(mem-...)",
    "attempt": 1,
    "maxAttempts": 2,
    "reason": "..."
  }
  ```
  `max_attempts = 2` prevents continuation loops.
- LLM extractor (`packages/cli/src/hooks/llm-extractor.ts`) with a clean
  fallback chain: `ANTHROPIC_API_KEY` (Claude Haiku) →
  `OPENAI_API_KEY` (GPT-4o-mini) → optional `@memrosetta/extractor`
  propositionizer → no-op.
- `memrosetta-enforce-claude-code` bin: Claude Code Stop hook wrapper that
  reads the Stop hook event from stdin, extracts the last assistant turn
  from the transcript, normalizes it, and `exec()`s `memrosetta enforce stop`.
  `memrosetta init --claude-code` now registers this binary automatically
  (replacing the legacy `memrosetta-on-stop` entry) with a 30 s timeout,
  so new installs get the LLM-extractor pipeline without hand-editing
  `~/.claude/settings.json`.

**Philosophy**
- `@memrosetta/core` stays LLM-free. All model calls live in the hook
  layer, since hook callers already pay for model inference.
- The same `memrosetta enforce stop` pipeline is designed to back Codex
  CLI and Copilot wrappers in follow-up releases — only the trigger and
  continuation policy differ per client.

**Fixed**
- **`SyncClient.push()` choked on large backfills.** The sync server caps
  each `/sync/push` at 500 ops, so a 2 k-memory backfill returned
  `400 Bad Request` and the outbox stayed stuck. Push now chunks pending
  ops into batches of 400 (`MAX_OPS_PER_PUSH`), marks each accepted batch
  pushed before the next request, and re-reads the cursor per batch — so
  a mid-run failure commits whatever succeeded instead of rolling the
  whole backfill back. Verified with a 30/30 test suite covering the
  multi-batch happy path and partial-failure recovery.
- `@memrosetta/cli` Codex integration (`packages/cli/src/integrations/codex.ts`)
  now emits TOML **literal strings** (`'...'`) instead of basic strings
  (`"..."`) when writing `~/.codex/config.toml`. Basic strings interpret
  backslashes, which mangled Windows paths like `C:\Users\...` into `\\`
  or produced `\U` unicode-escape errors. Literal strings have no escape
  processing, so Windows paths round-trip cleanly.
- The register/reset paths now strip both the current
  `[mcp_servers.memory-service]` block and any legacy
  `[mcp_servers.memrosetta]` blocks written by older `memrosetta init`
  versions, fixing a class of "stale entries survived a disable".

**Deferred to v0.5.1**
- Automatic Stop hook registration for Codex CLI (`~/.codex/hooks`).
  `memrosetta enforce stop` itself is already the shared backend, so you
  can wire Codex manually today; auto-registration is deferred because
  its config-merge and reset semantics deserve a dedicated test pass.

---

## v0.4.8 — 2026-04-15

**Highlights**
- Seven data-integrity fixes surfaced by Codex's end-of-session review.
- v0.4.0 → v0.4.7 sync looked healthy but was quietly corrupting keyword
  storage and re-publishing the same memories on every backfill run.

**Fixed — High (data integrity)**
- **Keyword format mismatch.** The `@memrosetta/sync-client` applier wrote
  keywords as a JSON array, but `@memrosetta/core` expects a space-joined
  string. FTS keyword recall was degraded on every synced memory. The
  applier and `sync backfill` now use the canonical space-joined format.
- **`sync backfill` crashed on keyworded memories.** Previously called
  `JSON.parse(row.keywords)` and threw on the first row. Now uses
  split-by-space, matching core.
- **Non-idempotent backfill.** `sync backfill` previously generated fresh
  `randomUUID()` op ids per run, so re-runs inflated the local outbox,
  the server log, and downstream inboxes. Backfill now uses deterministic
  ids (`op-<sha256(memory_id)[:16]>` and `op-<sha256(src|dst|type)[:16]>`),
  and `Outbox.addOp` switched to `INSERT OR IGNORE` so re-runs are no-ops
  at every layer.

**Fixed — Medium**
- **Salience drift across devices.** Pulled `feedback_given` ops only
  bumped `use_count` / `success_count`. Local `engine.feedback()` also
  adjusts `salience`, so cross-device ranking drifted over time. The
  applier now applies the same
  `salience = clamp(0.5 + 0.5 * success_rate, 0.1, 1.0)` update.
- **`pull()` ignored apply-skipped ops.** The cursor still advances (so
  skipped ops are not redownloaded forever), but `pull()` now logs every
  skip to stderr and only updates `last_pull_success_at` when no ops were
  skipped. Skipped ops stay pending in `sync_inbox` for retry.
- **MCP background sync was push-only.** The 5-minute MCP background loop
  only ran `push()`, so an MCP-only device never saw remote updates
  without a manual `memrosetta sync now`. The interval now runs
  `push()` + `pull()` sequentially, with separated logging.

**Fixed — Low**
- `@memrosetta/mcp` no longer hard-codes `VERSION = '0.3.0'`. Resolved
  from `package.json` at startup.

**Upgrade note**
After upgrading on any sync-enabled device, consider re-running
`memrosetta sync backfill` once. Because backfill is now idempotent
via deterministic op ids, the second run is a no-op on healthy memories
but will re-normalize any memory whose keywords had been mangled.

---

## v0.4.7 — 2026-04-15

**Highlights**
- CLI write paths now participate in sync, not just the MCP adapter.
- Added `memrosetta sync backfill` for one-shot enqueue of existing local
  memories into the sync outbox.

**Added**
- CLI `store`, `relate`, `invalidate`, and `feedback` now enqueue sync ops
  after the local SQLite write succeeds.
- `memrosetta sync backfill [--dry-run]` to enqueue current local memories
  and relations for first-time migration to a sync-enabled setup.

**Notes**
- `sync backfill` is a local enqueue step. Run `memrosetta sync now`
  afterwards to push the queued ops to your server.

---

## v0.4.6 — 2026-04-15

**Highlights**
- Sync is now genuinely bidirectional. Pulled ops are applied into the local
  `memories` graph instead of stopping at the inbox.

**Fixed**
- `pull()` now performs `inbox -> apply -> markApplied`, so memories pulled
  from another device become searchable locally.
- Existing unapplied inbox rows are retried on the next pull rather than
  being stranded permanently.

---

## v0.4.5 — 2026-04-15

**Highlights**
- Cross-device sync finally works when the same person's OS usernames
  disagree (e.g. `obst` on macOS and `jhlee13` on Windows).

**Fixed**
- Devices previously picked `userId` from the OS username, so two machines
  owned by the same human ended up partitioned into different server-side
  op streams. Pull returned zero ops and sync silently looked one-way.

**Added**
- `MemRosettaConfig.syncUserId` is now a first-class field. Both the CLI
  and the MCP adapter read it, falling back to the OS username only when
  absent.
- `memrosetta sync enable --user <id>` sets the shared logical user id.
  Run it on every device with the **same** value.
- `memrosetta sync status` prints the active `userId` so mismatches are
  obvious before you debug pull counts.

**Upgrade note**
Users on 0.4.1–0.4.4 should re-run `memrosetta sync enable --user <id>`
on every device, using one consistent id for all machines you own.

---

## v0.4.4 — 2026-04-15

**Highlights**
- Four independent ways to supply the sync API key (finally works on Windows).
- Mutually exclusive key sources, explicit Windows fail-fast with a
  actionable hint instead of garbage captures.

**How to upgrade**
```bash
npm install -g memrosetta@0.4.4
```

**How to enable sync (any platform)**
```bash
# Environment variable (recommended for Windows PowerShell and CI)
export MEMROSETTA_SYNC_API_KEY="your-api-key"
memrosetta sync enable --server https://your-sync-server.example.com

# Or from a file
memrosetta sync enable --server https://… --key-file /path/to/key

# Or directly (visible in shell history)
memrosetta sync enable --server https://… --key <value>

# Or from stdin (POSIX shells)
echo "key" | memrosetta sync enable --server https://… --key-stdin
```

Supplying two of `--key / --key-stdin / --key-file` now errors out fast.
On Windows the hidden prompt is disabled; if you give no explicit source
and no env variable, the CLI prints the list of supported options and
exits with a clear message.

---

## v0.4.3 — 2026-04-15

**Fixed**
- `memrosetta update` no longer reports `Current version: unknown`.
  Tolerant parsing of `npm list -g` + running-binary fallback via a new
  shared `resolveCliVersion()` helper. `status` uses the same lookup.

---

## v0.4.2 — 2026-04-15

**Fixed**
- `memrosetta sync enable` on Windows PowerShell. The previous raw-mode
  hidden input captured U+0016 and wrote it to `~/.memrosetta/config.json`,
  which then caused every sync request to fail with `fetch failed`.
  Replaced with a `readline` + muted-output implementation and validation
  that rejects control characters with a clear error.

---

## v0.4.1 — 2026-04-15

**Added**
- `memrosetta sync` CLI: `enable`, `disable`, `status`, `now`, `device-id`.
- `SyncClient.getStatus()` with push/pull timestamp tracking.

**Fixed**
- Pull was failing with HTTP 400 because the server required `userId` in
  the query. `SyncClientConfig.userId` is now required, and both the CLI
  and the MCP adapter supply the current OS user.

**Security**
- CLI `writeConfig` applies `0600` on `~/.memrosetta/config.json` and
  `0700` on the parent directory, matching the MCP adapter.

---

## v0.4.0 — 2026-04-15

**Headline feature: optional multi-device sync.**

The local SQLite engine remains the default. When a user opts in, each
device keeps its own SQLite copy and syncs through an append-only
operation log hosted on your own PostgreSQL. The protocol is CRDT-free
and idempotent.

**Added**
- `@memrosetta/sync-client`: outbox/inbox, push/pull, background push
  when MCP detects `syncEnabled: true`.
- Operation log schema: `memory_created`, `relation_created`,
  `memory_invalidated`, `feedback_given`, `memory_tier_set`. Append-only,
  idempotent by `(user_id, op_id)`.
- API expansion: `/api/memories/:id/invalidate`, `/feedback`,
  `/api/working-memory`, `/api/memories/:id/quality`. API key auth
  (`MEMROSETTA_API_KEYS` / `SERVICE_KEY`) with constant-time comparison.
- `@memrosetta/extractor`: multilingual atomic fact decomposition using
  the Propositionizer-mT5-small ONNX model.
- Brain-spec documents: `docs/brain-spec.md`, `docs/memory-types.md`,
  `docs/recall-modes.md`, `docs/sync-architecture.md`, `docs/sync-api.md`.
  Self-hosting guide included.

**Security**
- `~/.memrosetta/config.json` is written `0600`, directory `0700` on POSIX
  systems (best-effort on Windows).

**Changed**
- MCP tool pipeline takes an optional `SyncRecorder`. Enqueue failures are
  non-fatal so local SQLite writes always succeed.

**Notes**
- `@memrosetta/sync-server` and `@memrosetta/postgres` ship as 0.1.0
  pre-1.0 building blocks for self-hosted deployments. They are **not
  published to the `latest` tag yet**. Build them from the monorepo or
  pin explicitly until they stabilise.

---

## Session Ownership

This release line (v0.4.0 → v0.5.0-wip) was produced via a tight
Claude ↔ Codex collaboration:

- Architecture reviews and implementation splits were agreed panel-to-panel
  (no synchronous hand-offs lost).
- Codex owned `packages/api` and documentation; Claude owned
  `packages/core`, `sync-*`, `postgres`, and the CLI commands.
- Every release went through cross-review before publish (smoke test,
  tarball inspection, `publish --dry-run`).
- Windows post-release bugs were fixed on the same day they were reported.
