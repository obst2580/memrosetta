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
      lower.includes('let\'s do') ||
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

export function extractMemories(
  data: TranscriptData,
  userId: string,
): readonly MemoryInput[] {
  const memories: MemoryInput[] = [];
  const sessionShort = data.sessionId
    ? data.sessionId.slice(0, 8)
    : 'unknown';
  const now = new Date().toISOString();

  for (let i = 0; i < data.turns.length; i++) {
    const turn = data.turns[i];

    // Skip very short turns
    if (turn.content.length < 20) continue;

    // Truncate to reasonable size for atomic memories
    const content =
      turn.content.length > 500
        ? turn.content.slice(0, 497) + '...'
        : turn.content;

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
