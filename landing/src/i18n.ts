export type Lang = 'en' | 'ko'

export const content = {
  en: {
    nav: {
      docs: 'Docs',
      github: 'GitHub',
    },
    hero: {
      badge: 'Brain-inspired memory · MIT open source',
      title: 'MemRosetta',
      tagline: 'Memory that survives every session.',
      subtitle:
        'AI tools start from a blank slate every time. MemRosetta gives your AI a real memory — one that persists across sessions, tools, and devices. Built on how the human brain actually stores and recalls.',
      install: 'npm install -g memrosetta',
      byline: 'Local-first SQLite. Optional self-host or hosted cloud sync.',
    },
    brainScience: {
      title: 'How it remembers',
      subtitle: 'Not another vector database. A memory engine modeled on the human brain.',
      pillars: [
        {
          label: 'Storage',
          title: 'Atomic memory with activation decay',
          body:
            'Every fact, preference, and decision is stored as a single atomic unit, not a text chunk. Each memory has an activation score — frequently recalled memories stay bright, unused ones fade. ACT-R activation + Ebbinghaus forgetting curve, the way your own brain rates what to remember.',
          citations: 'Anderson 1993, Ebbinghaus 1885',
        },
        {
          label: 'Retrieval',
          title: 'Spreading activation, not just keyword match',
          body:
            'Recalling one memory automatically activates related ones through the relation graph and Hebbian co-access edges. "Memories that fire together, wire together." One seed search spreads across semantic and associative neighbors — exactly what happens in your head.',
          citations: 'Hebb 1949, Collins & Loftus 1975, HippoRAG 2024',
        },
        {
          label: 'Reconstruction',
          title: 'Verbatim + gist, reassembled on demand',
          body:
            'Humans do not store the raw text of every conversation — they keep the gist and reconstruct details when needed. v1.0 adds pattern/procedure memory with dual verbatim+gist storage, and reconstructRecall() lets an LLM adapt a past prompt to a new context while citing evidence.',
          citations: 'Bartlett 1932, Reyna & Brainerd Fuzzy Trace',
        },
      ],
    },
    threePaths: {
      title: 'Three ways to use it',
      subtitle: 'Your memory, your terms. From single-device local to hosted cloud.',
      paths: [
        {
          name: 'Local only',
          subtitle: 'Default. Zero setup.',
          body:
            'One SQLite file at ~/.memrosetta/memories.db. All your AI tools on this machine share it through MCP. Offline forever. No account, no server, no sync.',
          auth: 'None',
          cta: 'npm install -g memrosetta',
          primary: false,
        },
        {
          name: 'Self-hosted sync',
          subtitle: 'Your devices, your server.',
          body:
            'Run @memrosetta/sync-server on your own PostgreSQL. Every device keeps a full local SQLite copy and syncs through your hub. Shared API key for authentication — no external account needed.',
          auth: 'API key (Bearer token)',
          cta: 'Self-host docs',
          primary: false,
        },
        {
          name: 'Liliplanet Cloud',
          subtitle: 'Hosted. Free tier.',
          body:
            'Log in with Google, Kakao, Naver, or email via login.liliplanet.net. Your memories sync automatically across every device you sign into. Managed backups, no server to run.',
          auth: 'JWT via login.liliplanet.net (OAuth/OIDC)',
          cta: 'Login / Sign up',
          primary: true,
        },
      ],
      note:
        'Same engine across all three. The only difference is where your memory lives and who issues the auth.',
    },
    problem: {
      title: 'The Forgetting Problem',
      subtitle:
        'Every new session starts from zero. Decisions, preferences, hard-won debugging knowledge -- all gone.',
      scenarios: [
        {
          session: 'Session 1',
          label: 'Knowledge acquired',
          items: [
            '"Our API uses Spring Boot with PostgreSQL, deployed on Azure..."',
            '"Let\'s go with approach B for the auth system"',
            '(3 hours debugging) "The fix was changing the batch size to 4"',
          ],
        },
        {
          session: 'Session 2',
          label: 'All forgotten',
          items: [
            '"What tech stack are we using?"',
            '"What did we decide about auth?"',
            '(same bug) starts from scratch',
          ],
        },
      ],
      resolution:
        'With MemRosetta, Session 2 picks up exactly where Session 1 left off.',
    },
    quickStart: {
      title: 'Quick Start',
      subtitle: 'Get started in under a minute.',
      tabs: {
        'claude-code': 'Claude Code',
        cursor: 'Cursor / MCP',
        codex: 'Codex',
        gemini: 'Gemini',
        cli: 'CLI',
      },
      code: {
        'claude-code': {
          language: 'bash',
          code: `# Install CLI and set up everything
npm install -g memrosetta
memrosetta init --claude-code

# That's it. Restart Claude Code.
# Claude will automatically:
#   - Store memories during sessions (via MCP)
#   - Search past memories when needed (via MCP)
#   - Extract facts on session end (via Stop Hook)

# Check status
memrosetta status

# Remove integration
memrosetta reset --claude-code`,
        },
        cursor: {
          language: 'json',
          code: `// Add to .mcp.json (project root or ~/.mcp.json)
{
  "mcpServers": {
    "memory-service": {
      "command": "npx",
      "args": ["-y", "@memrosetta/mcp"]
    }
  }
}

// Available MCP tools:
//   memrosetta_search  -- search past memories
//   memrosetta_store   -- save a memory
//   memrosetta_working_memory -- get top context
//   memrosetta_relate  -- link related memories
//   memrosetta_invalidate -- mark outdated`,
        },
        codex: {
          language: 'bash',
          code: `# Install CLI and set up everything
npm install -g memrosetta
memrosetta init --codex

# That's it. Restart Codex.
# Registers MCP server in ~/.codex/config.toml
# Adds memory instructions to AGENTS.md
# Shares the same ~/.memrosetta/memories.db

# Check status
memrosetta status

# Remove integration
memrosetta reset --codex`,
        },
        gemini: {
          language: 'bash',
          code: `# Install CLI and set up everything
npm install -g memrosetta
memrosetta init --gemini

# That's it. Restart Gemini.
# Registers MCP server in ~/.gemini/settings.json
# Adds memory instructions to GEMINI.md
# Shares the same ~/.memrosetta/memories.db

# Check status
memrosetta status

# Remove integration
memrosetta reset --gemini`,
        },
        cli: {
          language: 'bash',
          code: `# Install globally
npm install -g memrosetta

# Store memories (userId defaults to system username)
memrosetta store \\
  --content "Prefers TypeScript over JavaScript" \\
  --type preference

# Search
memrosetta search \\
  --query "tech stack choices" \\
  --format text
# [0.95] Decided to use Tailwind CSS (decision)
# [0.88] Prefers TypeScript over JavaScript (preference)

# Working memory (top-priority context)
memrosetta working-memory

# Run maintenance (recompute activation scores)
memrosetta maintain`,
        },
      },
      packages: {
        title: 'Packages',
      },
    },
    compatibility: {
      title: 'Works With',
      subtitle:
        'One local SQLite database per machine, shared across all your AI tools. Need the same memory on another machine? Optional self-hosted sync now separates OS usernames from logical sync users, applies pulled memories into the local graph, and keeps MCP clients current with background push + pull.',
      diagramComment: '// Local by default, optional sync across devices',
      sharing: {
        title: 'Cross-tool and cross-device memory sharing',
        description:
          'MacBook uses OS user `obst`, Windows laptop uses `jhlee13` -- but both run `memrosetta sync enable --user alice`, so they join the same logical stream. Claude Code writes via MCP, CLI writes enqueue the same sync outbox, `sync backfill` migrates older local history, and pulled ops become searchable locally instead of stopping at the inbox.',
      },
      table: {
        headers: { tool: 'Tool', mcp: 'MCP', setup: 'Setup', note: 'Note' },
      },
    },
    howItWorks: {
      title: 'How It Works',
      subtitle:
        'Three layers of memory capture, in priority order. Every session contributes to long-term knowledge.',
      layers: [
        {
          number: '1',
          title: 'Claude stores directly during session',
          description:
            'Claude Code acts as both the LLM and the memory author. When it encounters an important fact, decision, or preference, it calls memrosetta_store via MCP in real time. This is the highest-quality path: Claude understands context, extracts clean atomic facts, and tags them with type and keywords. No extra cost, no post-processing needed.',
          quality: 'Best quality',
          cost: '$0',
        },
        {
          number: '2',
          title: 'Stop Hook + LLM extraction on session end',
          description:
            'When a session ends, the Stop Hook reads the JSONL transcript and sends meaningful turns to an LLM (OpenAI or Anthropic) for fact extraction. The LLM identifies decisions, preferences, and facts that Claude may have missed during the conversation. Extracted facts are deduplicated against existing memories before storage.',
          quality: 'Good',
          cost: 'Needs API key',
        },
        {
          number: '3',
          title: 'Stop Hook + rule-based fallback',
          description:
            'No API key? No problem. Pattern matching extracts decisions ("decided to...", "let\'s go with..."), preferences ("prefers...", "always use..."), and facts from the transcript using regular expressions. Zero external dependencies, zero cost. Lower recall than LLM extraction, but catches the most important patterns.',
          quality: 'Basic',
          cost: '$0',
        },
      ],
      flow: [
        'Session active',
        'Claude stores via MCP',
        'Session ends',
        'Stop Hook extracts remaining',
        '~/.memrosetta/memories.db',
      ],
    },
    notAnotherRag: {
      title: 'Not Another RAG',
      subtitle:
        'Traditional RAG chops documents into text chunks and searches by similarity. MemRosetta is fundamentally different.',
      headers: {
        rag: 'RAG (chunk-based)',
        memrosetta: 'MemRosetta (atomic)',
      },
      rows: [
        {
          feature: 'Storage unit',
          rag: '~400 token text chunks',
          memrosetta: 'One fact = one memory',
        },
        {
          feature: 'Updates',
          rag: 'Re-index entire document',
          memrosetta: 'updates relation, old version preserved',
        },
        {
          feature: 'Retrieval',
          rag: 'Vector similarity only',
          memrosetta: 'FTS5 + activation + relation graph + Hebbian co-access',
        },
        {
          feature: 'Time awareness',
          rag: 'None',
          memrosetta: '4 timestamps: learned, documented, event, invalidated',
        },
        {
          feature: 'Forgetting',
          rag: 'Everything equal weight',
          memrosetta: 'ACT-R: frequently used memories rank higher',
        },
        {
          feature: 'Cross-tool sharing',
          rag: 'Per-tool index',
          memrosetta: 'One local DB, shared across all tools',
        },
      ],
      explanation:
        'Why atomic? A text chunk like "...API uses Spring Boot with Post..." split mid-sentence loses meaning. An atomic memory like "API uses Spring Boot + PostgreSQL on Azure" is a complete, searchable, updatable fact. When your tech stack changes, you create an updates relation -- no re-indexing, no lost context, full version history preserved.',
      ragLabel: 'RAG approach',
      ragChunks: [
        'Chunk 1: "...API uses Spring Boot with Post..."',
        'Chunk 2: "...greSql, deployed on Azure. We al..."',
        'Chunk 3: "...so decided to use approach B fo..."',
      ],
      ragNote:
        'Text split arbitrarily. Facts span multiple chunks. Updates require re-indexing. No concept of time or validity.',
      memrosettaLabel: 'MemRosetta approach',
      memrosettaMemories: [
        {
          content: 'API uses Spring Boot + PostgreSQL on Azure',
          type: 'fact',
        },
        { content: 'Decided: approach B for auth system', type: 'decision' },
        { content: 'Fix: batch size must be 4', type: 'fact' },
      ],
      memrosettaNote:
        'One fact = one memory. Each has type, timestamps, keywords, relations. Updates create `updates` links; contradictions modeled explicitly via relations.',
    },
    features: {
      title: 'Features',
      subtitle: 'Core memory engine plus the recent sync and enforce releases: local-first storage, safer multi-device sync, and hook-driven capture.',
      items: [
        {
          title: 'FTS5 + Activation Search',
          description:
            'SQLite FTS5 (BM25) keyword and content search boosted by ACT-R activation score, recency decay, relation-graph expansion, and Hebbian co-access edges. No embeddings, no external models. Sub-millisecond on 13K memories.',
        },
        {
          badge: 'v0.10',
          title: 'Reconstructive Recall',
          description:
            'The hippocampal layer stores bindings rather than raw chunks. `memrosetta recall` (CLI) and `memrosetta_reconstruct_recall` (MCP) return an episode + gist reassembled on demand -- modeled on pattern separation / pattern completion in the human brain.',
        },
        {
          title: 'Adaptive Forgetting',
          description:
            'Based on the ACT-R cognitive architecture. Activation = sigmoid(ln(sum(t_j^-0.5)) + salience). Frequently accessed memories keep high activation. Unused memories decay over time but are never deleted -- they just rank lower in search results.',
        },
        {
          title: 'Memory Tiers',
          description:
            'Hot tier (~3K tokens): working memory, always loaded, highest-activation facts. Warm tier: last 30 days of active memories, normal search ranking. Cold tier: older than 30 days, compressed into summaries. Automatic tier management via the maintain command.',
        },
        {
          badge: 'v0.4.5',
          title: 'Logical Sync Users',
          description:
            '`memrosetta sync enable --user <id>` separates the shared human identity from each machine\'s OS username. A Mac `obst` and Windows `jhlee13` can finally converge on the same remote stream without hacks or surprise empty pulls.',
        },
        {
          badge: 'v0.4.6',
          title: 'True Bidirectional Sync',
          description:
            '`pull()` no longer stops at the inbox. Remote ops are applied into the local `memories` graph and retried if an earlier apply was skipped, so memories from another device become searchable on the next sync.',
        },
        {
          badge: 'v0.4.7',
          title: 'CLI Writes + Sync Backfill',
          description:
            'CLI `store`, `relate`, `invalidate`, and `feedback` now enqueue sync ops after the local SQLite write succeeds. `memrosetta sync backfill` migrates existing local memories and relations into the outbox for first-time sync rollout.',
        },
        {
          badge: 'v0.4.8',
          title: 'Sync Integrity Guardrails',
          description:
            'Keywords are normalized to the canonical space-joined format, `sync backfill` uses deterministic op ids, and the MCP background loop now runs `push()` plus `pull()` so remote updates arrive without manual babysitting.',
        },
        {
          badge: 'v0.5.0',
          title: 'Hook-Enforced Capture',
          description:
            '`memrosetta enforce stop` turns end-of-session capture into a structural hook pipeline. `memrosetta init --claude-code` wires the Stop hook automatically, and sync `push()` now chunks large backfills into 400-op batches so multi-thousand-memory devices sync cleanly.',
        },
        {
          badge: 'v0.5.1-v0.5.4',
          title: 'Identity, Sync & Cross-Platform Fixes',
          description:
            'Codex Stop hook auto-registration (v0.5.1). Canonical `user_id` migration collapses 30+ legacy partitions into one brain, Korean FTS5 preprocessing (v0.5.2). `pull()` paginates through all pages so new devices catch up in one sync run (v0.5.3). Windows CRLF fix in TOML config generation (v0.5.4).',
        },
        {
          badge: 'v0.7.0-v0.8.0',
          title: 'Brain-Inspired Retrieval',
          description:
            'Context-dependent retrieval boosts memories from the same project/session (Tulving 1973). Hebbian co-access strengthens memories that appear together in search results (Hebb 1949). Spreading activation propagates relevance through relation and co-access edges with hop decay.',
        },
        {
          badge: 'v0.9.0-v0.9.1',
          title: 'Auth Rework + Search Quality',
          description:
            'Liliplanet JWT auth replaces the device-code flow: browser-based login, JWKS verification, dual-auth middleware. Recency boost tuned (decay 0.99/hr), autoRelate expanded (50 candidates, cosine>0.7 auto-extends), and `memrosetta dedupe` collapses exact-content duplicates. 938 tests green.',
        },
      ],
    },
    architecture: {
      title: 'Architecture',
      subtitle: 'Modular package design. Each package has a single responsibility. Core engine: zero LLM dependency. Your AI tool acts as the intelligent client -- it decides what to store and when to search.',
      packages: [
        {
          name: '@memrosetta/core',
          description: 'Memory engine: SQLite + FTS5 + relation graph + reconstructive recall. Stores, searches, relates, compresses. Zero LLM, zero ML dependency (v0.11+).',
        },
        {
          name: '@memrosetta/mcp',
          description: 'MCP (Model Context Protocol) server exposing 8 tools: store, search, working_memory, relate, invalidate, count, feedback, reconstruct_recall. Any MCP-compatible AI tool can connect.',
        },
        {
          name: '@memrosetta/claude-code',
          description: 'DEPRECATED: Use @memrosetta/cli instead. Run: npm install -g memrosetta && memrosetta init --claude-code',
        },
        {
          name: '@memrosetta/cli',
          description: 'Full CLI for manual memory management: store, search, relate, maintain, compress, ingest, status, and sync commands. Supports JSON and text output formats.',
        },
        {
          name: '@memrosetta/sync-client',
          description: 'Optional local-first sync client. Keeps an outbox/inbox in SQLite and can push or pull through your own sync server when you want cross-device memory.',
        },
        {
          name: '@memrosetta/api',
          description: 'REST API built with Hono. Endpoints for all memory operations. Can be deployed as a standalone server for team use.',
        },
        {
          name: '@memrosetta/llm',
          description: 'Optional LLM-based fact extraction from conversation transcripts. Supports OpenAI and Anthropic. Used by Stop Hook layer 2 for higher-quality extraction.',
        },
      ],
      dependencyGraph: 'cli, mcp, api, sync-client, claude-code --> core (SQLite + FTS5, no ML deps)',
    },
    comparison: {
      title: 'Why MemRosetta?',
      subtitle: 'How MemRosetta compares to existing AI memory solutions.',
      headers: {
        feature: '',
        mem0: 'Mem0',
        zep: 'Zep',
        letta: 'Letta',
        memrosetta: 'MemRosetta',
      },
      rows: [
        {
          feature: 'Local-first',
          mem0: 'Cloud',
          zep: 'Cloud',
          letta: 'Cloud + Local',
          memrosetta: 'Local (SQLite)',
        },
        {
          feature: 'LLM dependency',
          mem0: 'Required',
          zep: 'Required',
          letta: 'Required',
          memrosetta: 'None (AI tool is the client)',
        },
        {
          feature: 'Contradiction detection',
          mem0: 'No',
          zep: 'No',
          letta: 'No',
          memrosetta: 'Yes (NLI, local)',
        },
        {
          feature: 'Forgetting model',
          mem0: 'No',
          zep: 'No',
          letta: 'No',
          memrosetta: 'Yes (ACT-R)',
        },
        {
          feature: 'Time model',
          mem0: 'No',
          zep: 'No',
          letta: 'No',
          memrosetta: 'Yes (4 timestamps)',
        },
        {
          feature: 'Relational versioning',
          mem0: 'No',
          zep: 'No',
          letta: 'No',
          memrosetta: 'Yes (5 types)',
        },
        {
          feature: 'Cross-tool sharing',
          mem0: 'No',
          zep: 'No',
          letta: 'No',
          memrosetta: 'Yes, one local DB',
        },
        {
          feature: 'Open protocol',
          mem0: 'API only',
          zep: 'API only',
          letta: 'API only',
          memrosetta: 'CLI + MCP + API',
        },
        {
          feature: 'Install',
          mem0: 'Complex',
          zep: 'Complex',
          letta: 'Complex',
          memrosetta: 'One command',
        },
      ],
    },
    footer: {
      tagline:
        'One persistent memory shared across all your AI tools. Local-first, optionally synced, open source.',
      motto: 'Memory + Rosetta: unlocking AI memory, one fact at a time.',
    },
  },

  ko: {
    nav: {
      docs: '문서',
      github: 'GitHub',
    },
    hero: {
      badge: '뇌과학 기반 기억 · MIT 오픈소스',
      title: 'MemRosetta',
      tagline: '세션이 끝나도 기억은 남습니다.',
      subtitle:
        'AI 도구는 매번 백지에서 시작합니다. MemRosetta는 AI에게 진짜 기억을 줍니다. 세션, 도구, 기기를 넘어 이어지는 기억. 인간 뇌가 저장하고 떠올리는 방식 그대로.',
      install: 'npm install -g memrosetta',
      byline: '로컬 우선 SQLite. 선택적 직접 호스팅 또는 관리형 클라우드 sync.',
    },
    brainScience: {
      title: '어떻게 기억하는가',
      subtitle: '또 다른 벡터 DB가 아닙니다. 인간 뇌를 본뜬 기억 엔진입니다.',
      pillars: [
        {
          label: '저장',
          title: '활성화 감쇠를 가진 원자적 기억',
          body:
            '사실, 선호, 결정을 텍스트 청크가 아닌 원자 단위로 저장합니다. 각 기억은 활성화 점수를 가지며 — 자주 떠올린 기억은 또렷해지고, 쓰지 않은 기억은 점점 희미해집니다. ACT-R 활성화 + 에빙하우스 망각 곡선, 뇌가 기억을 평가하는 방식 그대로.',
          citations: 'Anderson 1993, Ebbinghaus 1885',
        },
        {
          label: '인출',
          title: '확산 활성화 — 단순 키워드 매칭이 아닙니다',
          body:
            '한 기억을 떠올리면 relation 그래프와 Hebbian co-access 엣지를 타고 연관된 기억이 자동으로 활성화됩니다. "같이 발화하는 뉴런은 같이 엮인다." 하나의 쿼리가 의미적·연상적 이웃으로 퍼져나갑니다 — 머릿속에서 일어나는 일 그대로.',
          citations: 'Hebb 1949, Collins & Loftus 1975, HippoRAG 2024',
        },
        {
          label: '재구성',
          title: '원문 + 요지 이중 저장, 필요할 때 재조합',
          body:
            '인간은 대화의 원문을 저장하지 않습니다 — 핵심을 남기고 필요할 때 재구성합니다. v1.0에서 pattern/procedure 메모리 타입과 verbatim+gist 이중 저장이 추가됩니다. reconstructRecall()은 LLM이 과거 프롬프트를 새 맥락에 맞게 재구성하되, 증거 메모리 ID를 함께 반환합니다.',
          citations: 'Bartlett 1932, Reyna & Brainerd Fuzzy Trace',
        },
      ],
    },
    threePaths: {
      title: '세 가지 사용 방식',
      subtitle: '당신의 기억, 당신의 방식으로. 단일 기기 로컬부터 관리형 클라우드까지.',
      paths: [
        {
          name: '로컬 전용',
          subtitle: '기본값. 설정 불필요.',
          body:
            '~/.memrosetta/memories.db에 SQLite 파일 하나. 이 기기의 모든 AI 도구가 MCP를 통해 공유합니다. 영구 오프라인. 계정 없음, 서버 없음, 동기화 없음.',
          auth: '없음',
          cta: 'npm install -g memrosetta',
          primary: false,
        },
        {
          name: '직접 호스팅 sync',
          subtitle: '내 기기, 내 서버.',
          body:
            '본인 PostgreSQL 위에 @memrosetta/sync-server를 운영합니다. 모든 기기는 로컬 SQLite 전체를 가지면서 내 허브로 동기화합니다. 공유 API key 인증 — 외부 계정 불필요.',
          auth: 'API key (Bearer 토큰)',
          cta: '직접 호스팅 가이드',
          primary: false,
        },
        {
          name: 'Liliplanet Cloud',
          subtitle: '관리형. 무료 티어 제공.',
          body:
            'login.liliplanet.net을 통해 Google, 카카오, 네이버, 이메일로 로그인합니다. 로그인한 모든 기기에서 기억이 자동 동기화됩니다. 백업 관리형, 서버 운영 불필요.',
          auth: 'login.liliplanet.net을 통한 JWT (OAuth/OIDC)',
          cta: '로그인 / 가입',
          primary: true,
        },
      ],
      note:
        '세 방식 모두 같은 엔진을 사용합니다. 차이는 기억이 어디 저장되고 누가 인증을 발급하는지뿐.',
    },
    problem: {
      title: '망각 문제',
      subtitle:
        '새 세션은 항상 백지에서 시작합니다. 결정, 선호, 디버깅 노하우 -- 모두 사라집니다.',
      scenarios: [
        {
          session: '세션 1',
          label: '지식 축적',
          items: [
            '"우리 API는 Azure에 배포된 Spring Boot + PostgreSQL이야..."',
            '"인증 시스템은 방안 B로 가자"',
            '(3시간 디버깅) "배치 사이즈를 4로 바꾸면 해결돼"',
          ],
        },
        {
          session: '세션 2',
          label: '모두 유실',
          items: [
            '"기술 스택이 뭐였죠?"',
            '"인증 관련 결정은요?"',
            '(같은 버그) 처음부터 다시 시작',
          ],
        },
      ],
      resolution:
        'MemRosetta가 있으면, 세션 2는 세션 1이 끝난 곳에서 바로 시작합니다.',
    },
    quickStart: {
      title: '빠른 시작',
      subtitle: '1분 안에 시작할 수 있습니다.',
      tabs: {
        'claude-code': 'Claude Code',
        cursor: 'Cursor / MCP',
        codex: 'Codex',
        gemini: 'Gemini',
        cli: 'CLI',
      },
      code: {
        'claude-code': {
          language: 'bash',
          code: `# CLI 설치 후 모든 설정 완료
npm install -g memrosetta
memrosetta init --claude-code

# 끝. Claude Code를 재시작하세요.
# Claude가 자동으로:
#   - 세션 중 기억을 저장합니다 (MCP)
#   - 필요할 때 과거 기억을 검색합니다 (MCP)
#   - 세션 종료 시 사실을 추출합니다 (Stop Hook)

# 상태 확인
memrosetta status

# 통합 제거
memrosetta reset --claude-code`,
        },
        cursor: {
          language: 'json',
          code: `// .mcp.json에 추가 (프로젝트 루트 또는 ~/.mcp.json)
{
  "mcpServers": {
    "memory-service": {
      "command": "npx",
      "args": ["-y", "@memrosetta/mcp"]
    }
  }
}

// 사용 가능한 MCP 도구:
//   memrosetta_search  -- 과거 기억 검색
//   memrosetta_store   -- 기억 저장
//   memrosetta_working_memory -- 상위 컨텍스트 가져오기
//   memrosetta_relate  -- 관련 기억 연결
//   memrosetta_invalidate -- 무효화 표시`,
        },
        codex: {
          language: 'bash',
          code: `# CLI 설치 후 모든 설정 완료
npm install -g memrosetta
memrosetta init --codex

# 끝. Codex를 재시작하세요.
# ~/.codex/config.toml에 MCP 서버 등록
# AGENTS.md에 메모리 사용 지침 추가
# 동일한 ~/.memrosetta/memories.db 공유

# 상태 확인
memrosetta status

# 통합 제거
memrosetta reset --codex`,
        },
        gemini: {
          language: 'bash',
          code: `# CLI 설치 후 모든 설정 완료
npm install -g memrosetta
memrosetta init --gemini

# 끝. Gemini를 재시작하세요.
# ~/.gemini/settings.json에 MCP 서버 등록
# GEMINI.md에 메모리 사용 지침 추가
# 동일한 ~/.memrosetta/memories.db 공유

# 상태 확인
memrosetta status

# 통합 제거
memrosetta reset --gemini`,
        },
        cli: {
          language: 'bash',
          code: `# 전역 설치
npm install -g memrosetta

# 기억 저장 (userId는 시스템 사용자명으로 자동 설정)
memrosetta store \\
  --content "TypeScript를 JavaScript보다 선호" \\
  --type preference

# 검색
memrosetta search \\
  --query "기술 스택 선택" \\
  --format text
# [0.95] Tailwind CSS 사용 결정 (decision)
# [0.88] TypeScript를 JavaScript보다 선호 (preference)

# 작업 기억 (최우선 컨텍스트)
memrosetta working-memory

# 유지보수 (활성화 점수 재계산)
memrosetta maintain`,
        },
      },
      packages: {
        title: '패키지',
      },
    },
    compatibility: {
      title: '호환성',
      subtitle:
        '기기마다 있는 로컬 SQLite 데이터베이스 하나를 모든 AI 도구가 공유합니다. 다른 기기에도 같은 기억이 필요하면 선택적으로 자체 호스팅 sync를 붙이면 됩니다. 이제 OS username과 논리 sync 사용자를 분리하고, pull 결과를 로컬 그래프에 적용하며, MCP 클라이언트는 백그라운드 push + pull로 최신 상태를 유지합니다.',
      diagramComment: '// 기본은 로컬, 필요할 때 기기 간 sync',
      sharing: {
        title: '도구 간 + 기기 간 기억 공유',
        description:
          'MacBook의 OS user가 `obst`, Windows 노트북은 `jhlee13`여도 두 기기에서 `memrosetta sync enable --user alice`를 쓰면 같은 논리 스트림에 합류합니다. Claude Code의 MCP 쓰기와 CLI 쓰기가 같은 outbox로 들어가고, `sync backfill`이 예전 로컬 히스토리를 올리며, pull한 op는 inbox에서 멈추지 않고 로컬에서 바로 검색 가능해집니다.',
      },
      table: {
        headers: { tool: '도구', mcp: 'MCP', setup: '설정', note: '비고' },
      },
    },
    howItWorks: {
      title: '작동 원리',
      subtitle:
        '세 가지 기억 캡처 레이어가 우선순위 순으로 작동합니다. 모든 세션이 장기 지식에 기여합니다.',
      layers: [
        {
          number: '1',
          title: 'Claude가 세션 중 직접 저장',
          description:
            'Claude Code가 LLM과 기억 작성자 역할을 동시에 수행합니다. 중요한 사실, 결정, 선호를 만나면 MCP를 통해 memrosetta_store를 실시간으로 호출합니다. 최고 품질의 경로: Claude가 맥락을 이해하고, 깨끗한 원자적 사실을 추출하며, 타입과 키워드를 태깅합니다. 추가 비용 없음, 후처리 불필요.',
          quality: '최고 품질',
          cost: '$0',
        },
        {
          number: '2',
          title: 'Stop Hook + LLM 추출 (세션 종료 시)',
          description:
            '세션이 끝나면 Stop Hook이 JSONL 트랜스크립트를 읽고 의미 있는 턴을 LLM(OpenAI 또는 Anthropic)에 보내 사실을 추출합니다. LLM이 대화 중 Claude가 놓쳤을 수 있는 결정, 선호, 사실을 식별합니다. 추출된 사실은 저장 전에 기존 기억과 중복 검사를 합니다.',
          quality: '양호',
          cost: 'API 키 필요',
        },
        {
          number: '3',
          title: 'Stop Hook + 규칙 기반 폴백',
          description:
            'API 키가 없어도 괜찮습니다. 정규식 패턴 매칭으로 결정("결정했다...", "~로 가자..."), 선호("~를 선호한다...", "항상 ~를 사용..."), 사실을 트랜스크립트에서 추출합니다. 외부 의존성 제로, 비용 제로. LLM 추출보다 재현율은 낮지만, 가장 중요한 패턴은 잡아냅니다.',
          quality: '기본',
          cost: '$0',
        },
      ],
      flow: [
        '세션 활성',
        'Claude가 MCP로 저장',
        '세션 종료',
        'Stop Hook이 나머지 추출',
        '~/.memrosetta/memories.db',
      ],
    },
    notAnotherRag: {
      title: 'RAG가 아닙니다',
      subtitle:
        '기존 RAG는 문서를 텍스트 조각으로 잘라 유사도로 검색합니다. MemRosetta는 근본적으로 다릅니다.',
      headers: {
        rag: 'RAG (청크 기반)',
        memrosetta: 'MemRosetta (원자적)',
      },
      rows: [
        {
          feature: '저장 단위',
          rag: '~400 토큰 텍스트 조각',
          memrosetta: '1사실 = 1기억',
        },
        {
          feature: '업데이트',
          rag: '전체 문서 재색인',
          memrosetta: 'updates 관계, 이전 버전 보존',
        },
        {
          feature: '모순 감지',
          rag: '양쪽 다 반환, AI가 추측',
          memrosetta: 'FTS5 + 활성화 + 관계 그래프 + Hebbian co-access',
        },
        {
          feature: '시간 인식',
          rag: '없음',
          memrosetta: '4개 타임스탬프: 학습, 문서, 이벤트, 무효화',
        },
        {
          feature: '망각',
          rag: '모든 기억 동일 가중치',
          memrosetta: 'ACT-R: 자주 사용하는 기억 우선',
        },
        {
          feature: '도구 간 공유',
          rag: '도구별 인덱스',
          memrosetta: '로컬 DB 하나, 모든 도구가 공유',
        },
      ],
      explanation:
        '왜 원자적인가? "...API는 Spring Boot을 사용하고 Post..."처럼 문장 중간에서 잘린 텍스트 청크는 의미를 잃습니다. "API는 Azure에 배포된 Spring Boot + PostgreSQL"이라는 원자적 기억은 완전하고, 검색 가능하며, 업데이트할 수 있는 사실입니다. 기술 스택이 바뀌면 updates 관계를 생성하면 됩니다 -- 재색인 없이, 맥락 유실 없이, 전체 버전 이력이 보존됩니다.',
      ragLabel: 'RAG 방식',
      ragChunks: [
        'Chunk 1: "...API는 Spring Boot을 사용하고 Post..."',
        'Chunk 2: "...greSQL, Azure에 배포. 우리는 또..."',
        'Chunk 3: "...한 인증에 방안 B를 선택하기로..."',
      ],
      ragNote:
        '텍스트가 임의로 분할됩니다. 사실이 여러 조각에 걸쳐 있습니다. 업데이트시 재색인 필요. 시간이나 유효성 개념 없음.',
      memrosettaLabel: 'MemRosetta 방식',
      memrosettaMemories: [
        {
          content: 'API는 Azure에 배포된 Spring Boot + PostgreSQL',
          type: 'fact',
        },
        { content: '결정: 인증 시스템 방안 B', type: 'decision' },
        { content: '수정: 배치 사이즈를 4로 설정', type: 'fact' },
      ],
      memrosettaNote:
        '1사실 = 1기억. 각각 타입, 타임스탬프, 키워드, 관계를 가집니다. 업데이트는 링크를 생성하고, 모순은 자동 감지됩니다.',
    },
    features: {
      title: '기능',
      subtitle: '코어 메모리 엔진에 최근 sync와 enforce 릴리즈까지: 로컬 우선 저장, 더 안전한 멀티디바이스 sync, 그리고 hook 기반 캡처.',
      items: [
        {
          title: 'FTS5 + 활성화 검색',
          description:
            'SQLite FTS5 (BM25) 키워드/내용 검색에 ACT-R 활성화 점수, 최근성 감쇠, 관계 그래프 확장, Hebbian co-access 엣지 가중을 결합. 임베딩 없음, 외부 모델 없음. 13K 기억에서 sub-millisecond 지연.',
        },
        {
          badge: 'v0.10',
          title: '재구성 회상 (Reconstructive Recall)',
          description:
            '해마(hippocampal) 레이어가 원시 청크 대신 binding 을 저장합니다. `memrosetta recall` (CLI) 과 `memrosetta_reconstruct_recall` (MCP) 이 필요할 때 episode + gist 를 재조립해서 반환합니다 — 인간 뇌의 패턴 분리/완성을 모델링한 구조.',
        },
        {
          title: '적응형 망각',
          description:
            'ACT-R 인지 아키텍처 기반. activation = sigmoid(ln(sum(t_j^-0.5)) + salience). 자주 접근하는 기억은 높은 활성화 유지. 안 쓰는 기억은 시간이 지나며 감소하지만 절대 삭제되지 않음 -- 검색 결과에서 순위만 낮아짐.',
        },
        {
          title: '기억 계층',
          description:
            'Hot 계층 (~3K 토큰): 작업 기억, 항상 로드, 최고 활성화 사실. Warm 계층: 최근 30일 활성 기억, 정상 검색 랭킹. Cold 계층: 30일 이상, 요약으로 압축. maintain 명령으로 자동 계층 관리.',
        },
        {
          badge: 'v0.4.5',
          title: '논리 sync 사용자 ID',
          description:
            '`memrosetta sync enable --user <id>`가 사람의 공유 sync ID를 각 기기의 OS username과 분리합니다. macOS의 `obst`와 Windows의 `jhlee13`도 더 이상 갈라진 스트림에 빠지지 않고 같은 원격 op 스트림으로 합쳐집니다.',
        },
        {
          badge: 'v0.4.6',
          title: '진짜 양방향 sync',
          description:
            '`pull()`이 더 이상 inbox에서 멈추지 않습니다. 다른 기기에서 온 op를 로컬 `memories` 그래프에 실제로 적용하고, 이전 apply가 건너뛰어진 행도 다음 pull에서 다시 시도하므로 다른 기기의 기억이 로컬에서 바로 검색됩니다.',
        },
        {
          badge: 'v0.4.7',
          title: 'CLI 쓰기 + sync backfill',
          description:
            'CLI `store`, `relate`, `invalidate`, `feedback`도 이제 로컬 SQLite 쓰기 직후 sync op를 enqueue합니다. `memrosetta sync backfill`은 기존 로컬 memories/relations를 outbox에 올려서 첫 sync 도입 시 히스토리를 한 번에 이관합니다.',
        },
        {
          badge: 'v0.4.8',
          title: 'sync 정합성 가드레일',
          description:
            'keywords는 canonical한 공백-결합 포맷으로 정규화되고, `sync backfill`은 deterministic op id를 쓰며, MCP 백그라운드 루프는 `push()` 뒤에 `pull()`까지 수행합니다. 따라서 수동 재실행과 장치 간 동기화가 훨씬 안전해졌습니다.',
        },
        {
          badge: 'v0.5.0',
          title: 'Hook 기반 강제 캡처',
          description:
            '`memrosetta enforce stop`이 세션 종료 시 기억 추출을 "하면 좋다"가 아니라 구조적 hook 파이프라인으로 바꿉니다. `memrosetta init --claude-code`가 Stop hook을 자동 등록하고, sync `push()`는 대용량 backfill을 400-op 배치로 나눠 보내 수천 건 규모의 장치도 깔끔히 동기화됩니다.',
        },
        {
          badge: 'v0.5.1-v0.5.4',
          title: 'ID 통합, sync 개선, 크로스 플랫폼 수정',
          description:
            'Codex Stop hook 자동 등록 (v0.5.1). canonical `user_id` 마이그레이션으로 30개 이상의 레거시 파티션을 하나로 통합, 한글 FTS5 전처리 (v0.5.2). `pull()`이 모든 페이지를 순회하여 새 기기가 한 번의 sync로 동기화 완료 (v0.5.3). Windows CRLF TOML 설정 생성 버그 수정 (v0.5.4).',
        },
        {
          badge: 'v0.7.0-v0.8.0',
          title: '뇌과학 기반 검색',
          description:
            '맥락 의존 인출로 같은 프로젝트/세션의 기억을 부스트합니다 (Tulving 1973). Hebbian 동시 접근은 함께 검색된 기억을 강화합니다 (Hebb 1949). 확산 활성화가 relation 및 co-access 엣지를 통해 관련성을 전파하며 hop decay를 적용합니다.',
        },
        {
          badge: 'v0.9.0-v0.9.1',
          title: '인증 리워크 + 검색 품질',
          description:
            'Liliplanet JWT 인증이 device-code 흐름을 대체합니다: 브라우저 기반 로그인, JWKS 검증, 이중 인증 미들웨어. Recency 부스트 강화 (decay 0.99/hr), autoRelate 확장 (후보 50개, cosine>0.7 자동 extends), `memrosetta dedupe`로 동일 내용 중복 정리. 938개 테스트 통과.',
        },
      ],
    },
    architecture: {
      title: '아키텍처',
      subtitle: '모듈형 패키지 설계. 각 패키지는 단일 책임. 코어 엔진: LLM 의존성 제로. AI 도구가 지능적 클라이언트 역할 -- 무엇을 저장하고 언제 검색할지 결정.',
      packages: [
        {
          name: '@memrosetta/core',
          description: '메모리 엔진: SQLite + FTS5 + 관계 그래프 + 재구성 회상. 저장, 검색, 관계 연결, 압축. LLM 의존성 제로, ML 의존성 제로 (v0.11+).',
        },
        {
          name: '@memrosetta/mcp',
          description: 'MCP(Model Context Protocol) 서버. 8개 도구 노출: store, search, working_memory, relate, invalidate, count, feedback, reconstruct_recall. MCP 호환 AI 도구라면 무엇이든 연결 가능.',
        },
        {
          name: '@memrosetta/claude-code',
          description: 'DEPRECATED: @memrosetta/cli를 사용하세요. 실행: npm install -g memrosetta && memrosetta init --claude-code',
        },
        {
          name: '@memrosetta/cli',
          description: '수동 기억 관리를 위한 전체 CLI: store, search, relate, maintain, compress, ingest, status, sync 명령을 포함합니다. JSON 및 텍스트 출력 형식 지원.',
        },
        {
          name: '@memrosetta/sync-client',
          description: '선택적 로컬 우선 동기화 클라이언트. SQLite 안에 outbox/inbox를 유지하고, 다른 기기와 기억을 공유하고 싶을 때 직접 운영하는 sync 서버를 통해 push/pull 합니다.',
        },
        {
          name: '@memrosetta/api',
          description: 'Hono로 구축된 REST API. 모든 기억 작업에 대한 엔드포인트. 팀 사용을 위한 독립 서버로 배포 가능.',
        },
        {
          name: '@memrosetta/llm',
          description: '대화 트랜스크립트에서 LLM 기반 사실 추출 (선택사항). OpenAI와 Anthropic 지원. Stop Hook 레이어 2에서 더 높은 품질의 추출에 사용.',
        },
      ],
      dependencyGraph: 'cli, mcp, api, sync-client, claude-code --> core (SQLite + FTS5, no ML deps)',
    },
    comparison: {
      title: '왜 MemRosetta인가?',
      subtitle: '기존 AI 메모리 솔루션과의 비교.',
      headers: {
        feature: '',
        mem0: 'Mem0',
        zep: 'Zep',
        letta: 'Letta',
        memrosetta: 'MemRosetta',
      },
      rows: [
        {
          feature: '로컬 우선',
          mem0: '클라우드',
          zep: '클라우드',
          letta: '클라우드 + 로컬',
          memrosetta: '로컬 (SQLite)',
        },
        {
          feature: 'LLM 의존성',
          mem0: '필수',
          zep: '필수',
          letta: '필수',
          memrosetta: '없음 (AI 도구가 클라이언트)',
        },
        {
          feature: '모순 감지',
          mem0: '없음',
          zep: '없음',
          letta: '없음',
          memrosetta: '있음 (NLI, 로컬)',
        },
        {
          feature: '망각 모델',
          mem0: '없음',
          zep: '없음',
          letta: '없음',
          memrosetta: '있음 (ACT-R)',
        },
        {
          feature: '시간 모델',
          mem0: '없음',
          zep: '없음',
          letta: '없음',
          memrosetta: '있음 (4 타임스탬프)',
        },
        {
          feature: '관계형 버저닝',
          mem0: '없음',
          zep: '없음',
          letta: '없음',
          memrosetta: '있음 (5가지)',
        },
        {
          feature: '도구 간 공유',
          mem0: '없음',
          zep: '없음',
          letta: '없음',
          memrosetta: '있음, 로컬 DB 하나',
        },
        {
          feature: '개방 프로토콜',
          mem0: 'API만',
          zep: 'API만',
          letta: 'API만',
          memrosetta: 'CLI + MCP + API',
        },
        {
          feature: '설치',
          mem0: '복잡',
          zep: '복잡',
          letta: '복잡',
          memrosetta: '명령어 하나',
        },
      ],
    },
    footer: {
      tagline:
        '모든 AI 도구가 공유하는 하나의 영구 기억. 로컬 우선, 필요하면 동기화, 오픈소스.',
      motto: 'Memory + Rosetta: AI 기억의 열쇠, 한 사실씩.',
    },
  },
} as const
