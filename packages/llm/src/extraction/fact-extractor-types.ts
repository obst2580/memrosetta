import { z } from 'zod';

export const extractedFactSchema = z.object({
  content: z.string().min(1),
  memoryType: z.enum(['fact', 'preference', 'decision', 'event']),
  confidence: z.number().min(0).max(1),
  keywords: z.array(z.string()).optional(),
  subjectEntity: z.string().optional(),
});

export type ExtractedFact = z.infer<typeof extractedFactSchema>;

export const extractionResultSchema = z.object({
  facts: z.array(extractedFactSchema),
});

export type ExtractionResult = z.infer<typeof extractionResultSchema>;

export interface ConversationTurn {
  readonly speaker: string;
  readonly text: string;
  readonly turnId?: string;
}

export interface ExtractionContext {
  readonly dateTime?: string;
  readonly sessionNumber?: number;
  readonly speakerA?: string;
  readonly speakerB?: string;
}
