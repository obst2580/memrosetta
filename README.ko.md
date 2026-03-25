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

## 주요 기능

**하이브리드 검색** -- FTS5 (BM25) + 벡터 유사도 (bge-small-en-v1.5) + Reciprocal Rank Fusion.

**모순 감지** -- 로컬 NLI 모델 (nli-deberta-v3-xsmall, 71MB)이 새로운 사실과 기존 사실 사이의 모순을 자동으로 감지합니다.

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

## CLI 레퍼런스

<details>
<summary>전체 CLI 명령어</summary>

```
memrosetta init [options]                데이터베이스 및 연동 초기화
  --claude-code                            + Claude Code hooks + CLAUDE.md
  --cursor                                 + Cursor MCP 설정
  --mcp                                    + MCP 서버 설정만

memrosetta store                         기억 저장
  --user <id>                              사용자 식별자
  --content <text>                         기억 내용
  --type <fact|preference|decision|event>  기억 유형
  --keywords <k1,k2>                       검색 키워드
  --namespace <ns>                         카테고리
  --confidence <0-1>                       신뢰도 점수

memrosetta search                        기억 검색
  --user <id>                              사용자 식별자
  --query <text>                           검색 쿼리
  --limit <n>                              최대 결과 수 (기본: 5)
  --format <json|text>                     출력 형식

memrosetta get <memoryId>                ID로 기억 조회
memrosetta count --user <id>             기억 수 조회
memrosetta relate                        기억 간 관계 생성
  --src <id> --dst <id>
  --type <updates|extends|derives|contradicts|supports>
memrosetta invalidate <memoryId>         기억 무효화 표시
memrosetta working-memory --user <id>    작업 기억 컨텍스트 조회
memrosetta maintain --user <id>          유지보수 실행 (점수 + 압축)
memrosetta compress --user <id>          Cold 기억 압축
memrosetta ingest --user <id> --file <path>  JSONL 트랜스크립트 수집
memrosetta status                        상태 확인
memrosetta clear --user <id> --confirm   사용자 기억 전체 삭제
memrosetta reset --claude-code           Claude Code 연동 제거
memrosetta reset --all                   모든 설정 제거

글로벌 플래그: --db <path>  --format json|text  --no-embeddings
```

</details>

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
| `@memrosetta/obsidian` | Obsidian 볼트 동기화 |

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
- [x] Obsidian 동기화
- [x] LoCoMo 벤치마크
- [ ] 다국어 임베딩 (한국어, 일본어 등)
- [ ] PostgreSQL 어댑터 (팀/서버 용도)
- [ ] 프로필 빌더 (stable + dynamic 사용자 프로필)

## 라이선스

[MIT](LICENSE)
