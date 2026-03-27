# MemRosetta 아키텍처

> MemRosetta 내부 구조에 대한 최종 기술 레퍼런스 문서.
> 모든 수치, 임계값, 수식, 동작은 실제 소스 코드에서 도출되었습니다.

## 목차

- [설계 철학](#설계-철학)
- [메모리 모델](#메모리-모델)
- [저장 파이프라인](#저장-파이프라인)
- [검색 파이프라인](#검색-파이프라인)
- [망각 모델](#망각-모델)
- [모순 감지](#모순-감지)
- [유용성 피드백](#유용성-피드백)
- [메모리 계층](#메모리-계층)
- [상태 모델](#상태-모델)
- [품질 지표](#품질-지표)
- [통합 아키텍처](#통합-아키텍처)
- [데이터베이스 스키마](#데이터베이스-스키마)
- [임베딩 모델](#임베딩-모델)
- [벤치마크](#벤치마크)

---

## 설계 철학

### 뇌에서 영감을 받되, 뇌를 모방하지 않는다

MemRosetta는 신경과학 개념 -- 에빙하우스 망각 곡선, ACT-R 활성화 이론, 해마 기억 응고 -- 에서 착안했지만, 이를 실용적 엔지니어링으로 구현합니다. 목표는 생물학적 정확성이 아닌 유용한 동작입니다.

### Core에는 LLM 의존 없음

코어 엔진(`@memrosetta/core`)은 LLM API 호출 없이 저장, 검색, 랭킹, 망각, 압축을 수행합니다. 모든 지능은 로컬에서 동작합니다:

- **임베딩**: HuggingFace Transformers.js 모델을 CPU에서 실행 (bge-small-en-v1.5, 33MB)
- **모순 감지**: NLI 모델을 CPU에서 실행 (nli-deberta-v3-xsmall, 71MB)
- **사실 추출**은 명시적으로 클라이언트의 책임 (Core에 미포함)

### 로컬 우선: SQLite 파일 하나

기본 저장소는 WAL 모드의 단일 SQLite 파일입니다. 외부 데이터베이스, 네트워크 의존성, Docker가 필요 없습니다. `npm install`만으로 시작할 수 있습니다.

```
초기화 시 SQLite pragma 설정:
  journal_mode = WAL       (더 나은 동시성)
  synchronous  = NORMAL    (손상 위험 없이 성능 확보)
  foreign_keys = ON        (참조 무결성)
```

### 비파괴적 버전 관리

메모리는 절대 삭제되지 않습니다. 업데이트 시 새 메모리를 생성하고 기존 메모리의 `is_latest`를 0으로 설정합니다. 무효화는 행을 제거하지 않고 `invalidated_at`을 설정합니다. Git처럼 전체 이력이 보존됩니다.

---

## 메모리 모델

### 원자적 메모리 (Atomic Memory)

각 메모리는 하나의 독립적인 지식 조각입니다 -- 텍스트 blob이 아닙니다. 원자성은 애플리케이션 레벨에서 강제됩니다.

```
+-----------------------------------------------------------------------+
|                        Memory (원자 단위)                               |
+-----------------------------------------------------------------------+
| memory_id       TEXT    "mem-" + nanoid(16)                           |
| user_id         TEXT    이 메모리의 소유자                                |
| namespace       TEXT?   선택적 카테고리/프로젝트                          |
| memory_type     TEXT    fact | preference | decision | event          |
| content         TEXT    실제 지식 (필수)                                 |
| raw_text        TEXT?   원본 미가공 텍스트                                |
| document_date   TEXT?   ISO 8601, 출처 생성 시점                        |
| learned_at      TEXT    ISO 8601, 저장 시점 (자동 설정)                   |
| source_id       TEXT?   출처 추적용                                      |
| confidence      REAL    0-1, 기본값 1.0                                 |
| salience        REAL    0-1, 기본값 1.0 (동적 업데이트)                   |
| is_latest       INT     1=현행, 0=대체됨                                 |
| embedding       BLOB?   Float32Array 직렬화                             |
| keywords        TEXT?   공백 구분 토큰 (FTS/자동관계용)                    |
| event_date_start TEXT?  ISO 8601, 사건 시작 시점                        |
| event_date_end   TEXT?  ISO 8601, 사건 종료 시점                        |
| invalidated_at   TEXT?  ISO 8601, 이 사실이 무효화된 시점                 |
| tier             TEXT   hot | warm | cold (기본값: warm)               |
| activation_score REAL   0-1, 기본값 1.0 (엔진 관리)                     |
| access_count     INT    검색 적중 카운터 (기본값: 0)                      |
| last_accessed_at TEXT?  ISO 8601, 마지막 검색 적중                       |
| compressed_from  TEXT?  요약본인 경우 원본의 memory_id                    |
| use_count        INT    컨텍스트에 사용된 횟수 (기본값: 0)                 |
| success_count    INT    유용하다고 보고된 횟수 (기본값: 0)                 |
+-----------------------------------------------------------------------+
```

### 메모리 타입

| 타입 | 설명 | 예시 |
|------|------|------|
| `fact` | 객관적 지식 조각 | "사용자가 JavaScript보다 TypeScript를 선호함" |
| `preference` | 주관적 선호나 의견 | "다크 모드 에디터를 좋아함" |
| `decision` | 내린 선택 | "프로젝트에 MySQL 대신 PostgreSQL을 선택함" |
| `event` | 특정 시점에 일어난 일 | "2024-01-15에 v2.0을 프로덕션에 배포함" |

### 메모리 상태 (파생)

상태는 컬럼으로 저장되지 않습니다. 기존 필드에서 `deriveMemoryState()`로 파생됩니다:

```
deriveMemoryState(memory):
  if invalidated_at IS NOT NULL  -->  'invalidated'
  if is_latest = 0               -->  'superseded'
  그 외                           -->  'current'
```

| 상태 | 조건 | 의미 |
|------|------|------|
| `current` | `is_latest=1 AND invalidated_at IS NULL` | 활성, 유효한 메모리 |
| `superseded` | `is_latest=0` | 새 버전으로 대체됨 |
| `invalidated` | `invalidated_at IS NOT NULL` | 명시적으로 무효화됨 |

---

### 관계

5종의 관계 타입이 메모리를 지식 그래프로 연결합니다:

| 타입 | 의미 | 부수 효과 |
|------|------|-----------|
| `updates` | 새 메모리가 기존을 대체 | 대상의 `is_latest=0` 설정 |
| `extends` | 기존 메모리에 세부사항 추가 | 없음 |
| `derives` | 기존 메모리에서 추론 | 없음 |
| `contradicts` | 기존 메모리와 충돌 | 없음 (양쪽 모두 유지) |
| `supports` | 기존 메모리를 뒷받침 | 없음 |

**`updates` 관계의 자동 대체**: `updates` 타입의 관계가 생성되면 대상 메모리의 `is_latest`가 자동으로 `0`으로 설정됩니다. 부수 효과가 있는 유일한 관계 타입입니다.

**공유 키워드 기반 자동 관계**: `store()` 중에 엔진은 같은 사용자의 최근 10개 메모리를 확인합니다. 새 메모리가 기존 메모리와 3개 이상의 키워드를 공유하고 (그리고 둘 사이에 기존 관계가 없으면) `extends` 관계가 자동 생성됩니다.

```
autoRelate():
  1. 같은 사용자의 최근 10개 메모리 조회 (is_latest=1, 무효화되지 않은)
  2. 각 기존 메모리에 대해:
     a. 키워드 파싱 (공백 구분 -> 배열)
     b. 대소문자 무시하고 겹치는 키워드 수 세기
     c. 겹침 >= 3 AND 기존 관계 없음:
        'extends' 관계 생성, reason: "Auto: N shared keywords (kw1, kw2, ...)"
```

---

## 저장 파이프라인

```
Input (MemoryInput)
  |
  v
[1] 검증 + ID 생성
  |  memory_id = "mem-" + nanoid(16)
  |  learned_at = now()
  |  tier = "warm", activation_score = 1.0, access_count = 0
  |
  v
[2] 임베딩 (선택적, embedder 설정 시)
  |  embedding = embedder.embed(content)   // Float32Array[384]
  |  memories.embedding에 BLOB으로 저장
  |  vec_memories에 저장 (KNN 검색용)
  |
  v
[3] SQLite에 삽입
  |  memories 테이블에 단일 INSERT
  |  FTS5 동기 트리거가 memories_fts를 자동 갱신
  |
  v
[4] 모순 검사 (선택적, NLI detector 설정 시)
  |  a. 새 메모리 내용 임베딩
  |  b. 유사한 메모리 상위 5개 검색 (skipAccessTracking=true)
  |  c. 각 유사 메모리에 대해 (자기 자신 제외):
  |     NLI 실행: detector.detect(기존.content, 새.content)
  |     label='contradiction' AND score >= 0.7이면:
  |       'contradicts' 관계 생성
  |  d. 오류 발생 시 무시 (저장을 절대 차단하지 않음)
  |
  v
[5] 중복 검사 (선택적, embedder 설정 시)
  |  a. 새 메모리 내용 임베딩
  |  b. 사용자의 모든 최신 메모리와 브루트포스 코사인 유사도 계산
  |  c. 각 후보에 대해 (자기 자신 제외):
  |     cosine_similarity > 0.95이면:
  |       'updates' 관계 생성 (새 메모리가 기존을 대체)
  |       (기존 메모리의 is_latest = 0 설정)
  |  d. 오류 발생 시 무시
  |
  v
[6] 자동 관계 (키워드 겹침)
  |  a. 새 메모리에 키워드가 있으면:
  |     같은 사용자의 최근 10개 메모리 조회
  |     각각에 대해, 겹치는 키워드 >= 3개 AND 기존 관계 없으면:
  |       'extends' 관계 생성
  |  b. 오류 발생 시 무시
  |
  v
Memory 반환
```

**배치 저장** (`storeBatch`): 모든 입력에 대해 임베딩을 먼저 계산한 후, 모든 삽입을 단일 SQLite 트랜잭션에서 수행합니다 (원자성 보장). 모순 및 중복 검사는 50개 이하의 배치에서만 실행됩니다 (성능 가드).

**주요 임계값**:
- 모순 NLI 점수 임계값: **0.7** (`contradictionThreshold`로 설정 가능)
- 중복 코사인 유사도 임계값: **>0.95**
- 자동 관계 키워드 겹침 최솟값: **3개**
- 자동 관계 후보 풀: **최근 10개 메모리**
- 배치 모순/중복 검사 제한: **<=50개 메모리**

---

## 검색 파이프라인

```
Query
  |
  v
[단계 1] FTS5 전문 검색
  |
  v
[단계 2] 벡터 유사도 검색 (선택적)
  |
  v
[단계 3] 하이브리드 병합 (FTS 우선 전략)
  |
  v
[단계 4] 3요소 재순위화
  |
  v
[단계 5] 키워드 부스트
  |
  v
[단계 6] 중복 제거
  |
  v
[단계 7] 접근 추적 업데이트
  |
  v
결과 (SearchResponse)
```

### 단계 1: FTS5 전문 검색

**쿼리 빌딩** (`buildFtsQuery`):
1. 소문자 변환 후 공백으로 분리
2. FTS5 특수 문자 제거: `" * ( ) : ^ { } [ ] ? ! . , ; ' \`
3. 불용어 필터링 (go/went/getting 등 일반 동사 포함 영어 불용어 85개)
4. 모든 토큰이 불용어이면 원래 토큰으로 폴백
5. 토큰 수에 따른 결합 전략:
   - **1개 토큰**: `"token"` (리터럴 매치)
   - **2-4개 토큰**: `"a" AND "b" AND "c"` (높은 정밀도)
   - **5개 이상**: `"a" OR "b" OR "c" OR ...` (과도한 제한 방지)

**BM25 스코어링**: FTS5 내장 BM25, 가중치 `(1.0, 0.5)` -- `(content, keywords)` 컬럼. 원시 BM25 점수는 음수 (더 음수 = 더 관련성 높음). 점수는 [0, 1] 범위로 min-max 정규화됩니다 (1.0 = 가장 관련).

**SQL에서 적용되는 필터**:
- `user_id` (필수)
- `namespace` (선택)
- `memory_type IN (...)` (선택)
- `document_date` 범위 (선택)
- `event_date_start/end` 범위 (선택)
- `min_confidence` (선택)
- 상태 필터: `states` 배열이 레거시 `onlyLatest`/`excludeInvalidated`를 대체
- 기본값: `current` 메모리만 (is_latest=1 AND invalidated_at IS NULL)
- 기본 제한: **20**

### 단계 2: 벡터 유사도 검색

**모델**: HuggingFace Transformers.js를 통한 bge-small-en-v1.5 (384차원, q8 양자화)

**기본 경로**: sqlite-vec KNN 쿼리
```sql
SELECT rowid, distance
FROM vec_memories
WHERE embedding MATCH ?
AND k = ?
```
- 후보 제한: `min(limit * 5, 200)`
- 결과는 동일한 상태/타입/날짜 필터를 적용하여 memories 테이블과 조인

**폴백 경로**: JavaScript 브루트포스 코사인 유사도
- sqlite-vec 확장 사용 불가능 시 동작
- memories 테이블에서 모든 임베딩을 로드하고 JS에서 코사인 유사도 계산
- 코사인 유사도 공식: `dot(a,b) / (||a|| * ||b||)`
- 거리 = `1 - cosine_similarity` (낮을수록 더 유사)

### 단계 3: 하이브리드 병합 (FTS 우선 전략)

병합 전략은 요청된 limit 대비 FTS 결과 수에 따라 달라집니다:

```
queryVec가 제공되지 않으면:
    FTS 전용 결과 반환

FTS 결과가 0개이고 벡터 결과가 있으면:
    벡터 전용 결과 반환
    score = 1 - distance (유사도로 변환)

벡터 결과가 0개이면:
    FTS 전용 결과 반환

FTS 결과 >= limit이면:
    재순위 모드
    +-------------------------------------------------+
    | 모든 FTS 결과를 유지                              |
    | 벡터 top-K에도 있는 FTS 항목:                     |
    |   score *= 1.3  (겹침에 30% 부스트)              |
    | 부스트된 점수로 재정렬                             |
    +-------------------------------------------------+

FTS 결과 < limit이면:
    채움 모드
    +-------------------------------------------------+
    | 모든 FTS 결과로 시작                              |
    | limit까지 벡터 전용 결과를 추가                    |
    |   벡터 채움 score = (1 - distance) * 0.5          |
    |   (의도적으로 FTS 점수보다 낮게)                   |
    +-------------------------------------------------+
```

**FTS 우선인 이유**: BM25를 사용한 FTS는 정확한 키워드 매칭이 중요한 메모리 검색(이름, 프로젝트명, 특정 용어)에서 더 정밀합니다. 벡터 검색은 FTS만으로 부족할 때 의미적 격차를 메웁니다.

**RRF 함수** (사용 가능하지만 메인 파이프라인에서 미사용):
- `rrfMerge()`: 표준 RRF, `k=20` (웹 검색 기본값 60보다 선명)
- `rrfMergeWeighted()`: 가중 RRF, `ftsWeight=2.0`, `vecWeight=1.0`
- RRF 점수 공식: `각 리스트에 대해 weight / (k + rank + 1)의 합`

### 단계 4: 3요소 재순위화 (Generative Agents에서 영감)

"Generative Agents" 논문 (Park et al., 2023)에서 영감을 받아, 검색 결과를 세 가지 요소로 재순위화합니다:

```
final_score = w_recency * norm(recency)
            + w_importance * norm(importance)
            + w_relevance * norm(relevance)
```

**요소 정의**:

| 요소 | 공식 | 출처 |
|------|------|------|
| 최신성 (Recency) | `0.995 ^ max(0, hours_since_learned)` | `memory.learnedAt`으로부터의 지수적 감쇠 |
| 중요도 (Importance) | `memory.salience` (0-1) | 기본값 1.0, feedback()으로 업데이트 |
| 관련성 (Relevance) | `result.score` | FTS/벡터/하이브리드의 원래 검색 점수 |

**정규화**: 엡실론 임계값을 적용한 min-max 정규화.
```
NORM_EPSILON = 0.01

safeNormalize(values):
  range = max - min
  if range < 0.01:
    return 모두 1.0   // 노이즈 증폭 방지
  return 각 v에 대해 (v - min) / range
```

**기본 가중치**: `recency=1.0, importance=1.0, relevance=1.0` (모두 동일)

**최신성 감쇠율**: 시간당 0.995:
- 1시간 후: 0.995 (무시할 수 있는 감쇠)
- 24시간 후: 0.887
- 7일 후: 0.431
- 30일 후: 0.027
- 90일 후: ~0.00002

### 단계 5: 키워드 부스트

재순위화 후, 저장된 키워드가 쿼리 토큰과 겹치는 결과에 보너스를 부여합니다:

```
boost = min(겹침_수 * 0.1, 0.5)
boosted_score = score * (1 + boost)
```

- **키워드당 10% 부스트**, 최대 **50% 상한**
- 키워드는 대소문자 무시 비교
- 쿼리 토큰은 `buildFtsQuery`와 동일한 로직으로 추출 (불용어 필터링)

### 단계 6: 중복 제거

내용 동일성 기반으로 중복 결과를 제거합니다:

```
key = memory.content.toLowerCase().trim()
각 key의 첫 번째 (최고 점수) 출현만 유지
```

### 단계 7: 접근 추적

결과 반환 후, 엔진은 반환된 모든 메모리의 접근 추적을 업데이트합니다:

```sql
UPDATE memories
SET access_count = access_count + 1, last_accessed_at = ?
WHERE memory_id = ?
```

이 데이터가 영향을 미치는 곳:
- 에빙하우스 망각 곡선 (access_count = 강도 S)
- 계층 결정 (accessCount >= 10이면 hot으로 자동 승격)
- 3요소 재순위화 (maintain()를 통한 activation_score)

---

## 망각 모델

MemRosetta는 두 가지 망각 모델을 구현합니다. **에빙하우스가 현재 기본값**입니다 (`maintain()`에서 사용).

### 에빙하우스 망각 곡선

```
R = e^(-t/S)

여기서:
  R = 유지율 (0~1)
  t = 마지막 접근 이후 일수 (last_accessed_at 기준)
  S = 강도 = max(1, access_count)
```

- 접근한 적 없으면 (`last_accessed_at`이 null): **0.1** 반환
- 방금 접근했으면 (`t <= 0`): **1.0** 반환
- 기존 DB 필드(`access_count`, `last_accessed_at`)로 동작 -- 접근 이력 테이블 불필요

**감쇠 예시** (access_count=1, 즉 S=1):
- 1일 후: 0.368
- 3일 후: 0.050
- 7일 후: 0.001

**감쇠 예시** (access_count=10, 즉 S=10):
- 1일 후: 0.905
- 7일 후: 0.497
- 30일 후: 0.050

### maintain()에서의 혼합 활성화

`maintain()` 함수는 모든 활성 메모리의 활성화 점수를 계산합니다:

```
activation_score = ebbinghaus * 0.8 + salience * 0.2

여기서:
  ebbinghaus = computeEbbinghaus(access_count, last_accessed_at)
  salience   = memory.salience (0-1, 피드백 또는 원래 입력에서)
```

에빙하우스가 **80%**로 지배적이므로 오래 사용되지 않은 메모리가 적절히 감쇠합니다. 중요도(salience)가 **20%** 기여하여 높은 중요도의 메모리가 감쇠에 저항합니다.

### ACT-R 기저율 학습 (레거시)

`computeActivation()`으로 사용 가능하지만 기본 `maintain()` 플로우에서는 사용되지 않습니다:

```
B_i = ln(sum(t_j^(-d))) + beta_i

여기서:
  t_j    = j번째 접근 이후 일수
  d      = 감쇠 파라미터 (0.5)
  beta_i = 중요도 (기저율 상수)

activation = sigmoid(B_i) = 1 / (1 + e^(-B_i))
```

전체 접근 타임스탬프 이력이 필요하므로 (단순 카운트가 아닌), 실용적인 기본값으로 에빙하우스가 선택되었습니다.

---

## 모순 감지

### 모델

- **nli-deberta-v3-xsmall** (Xenova/nli-deberta-v3-xsmall)
- 크기: 71MB, q8 양자화
- 라이선스: Apache 2.0
- HuggingFace Transformers.js를 통해 로컬 실행
- 분류 파이프라인: `text-classification` 태스크

### 감지 흐름

```
store() 시:
  1. 새 메모리 내용 임베딩
  2. 유사한 메모리 상위 5개 검색 (같은 사용자, is_latest=1)
     (접근 카운트 팽창 방지를 위해 skipAccessTracking=true)
  3. 각 유사 메모리에 대해 (자기 자신 제외):
     a. NLI 실행: pipeline(기존_내용, { text_pair: 새_내용, top_k: null })
     b. 결과 파싱: 최고 점수 레이블 찾기
     c. 레이블 정규화: "contradict*" -> contradiction, "entail*" -> entailment, 그 외 neutral
     d. label = 'contradiction' AND score >= 0.7이면:
        'contradicts' 관계 생성, reason: "NLI confidence: 0.XXX"
```

### 동작

- **임계값**: 0.7 (엔진 옵션 `contradictionThreshold`로 설정 가능)
- **배치 제한**: `storeBatch`에서 50개 이하 배치에서만 실행
- **우아한 퇴화**: 모든 오류는 무시됨; 저장이 절대 차단되지 않음
- **양쪽 메모리 유지**: `updates`와 달리, `contradicts`는 `is_latest`를 변경하지 않음

---

## 유용성 피드백

Memento-Skills 접근법에서 영감: "도움이 되는 메모리는 더 높이 랭크되고, 오해를 주는 메모리는 사라진다."

### feedback(memoryId, helpful)

```
1. use_count 증가 (항상)
2. helpful이면: success_count 증가
3. 중요도 재계산:
   success_rate = success_count / use_count
   salience = clamp(0.5 + 0.5 * success_rate, 0.1, 1.0)
```

**중요도 범위**: [0.1, 1.0]
- 항상 유용한 메모리 (성공률 100%): salience = 1.0
- 전혀 유용하지 않은 메모리 (성공률 0%): salience = 0.5
- 혼합 결과: 0.5와 1.0 사이 비례
- 최솟값 0.1로 완전한 억제 방지

**영향 경로**: salience는 3요소 재순위화의 `importance` 요소와 `maintain()` 활성화 혼합(20% 가중치)에 반영됩니다.

---

## 메모리 계층

```
+------------------------------------------+
|  HOT (작업 기억)                          |
|  - 항상 먼저 로드                         |
|  - 목표: ~3K 토큰                         |
|  - 고정: 수동 승격은 hot 유지              |
|  - 자동 승격: accessCount >= 10           |
+------------------------------------------+
         |                    ^
         | age > warmDays     | accessCount >= 10
         | AND 낮은 활성화    |
         v                    |
+------------------------------------------+
|  WARM (최근 기억)                         |
|  - 최근 30일 이내, 또는                   |
|  - 오래되었지만 activation >= 0.3         |
+------------------------------------------+
         |
         | age > warmDays AND activation < 0.3
         v
+------------------------------------------+
|  COLD (장기 보관)                         |
|  - 30일 이상 경과                         |
|  - 낮은 활성화                            |
|  - 압축 후보                              |
+------------------------------------------+
```

### determineTier() 로직

```
1. memory.tier == 'hot'이면:      return 'hot'    // 고정
2. memory.accessCount >= 10이면:  return 'hot'    // 열 기반 승격
3. age <= warmDays (30)이면:      return 'warm'   // 최근
4. activationScore >= 0.3이면:    return 'warm'   // 여전히 활성
5. 그 외:                         return 'cold'
```

### 기본 계층 구성

| 파라미터 | 값 | 설명 |
|----------|-----|------|
| `hotMaxTokens` | 3000 | 작업 기억 토큰 예산 |
| `warmDays` | 30 | 메모리가 cold로 갈 수 있는 최소 경과일 |
| `coldActivationThreshold` | 0.3 | 이 아래의 활성화에서 오래된 메모리가 cold로 |

### 토큰 추정

```
estimateTokens(content) = ceil(content.length / 4)
```

대략적 휴리스틱: 4자당 1토큰.

### 작업 기억

`workingMemory(userId, maxTokens=3000)`은 계층 우선순위, 활성화 점수 순으로 토큰 예산 내에서 메모리를 반환합니다:

```sql
SELECT * FROM memories
WHERE user_id = ? AND is_latest = 1 AND invalidated_at IS NULL
ORDER BY
  CASE tier WHEN 'hot' THEN 0 WHEN 'warm' THEN 1 ELSE 2 END,
  activation_score DESC
```

추정 토큰 수가 `maxTokens`를 초과할 때까지 메모리를 추가합니다.

### 압축

`compress(userId)`는 활성화가 매우 낮은 cold 메모리를 대상으로 합니다:

```
1. activation_score < 0.1 AND is_latest = 1인 cold 메모리 SELECT
2. namespace로 그룹화
3. 2개 이상의 메모리를 가진 그룹에 대해:
   a. content를 " | " 구분자로 연결
   b. 500자 초과 시 잘라내기 (+ "...")
   c. cold 계층의 새 'fact' 메모리로 저장
      (confidence=0.5, salience=0.5, activation=0.5)
   d. compressed_from에 첫 번째 원본의 memory_id 설정
   e. 모든 원본을 is_latest=0으로 설정
```

### 유지보수

`maintain(userId)`은 전체 유지보수 사이클을 실행합니다:

```
단계 1: 활성화 점수 재계산
  각 is_latest=1 메모리에 대해:
    activation_score = ebbinghaus * 0.8 + salience * 0.2

단계 2: 계층 업데이트
  각 is_latest=1 메모리에 대해:
    new_tier = determineTier(memory)
    변경되면: UPDATE tier

단계 3: 압축
  cold 낮은 활성화 메모리에 compress(userId) 실행

반환: { activationUpdated, tiersUpdated, compressed, removed }
```

---

## 상태 모델

### 상태 도출

```
+--------------------+-----------------------------------+
| 상태               | 조건                              |
+--------------------+-----------------------------------+
| current            | is_latest=1 AND                   |
|                    | invalidated_at IS NULL            |
+--------------------+-----------------------------------+
| superseded         | is_latest=0                       |
+--------------------+-----------------------------------+
| invalidated        | invalidated_at IS NOT NULL        |
+--------------------+-----------------------------------+
```

### 검색에서의 상태 필터링

`SearchFilters`의 `states` 필터가 레거시 `onlyLatest`/`excludeInvalidated` 불리언을 대체합니다:

```
filters.states가 설정되어 있으면:
  상태 조건을 OR 절로 적용
  예: states=['current','superseded'] -->
    (is_latest=1 AND invalidated_at IS NULL) OR (is_latest=0)

filters.states가 설정되지 않으면:
  onlyLatest (기본값: true)  --> WHERE is_latest = 1
  excludeInvalidated (기본값: true) --> WHERE invalidated_at IS NULL
```

**기본 검색은 `current` 메모리만 반환합니다.**

---

## 품질 지표

`quality(userId)`는 `MemoryQuality` 스냅샷을 반환합니다:

| 지표 | SQL | 설명 |
|------|-----|------|
| `total` | `COUNT(*)` | 사용자의 전체 메모리 수 |
| `fresh` | `COUNT(*) WHERE is_latest=1 AND invalidated_at IS NULL` | 현행 활성 메모리 |
| `invalidated` | `COUNT(*) WHERE invalidated_at IS NOT NULL` | 명시적으로 무효화됨 |
| `superseded` | `COUNT(*) WHERE is_latest=0` | 새 버전으로 대체됨 |
| `withRelations` | memory_relations의 고유 memory_id | 그래프 연결이 있는 메모리 |
| `avgActivation` | `AVG(activation_score) WHERE is_latest=1` | 건강 지표 |

`memrosetta status` CLI 명령에서 표시됩니다.

---

## 통합 아키텍처

```
+------------------+          +------------------+          +-------------------+
| Claude Code      |--hooks-->| memrosetta CLI   |--------->|                   |
| (on-stop 훅)     |          | (직접 엔진)       |          |                   |
+------------------+          +------------------+          |                   |
                                                            |  MemRosetta Core  |
+------------------+          +------------------+          |  (@memrosetta/    |
| Claude Code      |--MCP---->|                  |          |   core)           |
| Cursor           |--MCP---->| MCP 서버         |--------->|                   |
| Codex            |--MCP---->| (7개 도구)        |          |                   |-----> SQLite
| 모든 MCP 클라이언트|--MCP---->|                  |          |                   |       (단일 파일)
+------------------+          +------------------+          |                   |
                                                            |                   |
+------------------+          +------------------+          |                   |
| HTTP 클라이언트   |--REST--->| Hono REST API    |--------->|                   |
+------------------+          +------------------+          +-------------------+
```

### MCP 도구 (7개)

| 도구 | 설명 |
|------|------|
| `memrosetta_store` | 원자적 메모리 저장 |
| `memrosetta_search` | 하이브리드 검색 (키워드 + 의미) |
| `memrosetta_relate` | 메모리 간 관계 생성 |
| `memrosetta_working_memory` | 작업 기억 조회 (기본 3K 토큰) |
| `memrosetta_count` | 저장된 메모리 수 조회 |
| `memrosetta_invalidate` | 메모리를 무효로 표시 |
| `memrosetta_feedback` | 유용/비유용 피드백 기록 |

모든 MCP 도구는 `userId`를 시스템 사용자 이름(`os.userInfo().username`)으로 기본 설정합니다.

### CLI 명령어

| 명령어 | 설명 |
|--------|------|
| `memrosetta store` | 메모리 저장 |
| `memrosetta search` | 메모리 검색 |
| `memrosetta relate` | 관계 생성 |
| `memrosetta get` | ID로 메모리 조회 |
| `memrosetta count` | 메모리 수 세기 |
| `memrosetta clear` | 사용자의 모든 메모리 삭제 |
| `memrosetta invalidate` | 메모리 무효화 |
| `memrosetta feedback` | 피드백 기록 |
| `memrosetta working-memory` | 작업 기억 조회 |
| `memrosetta maintain` | 유지보수 실행 |
| `memrosetta compress` | 압축 실행 |
| `memrosetta status` | 상태 및 품질 지표 표시 |
| `memrosetta init` | 초기화 및 통합 설정 |
| `memrosetta ingest` | 벌크 메모리 임포트 |
| `memrosetta reset` | 데이터베이스 초기화 |
| `memrosetta update` | 자체 업데이트 |

### Claude Code 훅

MemRosetta는 훅을 통해 Claude Code와 통합됩니다:
- **on-stop**: 대화 트랜스크립트에서 사실을 추출하고 저장
- **on-prompt**: 작업 기억을 프롬프트 컨텍스트에 주입

---

## 데이터베이스 스키마

### 스키마 버전: V5

스키마는 자동 마이그레이션(V1 -> V5)을 사용합니다. 새 데이터베이스는 V1 정의에서 모든 컬럼을 포함합니다. 기존 데이터베이스는 ALTER TABLE 문으로 마이그레이션됩니다.

### 테이블

**memories** (메인 테이블):
```sql
CREATE TABLE memories (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  memory_id        TEXT NOT NULL UNIQUE,
  user_id          TEXT NOT NULL,
  namespace        TEXT,
  memory_type      TEXT NOT NULL CHECK(memory_type IN ('fact','preference','decision','event')),
  content          TEXT NOT NULL,
  raw_text         TEXT,
  document_date    TEXT,
  learned_at       TEXT NOT NULL,
  source_id        TEXT,
  confidence       REAL DEFAULT 1.0,
  salience         REAL DEFAULT 1.0,
  is_latest        INTEGER NOT NULL DEFAULT 1,
  embedding        BLOB,
  keywords         TEXT,
  event_date_start TEXT,
  event_date_end   TEXT,
  invalidated_at   TEXT,
  tier             TEXT DEFAULT 'warm' CHECK(tier IN ('hot','warm','cold')),
  activation_score REAL DEFAULT 1.0,
  access_count     INTEGER DEFAULT 0,
  last_accessed_at TEXT,
  compressed_from  TEXT,
  use_count        INTEGER DEFAULT 0,
  success_count    INTEGER DEFAULT 0
);
```

**memory_relations**:
```sql
CREATE TABLE memory_relations (
  src_memory_id TEXT NOT NULL,
  dst_memory_id TEXT NOT NULL,
  relation_type TEXT NOT NULL CHECK(relation_type IN
    ('updates','extends','derives','contradicts','supports')),
  created_at    TEXT NOT NULL,
  reason        TEXT,
  PRIMARY KEY (src_memory_id, dst_memory_id, relation_type),
  FOREIGN KEY (src_memory_id) REFERENCES memories(memory_id),
  FOREIGN KEY (dst_memory_id) REFERENCES memories(memory_id)
);
```

**memories_fts** (FTS5, content-sync 모드):
```sql
CREATE VIRTUAL TABLE memories_fts USING fts5(
  content,
  keywords,
  content='memories',
  content_rowid='id'
);
```

트리거로 동기화 (memories의 INSERT/UPDATE/DELETE가 FTS를 자동 업데이트).

**vec_memories** (sqlite-vec, 선택적):
```sql
CREATE VIRTUAL TABLE vec_memories USING vec0(
  embedding float[384]   -- 임베딩 모델의 차원과 일치
);
```

### 인덱스

```sql
idx_memories_user_id      ON memories(user_id)
idx_memories_namespace    ON memories(user_id, namespace)
idx_memories_memory_type  ON memories(memory_type)
idx_memories_is_latest    ON memories(is_latest)
idx_memories_source_id    ON memories(source_id)
idx_memories_learned_at   ON memories(learned_at)
idx_memories_event_date   ON memories(event_date_start, event_date_end)
idx_memories_invalidated  ON memories(invalidated_at)
idx_memories_tier         ON memories(tier)
idx_memories_activation   ON memories(activation_score)
```

---

## 임베딩 모델

### 프리셋

| 프리셋 | 모델 | 크기 | 차원 | 언어 | 라이선스 |
|--------|------|------|------|------|----------|
| `en` (기본값) | Xenova/bge-small-en-v1.5 | 33MB | 384 | 영어 | MIT |
| `multilingual` | Xenova/multilingual-e5-small | 100MB | 384 | 94개 언어 | MIT |
| `ko` | Xenova/ko-sroberta-nli-multitask | 110MB | 768 | 한국어 | Apache 2.0 |

모든 모델:
- `@huggingface/transformers` (Transformers.js)를 통해 실행
- 빠른 CPU 추론을 위한 `q8` 양자화 형식 사용
- Mean pooling + L2 정규화
- 첫 사용 시 다운로드, 로컬 캐시

### 차원 불일치 처리

설정된 임베딩 차원이 `schema_version.embedding_dimension`에 저장된 값과 다르면 `vec_memories` 테이블이 삭제되고 재생성됩니다:

```
[memrosetta] Embedding dimension changed (384 -> 768). Recreating vector index...
```

---

## 벤치마크

### 데이터셋: LoCoMo

- 1,986개 QA 쌍
- 5,882개 메모리 수집
- 장기 대화 메모리 검색 평가

### 현재 결과 (FTS 전용)

| 지표 | 값 |
|------|-----|
| P@5 | 0.0087 |
| MRR | 0.0298 |

참고: 이들은 초기 단계 베이스라인 수치입니다. 하이브리드 검색(FTS + 벡터)과 3요소 재순위화가 결과를 크게 개선할 것으로 예상됩니다.
