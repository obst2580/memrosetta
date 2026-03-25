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
          code: `# One command sets up everything
npx @memrosetta/claude-code init

# That's it. Restart Claude Code.
# Claude will automatically:
#   - Store memories during sessions (via MCP)
#   - Search past memories when needed (via MCP)
#   - Extract facts on session end (via Stop Hook)

# Check status
npx @memrosetta/claude-code status

# Remove integration
npx @memrosetta/claude-code reset`,
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
            'Claude Code acts as both the LLM and the memory author. When it encounters an important fact, decision, or preference, it stores it via MCP in real time.',
          quality: 'Best quality',
          cost: '$0',
        },
        {
          number: '2',
          title: 'Stop Hook + LLM extraction on session end',
          description:
            'When a session ends, the Stop Hook sends the transcript to an LLM for fact extraction. Catches anything Claude missed during the session.',
          quality: 'Good',
          cost: 'Needs API key',
        },
        {
          number: '3',
          title: 'Stop Hook + rule-based fallback',
          description:
            'No API key? No problem. Pattern matching extracts decisions, preferences, and facts from the transcript. Zero external dependencies.',
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
          memrosetta: 'Auto-detected by NLI model',
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
      ],
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
            'FTS5 (BM25) + vector similarity (bge-small-en-v1.5) + Reciprocal Rank Fusion. Better recall than either approach alone.',
        },
        {
          title: 'Contradiction Detection',
          description:
            'Local NLI model (nli-deberta-v3-xsmall, 71MB) automatically detects conflicting facts. No LLM needed.',
        },
        {
          title: 'Adaptive Forgetting',
          description:
            'ACT-R activation scoring. Frequently accessed memories rank higher. Unused memories fade but are never deleted.',
        },
        {
          title: 'Memory Tiers',
          description:
            'Hot (working memory, ~3K tokens), Warm (last 30 days), Cold (compressed long-term). Automatic tier management.',
        },
        {
          title: 'Relations',
          description:
            '5 relation types: updates, extends, derives, contradicts, supports. Memories form a graph, not a flat list.',
        },
        {
          title: 'Time Model',
          description:
            'Four timestamps per memory: learnedAt, documentDate, eventDateStart/End, invalidatedAt.',
        },
        {
          title: 'Non-destructive',
          description:
            'Nothing is ever deleted. Old versions preserved via relations and isLatest flags. Full audit trail.',
        },
        {
          title: '588+ Tests',
          description:
            'Comprehensive test suite covering core engine, search, relations, compression, and all integrations.',
        },
      ],
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
          code: `# 명령어 하나로 모든 설정 완료
npx @memrosetta/claude-code init

# 끝. Claude Code를 재시작하세요.
# Claude가 자동으로:
#   - 세션 중 기억을 저장합니다 (MCP)
#   - 필요할 때 과거 기억을 검색합니다 (MCP)
#   - 세션 종료 시 사실을 추출합니다 (Stop Hook)

# 상태 확인
npx @memrosetta/claude-code status

# 통합 제거
npx @memrosetta/claude-code reset`,
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
            'Claude Code가 LLM과 기억 작성자 역할을 동시에 수행합니다. 중요한 사실, 결정, 선호를 만나면 MCP를 통해 실시간으로 저장합니다.',
          quality: '최고 품질',
          cost: '$0',
        },
        {
          number: '2',
          title: 'Stop Hook + LLM 추출 (세션 종료 시)',
          description:
            '세션이 끝나면 Stop Hook이 대화 내용을 LLM에 보내 사실을 추출합니다. Claude가 세션 중 놓친 것을 보완합니다.',
          quality: '양호',
          cost: 'API 키 필요',
        },
        {
          number: '3',
          title: 'Stop Hook + 규칙 기반 폴백',
          description:
            'API 키가 없어도 괜찮습니다. 패턴 매칭으로 대화에서 결정, 선호, 사실을 추출합니다. 외부 의존성 제로.',
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
          memrosetta: 'NLI 모델로 자동 감지',
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
      ],
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
            'FTS5 (BM25) + 벡터 유사도 (bge-small-en-v1.5) + Reciprocal Rank Fusion. 개별 방식보다 높은 검색 정확도.',
        },
        {
          title: '모순 감지',
          description:
            '로컬 NLI 모델 (nli-deberta-v3-xsmall, 71MB)로 충돌하는 사실을 자동 감지. LLM 불필요.',
        },
        {
          title: '적응형 망각',
          description:
            'ACT-R 활성화 점수 기반. 자주 접근하는 기억 우선. 안 쓰는 기억은 사라지지만 절대 삭제되지 않음.',
        },
        {
          title: '기억 계층',
          description:
            'Hot (작업 기억, ~3K 토큰), Warm (최근 30일), Cold (압축된 장기 기억). 자동 계층 관리.',
        },
        {
          title: '관계',
          description:
            '5가지 관계: updates, extends, derives, contradicts, supports. 기억은 리스트가 아닌 그래프.',
        },
        {
          title: '시간 모델',
          description:
            '기억당 4개 타임스탬프: learnedAt, documentDate, eventDateStart/End, invalidatedAt.',
        },
        {
          title: '비파괴적',
          description:
            '삭제 없음. 이전 버전은 관계와 isLatest 플래그로 보존. 전체 감사 추적.',
        },
        {
          title: '588+ 테스트',
          description:
            '코어 엔진, 검색, 관계, 압축, 모든 통합을 커버하는 종합 테스트 스위트.',
        },
      ],
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
