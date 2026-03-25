# MemRosetta CLI 레퍼런스

14개 CLI 명령어의 전체 레퍼런스입니다.

## 설치

```bash
npm install -g @memrosetta/cli
```

## 글로벌 옵션

모든 명령어에서 사용할 수 있는 옵션입니다:

| 옵션 | 타입 | 기본값 | 설명 |
|------|------|--------|------|
| `--db <path>` | string | `~/.memrosetta/memories.db` | 데이터베이스 파일 경로 |
| `--format <type>` | `json` \| `text` | `json` | 출력 형식 |
| `--no-embeddings` | flag | false | 벡터 임베딩 비활성화 (FTS 전용 검색) |
| `--help`, `-h` | flag | - | 도움말 표시 |
| `--version`, `-v` | flag | - | 버전 번호 표시 |

**참고:**
- JSON 출력은 stdout에 한 줄의 JSON으로 출력됩니다. `jq`로 파이프하거나 프로그래밍 방식으로 사용하기에 적합합니다.
- Text 출력은 터미널 표시에 최적화된 사람이 읽기 쉬운 형식입니다.
- `--no-embeddings`를 설정하면 검색이 FTS5 전용 모드로 전환됩니다 (벡터 유사도 검색 없음).

---

## 명령어

### memrosetta init

데이터베이스를 초기화하고 도구 연동을 설정합니다.

**옵션:**

| 옵션 | 타입 | 필수 | 기본값 | 설명 |
|------|------|------|--------|------|
| `--claude-code` | flag | 아니오 | - | Claude Code hooks + CLAUDE.md 지침 설정 |
| `--cursor` | flag | 아니오 | - | Cursor MCP 설정 (~/.cursor/mcp.json) |

**동작:**
- SQLite 데이터베이스가 없으면 항상 생성합니다.
- `~/.mcp.json`에 MCP 서버를 항상 등록합니다 (기본 설정).
- `--claude-code`는 추가로 `~/.claude/settings.json`에 Stop Hook을 설치하고 `~/.claude/CLAUDE.md`에 기억 지침을 추가합니다.
- `--cursor`는 추가로 `~/.cursor/mcp.json`에 MCP 설정을 작성합니다.
- 두 플래그를 함께 사용할 수 있습니다.

**예제:**

기본 설정 (데이터베이스 + MCP 서버):
```bash
memrosetta init
```

출력 (text, `--format text`):
```
MemRosetta initialized successfully.

  What was set up:
  ----------------------------------------
  Database:   /Users/alice/.memrosetta/memories.db (created)
  MCP Server: /Users/alice/.mcp.json (always included)

  MCP is ready. Add --claude-code or --cursor for tool-specific setup.
  Example: memrosetta init --claude-code
```

출력 (JSON):
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

Claude Code 전체 설정:
```bash
memrosetta init --claude-code
```

출력 (text):
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

조합 설정:
```bash
memrosetta init --claude-code --cursor
```

**팁:**
- `memrosetta init`은 언제든 다시 실행할 수 있습니다 -- 멱등성을 보장합니다. 기존 데이터베이스는 보존됩니다.
- Claude Code가 설치되어 있지 않으면 (`~/.claude` 디렉토리 미존재) Hook 설정 단계가 건너뛰어집니다.

---

### memrosetta store

원자적 기억을 저장합니다.

**옵션:**

| 옵션 | 타입 | 필수 | 기본값 | 설명 |
|------|------|------|--------|------|
| `--user` | string | 아니오 | 시스템 사용자명 | 사용자 식별자 |
| `--content` | string | 예* | - | 기억 내용 텍스트 |
| `--type` | enum | 예* | - | `fact`, `preference`, `decision`, `event` |
| `--namespace` | string | 아니오 | - | 카테고리 또는 그룹 라벨 |
| `--keywords` | string | 아니오 | - | 쉼표로 구분된 검색 키워드 |
| `--confidence` | number | 아니오 | - | 신뢰도 점수 (0.0 - 1.0) |
| `--source-id` | string | 아니오 | - | 출처 추적을 위한 소스 식별자 |
| `--event-start` | string | 아니오 | - | 이벤트 시작 날짜 (ISO 8601) |
| `--event-end` | string | 아니오 | - | 이벤트 종료 날짜 (ISO 8601) |
| `--stdin` | flag | 아니오 | - | 플래그 대신 stdin에서 JSON 입력 읽기 |

*`--stdin` 사용 시 JSON 객체에 `userId`, `content`, `memoryType`을 포함해야 합니다.

**Stdin JSON 형식:**
```json
{
  "userId": "alice",
  "content": "기억 내용",
  "memoryType": "fact",
  "namespace": "선택사항",
  "keywords": ["선택", "배열"],
  "confidence": 0.9,
  "sourceId": "선택사항-소스"
}
```

**예제:**

사실 저장:
```bash
memrosetta store --user alice --content "API는 Spring Boot + PostgreSQL 사용" --type fact --keywords "spring,postgresql,api"
```

출력 (JSON):
```json
{
  "memoryId": "mem-WL5IFdnKmMjx9_ES",
  "userId": "alice",
  "content": "API는 Spring Boot + PostgreSQL 사용",
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

출력 (text):
```
ID: mem-WL5IFdnKmMjx9_ES
Content: API는 Spring Boot + PostgreSQL 사용
Type: fact
Date: 2026-03-24
Keywords: spring, postgresql, api
```

신뢰도와 함께 선호 저장:
```bash
memrosetta store --user alice --content "모든 에디터에서 다크 모드 선호" --type preference --confidence 0.95 --namespace ui-prefs
```

stdin에서 저장 (파이프):
```bash
echo '{"userId":"alice","content":"다크 모드 선호","memoryType":"preference"}' | memrosetta store --stdin
```

이벤트 날짜와 함께 저장:
```bash
memrosetta store --user alice --content "스프린트 12 회고 완료" --type event --event-start "2026-03-01" --event-end "2026-03-14"
```

**팁:**
- 키워드는 FTS5 검색 정확도를 크게 향상시킵니다. 항상 관련 키워드를 포함하세요.
- 기억 하나에 사실 하나. 복합 사실은 별도의 `store` 호출로 분리하세요.
- 임베딩이 활성화되어 있으면 모순 감지가 자동으로 실행됩니다.

---

### memrosetta search

하이브리드 검색(FTS5 + 벡터 + RRF)으로 기억을 검색합니다.

**옵션:**

| 옵션 | 타입 | 필수 | 기본값 | 설명 |
|------|------|------|--------|------|
| `--user` | string | 아니오 | 시스템 사용자명 | 사용자 식별자 |
| `--query` | string | 예 | - | 검색 쿼리 텍스트 |
| `--limit` | number | 아니오 | `5` | 최대 결과 수 |
| `--namespace` | string | 아니오 | - | 네임스페이스로 필터링 |
| `--types` | string | 아니오 | - | 쉼표로 구분된 기억 유형 필터 (예: `fact,decision`) |
| `--min-confidence` | number | 아니오 | - | 최소 신뢰도 임계값 (0.0 - 1.0) |

**예제:**

기본 검색:
```bash
memrosetta search --user alice --query "언어 선호"
```

출력 (JSON):
```json
{
  "results": [
    {
      "memory": {
        "memoryId": "mem-WL5IFdnKmMjx9_ES",
        "content": "JavaScript보다 TypeScript 선호",
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
        "content": "데이터 분석 스크립트에 Python 사용",
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

출력 (text):
```
[0.92] JavaScript보다 TypeScript 선호 (preference, 2026-03-24)
[0.71] 데이터 분석 스크립트에 Python 사용 (fact, 2026-03-20)

2 result(s) in 3.2ms
```

필터로 검색:
```bash
memrosetta search --user alice --query "인증 결정" --types decision --limit 3 --min-confidence 0.8
```

네임스페이스 내 검색:
```bash
memrosetta search --user alice --query "데이터베이스 설정" --namespace project-alpha
```

텍스트 출력으로 검색:
```bash
memrosetta search --user alice --query "UI 선호사항" --format text
```

**팁:**
- `--no-embeddings`를 사용하면 FTS5 키워드 검색만 수행됩니다 (더 빠르지만 재현율이 낮음).
- `--types`로 특정 기억 카테고리로 결과를 좁힐 수 있습니다.
- 결과는 검색 관련성과 활성화 점수의 조합으로 랭킹됩니다.

---

### memrosetta get

ID로 단일 기억을 조회합니다.

**옵션:**

| 옵션 | 타입 | 필수 | 기본값 | 설명 |
|------|------|------|--------|------|
| `<memory-id>` | 위치 인수 | 예 | - | 조회할 기억 ID |

**예제:**

기억 조회:
```bash
memrosetta get mem-WL5IFdnKmMjx9_ES
```

출력 (JSON):
```json
{
  "memoryId": "mem-WL5IFdnKmMjx9_ES",
  "userId": "alice",
  "content": "JavaScript보다 TypeScript 선호",
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

출력 (text):
```
ID: mem-WL5IFdnKmMjx9_ES
Content: JavaScript보다 TypeScript 선호
Type: preference
Date: 2026-03-24
Keywords: typescript, javascript
```

존재하지 않는 기억 조회:
```bash
memrosetta get mem-nonexistent
```

출력 (JSON):
```json
{"error":"Memory not found: mem-nonexistent"}
```

**팁:**
- 기억 ID는 `store` 명령어의 출력에서 확인할 수 있습니다. 직접 조회, 관계 생성, 무효화에 사용합니다.

---

### memrosetta count

사용자의 기억 수를 조회합니다.

**옵션:**

| 옵션 | 타입 | 필수 | 기본값 | 설명 |
|------|------|------|--------|------|
| `--user` | string | 아니오 | 시스템 사용자명 | 사용자 식별자 |

**예제:**

기억 수 조회:
```bash
memrosetta count --user alice
```

출력 (JSON):
```json
{"userId":"alice","count":42}
```

출력 (text):
```
Count: 42
```

기억이 없는 사용자:
```bash
memrosetta count --user newuser
```

출력 (JSON):
```json
{"userId":"newuser","count":0}
```

---

### memrosetta clear

사용자의 모든 기억을 삭제합니다. 안전 장치로 `--confirm` 플래그가 필수입니다.

**옵션:**

| 옵션 | 타입 | 필수 | 기본값 | 설명 |
|------|------|------|--------|------|
| `--user` | string | 아니오 | 시스템 사용자명 | 사용자 식별자 |
| `--confirm` | flag | 예 | - | 안전 확인 플래그 |

**예제:**

확인 없이 삭제 시도 (실패):
```bash
memrosetta clear --user alice
```

출력 (JSON):
```json
{"error":"This will delete all memories for the user. Use --confirm to proceed."}
```

확인 후 삭제:
```bash
memrosetta clear --user alice --confirm
```

출력 (JSON):
```json
{"userId":"alice","cleared":42,"message":"Cleared 42 memories"}
```

**팁:**
- 이 작업은 되돌릴 수 없습니다. 기억을 보존하는 `invalidate`와 달리 `clear`는 사용자의 모든 기억을 영구 삭제합니다.
- `--confirm` 플래그는 실수로 인한 데이터 손실을 방지하기 위해 필수입니다.

---

### memrosetta relate

두 기억 사이에 타입이 지정된 관계를 생성합니다.

**옵션:**

| 옵션 | 타입 | 필수 | 기본값 | 설명 |
|------|------|------|--------|------|
| `--src` | string | 예 | - | 소스 기억 ID |
| `--dst` | string | 예 | - | 대상 기억 ID |
| `--type` | enum | 예 | - | `updates`, `extends`, `derives`, `contradicts`, `supports` |
| `--reason` | string | 아니오 | - | 관계에 대한 설명 |

**관계 유형:**

| 유형 | 의미 | 예시 |
|------|------|------|
| `updates` | 소스가 대상을 대체/수정 | "시급이 5만원에서 4만원으로 변경" |
| `extends` | 소스가 대상에 세부사항 추가 | "특히 SaaS 프로젝트의 경우" |
| `derives` | 소스가 대상에서 추론됨 | "SaaS + 장기 = 초기 단가 낮아도 OK" |
| `contradicts` | 소스가 대상과 충돌 | "시급 4만원" vs "시급 5만원" |
| `supports` | 소스가 대상을 강화 | "여러 고객이 요율을 확인" |

**예제:**

업데이트 관계 생성:
```bash
memrosetta relate --src mem-NEW123 --dst mem-OLD456 --type updates --reason "시급이 5만원에서 4만원으로 변경"
```

출력 (JSON):
```json
{
  "srcMemoryId": "mem-NEW123",
  "dstMemoryId": "mem-OLD456",
  "relationType": "updates",
  "reason": "시급이 5만원에서 4만원으로 변경",
  "createdAt": "2026-03-24T06:42:00.000Z"
}
```

모순 관계 생성:
```bash
memrosetta relate --src mem-abc --dst mem-def --type contradicts
```

잘못된 관계 유형:
```bash
memrosetta relate --src mem-abc --dst mem-def --type replaces
```

출력 (JSON):
```json
{"error":"Invalid relation type: replaces. Must be one of: updates, extends, derives, contradicts, supports"}
```

**팁:**
- 관계는 방향 그래프를 형성합니다. `--src`는 새로운/활성 기억, `--dst`는 이전/참조 기억입니다.
- `--type updates` 사용 시 대상 기억의 `isLatest` 플래그가 false로 설정됩니다.
- 임베딩이 활성화된 상태에서 기억을 저장하면 NLI 모델이 모순 관계를 자동으로 생성합니다.

---

### memrosetta invalidate

기억을 무효화(구식) 표시합니다. 기억은 보존되며 `invalidatedAt` 타임스탬프가 기록됩니다.

**옵션:**

| 옵션 | 타입 | 필수 | 기본값 | 설명 |
|------|------|------|--------|------|
| `<memory-id>` | 위치 인수 | 예 | - | 무효화할 기억 ID |

**예제:**

기억 무효화:
```bash
memrosetta invalidate mem-WL5IFdnKmMjx9_ES
```

출력 (JSON):
```json
{"memoryId":"mem-WL5IFdnKmMjx9_ES","invalidated":true}
```

기억 ID 누락:
```bash
memrosetta invalidate
```

출력 (JSON):
```json
{"error":"Usage: memrosetta invalidate <memoryId>"}
```

**팁:**
- 무효화는 비파괴적입니다. 기억은 `invalidatedAt` 타임스탬프와 함께 데이터베이스에 남습니다.
- 무효화된 기억은 검색 결과에서 우선순위가 낮아지지만 제거되지 않습니다.
- 사실이 구식이 되었을 때 사용합니다 (예: "더 이상 React를 사용하지 않음").

---

### memrosetta ingest

Claude Code 대화 트랜스크립트(JSONL 형식)를 수집하여 기억을 추출합니다.

**옵션:**

| 옵션 | 타입 | 필수 | 기본값 | 설명 |
|------|------|------|--------|------|
| `--user` | string | 아니오 | 시스템 사용자명 | 사용자 식별자 |
| `--file` | string | 아니오 | - | JSONL 트랜스크립트 파일 경로 |
| `--namespace` | string | 아니오 | `session-<id>` | 수집된 기억의 네임스페이스 |

**동작:**
- `--file`이 제공되지 않으면 stdin에서 읽습니다.
- 각 줄을 JSON으로 파싱하며, Claude Code 트랜스크립트 형식(`message.role`과 `message.content`가 있는 객체)을 기대합니다.
- 사용자 메시지에서 `<system-reminder>` 태그를 제거합니다.
- 각 턴을 분류합니다: "decide"/"go with"/"let's do"를 포함하는 사용자 메시지는 `decision`; "prefer"/"i like"/"i want"는 `preference`; 기타 사용자 메시지는 `event`; 어시스턴트 메시지는 `fact`.
- 20자 미만의 턴은 건너뜁니다.
- 내용은 500자로 잘립니다.
- 신뢰도: 사용자 턴 0.9, 어시스턴트 턴 0.8.

**예제:**

파일에서 수집:
```bash
memrosetta ingest --user alice --file ~/.claude/projects/myproject/session.jsonl
```

출력 (JSON):
```json
{
  "stored": 15,
  "sessionId": "abc12345-6789-...",
  "namespace": "session-abc12345"
}
```

stdin에서 수집:
```bash
cat transcript.jsonl | memrosetta ingest --user alice
```

커스텀 네임스페이스로 수집:
```bash
memrosetta ingest --user alice --file session.jsonl --namespace "auth-refactor-session"
```

추출된 기억이 없을 때의 출력:
```json
{"stored":0,"message":"No memories extracted from transcript"}
```

**팁:**
- 이 명령어는 Claude Code Stop Hook이 세션 컨텍스트를 자동 저장할 때 사용됩니다.
- 세션 ID는 `sessionId` 필드를 포함하는 첫 번째 JSONL 항목에서 추출됩니다.
- `--namespace`를 제공하지 않으면 `session-<세션ID 앞 8자>`가 기본값입니다.

---

### memrosetta working-memory

사용자의 작업 기억 컨텍스트를 조회합니다 -- 토큰 예산 내에서 가장 높은 활성화 점수의 기억들입니다.

**옵션:**

| 옵션 | 타입 | 필수 | 기본값 | 설명 |
|------|------|------|--------|------|
| `--user` | string | 아니오 | 시스템 사용자명 | 사용자 식별자 |
| `--max-tokens` | number | 아니오 | `3000` | 최대 토큰 예산 |

**예제:**

작업 기억 조회:
```bash
memrosetta working-memory --user alice
```

출력 (JSON):
```json
{
  "userId": "alice",
  "maxTokens": 3000,
  "memories": [
    {
      "memoryId": "mem-abc123",
      "content": "JavaScript보다 TypeScript 선호",
      "memoryType": "preference",
      "tier": "hot",
      "activationScore": 0.95
    },
    {
      "memoryId": "mem-def456",
      "content": "API는 Spring Boot + PostgreSQL + Azure 사용",
      "memoryType": "fact",
      "tier": "hot",
      "activationScore": 0.88
    }
  ]
}
```

출력 (text):
```
[HOT|0.95] JavaScript보다 TypeScript 선호 (preference)
[HOT|0.88] API는 Spring Boot + PostgreSQL + Azure 사용 (fact)

2 memories, ~24 tokens
```

커스텀 토큰 예산으로 조회:
```bash
memrosetta working-memory --user alice --max-tokens 1000
```

기억이 없을 때:
```bash
memrosetta working-memory --user newuser --format text
```

출력 (text):
```
No working memory found.
```

**팁:**
- 토큰 추정은 `ceil(content.length / 4)`를 근사값으로 사용합니다.
- 작업 기억은 활성화 점수 순으로 반환됩니다 (가장 높은 것 먼저).
- Hot 계층 기억이 항상 먼저 포함됩니다.

---

### memrosetta maintain

사용자에 대한 전체 유지보수를 실행합니다: 활성화 점수 재계산, 계층 업데이트, Cold 기억 압축.

**옵션:**

| 옵션 | 타입 | 필수 | 기본값 | 설명 |
|------|------|------|--------|------|
| `--user` | string | 아니오 | 시스템 사용자명 | 사용자 식별자 |

**동작:**
1. ACT-R 기저율 학습 방정식을 사용하여 모든 기억의 활성화 점수를 재계산합니다.
2. 활성화 점수와 연령에 따라 기억 계층(Hot/Warm/Cold)을 업데이트합니다.
3. 매우 낮은 활성화(< 0.1)의 Cold 기억 그룹을 요약 항목으로 압축합니다.
4. 압축된 원본 기억을 not-latest로 표시(보관)합니다.

**예제:**

유지보수 실행:
```bash
memrosetta maintain --user alice
```

출력 (JSON):
```json
{
  "userId": "alice",
  "activationUpdated": 42,
  "tiersUpdated": 8,
  "compressed": 3,
  "removed": 12
}
```

출력 (text):
```
Maintenance completed for user: alice
  Activation scores updated: 42
  Tiers updated: 8
  Groups compressed: 3
  Memories archived: 12
```

기억이 적은 사용자의 유지보수:
```bash
memrosetta maintain --user newuser --format text
```

출력 (text):
```
Maintenance completed for user: newuser
  Activation scores updated: 2
  Tiers updated: 0
  Groups compressed: 0
  Memories archived: 0
```

**팁:**
- 주기적으로 (예: 매주) 실행하여 활성화 점수를 최신 상태로 유지하고 오래된 기억을 압축합니다.
- Claude Code Stop Hook은 유지보수를 자동 실행하지 않습니다 -- 이 명령어를 사용하거나 cron으로 예약하세요.
- 압축은 비파괴적입니다: 원본 기억은 `isLatest = false`로 보존됩니다.

---

### memrosetta compress

압축만 실행합니다 (활성화 점수 재계산이나 계층 업데이트 없이).

**옵션:**

| 옵션 | 타입 | 필수 | 기본값 | 설명 |
|------|------|------|--------|------|
| `--user` | string | 아니오 | 시스템 사용자명 | 사용자 식별자 |

**동작:**
- 낮은 활성화의 Cold 기억을 네임스페이스별로 그룹화합니다.
- 내용을 요약 항목으로 결합합니다.
- 원본을 not-latest로 표시합니다.

**예제:**

압축 실행:
```bash
memrosetta compress --user alice
```

출력 (JSON):
```json
{
  "userId": "alice",
  "compressed": 2,
  "removed": 8
}
```

출력 (text):
```
Compression completed for user: alice
  Groups compressed: 2
  Memories archived: 8
```

압축할 것이 없을 때:
```bash
memrosetta compress --user newuser --format text
```

출력 (text):
```
Compression completed for user: newuser
  Groups compressed: 0
  Memories archived: 0
```

**팁:**
- 활성화 점수와 계층도 함께 업데이트하려면 `maintain`을 대신 사용하세요.
- `compress`는 `maintain`의 부분 집합입니다 -- 압축 단계만 실행합니다.

---

### memrosetta status

데이터베이스 상태, 기억 수, 사용자 목록, 연동 설정을 표시합니다.

**옵션:**

명령어 고유 옵션 없음. 글로벌 옵션(`--db`, `--format`, `--no-embeddings`)만 사용합니다.

**예제:**

상태 확인:
```bash
memrosetta status --format text
```

출력 (text):
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

출력 (JSON):
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

초기화 전 상태:
```bash
memrosetta status --format text
```

출력 (text):
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

**팁:**
- `init` 실행 후 연동이 제대로 설정되었는지 `status`로 확인하세요.
- 기억이 저장될수록 데이터베이스 크기가 증가합니다. 압축으로 크기를 관리할 수 있습니다.

---

### memrosetta reset

연동 설정을 제거합니다. 데이터베이스는 삭제하지 않습니다.

**옵션:**

| 옵션 | 타입 | 필수 | 기본값 | 설명 |
|------|------|------|--------|------|
| `--claude-code` | flag | 아니오 | - | Claude Code hooks + CLAUDE.md 섹션 + MCP 제거 |
| `--cursor` | flag | 아니오 | - | Cursor MCP 설정 제거 |
| `--mcp` | flag | 아니오 | - | 범용 MCP 설정 제거 (~/.mcp.json) |
| `--all` | flag | 아니오 | - | 모든 연동 제거 |

최소 하나의 플래그가 필요합니다. 플래그가 없으면 사용법이 출력됩니다.

**예제:**

사용법 표시 (플래그 없음):
```bash
memrosetta reset
```

출력 (text):
```
Usage: memrosetta reset [--claude-code] [--cursor] [--mcp] [--all]

Flags:
  --claude-code  Remove Claude Code hooks, MCP, and CLAUDE.md section
  --cursor       Remove Cursor MCP configuration
  --mcp          Remove generic MCP configuration (~/.mcp.json)
  --all          Remove all integrations
```

Claude Code 연동 제거:
```bash
memrosetta reset --claude-code
```

출력 (text):
```
Removed Claude Code hooks from ~/.claude/settings.json
Removed MemRosetta section from ~/.claude/CLAUDE.md
Removed MCP server from ~/.mcp.json

Note: ~/.memrosetta/ directory preserved. Delete manually if needed:
  rm -rf ~/.memrosetta
```

출력 (JSON):
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

모든 연동 제거:
```bash
memrosetta reset --all
```

제거할 것이 없을 때:
```bash
memrosetta reset --all --format text
```

출력 (text):
```
Nothing to remove (no integrations were configured).

Note: ~/.memrosetta/ directory preserved. Delete manually if needed:
  rm -rf ~/.memrosetta
```

**팁:**
- 데이터베이스(`~/.memrosetta/`)는 `reset`으로 삭제되지 않습니다. 필요하면 `rm -rf ~/.memrosetta`로 수동 삭제하세요.
- 리셋 후 `memrosetta init`을 다시 실행하여 재설정할 수 있습니다.
- `--all`을 사용하여 재설치 전에 깨끗하게 제거할 수 있습니다.

---

## 출력 형식

### JSON (기본값)

모든 명령어는 stdout에 한 줄의 JSON을 출력합니다. 오류도 JSON입니다:

```json
{"error":"Missing required option: user (--user)"}
```

스크립팅에 유용합니다:
```bash
memrosetta count --user alice | jq '.count'
```

### Text (`--format text`)

터미널 표시에 최적화된 사람이 읽기 쉬운 출력입니다. 검색 결과는 점수, 날짜, 유형을 보여줍니다:

```
[0.92] JavaScript보다 TypeScript 선호 (preference, 2026-03-24)
[0.71] 데이터 분석 스크립트에 Python 사용 (fact, 2026-03-20)

2 result(s) in 3.2ms
```

작업 기억은 계층과 활성화 점수를 보여줍니다:

```
[HOT|0.95] JavaScript보다 TypeScript 선호 (preference)
[HOT|0.88] API는 Spring Boot + PostgreSQL + Azure 사용 (fact)

2 memories, ~24 tokens
```

---

## 종료 코드

| 코드 | 의미 |
|------|------|
| `0` | 성공 |
| `1` | 오류 (옵션 누락, 잘못된 입력, 기억 미발견 등) |

text 모드에서 오류는 stderr에, json 모드에서 오류는 stdout에 JSON으로 출력됩니다.

---

## 환경

| 항목 | 값 |
|------|-----|
| 데이터베이스 위치 | `~/.memrosetta/memories.db` (기본값) |
| MCP 설정 | `~/.mcp.json` |
| Claude Code hooks | `~/.claude/settings.json` |
| Claude Code 지침 | `~/.claude/CLAUDE.md` |
| Cursor MCP 설정 | `~/.cursor/mcp.json` |
| 임베딩 모델 | bge-small-en-v1.5 (33MB, MIT) |
| NLI 모델 | nli-deberta-v3-xsmall (71MB, Apache 2.0) |

---

## 일반적인 워크플로우

### 최초 설정

```bash
npm install -g @memrosetta/cli
memrosetta init --claude-code
memrosetta status --format text
```

### 기억 저장 및 조회

```bash
memrosetta store --user alice --content "모든 프로젝트에 PostgreSQL 사용" --type fact --keywords "postgresql,database"
memrosetta search --user alice --query "데이터베이스 선택" --format text
```

### 관련 기억 연결

```bash
# 원본 사실 저장
memrosetta store --user alice --content "시급은 5만원" --type fact
# 출력에서 기억 ID 확인, 예: mem-AAA

# 업데이트된 사실 저장
memrosetta store --user alice --content "장기 고객은 시급 4만원" --type fact
# 출력에서 기억 ID 확인, 예: mem-BBB

# 업데이트 관계 생성
memrosetta relate --src mem-BBB --dst mem-AAA --type updates --reason "장기 고객 대상 요율 조정"
```

### 주간 유지보수

```bash
memrosetta maintain --user alice
memrosetta status --format text
```

### 제거

```bash
memrosetta reset --all
rm -rf ~/.memrosetta
npm uninstall -g @memrosetta/cli
```
