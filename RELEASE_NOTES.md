# Release Notes

This file summarises user-facing changes per release.
For the full machine-readable history see [CHANGELOG.md](CHANGELOG.md).

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
