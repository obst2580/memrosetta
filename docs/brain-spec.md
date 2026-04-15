# Cloud Brain Master Plan (Brain Spec)

## 1. 시스템 철학 (Philosophy)
본 시스템의 궁극적인 목표는 **"개인의 뇌를 클라우드에 복제하고 확장하는 것"**입니다. 
이는 단순한 데이터 로깅(Logging)이나 하드디스크 백업이 아니며, 인간의 기억 처리 방식(분류, 활성화, 연결, 망각, 업데이트)을 모방하는 **인지적 기억 엔진(Cognitive Memory Engine)**을 구축하는 것을 의미합니다. 여기서 핵심은 **저장(Storage)이 아닌 회상(Recall)**입니다.

## 2. 역할 분리 (Architecture Separation)
전체 시스템은 뇌의 구조에 빗대어 두 개의 핵심 모듈로 분리됩니다.

### MemRosetta (해마 + 회상 엔진)
* **역할:** 인간의 기억 방식에 가까운 원자적 사실(Atom)의 저장, 연결, 활성화, 그리고 맥락 기반 회상을 담당하는 핵심 기억 엔진.
* **특징:** 벡터 저장, Activation Score 관리, 그래프 연결성(Link) 유지, 모순 및 업데이트 논리 처리.

### Liliplanet (대뇌피질 + 감각기관 + 인터페이스)
* **역할:** 외부 데이터 수집, 인증, API 라우팅, UI 제공, 위키 생성, 에이전트 오케스트레이션.
* **특징:** 여러 디바이스(크롬, 터미널, 모바일)에서의 Capture, 통합 대시보드 및 지식 합성(Synthesis) 제공.

## 3. 6계층 구조 (The 6 Layers of the Brain)

1. **Capture Layer (수집 계층)**
   * **목표:** 무엇을 추적할지 확정하고 이벤트를 수집.
   * **초기 스코프:** Claude/Codex 세션, 브라우저 활동, 코드 커밋, 수동 메모 (지식 노동 뇌 구축).
   * **확장 스코프:** 모바일, 사진, 음성, 캘린더, 메신저 등.
2. **Artifact Layer (원본 보존 계층)**
   * **목표:** 모든 원본 데이터를 가공 없이 그대로 보존. (Raw Artifact)
   * **특징:** 세션 전문, URL 본문, PDF 텍스트 등. 추후 재처리(Reprocessing) 및 삭제/비공개 처리를 위한 기반.
3. **Memory Layer (기억 원자화 계층)**
   * **목표:** Raw Artifact에서 독립적인 의미를 갖는 '기억 원자(Memory Atom)'를 추출.
   * **특징:** 추출된 Atom은 인간의 기억 유형(Episodic, Semantic, Preference 등)으로 분류됨. (세부 사항은 `memory-types.md` 참조)
4. **Linking Layer (신경망 연결 계층)**
   * **목표:** 기억 원자들 간의 관계(Edge)를 생성하여 지식 그래프를 구축.
   * **관계 유형:** `related`, `updates`, `contradicts`, `supports`, `derived_from` 등.
5. **Recall Layer (인간형 회상 계층)**
   * **목표:** 단순 키워드/유사도 검색을 넘어, 상황과 맥락에 맞는 기억을 떠올림.
   * **특징:** 활성화 점수(Activation Score), 연상적 확장(Associative), 상태 의존적(State-dependent) 회상 지원. (세부 사항은 `recall-modes.md` 참조)
6. **Synthesis / Agent Layer (통합 및 에이전트 계층)**
   * **목표:** 파편화된 기억을 종합하여 자아 모델(Self-model)을 형성하고, 에이전트가 이를 바탕으로 자율 행동을 수행.
   * **산출물:** Working Memory, Project Wiki, Life Wiki 등.

## 4. 실행 로드맵 (Execution Roadmap)

* **Phase A. Brain Spec (현재):** 기억 모델, 타입, 관계, 회상 모드 정의 (`brain-spec.md`, `memory-types.md`, `recall-modes.md`).
* **Phase B. Local Cognitive Spike:** 실제 Claude/Codex 세션을 Ingest하여 원자화(Atom 추출), 증거(Evidence) 연결, 관계(Related) 생성이 동작하는지 로컬 검증.
* **Phase C. Sync Hub:** 로컬 SQLite는 유지하면서, Op Log 기반 동기화 서버(PostgreSQL)를 옵셔널 sync hub로 추가. 멀티디바이스 동기화. (세부 사항은 `sync-architecture.md` 참조)
* **Phase D. Human-like Recall:** 하이브리드 회상, 타임라인 회상, 연상 팽창, 프로젝트 스코프 Working Memory 구현.
* **Phase E. Self Model / Wiki:** Project/People Wiki, 의사결정 장부(Decisions Ledger), 일간/주간 자동 요약.
* **Phase F. Agentic Brain:** 기억을 바탕으로 에이전트가 선제적 제안(Proactive Suggestions) 및 작업 이어서 하기(Task Continuation) 수행.
