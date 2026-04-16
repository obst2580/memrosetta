<p align="center">
  <h1 align="center">MemRosetta</h1>
  <p align="center">나의 뇌를 모든 기기에서 공유. AI 도구와 장비에 관계없이 하나의 기억.</p>
</p>

> English version: [README.md](README.md)

```bash
npm install -g memrosetta && memrosetta init --claude-code
```

---

## 나의 뇌, 모든 곳에서

```
  +---------------------------+
  |       나의 모든 기기       |
  +---------------------------+
  |                           |
  |  집 맥 ----- Claude Code  |       모든 기기가 각자 로컬
  |  회사 PC --- Codex        |       SQLite를 갖고, AI 도구가
  |  노트북 ---- Cursor       |       하나의 공유된 뇌를 통해
  |  휴대폰 ---- 앱/브라우저   |       기억을 저장하고 검색합니다.
  |                           |
  +------------+--------------+
               |
               v  (선택적 sync)
  +---------------------------+
  |     직접 호스팅 허브        |
  |  sync.your-domain.net     |
  +---------------------------+
  |  store / search / recall  |
  |  PostgreSQL op-log        |
  |  push + pull (1000/배치)  |
  +------------+--------------+
               |
               v
  +---------------------------+
  |    memrosetta core        |
  |    (LLM-free 엔진)        |
  +---------------------------+
```

**새벽 2시에 집 맥에서 내린 결정? 다음 날 아침 회사 PC의 AI가 알고 있습니다.**

```
월요일 — 집 맥 + Claude Code:
  나: "인증은 OAuth2 + PKCE로. JWT refresh token은 매번 갱신."
  Claude: 결정 사항 저장 --> sync 허브로 전송

화요일 — 회사 PC + Codex:
  나: "인증 설정 어떻게 하기로 했지?"
  Codex: 기억 검색 --> "OAuth2 + PKCE, JWT 갱신형 refresh."
         월요일에 저장한 것. 다른 기기. 다른 AI 도구. 같은 뇌.
```

**로컬 우선. 직접 호스팅 sync 옵션. 내 기억은 내가 통제하는 인프라를 벗어나지 않습니다.**

---

## 문제

모든 AI 도구는 세션이 끝나면 모든 것을 잊습니다:

```
MemRosetta 없이:
  세션 1: "우리 API는 Spring Boot + Azure. 인증은 OAuth2 PKCE."
  세션 2: "기술 스택이 뭐였죠?"    →  AI는 모름

  세션 1: "인증 리팩토링은 B안으로 가자."
  세션 2: "뭘로 결정했더라?"       →  사라짐

  세션 1: (3시간 디버깅) "배치 사이즈를 4로 바꾸면 해결됨."
  세션 2: (같은 버그)              →  처음부터 다시 시작
```

같은 설명을 반복하고, 같은 결정을 다시 내리고, 같은 버그를 다시 잡습니다. MemRosetta가 해결합니다.

## 시작하기

**Node.js 22+** 필요.

```bash
npm install -g memrosetta
```

```bash
# 기본: 데이터베이스 + MCP 서버
memrosetta init

# Claude Code: + hooks + CLAUDE.md 지침
memrosetta init --claude-code

# Cursor: + MCP 설정
memrosetta init --cursor

# Codex: + config.toml + AGENTS.md 지침
memrosetta init --codex

# Gemini: + settings.json + GEMINI.md 지침
memrosetta init --gemini
```

끝입니다. 도구를 재시작하면 기억이 작동합니다.

## Claude Code 통합 작동 원리

`memrosetta init --claude-code`를 실행하면 세 가지가 설정됩니다:

### 1. MCP 서버 (Claude를 위한 기억 도구)

Claude가 세션 중 호출할 수 있는 6개의 기억 도구를 제공합니다:

**memrosetta_store** -- Claude가 중요한 정보를 만나면 호출합니다:
- 기술적 결정 ("MySQL 대신 PostgreSQL을 선택한 이유는...")
- 사용자 선호 ("사용자는 OOP보다 함수형 스타일을 선호")
- 프로젝트 사실 ("API는 포트 8080에서 JWT 인증으로 실행")
- 완료된 작업 ("user 테이블을 새 스키마로 마이그레이션, 3개 컬럼 추가")

**memrosetta_search** -- Claude가 맥락이 필요할 때 호출합니다:
- "인증 시스템에 대해 뭘 결정했지?" --> 과거 기억 검색
- "API가 어떻게 설정되어 있지?" --> 이전 세션의 기술 사실 검색
- "사용자가 에러 처리에 대해 뭘 선호하지?" --> 선호 기억 조회

**memrosetta_working_memory** -- Claude가 관련 컨텍스트를 로드할 때 호출합니다:
- 가장 높은 활성화 점수의 기억을 반환 (~3K 토큰)
- 자주 접근하고 최근의 기억을 우선
- "지금 알아야 할 것" 요약 역할

**memrosetta_relate** -- Claude가 관련 기억을 연결합니다:
- "인증 방식이 바뀌었다" --> `updates` 관계 생성
- "이전 결정과 모순된다" --> `contradicts` 관계 생성

**memrosetta_invalidate** -- Claude가 오래된 사실을 표시합니다:
- "더 이상 React를 사용하지 않고 Vue로 전환했다" --> React 사실을 무효화

**memrosetta_count** -- 빠른 확인: "이 프로젝트에 기억이 몇 개 있지?"

### 2. Stop Hook — 의지력이 아니라 구조적 강제

Claude Code 세션이 끝나면 Stop hook이 `memrosetta-enforce-claude-code`를
실행합니다:

1. Stop hook 이벤트(stdin)와 세션 트랜스크립트(JSONL)를 읽습니다.
2. 마지막 assistant turn을 추출해 정규화합니다.
3. LLM 추출기(Claude Haiku → GPT-4o-mini → Propositionizer → 없음 순 폴백)를
   호출해 해당 turn을 원자 사실(atomic facts)로 분해합니다.
4. `memrosetta enforce stop`을 실행해 추출된 기억을 저장하고, 상태
   (`stored | needs-continuation | noop`), 카운트, 저장된 memory id,
   감사 푸터(`STORED: ...`)를 JSON envelope으로 반환합니다.
5. 중복 제거: 같은 세션은 자기 자신의 기억을 부풀릴 수 없습니다.

왜 `CLAUDE.md` 지침 대신 hook인가: "매 턴마다 무엇을 저장할지 판단하라"는
지침은 모델이 스스로 체크리스트를 돌리기로 마음먹었을 때만 동작합니다.
v0.5.0은 이 의지력 루프를 구조적 파이프라인으로 대체합니다 — 캡처는
세션이 종료되는 순간 자동으로 일어나며, 모델이 기억해서 해야 할 일이
아닙니다. `memrosetta init --claude-code`가 설치 시 Stop hook을 자동
등록하므로, 별도의 `~/.claude/settings.json` 수정은 필요 없습니다.

`@memrosetta/core`는 여전히 LLM-free입니다. 모델 호출은 hook 레이어에서만
일어나며, hook 호출자는 이미 모델 비용을 지불하고 있기 때문입니다.

### 3. CLAUDE.md 지침

전역 CLAUDE.md에 다음 지침을 추가합니다:
- 기억을 저장할 때 (결정, 사실, 선호, 이벤트)
- 저장하지 않을 때 (코드 자체, 디버깅 과정, 확인 응답)
- 맥락이 부족할 때 과거 기억을 검색하는 방법
- 더 나은 검색 품질을 위해 항상 키워드를 포함

## 지원 도구

같은 기기의 모든 도구가 하나의 SQLite 를 공유합니다. Sync 를 켜면 모든 기기가 같은 뇌를 공유합니다.

```
  집 맥                                 회사 PC
  ------                                -------
  Claude Code --+                       Codex ------+
  Cursor -------+--> memories.db        Cursor -----+--> memories.db
  Claude Desktop+         |                         |         |
                          v (sync)                  v (sync)
                    +--sync 허브--+
                    | PostgreSQL  |
                    +-------------+
```

| 도구 | MCP | 설정 |
|------|:---:|------|
| Claude Code | Yes | `memrosetta init --claude-code` |
| Claude Desktop | Yes | `memrosetta init --mcp` |
| Cursor | Yes | `memrosetta init --cursor` |
| Windsurf | Yes | `memrosetta init --mcp` |
| Cline | Yes | `memrosetta init --mcp` |
| Codex | Yes | `memrosetta init --codex` |
| Gemini | Yes | `memrosetta init --gemini` |
| Continue | Yes | `memrosetta init --mcp` |
| ChatGPT / Copilot | -- | MCP 미지원. CLI 또는 REST API 사용. |

### 도구 + 기기 간 기억 공유

```
오전   집 맥 + Claude Code:  인증 시스템 디버깅    --> 기억 저장 + sync
오후   회사 PC + Codex:      "인증 설정?"          --> 오전 결정사항 검색 성공
저녁   집 맥 + Cursor:       미들웨어 리팩토링      --> 양쪽 세션의 전체 맥락 보유
```

동기화 없음. 클라우드 없음. 설정 없음. 로컬 파일 하나로 동작합니다.

## 작동 원리

### AI가 클라이언트. MemRosetta가 기억.

MemRosetta는 LLM을 호출하지 않습니다. 대신 AI 도구(Claude Code, Cursor 등)가 MemRosetta를 호출합니다:

```
AI 도구                          MemRosetta
-------                          ----------
"이건 중요하니까                  store() --> SQLite
 저장해두자"

"인증 시스템에 대한                search() --> 하이브리드 검색
 맥락이 필요해"

"이전에 말한 것과                  relate() --> 모순 그래프
 모순되네"
```

엔진은 저장, 검색, 모순 감지, 망각을 처리합니다 -- 모두 로컬에서, API 호출 없이. AI가 무엇을 저장할지 결정합니다. MemRosetta는 어떻게 저장하고 검색할지 결정합니다.

### 원자적 기억 + 하이브리드 검색

MemRosetta는 **원자적 기억**(텍스트 덩어리가 아닌 사실 하나 = 레코드 하나)을 로컬 SQLite에 저장하고, 키워드 매칭 + 의미 유사도 + 활성화 기반 랭킹을 결합한 하이브리드 검색으로 조회합니다.

```
쿼리: "CSS 프레임워크 뭘로 정했지?"
  |
  +-- FTS5 (BM25)     키워드 매칭: "CSS", "프레임워크"
  +-- Vector (KNN)     의미 매칭: 유사한 의미
  +-- RRF Merge        결합 랭킹
  |
  +-- Activation       자주 접근한 기억 부스트
  +-- Time decay       최신 기억 우선
```

### 기억의 생명주기

```
저장                        검색                        유지보수
----                        ----                        ------
분류 (사실/선호/             하이브리드 검색              활성화 점수 계산
  결정/이벤트)                (FTS + 벡터 + RRF)           (ACT-R 모델)
원자적 저장                  활성화 가중치                계층 압축
모순 감지                    관계 확장                     Hot  -> 항상 로드
  (NLI 모델, 로컬)          시간 필터링                   Warm -> 최근 30일
관계 연결                                                Cold -> 압축 저장
```

### RAG와 다른 점

| | RAG (청크 기반) | MemRosetta (원자적) |
|---|---|---|
| **단위** | ~400 토큰 텍스트 청크 | 사실 하나 = 레코드 하나 |
| **수정** | 문서 전체 재인덱싱 | `updates` 관계, 이전 버전 보존 |
| **모순** | 양쪽 다 반환, AI가 추측 | NLI 모델이 자동 감지 |
| **시간** | 없음 | 기억당 4개 타임스탬프 |
| **망각** | 모두 동일 가중치 | ACT-R: 자주 쓰면 높은 순위 |

## 검색 아키텍처

MemRosetta는 3단계 하이브리드 검색 파이프라인을 사용합니다:

### 1단계: FTS5 전문 검색 (BM25)

SQLite 내장 전문 검색과 BM25 랭킹:
- 쿼리를 키워드로 토큰화
- 일반적인 불용어 필터링 (the, is, are...)
- 기억 내용과 키워드에 대해 매칭
- 단어 빈도 * 역문서 빈도로 랭킹
- 속도: 13K 기억에서 ~0.2ms

### 2단계: 벡터 유사도 검색 (KNN)

로컬 임베딩 모델 (bge-small-en-v1.5, 33MB, MIT 라이선스):
- 쿼리와 기억을 384차원 벡터로 변환
- sqlite-vec을 사용한 KNN 검색
- 키워드가 놓치는 의미적 매칭 포착 ("UI 테마"가 공유 키워드 없이도 "다크 모드 선호"와 매칭)
- 속도: 13K 기억에서 ~3ms

### 3단계: Reciprocal Rank Fusion (RRF)

FTS5와 벡터 검색 결과를 결합:
- `score = 1/(k + rank_fts) + 1/(k + rank_vec)` (k = 60)
- 두 방법 모두에서 발견된 기억은 부스트
- 최종 결과에 활성화 점수(ACT-R) 가중치 적용
- 자주 접근한 기억이 더 높은 순위

## 모순 감지

새로운 기억이 저장될 때 MemRosetta가 자동으로 모순을 확인합니다:

1. 새 기억의 임베딩 계산
2. 유사한 기존 기억 검색 (상위 5개)
3. 각 쌍에 NLI(자연어 추론) 검사 실행
4. 모순 점수 >= 0.7이면 `contradicts` 관계 자동 생성

```
예시:
  기존: "우리 시급은 5만원"
  신규: "우리 시급은 4만원"
  결과: 모순 감지 (점수: 0.93)
        --> 자동 생성: 신규 --[contradicts]--> 기존
```

NLI 모델 (nli-deberta-v3-xsmall)은 완전히 로컬에서 실행:
- 크기: 71MB
- 라이선스: Apache 2.0
- API 호출 없음, LLM 불필요
- 논리적 부정 감지 정확도 우수 (MNLI에서 0.92+)
- 숫자 모순은 항상 잡히지 않을 수 있음 (모델 한계)

## 기억 계층 & 적응형 망각

인간의 기억 응고화에서 영감을 받았습니다:

### 계층

| 계층 | 내용 | 동작 |
|------|------|------|
| **Hot** | 작업 기억 (~3K 토큰) | 항상 로드. 최고 활성화. |
| **Warm** | 최근 30일 | 활성 기억. 정상 검색 랭킹. |
| **Cold** | 30일 이전 | 낮은 활성화. 압축 저장. 검색 가능. |

### ACT-R 활성화 공식

각 기억은 ACT-R 기저율 학습 방정식으로 계산된 활성화 점수를 가집니다:

```
activation = sigmoid( ln( sum( t_j ^ -0.5 ) ) + salience )
```

여기서:
- `t_j` = j번째 접근 이후 경과일
- `salience` = 기억 중요도 (0-1)
- 접근 횟수가 많을수록 --> 높은 활성화
- 최근 접근일수록 --> 높은 활성화
- 높은 중요도 --> 기본 활성화 부스트

### 압축

매우 낮은 활성화(< 0.1)의 Cold 기억은 압축 대상:
- 네임스페이스(세션/프로젝트)별로 그룹화
- 내용을 요약으로 결합
- 원본 기억은 not-latest로 표시 (보존, 삭제하지 않음)
- 요약이 새로운 검색 가능 항목이 됨

수동으로 유지보수 실행:

```bash
memrosetta maintain
```

## 주요 기능

**하이브리드 검색** -- FTS5 (BM25) + 벡터 유사도 (bge-small-en-v1.5) + Reciprocal Rank Fusion. 개별 방식보다 높은 검색 정확도.

**모순 감지** -- 로컬 NLI 모델 (nli-deberta-v3-xsmall, 71MB)이 새로운 사실과 기존 사실 사이의 모순을 자동으로 감지합니다. LLM 불필요.

**적응형 망각** -- ACT-R 활성화 점수. 자주 접근하는 기억은 순위가 올라가고, 사용하지 않는 기억은 서서히 사라지지만 삭제되지는 않습니다.

**기억 계층** -- Hot (작업 기억, ~3K 토큰), Warm (최근 30일), Cold (압축된 장기 기억).

**관계** -- `updates`, `extends`, `derives`, `contradicts`, `supports`. 기억은 평면 목록이 아니라 그래프를 형성합니다.

**시간 모델** -- 4개 타임스탬프: `learnedAt`, `documentDate`, `eventDateStart/End`, `invalidatedAt`.

**비파괴적** -- 아무것도 삭제하지 않습니다. 이전 버전은 관계와 `isLatest` 플래그로 보존됩니다.

**옵셔널 멀티 디바이스 동기화** -- Local-first가 기본. 활성화하면 각 기기가 로컬 SQLite를 유지하면서 직접 호스팅한 PostgreSQL의 append-only 연산 로그를 통해 동기화합니다. CRDT 없음, 멱등, 오프라인 지원.

**900개 이상의 테스트, 25개 테스트 파일.**

## MCP 도구

MCP로 연결하면 AI 도구가 다음 기능을 사용할 수 있습니다:

| 도구 | 설명 |
|------|------|
| `memrosetta_store` | 원자적 기억 저장 |
| `memrosetta_search` | 과거 기억 하이브리드 검색 |
| `memrosetta_working_memory` | 최우선 컨텍스트 조회 (~3K 토큰) |
| `memrosetta_relate` | 관련 기억 연결 |
| `memrosetta_invalidate` | 기억을 무효화 표시 |
| `memrosetta_count` | 저장된 기억 수 조회 |

## REST API

> **범위 주의.** `@memrosetta/api`는 **어드밴스드 싱글 노드 self-host 옵션**이지, 권장 배포 모델이 아닙니다. 로컬 SQLite 엔진을 HTTP 뒤에 붙여서, 같은 머신이나 신뢰된 LAN 안의 클라이언트(웹 UI, CRON, MCP를 못 쓰는 서비스 등)가 접근할 수 있게 해주는 용도입니다.
>
> 멀티 테넌트 클라우드 API가 **아닙니다**. 여러 기기에서 쓰려면 로컬 SQLite를 primary로 두고 옵셔널 sync hub(`@memrosetta/sync-server`)를 사용하세요. PostgreSQL 기반 원격 API는 현재 배포 대상이 아니라 향후 phase입니다.

### 기억 저장

```http
POST /api/memories
Content-Type: application/json

{
  "userId": "alice",
  "content": "모든 애플리케이션에서 다크 모드를 선호",
  "memoryType": "preference",
  "keywords": ["dark-mode", "ui"],
  "confidence": 0.95
}
```

응답:

```json
{
  "success": true,
  "data": {
    "memoryId": "mem-WL5IFdnKmMjx9_ES",
    "userId": "alice",
    "content": "모든 애플리케이션에서 다크 모드를 선호",
    "memoryType": "preference",
    "learnedAt": "2026-03-24T06:42:00Z",
    "tier": "warm",
    "activationScore": 1.0
  }
}
```

### 기억 검색

```http
POST /api/search
Content-Type: application/json

{
  "userId": "alice",
  "query": "UI 선호사항",
  "limit": 5,
  "filters": {
    "onlyLatest": true,
    "minConfidence": 0.5
  }
}
```

응답:

```json
{
  "success": true,
  "data": {
    "results": [
      {
        "memory": {
          "memoryId": "mem-WL5IFdnKmMjx9_ES",
          "content": "모든 애플리케이션에서 다크 모드를 선호",
          "memoryType": "preference",
          "activationScore": 0.87
        },
        "score": 0.92,
        "matchType": "hybrid"
      }
    ],
    "totalCount": 1,
    "queryTimeMs": 3.2
  }
}
```

### 작업 기억

```http
GET /api/working-memory?userId=alice&maxTokens=3000
```

응답:

```json
{
  "success": true,
  "data": {
    "memories": [
      {
        "content": "모든 애플리케이션에서 다크 모드를 선호",
        "memoryType": "preference",
        "activationScore": 0.87
      }
    ],
    "totalTokens": 2847,
    "memoryCount": 12
  }
}
```

### 관계 생성

```http
POST /api/relations
Content-Type: application/json

{
  "srcMemoryId": "mem-abc123",
  "dstMemoryId": "mem-def456",
  "relationType": "updates",
  "reason": "시급이 5만원에서 4만원으로 변경"
}
```

### 기억 무효화

```http
POST /api/memories/mem-abc123/invalidate
```

## CLI 레퍼런스

15개 명령어로 기억을 완전히 관리합니다. [CLI 전체 문서](docs/CLI.ko.md) | [CLI English docs](docs/CLI.md)

| 명령어 | 설명 |
|--------|------|
| `init` | 데이터베이스 + 연동 초기화 |
| `store` | 원자적 기억 저장 |
| `search` | 하이브리드 기억 검색 |
| `get` | ID로 기억 조회 |
| `count` | 사용자 기억 수 조회 |
| `clear` | 사용자 기억 전체 삭제 |
| `relate` | 기억 간 관계 생성 |
| `invalidate` | 기억 무효화 표시 |
| `ingest` | JSONL 트랜스크립트에서 대화 수집 |
| `working-memory` | 사용자 작업 기억 조회 |
| `maintain` | 유지보수 실행 (점수 + 계층 + 압축) |
| `compress` | 압축만 실행 |
| `status` | 데이터베이스 및 연동 상태 확인 |
| `reset` | 연동 설정 제거 |
| `sync` | 옵셔널 멀티 디바이스 동기화 관리 |

글로벌 플래그: `--db <path>` `--format json|text` `--no-embeddings`

## 멀티 디바이스 동기화 (옵션)

MemRosetta 는 local-first 입니다. CLI, MCP, SQLite 엔진 모두 서버 없이 동작합니다. 여러 기기에서 같은 기억 그래프를 쓰고 싶을 때 **두 가지 경로**가 있습니다.

### 경로 A: Liliplanet Cloud (관리형)

설정 없는 호스팅 sync. Google, 카카오, 네이버, 이메일 계정으로 로그인하면 모든 기기에서 기억이 자동 동기화됩니다.

```bash
memrosetta sync login                     # 브라우저 열림, 한 번 로그인
memrosetta sync now                       # push + pull 한 번에
```

대부분의 사용자에게 권장하는 경로입니다. sync 허브, 데이터베이스, 백업이 관리됩니다. 무료 티어 제공, 유료 플랜은 사용량 제한 해제.

> Liliplanet Cloud 는 호스팅 편의 서비스입니다. MemRosetta 사용에 필수가 아닙니다. 로컬 SQLite 파일은 클라우드 없이 완전히 오프라인으로 동작합니다.

### 경로 B: 직접 호스팅 (완전한 통제)

본인의 PostgreSQL 에 sync 허브를 직접 운영합니다. 인프라를 직접 통제하며, 외부 계정 불필요.

```bash
memrosetta sync enable \
  --server https://your-sync-server.example.com \
  --key your-api-key \
  --user obst          # 모든 기기에서 같은 논리적 사용자 id
```

설정 방법은 아래 [직접 호스팅](#sync-서버-직접-호스팅) 섹션 참고.

### 공통 특성 (양쪽 경로 모두)

- 기본 비활성화. 켜지 않으면 기존 버전과 동일.
- 모든 기기가 로컬 SQLite 전체를 가짐. sync 는 append-only 연산 로그 기반 — 오프라인에서 작동하고, 연결되면 push.
- **v0.4.6 부터 진짜 양방향.** `pull()` 이 원격 ops 를 로컬 `memories` 그래프까지 INSERT. 다른 기기에서 저장한 기억이 pull 직후 바로 검색됩니다.
- **v0.4.7 부터 모든 write 경로가 sync 참여.** CLI `store / relate / invalidate / feedback` 과 MCP 어댑터 전부 로컬 SQLite 쓰기 성공 후 sync outbox 에 enqueue.
- **같은 사람, 다른 OS 계정.** 같은 `--user <id>` (self-host) 또는 같은 계정으로 로그인 (cloud) 하면 모든 기기가 같은 sync 파티션에 모입니다.

### 기기에서 sync 활성화 (self-host, API key)

```bash
# 1. 키 지정 (환경에 맞는 방식 하나 선택)

# 옵션 A — 환경변수 (Windows PowerShell/CI 권장)
export MEMROSETTA_SYNC_API_KEY="your-api-key"
memrosetta sync enable \
  --server https://your-sync-server.example.com \
  --user obst         # 논리적 사용자 id — 본인 소유 모든 기기에서 같은 값 사용

# 옵션 B — 파일에서 읽기 (쉘 히스토리에 남지 않음)
memrosetta sync enable \
  --server https://your-sync-server.example.com \
  --key-file /path/to/key

# 옵션 C — 직접 인자 (히스토리에 남음)
memrosetta sync enable \
  --server https://your-sync-server.example.com \
  --key your-api-key

# 옵션 D — stdin 파이프 (POSIX 쉘)
echo "your-api-key" | memrosetta sync enable \
  --server https://your-sync-server.example.com \
  --key-stdin
```

키 입력 소스는 **상호 배타**입니다. `--key`, `--key-stdin`, `--key-file` 중 정확히 하나만 쓰거나, `MEMROSETTA_SYNC_API_KEY`를 설정하세요. POSIX TTY에서 이 중 어느 것도 없으면 hidden prompt로 폴백합니다.

### 확인 & 운영

```bash
memrosetta sync status --format text   # 활성화 여부, cursor, pending ops, 마지막 push/pull
memrosetta sync now                    # 즉시 push + pull
memrosetta sync now --push-only        # push만
memrosetta sync device-id               # 현재 기기 ID 출력
memrosetta sync backfill --dry-run      # 기존 로컬 히스토리 enqueue 미리보기
memrosetta sync backfill                # 기존 memories/relations를 outbox에 enqueue
memrosetta sync disable                 # 동기화 끄기 (설정은 유지)
```

`sync backfill`은 sync를 켜기 전에 이미 로컬 메모리가 많이 쌓여 있던
기기에서 한 번 실행하는 용도입니다. 현재 SQLite 상태를 outbox에
enqueue만 하고 자동 push는 하지 않으므로, enqueue 후에는
`memrosetta sync now`를 직접 실행하세요. `--dry-run`으로 메모리와
관계가 몇 개 들어갈지 먼저 확인할 수 있습니다.

v0.4.8부터 backfill은 **멱등(idempotent)**입니다. op id는
`sha256(memory_id)` / `sha256(src|dst|type)`에서 결정적으로 생성되고,
outbox 삽입은 `INSERT OR IGNORE`를 사용하므로 `sync backfill`을 같은
기기에서 다시 돌려도 로컬 outbox / 서버 op 로그 / 다른 기기 inbox가
전부 그대로입니다 (재실행 = no-op).

### Sync 서버 셀프 호스팅

sync 서버는 Hono 앱이며, append-only 연산 로그를 PostgreSQL 15+에 기록합니다. 전체 아키텍처는 [docs/sync-architecture.md](docs/sync-architecture.md), push/pull 프로토콜은 [docs/sync-api.md](docs/sync-api.md) 참조.

최소 설정:

1. 빈 PostgreSQL 데이터베이스를 만든다.
2. `DATABASE_URL`과 `MEMROSETTA_API_KEYS`(쉼표 구분 다중 키 가능)를 설정한다.
3. `@memrosetta/sync-server`(Node 22+)를 시작한다. 첫 실행 시 `@memrosetta/postgres/migrations`의 마이그레이션을 자동 적용.

`GET /sync/health`가 `{"status":"ok","db":"ok"}`를 반환하면 정상.

> **중요:** `@memrosetta/sync-server`와 `@memrosetta/postgres`는 현재 pre-1.0 (0.1.x)입니다. 아직 npm `latest` 태그로 공개하지 않았습니다. 모노레포에서 직접 빌드하거나 명시적으로 pin해서 사용하세요.

## 라이브러리로 사용

```typescript
import { SqliteMemoryEngine } from '@memrosetta/core';
import { HuggingFaceEmbedder } from '@memrosetta/embeddings';

const embedder = new HuggingFaceEmbedder();
await embedder.initialize();

const engine = new SqliteMemoryEngine({ dbPath: './memories.db', embedder });
await engine.initialize();

// 저장
await engine.store({
  userId: 'alice',
  content: 'Prefers dark mode in all applications',
  memoryType: 'preference',
  keywords: ['dark-mode', 'ui'],
});

// 검색 (하이브리드: 키워드 + 시맨틱)
const results = await engine.search({
  userId: 'alice',
  query: 'UI theme preference',
  limit: 5,
});

// 관계 설정
await engine.relate(memA.memoryId, memB.memoryId, 'updates', 'Changed preference');

// 작업 기억 (최우선 기억, ~3K 토큰)
const context = await engine.workingMemory('alice', 3000);

// 유지보수 (활성화 점수 재계산, 오래된 기억 압축)
await engine.maintain('alice');

await engine.close();
```

## 패키지

| 패키지 | 설명 |
|--------|------|
| `@memrosetta/core` | 메모리 엔진: SQLite + FTS5 + 벡터 + NLI |
| `@memrosetta/embeddings` | 로컬 임베딩 (bge-small-en-v1.5) + NLI (nli-deberta-v3-xsmall) |
| `@memrosetta/cli` | CLI |
| `@memrosetta/mcp` | MCP 서버 (AI 도구 연동) |
| `@memrosetta/api` | REST API (Hono) -- 싱글 노드 self-host용, 멀티 테넌트 클라우드 API 아님 |
| `@memrosetta/claude-code` | Claude Code 연동 (hooks + init) |
| `@memrosetta/llm` | LLM 기반 사실 추출 (OpenAI/Anthropic) -- 선택사항 |
| `@memrosetta/extractor` | 다국어 원자적 사실 분해 (Propositionizer-mT5) -- 선택사항 |
| `@memrosetta/sync-client` | 옵셔널 멀티 디바이스 동기화용 로컬 outbox/inbox |
| `@memrosetta/sync-server` | 셀프 호스트 가능한 Hono sync hub (pre-1.0, `latest`에 없음) |
| `@memrosetta/postgres` | sync hub용 PostgreSQL 어댑터 (pre-1.0, `latest`에 없음) |

## 벤치마크

[LoCoMo](https://github.com/snap-research/locomo) 데이터셋으로 평가 (1,986개 QA, 5,882개 기억):

| 방법 | Precision@5 | MRR | 지연시간 (p50) | LLM 필요 |
|------|:-----------:|:---:|:-------------:|:--------:|
| FTS5 only | 0.0087 | 0.0298 | 0.4ms | No |
| Hybrid (FTS + Vector) | 0.0030 | 0.0111 | 4.2ms | No |
| **Hybrid + Fact Extraction** | **0.0311** | **0.0572** | **4.0ms** | **Yes (외부)** |

LoCoMo 대화 턴 데이터에서 FTS5 키워드 매칭이 정밀도가 가장 높음. Hybrid는 쿼리가 저장된 메모리와 다른 표현을 쓸 때 유용. 사실 추출(원자적 메모리 전처리)이 **single-hop 23.8%**로 최고 정확도.

사실 추출은 외부 LLM(OpenAI, Anthropic 등)을 사용하여 대화 트랜스크립트를 원자적 사실로 전처리합니다. 코어 검색 엔진은 LLM 없이 동작합니다.

> 벤치마크 결과는 SQLite 버전, 임베딩 모델 양자화, 하드웨어에 따라 약간 다를 수
> 있습니다. `pnpm bench:*`를 실행하여 직접 재현할 수 있습니다.

```bash
pnpm bench:sqlite                    # FTS only
pnpm bench:hybrid                    # 하이브리드 검색
pnpm bench:hybrid --converter fact --llm-provider openai  # LLM 추출 포함
```

## 비교

| | Mem0 | Zep | Letta | **MemRosetta** |
|---|---|---|---|---|
| 로컬 실행 | 클라우드 | 클라우드 | 클라우드 + 로컬 | **SQLite, 서버 불필요** |
| 코어 LLM 의존 | Yes | Yes | Yes | **없음 (AI 도구가 클라이언트)** |
| 모순 감지 | No | No | No | **Yes (NLI, 로컬)** |
| 망각 모델 | No | No | No | **Yes (ACT-R)** |
| 시간 모델 | No | No | No | **4개 타임스탬프** |
| 관계형 버전 관리 | No | No | No | **5가지 관계 타입** |
| 도구 간 공유 | No | No | No | **Yes, 로컬 DB 하나** |
| 프로토콜 | REST API | REST API | REST API | **MCP + CLI + REST** |
| 설치 | 복잡 | 복잡 | 복잡 | **명령어 하나** |

## 개발

```bash
git clone https://github.com/obst2580/memrosetta.git
cd memrosetta
pnpm install
pnpm build             # 모든 패키지 빌드 (첫 테스트 전 필수)
pnpm test              # 696개 이상의 테스트
pnpm bench:mock        # 빠른 벤치마크 (LLM 불필요)
```

> 클린 클론에서 `pnpm test`는 자동으로 `pnpm build`를 먼저 실행하여 워크스페이스
> 패키지(`@memrosetta/types`, `@memrosetta/core` 등)가 테스트에서 `dist/` 내보내기를
> 참조하기 전에 컴파일되도록 합니다. 빌드 없이 테스트만 재실행하려면
> `pnpm test:only`를 사용하세요.

기여 가이드라인은 [CONTRIBUTING.md](CONTRIBUTING.md)를 참고하세요.

## 로드맵

- [x] 원자적 기억 CRUD + SQLite + FTS5
- [x] 벡터 검색 + 하이브리드 검색 (RRF)
- [x] NLI 모순 감지
- [x] 시간 모델 (4개 타임스탬프, 무효화)
- [x] 계층 압축 (Hot/Warm/Cold)
- [x] 적응형 망각 (ACT-R)
- [x] 작업 기억 엔드포인트
- [x] CLI + REST API + MCP 서버
- [x] Claude Code 연동
- [x] LoCoMo 벤치마크
- [x] 다국어 임베딩 (한국어, 다국어, 프리셋 설정)
- [x] Codex 연동
- [x] Gemini 연동
- [x] CI 파이프라인 (빌드 + 타입체크 + 테스트)
- [x] 옵셔널 멀티 디바이스 동기화 (self-host op log hub)
- [x] 다국어 원자적 사실 분해 (Propositionizer-mT5)
- [x] 양방향 sync (pull이 로컬 그래프까지 적용, v0.4.6)
- [x] CLI write 경로가 sync에 참여 (v0.4.7)
- [x] 기기 간 공유 `syncUserId` (v0.4.5)
- [x] 결정적/멱등적 backfill (v0.4.8)
- [x] `memrosetta enforce` + Stop hook 기반 구조적 기억 캡처 (v0.5.0)
- [x] 대용량 backfill을 위한 sync push 청크 분할 (v0.5.0)
- [x] Codex CLI Stop hook 자동 등록 (v0.5.1)
- [x] 단일 canonical `user_id` 마이그레이션 + `duplicates report` (v0.5.2)
- [x] 한글 자연어 FTS5 쿼리 전처리 (v0.5.2)
- [x] 대용량 sync pull 페이지네이션 (v0.5.3)
- [x] 맥락 의존 인출 + Hebbian 동시 활성화 (v0.7.0)
- [x] 확산 활성화 Lite: relation + co-access 그래프 순회 (v0.8.0)
- [ ] Sync server 1.0 (프로덕션 검증 후 0.1.x → 1.0 승격)
- [ ] 프로필 빌더 (stable + dynamic 사용자 프로필)
- [ ] Stable/volatile 기억 분류

## 라이선스

[MIT](LICENSE)
