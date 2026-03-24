import { z } from 'zod';

// ---------------------------------------------------------------------------
// QA category taxonomy (from LoCoMo paper, ACL 2024)
// ---------------------------------------------------------------------------

export const LoCoMoCategory = {
  SingleHop: 1,
  MultiHop: 2,
  Temporal: 3,
  OpenDomain: 4,
  Adversarial: 5,
} as const;

export type LoCoMoCategoryValue =
  (typeof LoCoMoCategory)[keyof typeof LoCoMoCategory];

export const LOCOMO_CATEGORY_LABELS: Readonly<
  Record<LoCoMoCategoryValue, string>
> = {
  [LoCoMoCategory.SingleHop]: 'single-hop',
  [LoCoMoCategory.MultiHop]: 'multi-hop',
  [LoCoMoCategory.Temporal]: 'temporal',
  [LoCoMoCategory.OpenDomain]: 'open-domain',
  [LoCoMoCategory.Adversarial]: 'adversarial',
};

// ---------------------------------------------------------------------------
// Zod schemas -- runtime validation for raw LoCoMo JSON
// ---------------------------------------------------------------------------

export const locomoDialogueTurnSchema = z.object({
  speaker: z.string(),
  dia_id: z.string(),
  text: z.string(),
  img_url: z.array(z.string()).optional(),
  blip_caption: z.string().optional(),
  query: z.string().optional(),
});

export const locomoQAItemSchema = z.object({
  question: z.string(),
  answer: z.union([z.string(), z.number()]).optional(),
  evidence: z.array(z.string()),
  category: z.number().int().min(1).max(5),
  adversarial_answer: z.union([z.string(), z.number()]).optional(),
});

/**
 * The conversation object uses dynamic keys: session_1, session_1_date_time,
 * session_2, session_2_date_time, etc. We validate the known fixed fields and
 * allow arbitrary additional session keys via passthrough.
 */
export const locomoConversationSchema = z
  .object({
    speaker_a: z.string(),
    speaker_b: z.string(),
  })
  .passthrough();

export const locomoSampleSchema = z.object({
  qa: z.array(locomoQAItemSchema),
  conversation: locomoConversationSchema,
});

export const locomoDatasetSchema = z.array(locomoSampleSchema);

// ---------------------------------------------------------------------------
// Inferred TypeScript types from zod schemas
// ---------------------------------------------------------------------------

export type LoCoMoDialogueTurn = z.infer<typeof locomoDialogueTurnSchema>;
export type LoCoMoQAItem = z.infer<typeof locomoQAItemSchema>;
export type LoCoMoConversation = z.infer<typeof locomoConversationSchema>;
export type LoCoMoSample = z.infer<typeof locomoSampleSchema>;

// ---------------------------------------------------------------------------
// Refined readonly types for internal use after validation
// ---------------------------------------------------------------------------

export interface LoCoMoParsedDialogueTurn {
  readonly speaker: string;
  readonly diaId: string;
  readonly text: string;
  readonly imgUrl?: readonly string[];
  readonly blipCaption?: string;
  readonly query?: string;
}

export interface LoCoMoParsedQAItem {
  readonly question: string;
  readonly answer: string;
  readonly evidence: readonly string[];
  readonly category: LoCoMoCategoryValue;
  readonly categoryLabel: string;
  readonly adversarialAnswer?: string;
}

export interface LoCoMoParsedSession {
  readonly sessionNumber: number;
  readonly dateTime: string;
  readonly turns: readonly LoCoMoParsedDialogueTurn[];
}

export interface LoCoMoParsedSample {
  readonly sampleIndex: number;
  readonly speakerA: string;
  readonly speakerB: string;
  readonly sessions: readonly LoCoMoParsedSession[];
  readonly qaItems: readonly LoCoMoParsedQAItem[];
}
