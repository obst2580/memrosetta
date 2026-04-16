import type { MemoryInput, MemoryType } from '@memrosetta/types';
import type { ConversationTurn, TranscriptData } from './transcript-parser.js';
import { resolveCanonicalUserId } from './config.js';

const KEYWORD_PATTERNS: Record<string, string> = {
  typescript: 'TypeScript',
  sqlite: 'SQLite',
  api: 'API',
  benchmark: 'benchmark',
  docker: 'Docker',
  git: 'Git',
  react: 'React',
  hono: 'Hono',
  test: 'test',
  deploy: 'deploy',
  refactor: 'refactor',
  bug: 'bug',
  memrosetta: 'MemRosetta',
  vector: 'vector',
  embedding: 'embedding',
  fts5: 'FTS5',
  search: 'search',
  memory: 'memory',
  database: 'database',
  postgresql: 'PostgreSQL',
  nextjs: 'Next.js',
  'next.js': 'Next.js',
  node: 'Node.js',
  python: 'Python',
  rust: 'Rust',
  kubernetes: 'Kubernetes',
  ci: 'CI/CD',
  security: 'security',
  auth: 'authentication',
  cache: 'cache',
  performance: 'performance',
};

export function classifyTurn(turn: ConversationTurn): MemoryType {
  const lower = turn.content.toLowerCase();

  if (turn.role === 'user') {
    if (
      lower.includes('decide') ||
      lower.includes('go with') ||
      lower.includes("let's do") ||
      lower.includes('proceed') ||
      lower.includes('approved')
    ) {
      return 'decision';
    }
    if (
      lower.includes('prefer') ||
      lower.includes('i like') ||
      lower.includes('i want') ||
      lower.includes('i need')
    ) {
      return 'preference';
    }
    return 'event';
  }

  return 'fact';
}

export function extractKeywords(text: string): readonly string[] {
  const keywords = new Set<string>();
  const lower = text.toLowerCase();

  for (const [pattern, keyword] of Object.entries(KEYWORD_PATTERNS)) {
    if (lower.includes(pattern)) {
      keywords.add(keyword);
    }
  }

  return [...keywords];
}

/**
 * Legacy alias retained for backwards compatibility with hook callers
 * that still pass `cwd`. Routes through `resolveCanonicalUserId()` so
 * the OS username never wins over a user-pinned `config.syncUserId`,
 * preventing fresh fragmentation on multi-device installs.
 */
export function resolveUserId(_cwd: string): string {
  return resolveCanonicalUserId();
}

/**
 * Extract the first meaningful sentence or line from text.
 * Skips code blocks, markdown headers, formatting, file paths, and commands.
 */
function extractFirstSentence(text: string, maxLen: number = 200): string {
  const lines = text.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();

    // Skip empty, code, tables, lists, markdown formatting
    if (!trimmed) continue;
    if (trimmed.startsWith('```')) continue;
    if (trimmed.startsWith('|')) continue;
    if (trimmed.startsWith('- [')) continue;
    if (trimmed.startsWith('> ')) continue;
    if (trimmed.startsWith('import ') || trimmed.startsWith('export ') || trimmed.startsWith('const ') || trimmed.startsWith('function ')) continue;
    if (trimmed.startsWith('{') || trimmed.startsWith('}')) continue;
    if (/^[\s\-=*#]+$/.test(trimmed)) continue;

    // Headers are good summaries
    if (trimmed.startsWith('#')) {
      const headerText = trimmed.replace(/^#+\s*/, '');
      if (headerText.length > 10) {
        return headerText.length > maxLen
          ? headerText.slice(0, maxLen - 3) + '...'
          : headerText;
      }
      continue;
    }

    // Skip lines that look like file paths or commands
    if (trimmed.startsWith('/') || trimmed.startsWith('./') || trimmed.startsWith('$')) continue;

    // Must have actual words (not just symbols/numbers)
    if (trimmed.length < 15) continue;
    if (!/[a-zA-Z\uAC00-\uD7AF]{3,}/.test(trimmed)) continue;

    return trimmed.length > maxLen
      ? trimmed.slice(0, maxLen - 3) + '...'
      : trimmed;
  }

  // Fallback: first 200 chars
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean.length > maxLen ? clean.slice(0, maxLen - 3) + '...' : clean;
}

/**
 * Determine if a turn contains meaningful content worth storing.
 * Aggressively filters out code, tool-use messages, and noise.
 */
function isWorthStoring(turn: ConversationTurn): boolean {
  const content = turn.content;

  // Too short
  if (content.length < 30) return false;

  // User: skip confirmations, commands, short questions
  if (turn.role === 'user') {
    const lower = content.toLowerCase().trim();
    if (lower.length < 20) return false;
    if (lower.startsWith('/')) return false;
    if (/^(y|n|yes|no|ok|ㅇㅇ|ㅋㅋ|ㄱㄱ|네|아니|진행|계속|좋아|해봐)$/i.test(lower)) return false;
    return true;
  }

  // Assistant: AGGRESSIVE filtering
  // Skip tool-use heavy responses (they're about HOW, not WHAT was decided)
  const codeBlockCount = (content.match(/```/g) || []).length / 2;
  if (codeBlockCount >= 2) return false;

  // Skip file operations and tool results
  const toolPatterns = [
    /^(reading|writing|creating|editing|deleting|running|checking|searching|looking)/i,
    /^(file|directory|folder) (created|modified|deleted|found)/i,
    /^(let me|i'll|i will) (read|check|look|search|find|create|write|edit)/i,
    /^(here('s| is| are) (the|a|an))/i,
    /^\d+ (files?|tests?|errors?|warnings?) (found|passed|failed|created)/i,
    /^(done|completed|finished|success|failed|error)/i,
    /^(installing|building|compiling|running tests)/i,
  ];

  for (const pattern of toolPatterns) {
    if (pattern.test(content.trim())) return false;
  }

  // Skip very long messages (likely code dumps or detailed outputs)
  if (content.length > 2000) return false;

  // Skip messages that are mostly code (more backticks than words)
  const wordCount = content.split(/\s+/).length;
  const codeChars = (content.match(/[{}();=<>]/g) || []).length;
  if (codeChars > wordCount * 0.3) return false;

  return true;
}

export function extractMemories(
  data: TranscriptData,
  userId: string,
): readonly MemoryInput[] {
  const memories: MemoryInput[] = [];
  const sessionShort = data.sessionId
    ? data.sessionId.slice(0, 8)
    : 'unknown';
  const now = new Date().toISOString();
  const seen = new Set<string>();

  for (let i = 0; i < data.turns.length; i++) {
    const turn = data.turns[i];

    if (!isWorthStoring(turn)) continue;

    const content = extractFirstSentence(turn.content);

    if (seen.has(content)) continue;
    seen.add(content);

    memories.push({
      userId,
      namespace: `session-${sessionShort}`,
      memoryType: classifyTurn(turn),
      content,
      documentDate: now,
      sourceId: `cc-${sessionShort}-${i}`,
      confidence: turn.role === 'user' ? 0.9 : 0.8,
      keywords: extractKeywords(content),
    });
  }

  return memories;
}
