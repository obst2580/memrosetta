/**
 * LLM-based memory extraction for the enforce pipeline.
 *
 * Fallback order:
 *   1. ANTHROPIC_API_KEY            -> Claude Haiku 4.5
 *   2. OPENAI_API_KEY               -> GPT-4o-mini
 *   3. propositionizer ONNX model   -> @memrosetta/extractor (if available)
 *   4. nothing                      -> attempted = false
 *
 * The MemRosetta core itself never makes LLM calls. This module lives in
 * the CLI hook layer because it is invoked only by client-side hooks
 * (Claude Code Stop, Codex Stop) which already have permission to spend
 * model tokens.
 */

import type { MemoryType } from '@memrosetta/types';

const SYSTEM_PROMPT = `You extract atomic long-term memories from a single
assistant turn in a coding assistant conversation.

Return a JSON object: { "memories": [...] }. Each memory has:
  - "content": one self-contained, full-sentence fact, decision, preference,
    or event. Keep proper nouns. Resolve pronouns. Korean stays Korean,
    English stays English.
  - "memoryType": one of "decision", "fact", "preference", "event".
  - "keywords": 2-5 short keywords for search.
  - "confidence": 0.0 to 1.0.

Only emit memories the user would still care about NEXT WEEK. Ignore:
  - acknowledgements, greetings, status updates, confirmations
  - code snippets and diffs (those belong in git)
  - debugging steps and intermediate reasoning
  - questions you asked the user

If nothing is worth storing, return { "memories": [] }.`;

export interface ExtractedMemory {
  readonly content: string;
  readonly memoryType: MemoryType;
  readonly keywords?: readonly string[];
  readonly confidence?: number;
}

export interface LlmExtractor {
  readonly memories: readonly ExtractedMemory[];
  readonly source: 'anthropic' | 'openai' | 'propositionizer' | 'none';
  readonly attempted: boolean;
}

interface ExtractParams {
  readonly text: string;
  readonly userPrompt?: string;
  readonly client: string;
}

const VALID_TYPES = new Set<MemoryType>([
  'decision',
  'fact',
  'preference',
  'event',
]);

function safeParseMemories(raw: string): ExtractedMemory[] {
  // Strip optional markdown fences (```json ... ```)
  const stripped = raw.replace(/^```(?:json)?\s*|\s*```$/g, '').trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripped);
  } catch {
    return [];
  }
  if (!parsed || typeof parsed !== 'object') return [];
  const obj = parsed as { memories?: unknown };
  if (!Array.isArray(obj.memories)) return [];

  const out: ExtractedMemory[] = [];
  for (const item of obj.memories) {
    if (!item || typeof item !== 'object') continue;
    const m = item as Partial<ExtractedMemory>;
    if (typeof m.content !== 'string' || m.content.trim().length === 0) continue;
    if (!m.memoryType || !VALID_TYPES.has(m.memoryType as MemoryType)) continue;
    out.push({
      content: m.content.trim(),
      memoryType: m.memoryType as MemoryType,
      keywords:
        Array.isArray(m.keywords) && m.keywords.every((k) => typeof k === 'string')
          ? (m.keywords as string[])
          : undefined,
      confidence:
        typeof m.confidence === 'number' && m.confidence >= 0 && m.confidence <= 1
          ? m.confidence
          : undefined,
    });
  }
  return out;
}

function buildUserPrompt(params: ExtractParams): string {
  const ctx = params.userPrompt
    ? `User just asked:\n${params.userPrompt.slice(0, 800)}\n\n`
    : '';
  return `${ctx}Assistant turn (client=${params.client}):\n${params.text}`;
}

async function extractAnthropic(
  params: ExtractParams,
): Promise<ExtractedMemory[] | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1024,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: buildUserPrompt(params) }],
      }),
    });
    if (!res.ok) {
      process.stderr.write(
        `[enforce] anthropic returned ${res.status} ${res.statusText}\n`,
      );
      return null;
    }
    const body = (await res.json()) as {
      content?: Array<{ type: string; text?: string }>;
    };
    const text =
      body.content?.find((c) => c.type === 'text')?.text?.trim() ?? '';
    if (!text) return [];
    return safeParseMemories(text);
  } catch (err) {
    process.stderr.write(
      `[enforce] anthropic call failed: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    return null;
  }
}

async function extractOpenAI(
  params: ExtractParams,
): Promise<ExtractedMemory[] | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;

  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        max_tokens: 1024,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: buildUserPrompt(params) },
        ],
      }),
    });
    if (!res.ok) {
      process.stderr.write(
        `[enforce] openai returned ${res.status} ${res.statusText}\n`,
      );
      return null;
    }
    const body = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const text = body.choices?.[0]?.message?.content?.trim() ?? '';
    if (!text) return [];
    return safeParseMemories(text);
  } catch (err) {
    process.stderr.write(
      `[enforce] openai call failed: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    return null;
  }
}

async function extractPropositionizer(
  params: ExtractParams,
): Promise<ExtractedMemory[] | null> {
  // Lazy import so the propositionizer ONNX model only loads when needed.
  try {
    // @memrosetta/extractor is an optional peer; the CLI must build even
    // when it is not installed.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const importer = new Function('m', 'return import(m)') as (m: string) => Promise<any>;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mod: any = await importer('@memrosetta/extractor').catch(() => null);
    if (!mod?.PropositionizerDecomposer) return null;
    const decomposer = new mod.PropositionizerDecomposer();
    const facts: string[] = await decomposer.decompose(params.text);
    if (!Array.isArray(facts) || facts.length === 0) return [];
    return facts.map((content) => ({
      content,
      memoryType: 'fact' as MemoryType,
      confidence: 0.6,
    }));
  } catch (err) {
    process.stderr.write(
      `[enforce] propositionizer fallback failed: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    return null;
  }
}

export async function extractWithLLM(
  params: ExtractParams,
): Promise<LlmExtractor> {
  // 1. Anthropic
  const anthropic = await extractAnthropic(params);
  if (anthropic !== null) {
    return { memories: anthropic, source: 'anthropic', attempted: true };
  }

  // 2. OpenAI
  const openai = await extractOpenAI(params);
  if (openai !== null) {
    return { memories: openai, source: 'openai', attempted: true };
  }

  // 3. Local propositionizer (best-effort)
  const local = await extractPropositionizer(params);
  if (local !== null) {
    return { memories: local, source: 'propositionizer', attempted: true };
  }

  // 4. Nothing available.
  return { memories: [], source: 'none', attempted: false };
}
