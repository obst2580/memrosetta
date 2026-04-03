# @memrosetta/extractor

Multilingual atomic fact decomposition for MemRosetta.

Converts unstructured text into self-contained atomic propositions using a fine-tuned mT5-small ONNX model ([liliplanet/propositionizer-mt5-small](https://huggingface.co/liliplanet/propositionizer-mt5-small)).

## Usage

```typescript
import { PropositionizerDecomposer } from '@memrosetta/extractor';

const decomposer = new PropositionizerDecomposer();

const facts = await decomposer.decomposeWithContext(
  '김 대리가 시급을 낮추고 마감은 금요일이다.',
  '회의',
);
// ["김 대리가 시급을 낮춘다.", "마감은 금요일이다."]
```

## Supported Languages

- English
- Korean
- Japanese
- Chinese

## API

### `FactDecomposer` interface

```typescript
interface FactDecomposer {
  decompose(text: string): Promise<readonly string[]>;
  decomposeWithContext(content: string, title?: string, section?: string): Promise<readonly string[]>;
}
```

### `PropositionizerDecomposer`

```typescript
new PropositionizerDecomposer(options?: {
  model?: string;     // HuggingFace model ID (default: 'liliplanet/propositionizer-mt5-small')
  maxLength?: number; // Max output tokens (default: 256)
  numBeams?: number;  // Beam search width (default: 4)
})
```
