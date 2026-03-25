# MemRosetta CLI Reference

Complete reference for all 14 CLI commands.

## Installation

```bash
npm install -g @memrosetta/cli
```

## Global Options

These options can be used with any command:

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `--db <path>` | string | `~/.memrosetta/memories.db` | Database file path |
| `--format <type>` | `json` \| `text` | `json` | Output format |
| `--no-embeddings` | flag | false | Disable vector embeddings (FTS-only search) |
| `--help`, `-h` | flag | - | Show help text |
| `--version`, `-v` | flag | - | Show version number |

**Notes:**
- JSON output is a single line of JSON written to stdout. Ideal for piping to `jq` or programmatic use.
- Text output is human-readable, formatted for terminal display.
- When `--no-embeddings` is set, search falls back to FTS5-only mode (no vector similarity).

---

## Commands

### memrosetta init

Initialize the database and configure tool integrations.

**Options:**

| Option | Type | Required | Default | Description |
|--------|------|----------|---------|-------------|
| `--claude-code` | flag | No | - | Set up Claude Code hooks + CLAUDE.md instructions |
| `--cursor` | flag | No | - | Set up Cursor MCP configuration (~/.cursor/mcp.json) |

**Behavior:**
- Always creates the SQLite database if it does not exist.
- Always registers the MCP server in `~/.mcp.json` (base setup).
- `--claude-code` additionally installs a Stop Hook in `~/.claude/settings.json` and adds memory instructions to `~/.claude/CLAUDE.md`.
- `--cursor` additionally writes MCP config to `~/.cursor/mcp.json`.
- Both flags can be combined.

**Examples:**

Base setup (database + MCP server):
```bash
memrosetta init
```

Output (text, `--format text`):
```
MemRosetta initialized successfully.

  What was set up:
  ----------------------------------------
  Database:   /Users/alice/.memrosetta/memories.db (created)
  MCP Server: /Users/alice/.mcp.json (always included)

  MCP is ready. Add --claude-code or --cursor for tool-specific setup.
  Example: memrosetta init --claude-code
```

Output (JSON):
```json
{
  "database": {
    "path": "/Users/alice/.memrosetta/memories.db",
    "created": true
  },
  "integrations": {
    "mcp": {
      "registered": true,
      "path": "/Users/alice/.mcp.json"
    }
  }
}
```

Full Claude Code setup:
```bash
memrosetta init --claude-code
```

Output (text):
```
MemRosetta initialized successfully.

  What was set up:
  ----------------------------------------
  Database:   /Users/alice/.memrosetta/memories.db (already exists)
  MCP Server: /Users/alice/.mcp.json (always included)
  Stop Hook:  ~/.claude/settings.json (auto-save on session end)
  CLAUDE.md:  ~/.claude/CLAUDE.md (memory instructions added)

  Restart Claude Code to activate.
```

Combined setup:
```bash
memrosetta init --claude-code --cursor
```

**Tips:**
- Run `memrosetta init` again at any time -- it is idempotent. Existing databases are preserved.
- If Claude Code is not installed (`~/.claude` does not exist), the hook step is skipped with a message.

---

### memrosetta store

Store an atomic memory.

**Options:**

| Option | Type | Required | Default | Description |
|--------|------|----------|---------|-------------|
| `--user` | string | No | system username | User identifier |
| `--content` | string | Yes* | - | Memory content text |
| `--type` | enum | Yes* | - | `fact`, `preference`, `decision`, `event` |
| `--namespace` | string | No | - | Category or grouping label |
| `--keywords` | string | No | - | Comma-separated search keywords |
| `--confidence` | number | No | - | Confidence score (0.0 - 1.0) |
| `--source-id` | string | No | - | Source identifier for provenance tracking |
| `--event-start` | string | No | - | Event start date (ISO 8601) |
| `--event-end` | string | No | - | Event end date (ISO 8601) |
| `--stdin` | flag | No | - | Read JSON input from stdin instead of flags |

*When using `--stdin`, provide `userId`, `content`, and `memoryType` in the JSON object instead.

**Stdin JSON format:**
```json
{
  "userId": "alice",
  "content": "Memory content here",
  "memoryType": "fact",
  "namespace": "optional",
  "keywords": ["optional", "array"],
  "confidence": 0.9,
  "sourceId": "optional-source"
}
```

**Examples:**

Store a fact:
```bash
memrosetta store --user alice --content "API uses Spring Boot with PostgreSQL" --type fact --keywords "spring,postgresql,api"
```

Output (JSON):
```json
{
  "memoryId": "mem-WL5IFdnKmMjx9_ES",
  "userId": "alice",
  "content": "API uses Spring Boot with PostgreSQL",
  "memoryType": "fact",
  "namespace": null,
  "keywords": ["spring", "postgresql", "api"],
  "confidence": 1.0,
  "learnedAt": "2026-03-24T06:42:00.000Z",
  "tier": "warm",
  "activationScore": 1.0,
  "isLatest": true
}
```

Output (text):
```
ID: mem-WL5IFdnKmMjx9_ES
Content: API uses Spring Boot with PostgreSQL
Type: fact
Date: 2026-03-24
Keywords: spring, postgresql, api
```

Store a preference with confidence:
```bash
memrosetta store --user alice --content "Prefers dark mode in all editors" --type preference --confidence 0.95 --namespace ui-prefs
```

Store from stdin (pipe):
```bash
echo '{"userId":"alice","content":"Prefers dark mode","memoryType":"preference"}' | memrosetta store --stdin
```

Store with event dates:
```bash
memrosetta store --user alice --content "Sprint 12 retrospective completed" --type event --event-start "2026-03-01" --event-end "2026-03-14"
```

**Tips:**
- Keywords significantly improve FTS5 search recall. Always include relevant keywords.
- One fact per memory. Break compound facts into separate `store` calls.
- Contradiction detection runs automatically when embeddings are enabled.

---

### memrosetta search

Search across memories using hybrid retrieval (FTS5 + vector + RRF).

**Options:**

| Option | Type | Required | Default | Description |
|--------|------|----------|---------|-------------|
| `--user` | string | No | system username | User identifier |
| `--query` | string | Yes | - | Search query text |
| `--limit` | number | No | `5` | Maximum number of results |
| `--namespace` | string | No | - | Filter by namespace |
| `--types` | string | No | - | Comma-separated memory type filter (e.g., `fact,decision`) |
| `--min-confidence` | number | No | - | Minimum confidence threshold (0.0 - 1.0) |

**Examples:**

Basic search:
```bash
memrosetta search --user alice --query "language preference"
```

Output (JSON):
```json
{
  "results": [
    {
      "memory": {
        "memoryId": "mem-WL5IFdnKmMjx9_ES",
        "content": "Prefers TypeScript over JavaScript",
        "memoryType": "preference",
        "learnedAt": "2026-03-24T06:42:00.000Z",
        "activationScore": 0.87
      },
      "score": 0.92,
      "matchType": "hybrid"
    },
    {
      "memory": {
        "memoryId": "mem-Xk2mP9qR4vNb7_TY",
        "content": "Uses Python for data analysis scripts",
        "memoryType": "fact",
        "learnedAt": "2026-03-20T14:30:00.000Z",
        "activationScore": 0.65
      },
      "score": 0.71,
      "matchType": "hybrid"
    }
  ],
  "totalCount": 2,
  "queryTimeMs": 3.2
}
```

Output (text):
```
[0.92] Prefers TypeScript over JavaScript (preference, 2026-03-24)
[0.71] Uses Python for data analysis scripts (fact, 2026-03-20)

2 result(s) in 3.2ms
```

Search with filters:
```bash
memrosetta search --user alice --query "auth decision" --types decision --limit 3 --min-confidence 0.8
```

Search within a namespace:
```bash
memrosetta search --user alice --query "database config" --namespace project-alpha
```

Search with text output:
```bash
memrosetta search --user alice --query "UI preferences" --format text
```

**Tips:**
- With `--no-embeddings`, only FTS5 keyword search is used (faster but less recall).
- Use `--types` to narrow results to specific memory categories.
- Results are ranked by a combination of search relevance and activation score.

---

### memrosetta get

Retrieve a single memory by its ID.

**Options:**

| Option | Type | Required | Default | Description |
|--------|------|----------|---------|-------------|
| `<memory-id>` | positional | Yes | - | The memory ID to retrieve |

**Examples:**

Get a memory:
```bash
memrosetta get mem-WL5IFdnKmMjx9_ES
```

Output (JSON):
```json
{
  "memoryId": "mem-WL5IFdnKmMjx9_ES",
  "userId": "alice",
  "content": "Prefers TypeScript over JavaScript",
  "memoryType": "preference",
  "namespace": null,
  "keywords": ["typescript", "javascript"],
  "confidence": 0.95,
  "learnedAt": "2026-03-24T06:42:00.000Z",
  "documentDate": null,
  "eventDateStart": null,
  "eventDateEnd": null,
  "tier": "warm",
  "activationScore": 0.87,
  "isLatest": true,
  "invalidatedAt": null
}
```

Output (text):
```
ID: mem-WL5IFdnKmMjx9_ES
Content: Prefers TypeScript over JavaScript
Type: preference
Date: 2026-03-24
Keywords: typescript, javascript
```

Get a non-existent memory:
```bash
memrosetta get mem-nonexistent
```

Output (JSON):
```json
{"error":"Memory not found: mem-nonexistent"}
```

**Tips:**
- The memory ID is printed when you store a memory. Use it for direct retrieval, relation creation, or invalidation.

---

### memrosetta count

Count the number of memories for a user.

**Options:**

| Option | Type | Required | Default | Description |
|--------|------|----------|---------|-------------|
| `--user` | string | No | system username | User identifier |

**Examples:**

Count memories:
```bash
memrosetta count --user alice
```

Output (JSON):
```json
{"userId":"alice","count":42}
```

Output (text):
```
Count: 42
```

Count for a user with no memories:
```bash
memrosetta count --user newuser
```

Output (JSON):
```json
{"userId":"newuser","count":0}
```

---

### memrosetta clear

Delete all memories for a user. Requires `--confirm` flag as a safety measure.

**Options:**

| Option | Type | Required | Default | Description |
|--------|------|----------|---------|-------------|
| `--user` | string | No | system username | User identifier |
| `--confirm` | flag | Yes | - | Safety confirmation flag |

**Examples:**

Clear all memories (without confirmation -- fails):
```bash
memrosetta clear --user alice
```

Output (JSON):
```json
{"error":"This will delete all memories for the user. Use --confirm to proceed."}
```

Clear all memories (confirmed):
```bash
memrosetta clear --user alice --confirm
```

Output (JSON):
```json
{"userId":"alice","cleared":42,"message":"Cleared 42 memories"}
```

Output (text):
```json
{"userId":"alice","cleared":42,"message":"Cleared 42 memories"}
```

**Tips:**
- This operation is irreversible. Unlike `invalidate`, which preserves the memory, `clear` permanently removes all memories for the user.
- The `--confirm` flag is mandatory to prevent accidental data loss.

---

### memrosetta relate

Create a typed relation between two memories.

**Options:**

| Option | Type | Required | Default | Description |
|--------|------|----------|---------|-------------|
| `--src` | string | Yes | - | Source memory ID |
| `--dst` | string | Yes | - | Destination memory ID |
| `--type` | enum | Yes | - | `updates`, `extends`, `derives`, `contradicts`, `supports` |
| `--reason` | string | No | - | Human-readable reason for the relation |

**Relation Types:**

| Type | Meaning | Example |
|------|---------|---------|
| `updates` | Source replaces or modifies destination | "Hourly rate changed from $50 to $40" |
| `extends` | Source adds detail to destination | "Especially for SaaS projects" |
| `derives` | Source is inferred from destination | "SaaS + long-term = lower initial rate OK" |
| `contradicts` | Source conflicts with destination | "Rate is $40" vs "Rate is $50" |
| `supports` | Source reinforces destination | "Multiple clients confirmed the rate" |

**Examples:**

Create an update relation:
```bash
memrosetta relate --src mem-NEW123 --dst mem-OLD456 --type updates --reason "Hourly rate changed from 50 to 40"
```

Output (JSON):
```json
{
  "srcMemoryId": "mem-NEW123",
  "dstMemoryId": "mem-OLD456",
  "relationType": "updates",
  "reason": "Hourly rate changed from 50 to 40",
  "createdAt": "2026-03-24T06:42:00.000Z"
}
```

Create a contradiction relation:
```bash
memrosetta relate --src mem-abc --dst mem-def --type contradicts
```

Invalid relation type:
```bash
memrosetta relate --src mem-abc --dst mem-def --type replaces
```

Output (JSON):
```json
{"error":"Invalid relation type: replaces. Must be one of: updates, extends, derives, contradicts, supports"}
```

**Tips:**
- Relations create a directed graph. `--src` is the newer/active memory; `--dst` is the older/referenced memory.
- When `--type updates` is used, the destination memory's `isLatest` flag is set to false.
- Contradiction relations are also created automatically by the NLI model when storing memories (if embeddings are enabled).

---

### memrosetta invalidate

Mark a memory as invalidated (outdated). The memory is preserved but marked with an `invalidatedAt` timestamp.

**Options:**

| Option | Type | Required | Default | Description |
|--------|------|----------|---------|-------------|
| `<memory-id>` | positional | Yes | - | The memory ID to invalidate |

**Examples:**

Invalidate a memory:
```bash
memrosetta invalidate mem-WL5IFdnKmMjx9_ES
```

Output (JSON):
```json
{"memoryId":"mem-WL5IFdnKmMjx9_ES","invalidated":true}
```

Missing memory ID:
```bash
memrosetta invalidate
```

Output (JSON):
```json
{"error":"Usage: memrosetta invalidate <memoryId>"}
```

**Tips:**
- Invalidation is non-destructive. The memory remains in the database with an `invalidatedAt` timestamp.
- Invalidated memories are deprioritized in search results but not removed.
- Use this when a fact becomes outdated (e.g., "We no longer use React").

---

### memrosetta ingest

Ingest a Claude Code conversation transcript (JSONL format) and extract memories from it.

**Options:**

| Option | Type | Required | Default | Description |
|--------|------|----------|---------|-------------|
| `--user` | string | No | system username | User identifier |
| `--file` | string | No | - | Path to JSONL transcript file |
| `--namespace` | string | No | `session-<id>` | Namespace for ingested memories |

**Behavior:**
- If `--file` is not provided, reads from stdin.
- Parses each line as JSON, expecting Claude Code transcript format (objects with `message.role` and `message.content`).
- Strips `<system-reminder>` tags from user messages.
- Classifies each turn: user messages containing "decide"/"go with"/"let's do" become `decision`; "prefer"/"i like"/"i want" become `preference`; other user messages become `event`; assistant messages become `fact`.
- Turns shorter than 20 characters are skipped.
- Content is truncated to 500 characters.
- Confidence: 0.9 for user turns, 0.8 for assistant turns.

**Examples:**

Ingest from a file:
```bash
memrosetta ingest --user alice --file ~/.claude/projects/myproject/session.jsonl
```

Output (JSON):
```json
{
  "stored": 15,
  "sessionId": "abc12345-6789-...",
  "namespace": "session-abc12345"
}
```

Ingest from stdin:
```bash
cat transcript.jsonl | memrosetta ingest --user alice
```

Ingest with custom namespace:
```bash
memrosetta ingest --user alice --file session.jsonl --namespace "auth-refactor-session"
```

Output when no memories extracted:
```json
{"stored":0,"message":"No memories extracted from transcript"}
```

**Tips:**
- This command is used by the Claude Code Stop Hook to automatically save session context.
- The session ID is extracted from the first JSONL entry that contains a `sessionId` field.
- If no `--namespace` is provided, it defaults to `session-<first 8 chars of sessionId>`.

---

### memrosetta working-memory

Retrieve the working memory context for a user -- the highest-activation memories that fit within a token budget.

**Options:**

| Option | Type | Required | Default | Description |
|--------|------|----------|---------|-------------|
| `--user` | string | No | system username | User identifier |
| `--max-tokens` | number | No | `3000` | Maximum token budget |

**Examples:**

Get working memory:
```bash
memrosetta working-memory --user alice
```

Output (JSON):
```json
{
  "userId": "alice",
  "maxTokens": 3000,
  "memories": [
    {
      "memoryId": "mem-abc123",
      "content": "Prefers TypeScript over JavaScript",
      "memoryType": "preference",
      "tier": "hot",
      "activationScore": 0.95
    },
    {
      "memoryId": "mem-def456",
      "content": "API uses Spring Boot with PostgreSQL on Azure",
      "memoryType": "fact",
      "tier": "hot",
      "activationScore": 0.88
    }
  ]
}
```

Output (text):
```
[HOT|0.95] Prefers TypeScript over JavaScript (preference)
[HOT|0.88] API uses Spring Boot with PostgreSQL on Azure (fact)

2 memories, ~24 tokens
```

Get working memory with custom token budget:
```bash
memrosetta working-memory --user alice --max-tokens 1000
```

No memories found:
```bash
memrosetta working-memory --user newuser --format text
```

Output (text):
```
No working memory found.
```

**Tips:**
- Token estimation uses `ceil(content.length / 4)` as an approximation.
- Working memory returns memories ordered by activation score (highest first).
- Hot-tier memories are always included first.

---

### memrosetta maintain

Run full maintenance for a user: recompute activation scores, update tiers, and compress cold memories.

**Options:**

| Option | Type | Required | Default | Description |
|--------|------|----------|---------|-------------|
| `--user` | string | No | system username | User identifier |

**Behavior:**
1. Recomputes activation scores for all memories using the ACT-R base-level learning equation.
2. Updates memory tiers (Hot/Warm/Cold) based on activation scores and age.
3. Compresses groups of cold memories with very low activation (< 0.1) into summary entries.
4. Archives (marks not-latest) the original memories that were compressed.

**Examples:**

Run maintenance:
```bash
memrosetta maintain --user alice
```

Output (JSON):
```json
{
  "userId": "alice",
  "activationUpdated": 42,
  "tiersUpdated": 8,
  "compressed": 3,
  "removed": 12
}
```

Output (text):
```
Maintenance completed for user: alice
  Activation scores updated: 42
  Tiers updated: 8
  Groups compressed: 3
  Memories archived: 12
```

Run maintenance for a user with few memories:
```bash
memrosetta maintain --user newuser --format text
```

Output (text):
```
Maintenance completed for user: newuser
  Activation scores updated: 2
  Tiers updated: 0
  Groups compressed: 0
  Memories archived: 0
```

**Tips:**
- Run periodically (e.g., weekly) to keep activation scores fresh and compress old memories.
- The Claude Code Stop Hook does not run maintenance automatically -- use this command or schedule it with cron.
- Compression is non-destructive: original memories are preserved with `isLatest = false`.

---

### memrosetta compress

Run compression only (without recomputing activation scores or updating tiers).

**Options:**

| Option | Type | Required | Default | Description |
|--------|------|----------|---------|-------------|
| `--user` | string | No | system username | User identifier |

**Behavior:**
- Groups cold memories with low activation by namespace.
- Concatenates their content into summary entries.
- Marks originals as not-latest.

**Examples:**

Run compression:
```bash
memrosetta compress --user alice
```

Output (JSON):
```json
{
  "userId": "alice",
  "compressed": 2,
  "removed": 8
}
```

Output (text):
```
Compression completed for user: alice
  Groups compressed: 2
  Memories archived: 8
```

Nothing to compress:
```bash
memrosetta compress --user newuser --format text
```

Output (text):
```
Compression completed for user: newuser
  Groups compressed: 0
  Memories archived: 0
```

**Tips:**
- Use `maintain` instead if you also want activation scores and tiers updated.
- `compress` is a subset of `maintain` -- it only runs the compression step.

---

### memrosetta status

Show database status, memory count, user list, and integration configuration.

**Options:**

No command-specific options. Uses only global options (`--db`, `--format`, `--no-embeddings`).

**Examples:**

Show status:
```bash
memrosetta status --format text
```

Output (text):
```
MemRosetta Status
========================================

Database: /Users/alice/.memrosetta/memories.db (exists, 2.4MB)
Memories: 142
Users: 2 (alice, bob)
Embeddings: enabled (bge-small-en-v1.5)

Integrations:
  Claude Code:   configured (hooks + MCP)
  Cursor:        not configured
  MCP (generic): configured
```

Output (JSON):
```json
{
  "version": "0.1.0",
  "database": {
    "path": "/Users/alice/.memrosetta/memories.db",
    "exists": true,
    "sizeBytes": 2516582,
    "sizeFormatted": "2.4MB"
  },
  "memories": 142,
  "users": ["alice", "bob"],
  "embeddings": true,
  "integrations": {
    "claudeCode": true,
    "cursor": false,
    "mcp": true
  }
}
```

Status before initialization:
```bash
memrosetta status --format text
```

Output (text):
```
MemRosetta Status
========================================

Database: /Users/alice/.memrosetta/memories.db (not found)
Memories: 0
Users: 0
Embeddings: enabled (bge-small-en-v1.5)

Integrations:
  Claude Code:   not configured
  Cursor:        not configured
  MCP (generic): not configured
```

**Tips:**
- Use `status` to verify that integrations are properly configured after running `init`.
- Database size grows as memories are stored; compression helps manage size over time.

---

### memrosetta reset

Remove integration configurations. Does not delete the database.

**Options:**

| Option | Type | Required | Default | Description |
|--------|------|----------|---------|-------------|
| `--claude-code` | flag | No | - | Remove Claude Code hooks + CLAUDE.md section + MCP |
| `--cursor` | flag | No | - | Remove Cursor MCP configuration |
| `--mcp` | flag | No | - | Remove generic MCP configuration (~/.mcp.json) |
| `--all` | flag | No | - | Remove all integrations |

At least one flag is required. If no flag is provided, usage help is printed.

**Examples:**

Show usage (no flags):
```bash
memrosetta reset
```

Output (text):
```
Usage: memrosetta reset [--claude-code] [--cursor] [--mcp] [--all]

Flags:
  --claude-code  Remove Claude Code hooks, MCP, and CLAUDE.md section
  --cursor       Remove Cursor MCP configuration
  --mcp          Remove generic MCP configuration (~/.mcp.json)
  --all          Remove all integrations
```

Remove Claude Code integration:
```bash
memrosetta reset --claude-code
```

Output (text):
```
Removed Claude Code hooks from ~/.claude/settings.json
Removed MemRosetta section from ~/.claude/CLAUDE.md
Removed MCP server from ~/.mcp.json

Note: ~/.memrosetta/ directory preserved. Delete manually if needed:
  rm -rf ~/.memrosetta
```

Output (JSON):
```json
{
  "removed": {
    "claudeCodeHooks": true,
    "claudeMd": true,
    "mcp": true,
    "cursor": false
  }
}
```

Remove all integrations:
```bash
memrosetta reset --all
```

Nothing to remove:
```bash
memrosetta reset --all --format text
```

Output (text):
```
Nothing to remove (no integrations were configured).

Note: ~/.memrosetta/ directory preserved. Delete manually if needed:
  rm -rf ~/.memrosetta
```

**Tips:**
- The database (`~/.memrosetta/`) is never deleted by `reset`. Remove it manually with `rm -rf ~/.memrosetta` if needed.
- After resetting, run `memrosetta init` again to reconfigure.
- Use `--all` to cleanly remove everything before a reinstall.

---

## Output Formats

### JSON (default)

All commands output a single line of JSON to stdout. Errors are also JSON:

```json
{"error":"Missing required option: user (--user)"}
```

Useful for scripting:
```bash
memrosetta count --user alice | jq '.count'
```

### Text (`--format text`)

Human-readable output optimized for terminal display. Search results show scores, dates, and types:

```
[0.92] Prefers TypeScript over JavaScript (preference, 2026-03-24)
[0.71] Uses Python for data analysis scripts (fact, 2026-03-20)

2 result(s) in 3.2ms
```

Working memory shows tier and activation:

```
[HOT|0.95] Prefers TypeScript over JavaScript (preference)
[HOT|0.88] API uses Spring Boot with PostgreSQL on Azure (fact)

2 memories, ~24 tokens
```

---

## Exit Codes

| Code | Meaning |
|------|---------|
| `0` | Success |
| `1` | Error (missing option, invalid input, memory not found, etc.) |

Errors are written to stderr in text mode and to stdout as JSON in json mode.

---

## Environment

| Item | Value |
|------|-------|
| Database location | `~/.memrosetta/memories.db` (default) |
| MCP config | `~/.mcp.json` |
| Claude Code hooks | `~/.claude/settings.json` |
| Claude Code instructions | `~/.claude/CLAUDE.md` |
| Cursor MCP config | `~/.cursor/mcp.json` |
| Embedding model | bge-small-en-v1.5 (33MB, MIT) |
| NLI model | nli-deberta-v3-xsmall (71MB, Apache 2.0) |

---

## Common Workflows

### First-time setup

```bash
npm install -g @memrosetta/cli
memrosetta init --claude-code
memrosetta status --format text
```

### Store and retrieve memories

```bash
memrosetta store --content "Uses PostgreSQL for all projects" --type fact --keywords "postgresql,database"
memrosetta search --query "database choice" --format text
```

### Link related memories

```bash
# Store original fact
memrosetta store --user alice --content "Hourly rate is $50" --type fact
# Note the memory ID from output, e.g., mem-AAA

# Store updated fact
memrosetta store --user alice --content "Hourly rate is $40 for long-term clients" --type fact
# Note the memory ID from output, e.g., mem-BBB

# Create update relation
memrosetta relate --src mem-BBB --dst mem-AAA --type updates --reason "Rate adjusted for long-term clients"
```

### Weekly maintenance

```bash
memrosetta maintain --user alice
memrosetta status --format text
```

### Uninstall

```bash
memrosetta reset --all
rm -rf ~/.memrosetta
npm uninstall -g @memrosetta/cli
```
