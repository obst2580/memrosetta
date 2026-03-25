import { resolve } from 'node:path';
import { homedir } from 'node:os';

const CLAUDE_DIR = resolve(homedir(), '.claude');

/**
 * Validate that a transcript path points inside ~/.claude and ends with .jsonl.
 * Prevents path traversal via crafted hook input.
 */
export function isValidTranscriptPath(p: string): boolean {
  const resolved = resolve(p);
  return resolved.startsWith(CLAUDE_DIR) && resolved.endsWith('.jsonl');
}

/**
 * Strip everything except alphanumerics, hyphens, and underscores from a
 * session ID. Claude Code session IDs are UUIDs, so this is a safe filter
 * that prevents injection via session_id field.
 */
export function sanitizeSessionId(sessionId: string): string {
  return sessionId.replace(/[^a-zA-Z0-9_-]/g, '');
}
