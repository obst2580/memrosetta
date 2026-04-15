# MemRosetta Sync API Draft

> Draft contract for optional multi-device sync.
> Local MemRosetta remains SQLite-first and fully functional offline.
> The sync service is an append-only operation hub backed by PostgreSQL.

## 1. Goals

- Keep the default open-source experience unchanged: local SQLite, no server required.
- Make sync optional: a user can run multiple local MemRosetta instances and converge through a hub.
- Preserve MemRosetta's non-destructive model: prefer append-only events over in-place mutation.
- Keep the protocol simple enough for "a few devices, a few thousand memories".

## 2. Non-Goals

- This is not realtime collaborative editing.
- This is not DB-level replication of SQLite files.
- This does not attempt full CRDT semantics for arbitrary mutable objects.
- This document defines the sync transport and op log contract, not the full local sync engine.

## 3. V1 Sync Model

The sync system replicates **domain operations**, not raw database pages.

Basic flow:

1. A local SQLite engine commits a domain change.
2. The local sync client writes a corresponding op to its outbox.
3. The client pushes outbox ops to the sync service.
4. The sync service stores accepted ops in PostgreSQL and assigns a monotonic `cursor`.
5. Other devices pull ops newer than their last applied `cursor`.
6. Each device applies pulled ops idempotently into its local SQLite store.

This means the server is a **sync hub**, not the primary runtime engine for open-source users.

## 4. Design Principles

### 4.1 Append-Only First

V1 should avoid mutable "update this row in place" operations whenever possible.

Preferred pattern:

- Create a new memory
- Link it with `updates`
- Keep the old memory for history

This fits MemRosetta's existing versioning model and sharply reduces sync conflicts.

### 4.2 Server Cursor Is the Replication Order

- `created_at` is the client-side logical time of the op.
- `cursor` is the server-assigned replication order.
- Pull ordering is always `ORDER BY cursor ASC`.

### 4.3 Idempotent Apply

Both push and pull must tolerate retries.

- Pushing the same `op_id` twice must not duplicate side effects.
- Applying the same pulled op twice on a device must be safe.

### 4.4 SQLite Remains Canonical at the Edge

Local features such as search, working memory, and offline capture continue to run against local SQLite.
Sync only propagates the subset of state that is worth sharing across devices.

## 5. `sync_ops` Table

V1 requires one append-only op log table in PostgreSQL.

```sql
CREATE TABLE sync_ops (
  cursor        BIGSERIAL PRIMARY KEY,
  user_id       TEXT NOT NULL,
  op_id         TEXT NOT NULL,
  device_id     TEXT NOT NULL,
  op_type       TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL,
  received_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  api_version   INTEGER NOT NULL DEFAULT 1,
  source_seq    BIGINT,
  payload       JSONB NOT NULL,

  UNIQUE (user_id, op_id)
);

CREATE INDEX idx_sync_ops_user_cursor
  ON sync_ops (user_id, cursor);

CREATE INDEX idx_sync_ops_user_device_cursor
  ON sync_ops (user_id, device_id, cursor);

CREATE INDEX idx_sync_ops_user_type_cursor
  ON sync_ops (user_id, op_type, cursor);

CREATE INDEX idx_sync_ops_user_created_at
  ON sync_ops (user_id, created_at);
```

Field meanings:

| Column | Meaning |
|---|---|
| `cursor` | Server-assigned monotonic position used for pull replication |
| `user_id` | Account owner; derived from auth context and stored explicitly |
| `op_id` | Globally unique client-generated operation ID |
| `device_id` | Stable identifier for the source device |
| `op_type` | Domain event type |
| `created_at` | Client-side operation timestamp |
| `received_at` | Server receive timestamp |
| `api_version` | Version of the sync contract |
| `source_seq` | Optional per-device sequence number for diagnostics |
| `payload` | Event body |

Notes:

- `UNIQUE (user_id, op_id)` provides transport-level deduplication.
- `cursor` is global across all users, but pull queries are filtered by `user_id`.
- `payload` should contain the minimal canonical data required to replay the op on another SQLite node.

## 6. Required V1 Op Types

### 6.1 `memory_created`

Emitted **after** a local memory has already been committed to SQLite.
There is no `memory_updated` op in V1.
Updates are represented as:

- `memory_created`
- then `relation_created` with `relationType="updates"`

Suggested payload:

```json
{
  "memoryId": "mem_xxx",
  "userId": "obst",
  "namespace": "memrosetta",
  "memoryType": "decision",
  "content": "Use sync hub instead of replacing SQLite runtime",
  "rawText": null,
  "documentDate": null,
  "sourceId": "claude-session-123",
  "confidence": 0.95,
  "salience": 0.9,
  "keywords": ["sync", "sqlite", "architecture"],
  "eventDateStart": null,
  "eventDateEnd": null,
  "invalidatedAt": null,
  "learnedAt": "2026-04-15T00:00:00.000Z"
}
```

Synced fields intentionally exclude local-only counters such as:

- `accessCount`
- `lastAccessedAt`
- `activationScore`
- `tier`

### 6.2 `relation_created`

Creates a graph edge between two memories.

Suggested payload:

```json
{
  "srcMemoryId": "mem_new",
  "dstMemoryId": "mem_old",
  "relationType": "updates",
  "reason": "Newer decision supersedes old one",
  "createdAt": "2026-04-15T00:01:00.000Z"
}
```

The receiver must apply this idempotently.
If `relationType="updates"`, the receiver should also perform the existing side effect of marking the destination memory as `is_latest=0`.

### 6.3 `memory_invalidated`

Marks a memory as invalidated without deleting it.

Suggested payload:

```json
{
  "memoryId": "mem_xxx",
  "invalidatedAt": "2026-04-15T00:02:00.000Z",
  "reason": "Obsolete after architecture change"
}
```

Apply semantics:

- If the target memory is not yet present locally, the op stays pending until dependencies arrive.
- If the memory is already invalidated, re-applying is a no-op.

### 6.4 `feedback_given`

Represents one user feedback event, not an overwritten aggregate counter.

Suggested payload:

```json
{
  "memoryId": "mem_xxx",
  "helpful": true,
  "recordedAt": "2026-04-15T00:03:00.000Z"
}
```

This must stay additive because multiple devices may report usefulness independently.

### 6.5 `memory_tier_set` (Optional V1)

Only needed if manual pinning/tier override becomes a user-visible cross-device feature.

Suggested payload:

```json
{
  "memoryId": "mem_xxx",
  "tier": "hot",
  "recordedAt": "2026-04-15T00:04:00.000Z"
}
```

If used, this is the one place where V1 may use a simple LWW rule.

## 7. Deferred Op Types

Not needed for first sync rollout:

- `artifact_created`
- `artifact_updated`
- `namespace_cleared`
- `memory_deleted`
- `memory_merged`
- `working_memory_snapshot_created`

Rationale:

- Artifacts belong in the broader capture layer and can come later.
- Destructive operations are intentionally avoided.
- Working memory is derived state, not sync source-of-truth.

## 8. Push API

### 8.1 Endpoint

`POST /sync/push`

### 8.2 Purpose

Upload one or more local outbox ops to the sync hub.

### 8.3 Request Body

```json
{
  "deviceId": "macbook-a",
  "baseCursor": 120,
  "ops": [
    {
      "opId": "op_01JS2R8N9K1M4",
      "opType": "memory_created",
      "createdAt": "2026-04-15T00:00:00.000Z",
      "sourceSeq": 41,
      "payload": {
        "memoryId": "mem_xxx",
        "userId": "obst",
        "namespace": "memrosetta",
        "memoryType": "decision",
        "content": "Use sync hub instead of replacing SQLite runtime",
        "confidence": 0.95,
        "salience": 0.9,
        "keywords": ["sync", "sqlite", "architecture"],
        "learnedAt": "2026-04-15T00:00:00.000Z"
      }
    }
  ]
}
```

Field meanings:

| Field | Meaning |
|---|---|
| `deviceId` | Stable device identifier for this client |
| `baseCursor` | Last server cursor the client had seen when building this batch |
| `ops` | Ordered list of operations from the local outbox |
| `sourceSeq` | Optional per-device strictly increasing sequence number |

### 8.4 Server Behavior

For each op:

1. Authenticate request and resolve `user_id`.
2. Validate payload against the declared `opType`.
3. Insert into `sync_ops` if `(user_id, op_id)` is new.
4. If duplicate, return the existing cursor.
5. Apply the op to the server-side materialized state idempotently.

The request order is significant.
If one op depends on another op in the same batch, the dependency must appear first.

### 8.5 Response Body

```json
{
  "success": true,
  "data": {
    "results": [
      {
        "opId": "op_01JS2R8N9K1M4",
        "status": "accepted",
        "cursor": 121
      },
      {
        "opId": "op_01JS2R8P4JQ2",
        "status": "duplicate",
        "cursor": 119
      }
    ],
    "highWatermark": 121
  }
}
```

Allowed `status` values:

- `accepted`
- `duplicate`
- `rejected`

Suggested rejection codes:

- `invalid_op`
- `unknown_op_type`
- `dependency_missing`
- `entity_conflict`
- `payload_schema_error`

### 8.6 Recommended Limits

- Max ops per push: `1000`
- Max request body size: `5 MB`
- Clients should chunk large backlogs into multiple pushes

## 9. Pull API

### 9.1 Endpoint

`GET /sync/pull?since=<cursor>&limit=<n>`

### 9.2 Purpose

Fetch all remote ops newer than the caller's last applied server cursor.

### 9.3 Query Parameters

| Param | Required | Meaning |
|---|---|---|
| `since` | yes | Last applied server cursor on this device |
| `limit` | no | Max ops to return, default `500`, max `1000` |

### 9.4 Response Body

```json
{
  "success": true,
  "data": {
    "ops": [
      {
        "cursor": 121,
        "opId": "op_01JS2R8N9K1M4",
        "deviceId": "macbook-a",
        "opType": "memory_created",
        "createdAt": "2026-04-15T00:00:00.000Z",
        "receivedAt": "2026-04-15T00:00:01.000Z",
        "sourceSeq": 41,
        "payload": {
          "memoryId": "mem_xxx",
          "userId": "obst",
          "namespace": "memrosetta",
          "memoryType": "decision",
          "content": "Use sync hub instead of replacing SQLite runtime",
          "confidence": 0.95,
          "salience": 0.9,
          "keywords": ["sync", "sqlite", "architecture"],
          "learnedAt": "2026-04-15T00:00:00.000Z"
        }
      }
    ],
    "nextCursor": 121,
    "hasMore": false
  }
}
```

Server query:

```sql
SELECT *
FROM sync_ops
WHERE user_id = $1
  AND cursor > $2
ORDER BY cursor ASC
LIMIT $3;
```

### 9.5 Echoed Own Ops

V1 should return **all** ops for the user, including ops created by the same device.

Rationale:

- simpler protocol
- deterministic replay
- easier recovery after partial failure

Clients must therefore deduplicate by `op_id` when applying pulled ops.

## 10. Conflict Policy

### 10.1 Default Strategy

Use **append-only domain events**, not row overwrite.

That means most "conflicts" become multiple valid facts in history, not destructive races.

### 10.2 Per Op Type

| Op Type | Conflict Policy |
|---|---|
| `memory_created` | No overwrite. Different `memoryId` values can coexist. Same `opId` is duplicate. Same `memoryId` with incompatible payload is `entity_conflict`. |
| `relation_created` | Idempotent apply. If the same relation already exists, materialized state is unchanged. |
| `memory_invalidated` | Idempotent apply. Already-invalidated memory remains invalidated. |
| `feedback_given` | Additive. Multiple feedback events are allowed. |
| `memory_tier_set` | LWW by `createdAt`, tie-break by `opId`. |

### 10.3 No CRDT in V1

CRDTs are unnecessary for the current domain because:

- memories are mostly immutable once created
- updates are modeled as new memories plus links
- expected scale is small
- sync frequency is low relative to document-edit systems

If later the system introduces mutable shared notes or wiki pages, those can use a different conflict model.

## 11. Apply Semantics on the Receiver

Receivers should treat pulled ops like this:

1. If `op_id` is already in local inbox/applied log, skip.
2. If dependencies are missing, move the op to pending and retry later.
3. Apply the domain change to local SQLite.
4. Mark `op_id` as applied.
5. Advance the local `last_pulled_cursor`.

Dependency examples:

- `relation_created` depends on both memories existing.
- `memory_invalidated` depends on the target memory existing.
- `feedback_given` depends on the target memory existing.

## 12. Authentication Assumption

This draft assumes every sync request is authenticated and resolved to one `user_id`.

For V1 internal deployment, API key auth is acceptable.
Longer-term, the sync server should derive `user_id` from authenticated identity and reject payloads that claim another user.

## 13. Package Placement Recommendation

This sync contract fits the following separation:

- `packages/core`
  - local SQLite engine and shared domain logic
- `packages/sync-client`
  - outbox/inbox, push/pull client, apply logic
- `packages/sync-server`
  - Hono sync API implementation
- `packages/postgres`
  - PostgreSQL persistence for `sync_ops` and server-side materialized state

This keeps PostgreSQL out of the local-first core while still making sync a first-class feature.
