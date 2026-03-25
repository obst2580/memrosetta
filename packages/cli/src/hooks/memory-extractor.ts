import type { MemoryInput, MemoryType } from '@memrosetta/types';
import type { ConversationTurn, TranscriptData } from './transcript-parser.js';

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

export function resolveUserId(cwd: string): string {
  const parts = cwd.split('/');
  const dirname = parts[parts.length - 1] || 'unknown';

  if (cwd.includes('com_project') || cwd.includes('work')) {
    return `work/${dirname}`;
  }
  if (cwd.includes('personal_project') || cwd.includes('personal')) {
    return `personal/${dirname}`;
  }

  return dirname;
}

/**
 * Extract the first meaningful sentence or line from text.
 * Skips code blocks, markdown headers, and formatting.
 */
function extractFirstSentence(text: string, maxLen: number = 200): string {
  const lines = text.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith('```')) continue;
    if (trimmed.startsWith('|')) continue;
    if (trimmed.startsWith('#')) {
      const headerText = trimmed.replace(/^#+\s*/, '');
      if (headerText.length > 10) {
        return headerText.length > maxLen
          ? headerText.slice(0, maxLen - 3) + '...'
          : headerText;
      }
      continue;
    }
    if (trimmed.startsWith('- [') || trimmed.startsWith('> ')) continue;
    if (trimmed.length < 10) continue;

    return trimmed.length > maxLen
      ? trimmed.slice(0, maxLen - 3) + '...'
      : trimmed;
  }
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean.length > maxLen ? clean.slice(0, maxLen - 3) + '...' : clean;
}

/**
 * Determine if a turn contains meaningful content worth storing.
 */
function isWorthStoring(turn: ConversationTurn): boolean {
  const content = turn.content;

  if (content.length < 30) return false;

  if (turn.role === 'user') {
    const lower = content.toLowerCase().trim();
    if (lower.length < 15) return false;
    if (lower.startsWith('/')) return false;
    if (/^(y|n|yes|no|ok)$/i.test(lower)) return false;
    return true;
  }

  const codeBlockCount = (content.match(/```/g) || []).length / 2;
  const textLines = content.split('\n').filter((l) => {
    const t = l.trim();
    return (
      t && !t.startsWith('```') && !t.startsWith('|') && !t.startsWith('- [')
    );
  });

  if (codeBlockCount > 3 && textLines.length < 5) return false;

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
