export type { LLMProvider, LLMProviderConfig, CompletionOptions } from './types.js';
export { OpenAIProvider } from './providers/openai-provider.js';
export { AnthropicProvider } from './providers/anthropic-provider.js';
export { MockProvider } from './providers/mock-provider.js';

// Extraction
export { FactExtractor } from './extraction/fact-extractor.js';
export type { FactExtractorOptions } from './extraction/fact-extractor.js';
export type {
  ExtractedFact,
  ExtractionResult,
  ConversationTurn,
  ExtractionContext,
} from './extraction/fact-extractor-types.js';
export {
  extractedFactSchema,
  extractionResultSchema,
} from './extraction/fact-extractor-types.js';
export {
  buildExtractionSystemPrompt,
  buildExtractionPrompt,
  PROMPT_VERSION,
} from './extraction/prompts.js';

// Cache
export { ExtractionCache } from './cache/extraction-cache.js';
