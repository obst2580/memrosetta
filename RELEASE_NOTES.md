# Release Notes

This file summarises user-facing changes per release.
For the full machine-readable history see [CHANGELOG.md](CHANGELOG.md).

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
- MCP-originated writes now enter the sync outbox automatically.

**Added**
- MCP adapter wires a `SyncRecorder` so `store`, `relate`, `invalidate`,
  and `feedback` enqueue sync ops when sync is enabled.

**Notes**
- This closed the MCP write path, but CLI writes still remained local-only
  until v0.4.7.

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

This release line (v0.4.0 → v0.4.4) was produced via a tight
Claude ↔ Codex collaboration:

- Architecture reviews and implementation splits were agreed panel-to-panel
  (no synchronous hand-offs lost).
- Codex owned `packages/api` and documentation; Claude owned
  `packages/core`, `sync-*`, `postgres`, and the CLI commands.
- Every release went through cross-review before publish (smoke test,
  tarball inspection, `publish --dry-run`).
- Windows post-release bugs were fixed on the same day they were reported.
