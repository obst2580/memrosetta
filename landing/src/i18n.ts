export type Lang = 'en' | 'ko'

export const content = {
  en: {
    nav: {
      docs: 'Docs',
      github: 'GitHub',
    },
    hero: {
      badge: 'Open source -- MIT License',
      title: 'MemRosetta',
      subtitle: 'Persistent memory for AI tools. One SQLite file. Zero cloud.',
      install: 'npm install -g @memrosetta/cli',
      stats: {
        mrr: { value: '+324%', label: 'MRR improvement' },
        cost: { value: '$0', label: 'LLM cost for core' },
        setup: { value: '1', label: 'command to start' },
      },
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
        cli: 'CLI',
      },
      code: {
        'claude-code': {
          language: 'bash',
          code: `# Install CLI and set up everything
npm install -g @memrosetta/cli
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
        cli: {
          language: 'bash',
          code: `# Install globally
npm install -g @memrosetta/cli

# Store memories
memrosetta store --user alice \\
  --content "Prefers TypeScript over JavaScript" \\
  --type preference

# Search
memrosetta search --user alice \\
  --query "tech stack choices" \\
  --format text
# [0.95] Decided to use Tailwind CSS (decision)
# [0.88] Prefers TypeScript over JavaScript (preference)

# Working memory (top-priority context)
memrosetta working-memory --user alice

# Run maintenance (recompute activation scores)
memrosetta maintain --user alice`,
        },
      },
      packages: {
        title: 'Packages',
      },
    },
    compatibility: {
      title: 'Works With',
      subtitle:
        'One local database, shared across all your AI tools. Memories stored in Claude Code are searchable from Cursor, and vice versa.',
      diagramComment: '// All tools share one database',
      sharing: {
        title: 'Cross-tool memory sharing',
        description:
          'Morning: Claude Code session about auth system -- memories saved. Afternoon: Open Cursor for frontend -- search "auth" -- finds morning\'s decisions. No sync, no cloud. Same local file.',
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
          feature: 'Contradictions',
          rag: 'Both versions returned, AI guesses',
          memrosetta: 'Auto-detected by NLI model (71MB, local)',
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
        'One fact = one memory. Each has type, timestamps, keywords, relations. Updates create links, contradictions are auto-detected.',
    },
    features: {
      title: 'Features',
      subtitle: 'Cognitive-science-inspired memory management. Not just storage -- intelligent retrieval and lifecycle.',
      items: [
        {
          title: 'Hybrid Search',
          description:
            'Three-stage pipeline: FTS5 (BM25) for keyword matching, vector similarity (bge-small-en-v1.5, 33MB) for semantic matching, and Reciprocal Rank Fusion to combine results. Memories found by both methods get boosted. ~3ms latency for 13K memories. Better recall than either approach alone.',
        },
        {
          title: 'Contradiction Detection',
          description:
            'When a new memory is stored, the NLI model (nli-deberta-v3-xsmall, 71MB, Apache 2.0) checks the top 5 similar existing memories for logical contradictions. Score >= 0.7 triggers auto-creation of a contradicts relation. Runs entirely locally -- no API calls, no LLM needed.',
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
          title: 'Relations',
          description:
            '5 relation types form a knowledge graph: updates (fact changed), extends (detail added), derives (inference made), contradicts (conflict detected), supports (corroborating evidence). Old versions are preserved via isLatest flags, not deleted.',
        },
        {
          title: 'Time Model',
          description:
            'Four timestamps per memory: learnedAt (when MemRosetta first saw it), documentDate (when the conversation happened), eventDateStart/End (when the real-world event occurred), invalidatedAt (when it became outdated). Enables temporal queries like "what did we know as of last Tuesday?"',
        },
        {
          title: 'Non-destructive',
          description:
            'Nothing is ever deleted. When a fact is updated, the old version remains with isLatest=false and a relation edge pointing to the new version. When a fact is invalidated, it gets an invalidatedAt timestamp. Full audit trail of every change.',
        },
        {
          title: '588+ Tests',
          description:
            'Comprehensive test suite covering core engine, hybrid search, NLI contradiction detection, relation graph traversal, tier compression, activation scoring, MCP tools, REST API, CLI commands, and Claude Code integration.',
        },
      ],
    },
    architecture: {
      title: 'Architecture',
      subtitle: 'Modular package design. Each package has a single responsibility. Core has zero LLM dependency.',
      packages: [
        {
          name: '@memrosetta/core',
          description: 'Memory engine: SQLite + FTS5 + sqlite-vec + relation graph. Stores, searches, relates, compresses. Zero LLM dependency -- all intelligence is in the storage and retrieval layer.',
        },
        {
          name: '@memrosetta/embeddings',
          description: 'Local ML models: bge-small-en-v1.5 (33MB, MIT) for vector embeddings, nli-deberta-v3-xsmall (71MB, Apache 2.0) for contradiction detection. Runs on CPU, no GPU required.',
        },
        {
          name: '@memrosetta/mcp',
          description: 'MCP (Model Context Protocol) server exposing 6 tools: store, search, working_memory, relate, invalidate, count. Any MCP-compatible AI tool can connect.',
        },
        {
          name: '@memrosetta/claude-code',
          description: 'DEPRECATED: Use @memrosetta/cli instead. Run: npm install -g @memrosetta/cli && memrosetta init --claude-code',
        },
        {
          name: '@memrosetta/cli',
          description: 'Full CLI for manual memory management: store, search, relate, maintain, compress, ingest, status. Supports JSON and text output formats.',
        },
        {
          name: '@memrosetta/api',
          description: 'REST API built with Hono. Endpoints for all memory operations. Can be deployed as a standalone server for team use.',
        },
        {
          name: '@memrosetta/llm',
          description: 'Optional LLM-based fact extraction from conversation transcripts. Supports OpenAI and Anthropic. Used by Stop Hook layer 2 for higher-quality extraction.',
        },
        {
        },
      ],
      dependencyGraph: 'cli, mcp, api, claude-code --> core --> embeddings',
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
          memrosetta: 'None (core)',
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
        'Persistent, searchable long-term memory for AI tools. Local-first. No LLM required. Open source.',
      motto: 'Memory + Rosetta: unlocking AI memory, one fact at a time.',
    },
  },

  ko: {
    nav: {
      docs: '문서',
      github: 'GitHub',
    },
    hero: {
      badge: '오픈소스 -- MIT 라이선스',
      title: 'MemRosetta',
      subtitle: 'AI 도구를 위한 영구 기억. 하나의 SQLite 파일. 클라우드 없음.',
      install: 'npm install -g @memrosetta/cli',
      stats: {
        mrr: { value: '+324%', label: 'MRR 향상' },
        cost: { value: '$0', label: '코어 LLM 비용' },
        setup: { value: '1', label: '명령어로 시작' },
      },
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
        cli: 'CLI',
      },
      code: {
        'claude-code': {
          language: 'bash',
          code: `# CLI 설치 후 모든 설정 완료
npm install -g @memrosetta/cli
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
        cli: {
          language: 'bash',
          code: `# 전역 설치
npm install -g @memrosetta/cli

# 기억 저장
memrosetta store --user alice \\
  --content "TypeScript를 JavaScript보다 선호" \\
  --type preference

# 검색
memrosetta search --user alice \\
  --query "기술 스택 선택" \\
  --format text
# [0.95] Tailwind CSS 사용 결정 (decision)
# [0.88] TypeScript를 JavaScript보다 선호 (preference)

# 작업 기억 (최우선 컨텍스트)
memrosetta working-memory --user alice

# 유지보수 (활성화 점수 재계산)
memrosetta maintain --user alice`,
        },
      },
      packages: {
        title: '패키지',
      },
    },
    compatibility: {
      title: '호환성',
      subtitle:
        '하나의 로컬 데이터베이스를 모든 AI 도구가 공유합니다. Claude Code에 저장한 기억을 Cursor에서 검색할 수 있습니다.',
      diagramComment: '// 모든 도구가 하나의 데이터베이스를 공유',
      sharing: {
        title: '도구 간 기억 공유',
        description:
          '오전: Claude Code로 인증 시스템 작업 -- 기억 저장. 오후: Cursor로 프론트엔드 작업 -- "auth" 검색 -- 오전의 결정 사항 발견. 동기화 없음. 클라우드 없음. 같은 로컬 파일.',
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
          memrosetta: 'NLI 모델로 자동 감지 (71MB, 로컬)',
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
      subtitle: '인지과학 기반의 기억 관리. 단순 저장이 아닌 지능적 검색과 생명주기.',
      items: [
        {
          title: '하이브리드 검색',
          description:
            '3단계 파이프라인: FTS5 (BM25) 키워드 매칭, 벡터 유사도 (bge-small-en-v1.5, 33MB) 시맨틱 매칭, Reciprocal Rank Fusion으로 결과 결합. 두 방법 모두에서 발견된 기억은 부스트. 13K 기억에서 ~3ms 지연. 개별 방식보다 높은 검색 정확도.',
        },
        {
          title: '모순 감지',
          description:
            '새 기억 저장 시 NLI 모델(nli-deberta-v3-xsmall, 71MB, Apache 2.0)이 유사한 기존 기억 상위 5개를 논리적 모순 검사. 점수 >= 0.7이면 contradicts 관계 자동 생성. 완전히 로컬 실행 -- API 호출 없음, LLM 불필요.',
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
          title: '관계',
          description:
            '5가지 관계 타입이 지식 그래프 형성: updates (사실 변경), extends (세부사항 추가), derives (추론 도출), contradicts (충돌 감지), supports (뒷받침 증거). 이전 버전은 isLatest 플래그로 보존, 삭제하지 않음.',
        },
        {
          title: '시간 모델',
          description:
            '기억당 4개 타임스탬프: learnedAt (MemRosetta가 처음 인지한 시점), documentDate (대화가 일어난 시점), eventDateStart/End (실제 사건 발생 시점), invalidatedAt (무효화된 시점). "지난 화요일 시점에 우리가 알고 있던 것은?" 같은 시간 기반 쿼리 가능.',
        },
        {
          title: '비파괴적',
          description:
            '삭제 없음. 사실이 업데이트되면 이전 버전은 isLatest=false로 남고, 새 버전을 가리키는 관계 엣지가 생성. 사실이 무효화되면 invalidatedAt 타임스탬프를 받음. 모든 변경의 전체 감사 추적.',
        },
        {
          title: '588+ 테스트',
          description:
            '코어 엔진, 하이브리드 검색, NLI 모순 감지, 관계 그래프 탐색, 계층 압축, 활성화 점수, MCP 도구, REST API, CLI 명령어, Claude Code 통합을 커버하는 종합 테스트 스위트.',
        },
      ],
    },
    architecture: {
      title: '아키텍처',
      subtitle: '모듈형 패키지 설계. 각 패키지는 단일 책임. 코어는 LLM 의존성 제로.',
      packages: [
        {
          name: '@memrosetta/core',
          description: '메모리 엔진: SQLite + FTS5 + sqlite-vec + 관계 그래프. 저장, 검색, 관계 연결, 압축. LLM 의존성 제로 -- 모든 지능은 저장/검색 레이어에 있음.',
        },
        {
          name: '@memrosetta/embeddings',
          description: '로컬 ML 모델: bge-small-en-v1.5 (33MB, MIT) 벡터 임베딩용, nli-deberta-v3-xsmall (71MB, Apache 2.0) 모순 감지용. CPU에서 실행, GPU 불필요.',
        },
        {
          name: '@memrosetta/mcp',
          description: 'MCP(Model Context Protocol) 서버. 6개 도구 노출: store, search, working_memory, relate, invalidate, count. MCP 호환 AI 도구라면 무엇이든 연결 가능.',
        },
        {
          name: '@memrosetta/claude-code',
          description: 'DEPRECATED: @memrosetta/cli를 사용하세요. 실행: npm install -g @memrosetta/cli && memrosetta init --claude-code',
        },
        {
          name: '@memrosetta/cli',
          description: '수동 기억 관리를 위한 전체 CLI: store, search, relate, maintain, compress, ingest, status. JSON 및 텍스트 출력 형식 지원.',
        },
        {
          name: '@memrosetta/api',
          description: 'Hono로 구축된 REST API. 모든 기억 작업에 대한 엔드포인트. 팀 사용을 위한 독립 서버로 배포 가능.',
        },
        {
          name: '@memrosetta/llm',
          description: '대화 트랜스크립트에서 LLM 기반 사실 추출 (선택사항). OpenAI와 Anthropic 지원. Stop Hook 레이어 2에서 더 높은 품질의 추출에 사용.',
        },
        {
        },
      ],
      dependencyGraph: 'cli, mcp, api, claude-code --> core --> embeddings',
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
          memrosetta: '없음 (코어)',
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
        'AI 도구를 위한 영구적이고 검색 가능한 장기 기억. 로컬 우선. LLM 불필요. 오픈소스.',
      motto: 'Memory + Rosetta: AI 기억의 열쇠, 한 사실씩.',
    },
  },
} as const
