# Propositionizer-mT5-Small Fine-tuning

A6000 장비에서 Claude Code로 실행할 작업.

## 현재 상태 (v1)

HuggingFace: `liliplanet/propositionizer-mt5-small`
- 베이스: google/mt5-small (300M, Apache 2.0, 101개 언어)
- 학습: Claude Haiku distillation, ~9,700쌍
- ONNX: fp32만 (encoder 140MB + decoder 1074MB = 1.2GB)

### v1 테스트 결과 (2026-04-03)

| 언어 | 단순 문장 | 복잡 문장 | 문제 |
|------|----------|----------|------|
| 영어 | 잘 됨 | 거의 됨 (중복 1) | 양호 |
| 한국어 | 완벽 | repetition loop + 영어 hallucination | 학습 데이터 부족 |
| 일본어 | - | 영어 hallucination | 품질 부족 |
| 중국어 | - | 미테스트 | - |

### v1 문제점

1. 한국어 복잡 문장에서 repetition loop (같은 fact 무한 반복)
2. 한국어에서 3번째 fact부터 영어로 전환 (language drift)
3. "김" -> "Kim K" 토크나이저 깨짐
4. "React 대신 Vue" 같은 고유명사 포함 fact 누락
5. ONNX int8 양자화 안 됨 (1.2GB -> 목표 ~300MB)
6. generation_config에 repetition_penalty 미설정

## v2 목표

1. 한국어 복잡 문장 품질 대폭 개선 (F1 0.219 -> 0.5+)
2. int8 ONNX 양자화 (~300MB)
3. repetition_penalty=2.0 기본 설정
4. 영어 품질 유지

## v2 작업 순서

### 1. 환경 준비

```bash
# memrosetta 클론
git clone github-personal:obst2580/memrosetta.git
cd memrosetta

# Python 환경
python3 -m venv ~/propositionizer-env
source ~/propositionizer-env/bin/activate
pip install torch transformers datasets accelerate anthropic optimum onnxruntime sentencepiece protobuf
```

### 2. 한국어 학습 데이터 보강

v1 데이터: 한국어 2,860쌍 (부족)
v2 목표: 한국어 8,000쌍+ (복잡 문장 위주)

#### 데이터 소스

복잡 문장 위주로 수집:
- 뉴스 기사 (다중 사실 포함 문단)
- 회의록 스타일 텍스트
- 위키피디아 한국어 (인물, 사건 문단)
- AIHub 대화 데이터
- 복합문 (A하고 B했으며 C를 결정했다) 패턴 집중

#### Claude 프롬프트 (v2 개선)

```
You are a fact decomposition expert. Given a text passage, decompose it into
a list of atomic propositions. Rules:

1. Each proposition must be a single, self-contained fact
2. Resolve ALL pronouns (그는 -> 김 대리는, He -> John)
3. Each proposition must be understandable WITHOUT the original context
4. NOT further decomposable into smaller facts
5. MUST preserve the original language - Korean input -> Korean output
6. Include proper nouns exactly as they appear (React, Vue, TypeScript 등)
7. Every distinct piece of information must become a separate proposition
8. Do NOT merge or summarize facts

Input: "{text}"

Output as JSON array of strings. Output ONLY the JSON array.
```

핵심 개선:
- "MUST preserve the original language" 강조 (language drift 방지)
- "Include proper nouns exactly" (고유명사 누락 방지)
- "Every distinct piece" (fact 누락 방지)
- "Do NOT merge or summarize" (압축 방지)

#### 데이터 형식

```jsonl
{"input": "Title: 회의. Section: . Content: 김 대리가 시급을 5만원에서 4만5천으로 낮춰도 된다고 했고, 프로젝트 마감은 다음주 금요일이고, React 대신 Vue로 가기로 했다.", "output": "[\"김 대리가 시급을 5만원에서 4만5천으로 낮춰도 된다고 했다.\", \"프로젝트 마감은 다음주 금요일이다.\", \"React 대신 Vue로 가기로 했다.\"]"}
```

### 3. 파인튜닝 (v1 모델에서 continued training)

```python
from transformers import AutoTokenizer, AutoModelForSeq2SeqLM, Seq2SeqTrainingArguments, Seq2SeqTrainer

# v1 모델에서 이어서 학습 (처음부터 하지 않음)
model_name = "liliplanet/propositionizer-mt5-small"
tokenizer = AutoTokenizer.from_pretrained(model_name)
model = AutoModelForSeq2SeqLM.from_pretrained(model_name)

training_args = Seq2SeqTrainingArguments(
    output_dir="./results-v2",
    num_train_epochs=3,                  # v1 위에 3 에포크 추가
    per_device_train_batch_size=16,
    per_device_eval_batch_size=16,
    warmup_steps=300,
    weight_decay=0.01,
    learning_rate=5e-4,                  # v1보다 낮은 lr (catastrophic forgetting 방지)
    logging_steps=100,
    eval_strategy="steps",
    eval_steps=500,
    save_steps=500,
    save_total_limit=3,
    predict_with_generate=True,
    bf16=True,
    generation_max_length=256,
    load_best_model_at_end=True,
    metric_for_best_model="eval_loss",
)
```

핵심:
- v1 체크포인트에서 이어 학습 (continued training)
- lr을 5e-4로 낮춤 (영어 성능 유지)
- 한국어 데이터 비중 높임

### 4. generation_config 설정

```python
# 학습 후 generation_config.json 업데이트
model.generation_config.repetition_penalty = 2.0
model.generation_config.no_repeat_ngram_size = 3
model.generation_config.max_new_tokens = 256
model.generation_config.save_pretrained("./results-v2/best-checkpoint")
```

### 5. 평가

#### 테스트 케이스 (반드시 포함)

```python
test_cases = [
    # 한국어 복잡 문장 (v1 실패 케이스)
    {
        "input": "Title: 회의. Section: . Content: 김 대리가 시급을 5만원에서 4만5천으로 낮춰도 된다고 했고, 프로젝트 마감은 다음주 금요일이고, React 대신 Vue로 가기로 했다. 그는 특히 Vue의 러닝커브가 낮다는 점을 강조했다.",
        "expected_count": 4,
        "must_contain": ["시급", "금요일", "Vue", "러닝커브"],
        "must_be_korean": True,
    },
    # 한국어 단순 문장 (v1 성공 케이스, 회귀 방지)
    {
        "input": "Title: . Section: . Content: 사용자는 TypeScript를 주로 사용하고, SQLite를 메인 데이터베이스로 쓴다.",
        "expected_count": 2,
        "must_contain": ["TypeScript", "SQLite"],
        "must_be_korean": True,
    },
    # 영어 (회귀 방지)
    {
        "input": "Title: Meeting. Section: . Content: John said the hourly rate can be lowered from $50 to $45, the project deadline is next Friday, and they decided to use Vue instead of React.",
        "expected_count": 3,
        "must_contain": ["$50", "Friday", "Vue"],
        "must_be_korean": False,
    },
    # 한국어 고유명사 혼합
    {
        "input": "Title: . Section: . Content: 오늘 미팅에서 CEO가 Q2 목표를 매출 50억으로 잡았고, 마케팅팀은 SNS 예산을 30% 늘리기로 했다. CTO는 서버 마이그레이션을 4월까지 완료하겠다고 약속했다.",
        "expected_count": 3,
        "must_contain": ["50억", "30%", "4월"],
        "must_be_korean": True,
    },
]
```

#### 성공 기준

| 메트릭 | v1 | v2 목표 |
|--------|-----|---------|
| 한국어 Fuzzy F1 | 0.219 | 0.5+ |
| 영어 Fuzzy F1 | 0.518 | 0.5+ (유지) |
| 한국어 repetition 발생률 | ~50% | <5% |
| 한국어 language drift 발생률 | ~40% | <5% |

### 6. ONNX 변환 + int8 양자화

```python
from optimum.onnxruntime import ORTModelForSeq2SeqLM
from optimum.onnxruntime.configuration import AutoQuantizationConfig

# ONNX 변환
ort_model = ORTModelForSeq2SeqLM.from_pretrained(
    "./results-v2/best-checkpoint",
    export=True,
)

# int8 양자화
qconfig = AutoQuantizationConfig.avx512_vnni(is_static=False)
ort_model.quantize(save_dir="./onnx-int8", quantization_config=qconfig)

# 크기 확인
import os
total = sum(os.path.getsize(os.path.join("./onnx-int8", f))
            for f in os.listdir("./onnx-int8") if f.endswith('.onnx'))
print(f"Total ONNX size: {total / 1024 / 1024:.0f}MB")  # 목표: ~300MB
```

### 7. Transformers.js 테스트

```javascript
import { pipeline } from '@huggingface/transformers';

const gen = await pipeline('text2text-generation', './onnx-int8');

// 한국어 복잡 문장 (v1 실패 케이스)
const result = await gen(
  'Title: 회의. Section: . Content: 김 대리가 시급을 5만원에서 4만5천으로 낮춰도 된다고 했고, 프로젝트 마감은 다음주 금요일이고, React 대신 Vue로 가기로 했다.',
  { max_new_tokens: 256, repetition_penalty: 2.0 }
);
console.log(JSON.parse(result[0].generated_text));
// 기대: ["김 대리가 시급을 5만원에서 4만5천으로 낮춰도 된다고 했다", "프로젝트 마감은 다음주 금요일이다", "React 대신 Vue로 가기로 했다"]
```

### 8. HuggingFace 업로드

```bash
# safetensors + ONNX 모두 업로드
huggingface-cli upload liliplanet/propositionizer-mt5-small ./results-v2/best-checkpoint --include "*.safetensors" "*.json" "spiece.model"
huggingface-cli upload liliplanet/propositionizer-mt5-small ./onnx-int8 --path-in-repo onnx-int8
```

모델 카드 업데이트:
- v2 변경 사항
- 한국어 성능 개선 수치
- int8 ONNX 사용법 추가
- repetition_penalty=2.0 권장

### 9. MemRosetta 통합

성공하면 `packages/extractor/` 패키지 생성:

```typescript
interface FactDecomposer {
  initialize(): Promise<void>;
  decompose(text: string): Promise<readonly string[]>;
  close(): Promise<void>;
}
```

## 체크리스트

- [x] v1 모델 학습 + HuggingFace 업로드
- [x] v1 테스트 (영어 OK, 한국어 부족 확인)
- [x] packages/extractor 통합 (PR #1)
- [x] 한국어 복잡 문장 데이터 5,982쌍 생성
- [x] v2 continued training (v1 위에 3 에포크, eval_loss 2.45)
- [x] generation_config에 repetition_penalty=2.0 설정
- [x] ONNX int8 양자화 (1.2GB — 300MB 목표 미달, 모델 구조 한계)
- [x] HuggingFace v2 업로드

### v2 잔여 이슈
- 고유명사 hallucination (Vue→Unity 등) — v3에서 개선 필요
- ONNX 크기 목표(300MB) 미달
