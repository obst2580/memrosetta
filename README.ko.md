<p align="center">
  <h1 align="center">MemRosetta</h1>
  <p align="center">AI 도구를 위한 영구 기억 엔진. SQLite 파일 하나. 클라우드 없음.</p>
</p>

> English version: [README.md](README.md)

```bash
npm install -g @memrosetta/cli
memrosetta init --claude-code
# 끝. AI가 모든 것을 기억합니다.
```

---

## 문제

```
세션 1: "우리 API는 Spring Boot + Azure. 인증은 OAuth2 PKCE."
세션 2: "기술 스택이 뭐였죠?" -- AI는 모름

세션 1: "인증 리팩토링은 B안으로 가자."
세션 2: "뭘로 결정했더라?" -- 사라짐

세션 1: (3시간 디버깅) "배치 사이즈를 4로 바꾸면 해결됨."
세션 2: (같은 버그) 처음부터 다시 시작
```

모든 AI 도구는 세션이 끝나면 모든 것을 잊습니다. 같은 설명을 반복하고, 같은 결정을 다시 내리고, 같은 버그를 다시 잡습니다. MemRosetta는 AI 도구에 영구적이고 검색 가능한 장기 기억을 부여하는 로컬 메모리 엔진입니다. 내 컴퓨터의 SQLite 파일 하나에 저장됩니다.

## 시작하기

```bash
npm install -g @memrosetta/cli
```

```bash
# 기본: 데이터베이스 + MCP 서버
memrosetta init

# Claude Code: + hooks + CLAUDE.md 지침
memrosetta init --claude-code

# Cursor: + MCP 설정
memrosetta init --cursor
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

### 2. Stop Hook (세션 종료 시 자동 백업)

Claude Code 세션이 끝나면 Hook이 자동으로:
1. 세션 트랜스크립트(JSONL)를 읽습니다
2. 의미 있는 대화만 추출합니다 (확인, 코드 블록, 도구 호출 건너뜀)
3. 데이터베이스에 기억으로 저장합니다
4. 중복 제거: 같은 세션이 두 번 저장되면 이전 항목을 대체합니다

이것은 안전망입니다. Claude가 세션 중 MCP로 중요한 것을 저장하지만,
Stop Hook이 놓친 것을 잡아냅니다.

### 3. CLAUDE.md 지침

전역 CLAUDE.md에 다음 지침을 추가합니다:
- 기억을 저장할 때 (결정, 사실, 선호, 이벤트)
- 저장하지 않을 때 (코드 자체, 디버깅 과정, 확인 응답)
- 맥락이 부족할 때 과거 기억을 검색하는 방법
- 더 나은 검색 품질을 위해 항상 키워드를 포함

## 지원 도구

모든 도구가 같은 로컬 데이터베이스를 공유합니다. 한 도구에서 저장한 기억은 다른 도구에서 즉시 검색할 수 있습니다.

```
Claude Code ----+
Claude Desktop --+--> ~/.memrosetta/memories.db <--+-- Cursor
Windsurf -------+     (로컬 SQLite 파일 하나)       +-- Cline
                                                   +-- Continue
```

| 도구 | MCP | 설정 |
|------|:---:|------|
| Claude Code | Yes | `memrosetta init --claude-code` |
| Claude Desktop | Yes | `memrosetta init --mcp` |
| Cursor | Yes | `memrosetta init --cursor` |
| Windsurf | Yes | `memrosetta init --mcp` |
| Cline | Yes | `memrosetta init --mcp` |
| Continue | Yes | `memrosetta init --mcp` |
| ChatGPT / Copilot | -- | MCP 미지원. CLI 또는 REST API 사용. |

### 도구 간 기억 공유

```
오전   Claude Code: 인증 시스템 디버깅           --> 기억 저장
오후   Cursor: 로그인 UI 개발                    --> "인증" 검색 --> 오전 결정사항 조회
저녁   Claude Desktop: 아키텍처 문서 작성         --> 양쪽 세션의 전체 맥락 보유
```

동기화 없음. 클라우드 없음. 설정 없음. 로컬 파일 하나로 동작합니다.

## 작동 원리

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
memrosetta maintain --user alice
```

## 주요 기능

**하이브리드 검색** -- FTS5 (BM25) + 벡터 유사도 (bge-small-en-v1.5) + Reciprocal Rank Fusion. 개별 방식보다 높은 검색 정확도.

**모순 감지** -- 로컬 NLI 모델 (nli-deberta-v3-xsmall, 71MB)이 새로운 사실과 기존 사실 사이의 모순을 자동으로 감지합니다. LLM 불필요.

**적응형 망각** -- ACT-R 활성화 점수. 자주 접근하는 기억은 순위가 올라가고, 사용하지 않는 기억은 서서히 사라지지만 삭제되지는 않습니다.

**기억 계층** -- Hot (작업 기억, ~3K 토큰), Warm (최근 30일), Cold (압축된 장기 기억).

**관계** -- `updates`, `extends`, `derives`, `contradicts`, `supports`. 기억은 평면 목록이 아니라 그래프를 형성합니다.

**시간 모델** -- 4개 타임스탬프: `learnedAt`, `documentDate`, `eventDateStart/End`, `invalidatedAt`.

**비파괴적** -- 아무것도 삭제하지 않습니다. 이전 버전은 관계와 `isLatest` 플래그로 보존됩니다.

**588개 이상의 테스트.**

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

14개 명령어로 기억을 완전히 관리합니다. [CLI 전체 문서](docs/CLI.ko.md) | [CLI English docs](docs/CLI.md)

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

글로벌 플래그: `--db <path>` `--format json|text` `--no-embeddings`

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
| `@memrosetta/api` | REST API (Hono) |
| `@memrosetta/claude-code` | Claude Code 연동 (hooks + init) |
| `@memrosetta/llm` | LLM 기반 사실 추출 (OpenAI/Anthropic) -- 선택사항 |

## 벤치마크

[LoCoMo](https://github.com/snap-research/locomo) 데이터셋으로 평가 (1,986개 QA, 5,882개 기억):

| 방법 | Precision@5 | MRR | 지연시간 (p50) |
|------|:-----------:|:---:|:-------------:|
| FTS5 only | 0.0006 | 0.0026 | 0.2ms |
| Hybrid (FTS + Vector + RRF) | 0.0013 | 0.0037 | 3.4ms |
| **Hybrid + Fact Extraction** | **0.0074** | **0.0157** | 3.3ms |

원자적 기억 + 사실 추출로 hybrid-only 대비 **MRR +324%** 향상. 청크 기반 RAG가 아닌 원자적 기억 설계의 효과를 검증합니다.

```bash
pnpm bench:sqlite                    # FTS only
pnpm bench:hybrid                    # 하이브리드 검색
pnpm bench:hybrid --converter fact --llm-provider openai  # LLM 추출 포함
```

## 비교

| | Mem0 | Zep | Letta | **MemRosetta** |
|---|---|---|---|---|
| 로컬 실행 | 클라우드 | 클라우드 | 클라우드 + 로컬 | **SQLite, 서버 불필요** |
| LLM 필수 | Yes | Yes | Yes | **No** |
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
pnpm test              # 588개 이상의 테스트
pnpm bench:mock        # 빠른 벤치마크 (LLM 불필요)
```

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
- [ ] 다국어 임베딩 (한국어, 일본어 등)
- [ ] PostgreSQL 어댑터 (팀/서버 용도)
- [ ] 프로필 빌더 (stable + dynamic 사용자 프로필)

## 라이선스

[MIT](LICENSE)
