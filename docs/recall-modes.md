# Human-like Recall Modes

본 문서는 MemRosetta가 단순한 Vector Search(유사도 검색)를 넘어서, 인간의 뇌처럼 맥락에 맞게 기억을 떠올리는 **회상(Recall)** 시스템을 어떻게 구현할 것인지 정의합니다.

## 1. Search vs. Recall
* **Search (기존 방식):** 사용자가 명시적인 쿼리를 던지면, 텍스트 일치도나 벡터 코사인 유사도를 기준으로 결과를 반환합니다. (수동적, 정적)
* **Recall (인간형 회상):** 명시적 쿼리뿐만 아니라, 사용자의 **현재 상태(State)**, 기억의 **신선도(Recency)**, **중요도(Significance)**, 그리고 기억 간의 **연결(Association)**을 종합적으로 계산하여 가장 적절한 기억을 '의식(Working Memory)' 위로 떠오르게 합니다. (능동적, 동적)

## 2. 5대 회상 모드 (Recall Modes)

### A. Semantic Recall (의미 기반 회상)
* **개념:** 전통적인 임베딩 기반 검색.
* **작동:** 질문이나 현재 보고 있는 문서의 의미적 유사성(Vector Similarity)을 바탕으로 관련 사실(Semantic/Procedural)을 찾습니다.
* **사용처:** "이전에 썼던 인증 로직이 뭐였지?", "PostgreSQL JSONB 쿼리 작성법" 등 명확한 지식을 찾을 때.

### B. Episodic Recall (에피소드 기반 회상)
* **개념:** 시간, 장소, 도구 등 상황적 메타데이터를 축으로 기억을 재구성합니다.
* **작동:** Timeline 필터, 특정 세션 ID, 특정 프로젝트 컨텍스트를 기준으로 발생한 사건(Episodic/Decision)을 시간순/상황순으로 나열합니다.
* **사용처:** "지난주 금요일에 릴리스를 앞두고 무슨 버그를 고쳤더라?", "최근 한 달간 AI 에이전트 관련해서 고민했던 흔적들"

### C. Associative Recall (연상적 회상)
* **개념:** 하나의 기억이 트리거가 되어 거미줄처럼 연결된 다른 기억들을 연달아 떠올립니다.
* **작동:** Graph Database의 Edge(`related`, `supports`, `derived_from`)를 타고 N-hop 팽창(Expansion)을 수행합니다. 
* **사용처:** 하나의 버그 리포트(Atom)를 보았을 때, 이와 연관된 과거의 아키텍처 결정(Decision), 그리고 그 결정을 내렸을 때의 문서(Artifact)를 함께 끌어올림.

### D. State-dependent Recall (상태 의존적 회상)
* **개념:** 사용자가 현재 처한 맥락(IDE에서 열려있는 파일, 터미널 경로, 진행 중인 프로젝트)에 따라 검색 공간과 가중치를 동적으로 제한합니다.
* **작동:** Liliplanet(수집기)이 현재 맥락을 주입하면, MemRosetta는 해당 프로젝트/토픽과 강하게 바인딩된 기억들에 가중치를 부여합니다.
* **사용처:** `memrosetta` 리포지토리에서 코딩 중일 때는 시스템이 알아서 `liliplanet`과 무관한 기억을 일시적으로 배제하고 현재 컨텍스트(Working Memory)에 집중.

### E. Activation-based Recall (활성화 점수 기반 회상)
* **개념:** 모든 기억은 인간의 뇌처럼 '활성화 점수(Activation Score)'를 가집니다. 시간이 지나면 잊혀지고(Decay), 자주 꺼내볼수록 점수가 높아집니다(Reinforcement).
* **작동:** 
  * `Score = f(Recency, Frequency, Significance)`
  * 최근에 생성/조회됨(Recency) + 여러 번 참조됨(Frequency) + 감정적/구조적 중요도가 높음(Significance).
* **사용처:** 에이전트가 선제적으로 제안(Proactive Suggestion)을 할 때, 뇌에서 가장 '활성화된' 최상위 기억들을 바탕으로 사용자의 다음 행동을 예측하고 조언합니다.

## 3. 업데이트 및 모순 해결 로직 (Update & Contradiction)

인간은 과거의 잘못된 지식을 갱신합니다. MemRosetta 역시 이를 처리해야 합니다.

* **Updates (`updates` link):** 새로운 기억이 들어왔을 때, 기존 기억과 동일한 주제에 대해 더 최신의 결정을 담고 있다면 `updates` 엣지를 연결합니다. 기존 기억은 삭제되지 않지만(이력 보존), 회상 시 **패널티(Decay)**를 받아 의식 위로 떠오를 확률이 낮아집니다.
* **Contradictions (`contradicts` link):** 두 기억이 양립할 수 없을 때(예: "A 프레임워크가 좋다" vs "A 프레임워크는 쓰레기다"), 시스템은 이를 인지하고 충돌 엣지를 생성합니다. 이는 추후 Synthesis/Agent 계층에서 사용자에게 정리를 요청(Prompt)하는 트리거가 됩니다.
