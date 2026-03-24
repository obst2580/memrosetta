import type { ConversationTurn, ExtractionContext } from './fact-extractor-types.js';

export const PROMPT_VERSION = 'v1';

export function buildExtractionSystemPrompt(): string {
  return `You are a fact extraction engine. Your job is to extract independent, atomic facts from conversations.

Rules:
1. Each fact must be a single, self-contained statement that makes sense on its own.
2. Only extract facts explicitly stated or directly implied in the conversation. Do NOT hallucinate.
3. Categorize each fact:
   - "fact": Objective information (e.g., "John drives a Tesla Model 3")
   - "preference": Opinions or preferences (e.g., "John prefers electric cars")
   - "decision": Plans or decisions (e.g., "John plans to move next year")
   - "event": Time-bound actions/events (e.g., "John bought a car yesterday")
4. Set confidence:
   - 0.9-1.0: Directly stated by the speaker
   - 0.7-0.8: Strongly implied by context
   - 0.5-0.6: Weakly implied or uncertain
5. Do NOT extract the same information in different phrasings.
6. Identify the subject entity (who the fact is about).
7. Extract keywords that would help find this fact later.

Respond with JSON only: { "facts": [...] }`;
}

export function buildExtractionPrompt(
  turns: readonly ConversationTurn[],
  context: ExtractionContext,
): string {
  const parts: string[] = [];

  if (context.dateTime) {
    parts.push(`Conversation date: ${context.dateTime}`);
  }
  if (context.speakerA && context.speakerB) {
    parts.push(`Participants: ${context.speakerA}, ${context.speakerB}`);
  }
  if (context.sessionNumber != null) {
    parts.push(`Session: ${context.sessionNumber}`);
  }

  parts.push('\nConversation:');
  for (const turn of turns) {
    parts.push(`${turn.speaker}: ${turn.text}`);
  }

  parts.push('\nExtract all atomic facts from this conversation. Respond with JSON: { "facts": [...] }');

  return parts.join('\n');
}
