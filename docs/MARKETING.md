# MemRosetta Launch Marketing Copy

All copy is ready to post. Replace nothing -- all links, commands, and numbers are real.

---

## 1. Hacker News (Show HN)

**Title:**
```
Show HN: MemRosetta -- Persistent long-term memory for AI coding tools, one local SQLite file
```

**Body:**

Every AI coding tool forgets everything between sessions. You explain your tech stack, make decisions, debug for hours -- then start a new session and it's all gone. MemRosetta is a local memory engine that gives any MCP-compatible AI tool persistent, searchable long-term memory. One SQLite file, shared across Claude Code, Cursor, Windsurf, Cline, and Claude Desktop.

The core engine has zero LLM dependencies. Your AI tool decides what to store; MemRosetta handles storage and retrieval. Search is hybrid: FTS5 (BM25) for keywords + local vector embeddings (bge-small-en-v1.5, 33MB) + Reciprocal Rank Fusion. Contradiction detection uses a local NLI model (nli-deberta-v3-xsmall, 71MB) -- when you store "hourly rate is $40" and you already have "hourly rate is $50," it auto-creates a `contradicts` relation. Memories aren't deleted; they're versioned with five relation types (updates, extends, derives, contradicts, supports) and ranked by an ACT-R activation formula so frequently accessed memories surface first, while stale ones fade.

Compared to Mem0, Zep, and Letta: those require cloud infrastructure and an LLM in the core loop. MemRosetta is a single SQLite file on your disk. No server, no API keys, no cloud. Install is `npm install -g @memrosetta/cli && memrosetta init --claude-code`.

726 tests. MIT license. v0.2.4 on npm.

GitHub: https://github.com/obst2580/memrosetta
Website: https://memrosetta.liliplanet.net

---

## 2. Reddit r/programming

**Title:**
```
Your AI coding assistant forgets everything between sessions. I built a local SQLite memory engine that fixes that.
```

**Body:**

I got tired of re-explaining my tech stack, my architectural decisions, and my debugging history to Claude Code every single morning. So I built MemRosetta -- a local long-term memory engine for AI coding tools.

The aha moment:

```
Monday (Claude Code):
  You: "We're using OAuth2 with PKCE. JWT refresh tokens rotate on every use."
  Claude: (stores via MCP -> ~/.memrosetta/memories.db)

Tuesday (new Claude Code session, fresh context):
  You: "What did we decide about auth?"
  Claude: "OAuth2 with PKCE. JWT refresh tokens rotate on every use."

Tuesday afternoon (switch to Cursor):
  You: "What's the auth setup for the API?"
  Cursor: "OAuth2 with PKCE, rate limit 100 req/min."
  -- Same memories. Same DB. Different tool.
```

One `~/.memrosetta/memories.db` SQLite file, shared by all your AI tools via MCP.

What makes it different from a notes file or a README:
- **Hybrid search**: FTS5 keywords + vector similarity + Reciprocal Rank Fusion
- **Contradiction detection**: Local NLI model (71MB, no API calls) catches conflicting facts
- **Adaptive forgetting**: ACT-R model -- frequently accessed memories rank higher
- **Atomic memories**: One fact = one record. Not text chunks.

```bash
npm install -g @memrosetta/cli
memrosetta init --claude-code   # or --cursor
```

726 tests, MIT license, v0.2.4. GitHub: https://github.com/obst2580/memrosetta

---

## 3. Reddit r/ClaudeAI

**Title:**
```
I built persistent cross-session memory for Claude Code -- one command to set up, memories survive every session restart
```

**Body:**

If you use Claude Code daily, you know the pain: every session starts from zero.

MemRosetta gives Claude Code actual persistent memory. One command:

```bash
npm install -g @memrosetta/cli && memrosetta init --claude-code
```

This sets up: MCP server (6 memory tools), Stop Hook (auto-capture on session end), CLAUDE.md instructions (tells Claude when to store).

In practice:
- Session 1: "Let's use PostgreSQL. Auth is OAuth2 with PKCE." -> Claude stores these
- Session 2 (next day): "What did we decide about the database?" -> Claude finds "PostgreSQL" from yesterday

Everything local. One SQLite file. If you also use Cursor, they share the same DB.

726 tests, MIT license, v0.2.4. GitHub: https://github.com/obst2580/memrosetta

---

## 4. Reddit r/cursor

**Title:**
```
Give Cursor persistent memory across sessions -- one local SQLite file shared with Claude Code and other AI tools
```

**Body:**

```bash
npm install -g @memrosetta/cli
memrosetta init --cursor
```

This configures MCP + .cursorrules. Cursor gets memory tools: store, search, working-memory, relate, invalidate, count.

The killer feature: if you also use Claude Code, they share the same `~/.memrosetta/memories.db`.

```
Morning in Cursor: "We're using NextAuth with GitHub OAuth"
Afternoon in Claude Code: "What auth system?" -> finds it from Cursor session
```

No cloud. No server. Hybrid search + contradiction detection + ACT-R forgetting. All local.

GitHub: https://github.com/obst2580/memrosetta

---

## 5. Twitter/X Thread (English)

**1/**
```
Every AI coding tool has the same problem:

It forgets everything between sessions.

Your tech stack. Your decisions. That bug you spent 3 hours fixing.

New session = blank slate.

I built something to fix this.
```

**2/**
```
MemRosetta: a local SQLite memory engine for AI tools.

One file: ~/.memrosetta/memories.db
All tools share it: Claude Code, Cursor, Windsurf, Cline

npm install -g @memrosetta/cli
memrosetta init --claude-code

That's it. Your AI now remembers across sessions.
```

**3/**
```
How it works:

Monday Claude Code: "Auth: OAuth2 + PKCE" -> stored
Tuesday new session: "What did we decide?" -> found from Monday
Tuesday Cursor: "Auth setup?" -> same memories, different tool

No cloud. No server. One local file.
```

**4/**
```
Not just keyword search.

Hybrid: FTS5 + vector similarity + rank fusion
Contradiction detection: local NLI model catches conflicting facts
ACT-R forgetting: frequently used memories rank higher

All local. Zero API calls.
```

**5/**
```
726 tests. MIT license. v0.2.4 on npm.

GitHub: github.com/obst2580/memrosetta
Website: memrosetta.liliplanet.net

A star helps more than you'd think.
```

---

## 6. Dev.to

**Title:**
```
How I Built a Local Long-Term Memory Engine for AI Coding Tools
```

(Full article: 1500+ words covering problem, architecture, hybrid search, contradiction detection, ACT-R, setup. See landing page for content reference.)

---

## 7. Discord

```
hey, i built a thing -- MemRosetta

local memory engine for AI coding tools. one SQLite file shared across Claude Code, Cursor, Windsurf, etc.

problem: every AI tool forgets between sessions.
solution: your AI stores facts via MCP, retrieves them in future sessions.

hybrid search, contradiction detection (local NLI, no API), ACT-R forgetting model.

npm install -g @memrosetta/cli && memrosetta init --claude-code

726 tests, MIT, v0.2.4
github.com/obst2580/memrosetta

feedback welcome!
```

---

## 8. Product Hunt

**Tagline:** `Persistent memory for AI coding tools. One local file.`

**Description:** MemRosetta gives AI coding tools long-term memory that persists across sessions. Stores decisions, facts, and preferences in a local SQLite file that all your tools share via MCP. Works with Claude Code, Cursor, Windsurf, Cline, and Claude Desktop. Hybrid search, contradiction detection, adaptive forgetting -- all local. One command to install.

---

## 9. GeekNews (Korean)

**Title:**
```
MemRosetta -- AI 코딩 도구를 위한 로컬 장기 기억 엔진 (SQLite, MCP, MIT)
```

**Body:**

AI 코딩 도구의 가장 큰 문제: 세션이 끝나면 모든 맥락을 잊어버립니다.

MemRosetta는 하나의 SQLite 파일(`~/.memrosetta/memories.db`)에 모든 AI 도구가 MCP를 통해 접근하는 로컬 장기 기억 엔진입니다. Claude Code, Cursor, Windsurf, Cline, Claude Desktop 모두 같은 파일을 공유합니다.

Mem0/Zep과의 차이: 클라우드 불필요, 코어에 LLM 의존성 없음, 로컬 NLI 모델로 모순 자동 감지, ACT-R 기반 적응형 망각, 하이브리드 검색(FTS5 + 벡터 + RRF).

```bash
npm install -g @memrosetta/cli && memrosetta init --claude-code
```

726개 테스트, MIT 라이선스, v0.2.4.

GitHub: https://github.com/obst2580/memrosetta

---

## 10. Korean Twitter/X Thread

**1/**
```
모든 AI 코딩 도구의 공통 문제:
세션 끝나면 전부 잊어버린다.
기술 스택. 아키텍처 결정. 3시간 디버깅 끝에 찾은 해결책.
새 세션 = 백지.
이걸 해결하는 걸 만들었습니다.
```

**2/**
```
MemRosetta: AI 도구를 위한 로컬 장기 기억 엔진.
하나의 파일. 모든 도구가 공유.
npm install -g @memrosetta/cli
memrosetta init --claude-code
끝.
```

**3/**
```
월요일 Claude Code: "OAuth2 + PKCE로" -> 자동 저장
화요일 새 세션: "인증 어떻게 했지?" -> 찾아서 응답
화요일 Cursor: "API 인증은?" -> 같은 기억, 다른 도구
클라우드 없음. 서버 없음. SQLite 파일 하나.
```

**4/**
```
726 테스트. MIT. v0.2.4.
github.com/obst2580/memrosetta
별 하나가 큰 힘이 됩니다.
```
