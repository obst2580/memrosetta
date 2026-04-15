# Sync Architecture

MemRosetta의 멀티디바이스 동기화 아키텍처.
로컬 SQLite 엔진은 그대로 유지하고, 서버를 옵셔널 sync hub로 사용한다.

## 1. 설계 원칙

1. **Local-first**: 로컬 SQLite가 항상 primary. 오프라인에서도 완전히 동작.
2. **Sync is optional**: 동기화를 켜지 않으면 기존과 100% 동일하게 동작.
3. **Non-destructive**: memrosetta의 비파괴 원칙을 sync에도 적용. op은 append-only.
4. **Idempotent**: 같은 op를 여러 번 적용해도 결과가 동일.
5. **Eventual consistency**: 실시간 동기화가 아닌 batch 기반 eventual consistency.

## 2. 전체 아키텍처

```
┌─────────────┐        ┌──────────────┐        ┌─────────────┐
│  Device A   │        │  Sync Hub    │        │  Device B   │
│  (Mac)      │        │  (Sync Hub)  │        │  (GPU서버)  │
│             │        │              │        │             │
│ ┌─────────┐ │  push  │ ┌──────────┐ │  pull  │ ┌─────────┐ │
│ │ SQLite  │─┼───────→│ │PostgreSQL│←┼────────┼─│ SQLite  │ │
│ │ Engine  │ │        │ │ + pgvec  │ │        │ │ Engine  │ │
│ │         │←┼────────┼─│          │─┼───────→│ │         │ │
│ └─────────┘ │  pull  │ └──────────┘ │  push  │ └─────────┘ │
│ ┌─────────┐ │        │ ┌──────────┐ │        │ ┌─────────┐ │
│ │ Outbox  │ │        │ │ Op Log   │ │        │ │ Outbox  │ │
│ │ Inbox   │ │        │ │ Cursors  │ │        │ │ Inbox   │ │
│ └─────────┘ │        │ └──────────┘ │        │ └─────────┘ │
└─────────────┘        └──────────────┘        └─────────────┘
```

## 3. Operation Log 기반 동기화

### 3.1 설계 선택

| 방식 | 장단점 | 채택 |
|------|--------|------|
| CRDT | 충돌 자동 해결, 구현 복잡 | X (과잉) |
| Last-Write-Wins | 단순, 데이터 손실 가능 | 부분 (mutable 필드만) |
| **Op Log + Idempotent Apply** | 단순, 비파괴적, memrosetta 철학과 일치 | **O** |

### 3.2 왜 Op Log가 맞는가

memrosetta는 이미 비파괴적 설계:
- memory 수정 = 새 memory 생성 + `updates` relation
- memory 삭제 = `invalidated_at` 설정 (실제 삭제 아님)
- relation 생성 = idempotent (같은 src+dst+type은 1번만)

따라서 대부분의 변경이 **additive** (추가만). 충돌이 구조적으로 거의 발생하지 않는다.

## 4. Sync Operations (Op Types)

### 4.1 Core Ops

| Op Type | 설명 | Payload |
|---------|------|---------|
| `memory_created` | 새 메모리 저장 | Memory 전체 |
| `memory_invalidated` | 메모리 무효화 | memory_id, invalidated_at |
| `relation_created` | 관계 생성 | src_id, dst_id, type, reason |
| `feedback_given` | 피드백 기록 | memory_id, helpful, context |
| `tier_changed` | 수동 tier 변경 | memory_id, tier |

### 4.2 Op 구조

```typescript
interface SyncOp {
  readonly opId: string;          // UUID v7 (시간 정렬 가능)
  readonly opType: string;        // 'memory_created' | 'relation_created' | ...
  readonly deviceId: string;      // 디바이스 식별자
  readonly userId: string;        // 사용자 ID
  readonly timestamp: string;     // ISO 8601
  readonly payload: unknown;      // op별 데이터
}
```

### 4.3 Op 생성 규칙

- `store()` 호출 시 → `memory_created` op 자동 생성
- `relate()` 호출 시 → `relation_created` op 자동 생성
- `invalidate()` 호출 시 → `memory_invalidated` op 자동 생성
- `feedback()` 호출 시 → `feedback_given` op 자동 생성
- sync가 비활성이면 op 생성 안 함 (오버헤드 0)

## 5. 로컬 SQLite 확장 (Sync 테이블)

sync 활성화 시 로컬 SQLite에 추가되는 테이블:

```sql
-- 로컬에서 생성된 op (서버로 push 대기)
CREATE TABLE sync_outbox (
  op_id       TEXT PRIMARY KEY,
  op_type     TEXT NOT NULL,
  device_id   TEXT NOT NULL,
  user_id     TEXT NOT NULL,
  payload     TEXT NOT NULL,     -- JSON
  created_at  TEXT NOT NULL,
  pushed_at   TEXT               -- NULL이면 아직 미전송
);

-- 서버에서 받은 op (로컬 적용 대기 또는 완료)
CREATE TABLE sync_inbox (
  op_id       TEXT PRIMARY KEY,
  op_type     TEXT NOT NULL,
  device_id   TEXT NOT NULL,
  user_id     TEXT NOT NULL,
  payload     TEXT NOT NULL,     -- JSON
  created_at  TEXT NOT NULL,
  applied_at  TEXT               -- NULL이면 아직 미적용
);

-- 동기화 상태
CREATE TABLE sync_state (
  key         TEXT PRIMARY KEY,
  value       TEXT NOT NULL
);
-- 예: ('last_pull_cursor', '2026-04-15T00:00:00Z')
--     ('device_id', 'mac-obst-001')
--     ('sync_enabled', 'true')
--     ('sync_server_url', 'https://your-sync-server.example.com')
```

## 6. 동기화 대상 분류

### 6.1 Synced (동기화 대상)

서버에 push/pull되는 데이터:

| 데이터 | 이유 |
|--------|------|
| memories (content, type, keywords, confidence, salience, namespace) | 핵심 기억 |
| memory_relations | 지식 그래프 |
| invalidated_at | 무효화 상태 |
| is_latest | 버전 관리 |
| feedback (use_count, success_count) | 검색 품질 |

### 6.2 Local-only (동기화 안 함)

디바이스별로 독립적인 데이터:

| 데이터 | 이유 |
|--------|------|
| access_count | 로컬 접근 패턴 (디바이스별 다름) |
| last_accessed_at | 로컬 시간 |
| working-memory cache | 현재 작업 컨텍스트 (디바이스별) |
| search index cache | 로컬 최적화 |

### 6.3 Recomputable (재계산)

pull 후 로컬에서 재계산:

| 데이터 | 방식 |
|--------|------|
| activation_score | f(access_count, salience, age) - 로컬 access_count 기반 |
| tier (hot/warm/cold) | activation_score + age 기반 재계산 |
| embedding | 모델 버전이 같으면 동기화, 다르면 로컬 재생성 |
| FTS index | pull 후 자동 재구축 |

## 7. Push/Pull 흐름

### 7.1 Push (로컬 → 서버)

```
1. 로컬에서 store/relate/invalidate 호출
2. sync 활성화 상태면 sync_outbox에 op 기록
3. push 트리거 (주기적 또는 수동)
4. outbox에서 pushed_at IS NULL인 op 수집
5. POST /sync/push { ops: [...] }
6. 서버가 op 적용 + 응답 (accepted op_ids)
7. pushed_at 업데이트
```

### 7.2 Pull (서버 → 로컬)

```
1. pull 트리거 (주기적 또는 수동)
2. GET /sync/pull?since={last_cursor}&device_id={id}
3. 서버가 해당 cursor 이후의 op 반환 (자기 device 제외)
4. 로컬 inbox에 저장
5. 각 op를 로컬 SQLite에 idempotent apply
6. applied_at 업데이트
7. last_pull_cursor 갱신
```

### 7.3 Sync 주기

```
기본: 5분마다 자동 push + pull (설정 변경 가능)
수동: memrosetta sync 명령으로 즉시 동기화
이벤트: store/relate 호출 시 즉시 push (옵셔널, 설정에 따라)
```

## 8. 충돌 해결

### 8.1 충돌이 거의 없는 이유

memrosetta의 비파괴 설계 덕분:

```
시나리오: Device A와 B가 같은 메모리를 "수정"

실제 동작:
  Device A: store(new_content) → memory_X_v2 + updates(X_v2, X_v1)
  Device B: store(new_content) → memory_X_v3 + updates(X_v3, X_v1)

결과: X_v1에 두 개의 후속 버전 존재 → 충돌 아님, revision graph
  X_v1 ← updates ← X_v2 (from Device A)
       ← updates ← X_v3 (from Device B)

둘 다 is_latest = true → 검색 시 둘 다 나옴
→ 사용자가 나중에 정리 (또는 activation score로 자연 선택)
```

### 8.2 Mutable 필드 충돌 (LWW)

유일하게 in-place 수정되는 필드:

| 필드 | 충돌 해결 |
|------|----------|
| tier (수동 변경) | Last-Write-Wins (timestamp 기준) |
| is_latest | 관계 기반 재계산 (충돌 해결 불필요) |

### 8.3 Idempotent Apply 규칙

```
memory_created:
  IF memory_id already exists → skip (이미 동기화됨)
  ELSE → INSERT

relation_created:
  IF (src, dst, type) already exists → skip
  ELSE → INSERT

memory_invalidated:
  UPDATE invalidated_at WHERE memory_id = ?
  (idempotent: 같은 값으로 여러 번 설정해도 동일)

feedback_given:
  UPDATE use_count = use_count + 1 (additive)
  → 중복 방지: op_id로 이미 적용된 feedback skip
```

## 9. 서버 (Sync Hub)

### 9.1 역할

- Op 수신 + 저장 (append-only log)
- 디바이스별 cursor 관리
- Op 배포 (pull 요청에 응답)
- 인증 (API key 기반)

### 9.2 서버는 검색을 하지 않는다

서버의 PostgreSQL은 op log 저장소이지, 검색 엔진이 아니다.
검색/회상은 항상 로컬 SQLite에서 수행한다.

단, 향후 확장 시 서버 측 검색 API를 추가할 수 있다 (웹 UI용).

### 9.3 서버 스키마 (PostgreSQL)

```sql
-- Op Log (모든 변경 이력)
CREATE TABLE sync_ops (
  op_id       UUID PRIMARY KEY,
  op_type     TEXT NOT NULL,
  device_id   TEXT NOT NULL,
  user_id     TEXT NOT NULL,
  payload     JSONB NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  server_seq  BIGSERIAL           -- 서버 순서 (cursor용)
);

CREATE INDEX idx_sync_ops_user_seq ON sync_ops(user_id, server_seq);
CREATE INDEX idx_sync_ops_device ON sync_ops(device_id);

-- 디바이스 등록
CREATE TABLE sync_devices (
  device_id   TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL,
  device_name TEXT,
  last_push   TIMESTAMPTZ,
  last_pull   TIMESTAMPTZ,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Materialized State (op log에서 파생, 선택적)
-- 서버 측 검색이 필요해지면 여기에 memories/relations를 materialize
-- Phase 1에서는 불필요
```

## 10. 패키지 구조

```
packages/
  core/           → 기존 SQLite 엔진 (변경 최소화)
  types/          → 공유 타입 (SyncOp 타입 추가)
  sync-client/    → 로컬 outbox/inbox, push/pull 로직
  sync-server/    → Hono sync API (push/pull 엔드포인트)
  postgres/       → sync 서버의 PostgreSQL persistence
  api/            → 기존 REST API (엔진 직접 접근)
  cli/            → CLI (memrosetta sync 명령 추가)
  embeddings/     → 임베딩 모듈
  extractor/      → fact 분해 모듈
```

### 10.1 의존성 방향

```
sync-client → types, core (outbox/inbox를 로컬 SQLite에 추가)
sync-server → types, postgres (op log 저장)
postgres    → types (PostgreSQL 구현)
api         → core (기존 그대로)
cli         → core, sync-client (sync 명령 추가)
```

## 11. 설정

### 11.1 Sync 활성화 (CLI)

```bash
# 동기화 활성화
memrosetta sync enable --server https://your-sync-server.example.com --key YOUR_API_KEY

# 즉시 동기화
memrosetta sync now

# 상태 확인
memrosetta sync status

# 비활성화
memrosetta sync disable
```

### 11.2 환경변수 (서버)

```
MEMROSETTA_SYNC_PORT=8080
DATABASE_URL=postgresql://...
MEMROSETTA_API_KEYS=key1,key2,key3
```

### 11.3 Self-Hosting 가이드

MemRosetta는 공용 sync 서버를 기본 제공하지 않습니다. sync는 기본 비활성화이며, 사용자가 직접 서버를 운영할 때만 활성화해야 합니다.

최소 요구사항:

- Node.js 22+
- PostgreSQL 15+ (`sync_ops` 저장용)
- `DATABASE_URL`
- `MEMROSETTA_API_KEYS`

배포 방법 예시:

- Azure App Service: `@memrosetta/sync-server`를 배포하고 App Settings에 `DATABASE_URL`, `MEMROSETTA_API_KEYS`, `PORT`를 설정
- Docker: 컨테이너 시작 시 `node dist/standalone.js` 실행, PostgreSQL은 별도 관리형 서비스 또는 사이드카 사용
- VPS/systemd: 빌드 후 `node dist/standalone.js`를 systemd 서비스로 실행하고, reverse proxy(Nginx/Caddy) 뒤에 배치

권장 절차:

1. PostgreSQL 데이터베이스를 준비한다.
2. `DATABASE_URL`과 `MEMROSETTA_API_KEYS`를 설정한다.
3. `@memrosetta/sync-server`를 빌드/배포한다.
4. `GET /sync/health`가 `{\"status\":\"ok\",\"db\":\"ok\"}`를 반환하는지 확인한다.
5. 각 클라이언트의 `~/.memrosetta/config.json`에 서버 URL과 API key를 넣고 sync를 활성화한다.

예시 설정:

```json
{
  "syncEnabled": true,
  "syncServerUrl": "https://your-sync-server.example.com",
  "syncApiKey": "replace-with-your-api-key",
  "syncDeviceId": "device-your-machine"
}
```

## 12. Embedding 동기화 전략

embedding은 모델 버전에 따라 달라지므로 특별 처리:

```
Push 시:
  memory_created op의 payload에 embedding 포함 + model_id 기록

Pull 시:
  IF 로컬 모델 == op의 model_id → embedding 그대로 사용
  ELSE → embedding 무시, 로컬에서 재생성

서버:
  embedding을 payload에 저장하되, 검색에는 사용하지 않음 (Phase 1)
```

## 13. 구현 우선순위

### Phase 1: 기본 동기화

- [ ] packages/types에 SyncOp 타입 추가
- [ ] packages/core에 sync_outbox/inbox/state 테이블 추가 (선택적 활성화)
- [ ] packages/sync-client: push/pull 로직
- [ ] packages/sync-server: Hono API (push/pull 엔드포인트)
- [ ] packages/postgres: op log 저장
- [ ] CLI: `memrosetta sync` 명령
- [ ] Azure App Service 배포

### Phase 2: 안정화

- [ ] 자동 주기 동기화 (background worker)
- [ ] 충돌 감지 + 경고
- [ ] 동기화 상태 대시보드 (CLI)
- [ ] embedding 모델 버전 관리

### Phase 3: 서버 측 검색 (liliplanet)

- [ ] Materialized memories/relations in PostgreSQL
- [ ] 서버 측 검색 API (웹 UI용)
- [ ] pgvector 기반 서버 측 벡터 검색
