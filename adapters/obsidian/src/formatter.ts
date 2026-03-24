import type { Memory } from '@memrosetta/types';

/**
 * Convert a Memory to Obsidian-compatible Markdown with YAML frontmatter.
 * Includes all metadata fields in the frontmatter and the memory content as body.
 */
export function memoryToMarkdown(memory: Memory): string {
  const lines: readonly string[] = [
    '---',
    `memory_id: ${memory.memoryId}`,
    `type: ${memory.memoryType}`,
    `confidence: ${memory.confidence ?? 0.5}`,
    `learned_at: ${memory.learnedAt}`,
    ...(memory.documentDate ? [`document_date: ${memory.documentDate}`] : []),
    ...(memory.eventDateStart
      ? [`event_date_start: ${memory.eventDateStart}`]
      : []),
    ...(memory.eventDateEnd ? [`event_date_end: ${memory.eventDateEnd}`] : []),
    ...(memory.namespace ? [`namespace: ${memory.namespace}`] : []),
    ...(memory.keywords && memory.keywords.length > 0
      ? [`keywords: [${memory.keywords.join(', ')}]`]
      : []),
    `tier: ${memory.tier}`,
    `activation: ${memory.activationScore.toFixed(3)}`,
    ...(memory.invalidatedAt
      ? [`invalidated_at: ${memory.invalidatedAt}`]
      : []),
    '---',
    '',
    memory.content,
    '',
  ];

  return lines.join('\n');
}

/**
 * Extract the memory_id from a Markdown file's YAML frontmatter.
 * Returns null if not found.
 */
export function markdownToMemoryId(content: string): string | null {
  const match = content.match(/^memory_id:\s*(.+)$/m);
  return match ? match[1].trim() : null;
}

/**
 * Extract the body content (after frontmatter) from a Markdown string.
 * Returns empty string if no body is found.
 */
export function extractBody(content: string): string {
  const bodyMatch = content.match(/^---\n[\s\S]*?\n---\n\n?([\s\S]*)/);
  return bodyMatch ? bodyMatch[1].trim() : '';
}

/**
 * Extract the memory type from YAML frontmatter.
 * Defaults to 'fact' if not found or invalid.
 */
export function extractMemoryType(
  content: string,
): 'fact' | 'preference' | 'decision' | 'event' {
  const match = content.match(/^type:\s*(.+)$/m);
  if (!match) return 'fact';

  const value = match[1].trim();
  const valid = ['fact', 'preference', 'decision', 'event'] as const;
  return valid.includes(value as typeof valid[number])
    ? (value as typeof valid[number])
    : 'fact';
}

/**
 * Extract keywords from YAML frontmatter.
 * Returns empty array if not found.
 */
export function extractKeywords(content: string): readonly string[] {
  const match = content.match(/^keywords:\s*\[([^\]]*)\]$/m);
  if (!match) return [];
  return match[1]
    .split(',')
    .map((k) => k.trim())
    .filter((k) => k.length > 0);
}
