# MemRosetta

AI를 위한 범용 장기 기억 엔진. 뇌과학 기반 아키텍처. 오픈소스.

> Memory + Rosetta: 로제타석이 고대 문자의 열쇠였듯, MemRosetta는 AI 기억의 열쇠.

## 한 줄 요약

기억을 잘 저장하고, 잘 되살리는 구조. LLM 의존 없는 순수 저장/검색 엔진.

## 핵심 원칙

1. **Core는 LLM 의존 없음** - 메모리 추출은 클라이언트 책임. DB는 순수 저장/검색.
2. **인프라 최소화** - SQLite 기본 (npm install만으로 시작). PostgreSQL 옵션.
3. **비파괴적 버저닝** - 기억을 삭제하지 않음. Git처럼 이력 보존.
4. **뇌과학 기반** - 인간의 기억 원리(저장, 연결, 압축, 망각)를 공학적으로 구현.

## 아키텍처

```
클라이언트 (LLM 사용하는 쪽)
  - Claude Code Hook → 대화에서 사실 추출 → memrosetta.store()
  - OpenClaw 플러그인
  - 옵시디언 동기화
  - MirrorAgent Decision Profile
      ↓
MemRosetta Core (LLM 의존 없음)
  - store(memory)       → 원자적 메모리 저장
  - search(query)       → 하이브리드 검색 (벡터 + FTS + 관계 + 시간)
  - relate(a, b, type)  → 관계 설정 (updates/extends/derives/contradicts)
  - getProfile(userId)  → 프로필 집계 (stable + dynamic)
  - compress()          → 계층 압축 (Hot → Warm → Cold)
  - workingMemory()     → 3K 토큰 작업 기억 반환
```

## 핵심 기능

### 1. 원자적 메모리 (Atomic Memory Unit)
- 1사실 = 1메모리. 텍스트 blob이 아닌 독립된 지식 조각.
- 구조: content + metadata + embedding + relations

### 2. 관계형 버전 관리
- updates: 기존 사실 수정 ("시급 5만원" → "장기 거래면 4만원도 OK")
- extends: 세부사항 추가 ("특히 SaaS 프로젝트는")
- derives: 추론 ("SaaS + 장기 = 초기 단가 낮아도 총 수익 높음")
- contradicts: 모순 표시
- 비파괴적: isLatest 플래그 + 관계 엣지. 기존 기억 삭제 안 함.

### 3. 시간 모델
- learned_at: 이 사실을 알게 된 시점
- document_date: 대화/문서 시점
- event_date_start/end: 사건의 실제 시점
- invalidated_at: 무효화 시점
- MVP에서는 document_date + learned_at만 사용

### 4. 하이브리드 검색
- BM25/FTS5 (키워드)
- 벡터 유사도 (의미)
- 관계 확장 (그래프 탐색)
- 시간 필터
- Reciprocal Rank Fusion으로 결과 합산

### 5. 계층 압축 (뇌의 기억 응고화)
- Hot: 작업 기억, 항상 로드 (~3K 토큰)
- Warm: 최근 30일 메모리
- Cold: 30일 이전, 압축 요약
- 백그라운드 워커가 자동 실행

### 6. 적응형 망각 (뇌의 망각 곡선)
- 활성화 점수 = f(접근 빈도, 중요도, 시간)
- 임계값 이하 → 검색 가중치 감소 (삭제는 안 함)
- ACT-R 기저율 학습 공식 참고

### 7. 프로필 빌더
- stable: 인적사항, 역할, 장기 선호
- dynamic: 현재 프로젝트, 최근 관심사
- 메모리 집계 → 자동 프로필 생성

## 기술 스택

| 레이어 | 기술 |
|--------|------|
| 언어 | TypeScript (Node.js) |
| 저장 (기본) | SQLite + sqlite-vss |
| 저장 (옵션) | PostgreSQL + pgvector |
| 전문 검색 | SQLite FTS5 |
| 벡터 임베딩 | bge-small-en-v1.5 (33M, MIT) |
| 모순 감지 | nli-deberta-v3-xsmall (71M, Apache 2.0) |
| API | REST (Hono) |

## HuggingFace 모델 (Core 내장, 전부 MIT/Apache)

Core에 내장하는 모델은 상업적 사용 가능한 라이선스만 사용.
사실 추출(Triplet Extraction)은 Core에 넣지 않음 (클라이언트 책임).

### 벡터 임베딩 (검색용)

| 모델 | 크기 | 차원 | 성능 | 라이선스 | 용도 |
|------|------|------|------|----------|------|
| bge-small-en-v1.5 | 33M | 384 | MTEB 62.17 | MIT | 영어 기본 |
| multilingual-e5-small | 100M | 384 | 94개 언어 | MIT | 다국어 |
| ko-sroberta-multitask | 110M | 768 | KorSTS 85.6 | Apache 2.0 | 한국어 |

기본값: bge-small-en-v1.5. 설정으로 교체 가능.

### 모순 감지 (NLI)

| 모델 | 크기 | 성능 | 라이선스 |
|------|------|------|----------|
| nli-deberta-v3-xsmall | 71M | SNLI 91.6% | Apache 2.0 |

store() 시 유사 메모리와 모순 여부를 로컬에서 판단. LLM API 호출 불필요.

```
store() 호출 시 내부 흐름:
  1. 임베딩 생성 (bge-small, 33M)
  2. 유사 메모리 검색 (FTS + 벡터)
  3. 모순 체크 (nli-deberta, 71M) ← LLM 없이 로컬
  4. 모순 발견 시 → contradicts 관계 자동 설정
  5. 저장
```

### 사실 추출 (Core 미포함, 클라이언트 책임)

상업적 사용 가능한 사실 추출 모델이 아직 없음 (rebel-large 등은 CC-BY-NC-SA).
따라서 Core에는 넣지 않고, 참고 구현만 제공:

```
examples/
├── extract-with-claude.ts    # Claude API로 사실 추출
├── extract-with-gpt.ts       # OpenAI API로 사실 추출
└── extract-prompt-template.md # 추출 프롬프트 템플릿
```

### 벤치마크 데이터셋

| 데이터셋 | 평가 대상 | 라이선스 |
|---------|----------|----------|
| MemoryAgentBench | 4가지 메모리 역량 (충돌 해결 포함) | MIT |
| LongMemEval | 5가지 장기 메모리 능력 | MIT |
| MemoryBench (THUIR) | 28+ 하위 벤치마크 통합 | - |

## DB 스키마 (MVP)

```sql
CREATE TABLE memories (
  memory_id       TEXT PRIMARY KEY,
  user_id         TEXT,
  namespace       TEXT,
  memory_type     TEXT,  -- fact, preference, decision, event
  content         TEXT,
  raw_text        TEXT,
  document_date   TEXT,
  learned_at      TEXT,
  source_id       TEXT,
  confidence      REAL,
  salience        REAL,
  is_latest       INTEGER DEFAULT 1,
  embedding       BLOB,
  keywords        TEXT
);

CREATE TABLE memory_relations (
  src_memory_id   TEXT,
  dst_memory_id   TEXT,
  relation_type   TEXT,  -- updates, extends, derives, contradicts
  created_at      TEXT,
  reason          TEXT,
  PRIMARY KEY (src_memory_id, dst_memory_id, relation_type)
);

CREATE VIRTUAL TABLE memories_fts USING fts5(content, keywords);
```

## 프로젝트 구조 (목표)

```
memrosetta/
├── packages/
│   ├── core/           # 메모리 엔진 코어
│   ├── sqlite/         # SQLite 스토리지 어댑터
│   ├── postgres/       # PostgreSQL 스토리지 어댑터 (Phase 2)
│   ├── embeddings/     # 로컬 임베딩 모듈
│   └── cli/            # CLI 도구
├── adapters/
│   ├── claude-code/    # Claude Code 플러그인
│   ├── openclaw/       # OpenClaw 플러그인
│   └── obsidian/       # 옵시디언 동기화
├── benchmarks/         # LongMemEval + memorybench
└── docs/
```

## 구현 로드맵

### Phase 1: MVP (핵심 동작)
- 원자적 메모리 CRUD
- SQLite + FTS5 키워드 검색
- REST API (Hono)
- CLI 도구
- 기본 관계 (updates/extends)

### Phase 2: 벡터 검색
- 로컬 임베딩 (all-MiniLM-L6-v2)
- 하이브리드 검색 (FTS + 벡터 + RRF)
- PostgreSQL + pgvector 어댑터

### Phase 3: 관계 + 시간
- 전체 관계 타입 (derives, contradicts, supports)
- 시간 모델 확장 (valid_from/to, invalidated_at)
- 모순 감지 + resolver policy
- 프로필 빌더

### Phase 4: 압축 + 망각
- 계층 압축 (Hot/Warm/Cold)
- 적응형 망각 (활성화 점수)
- 작업 기억 엔드포인트 (workingMemory)
- 백그라운드 워커

### Phase 5: 연동 + 벤치마크
- Claude Code Stop Hook 플러그인
- OpenClaw 플러그인
- 옵시디언 동기화
- LongMemEval 벤치마크 자동화
- MCP 서버

## 참고 프로젝트

| 프로젝트 | 참고 포인트 |
|----------|-------------|
| Supermemory | 원자 메모리, 관계 버전, 이중 시간, 프로필 |
| Mem0 | API 패턴, provider abstraction, 배포 구조 |
| Hipocampus | 파일 기반 계층, ROOT.md 압축, 작업 기억 UX |
| Zep/Graphiti | temporal validity, provenance, hybrid retrieval |
| A-MEM | 제텔카스텐 동적 연결 |
| HippoRAG | 해마 색인 + PageRank 검색 |
| MemoryOS | 3계층 동적 전환 |
| ACT-R LLM | 망각 곡선, 시간 감쇠 |

## 상세 설계 문서

옵시디언: `~/Documents/obst/개인프로젝트/mirroragent/메모리엔진-설계.md`

## 비전

기억을 잃지 않는 AI. 모든 AI 도구에 장기 기억을 부여하는 오픈소스 표준.
