export const WELL_KNOWN_SOURCE_KINDS = [
  'claude-code',
  'codex',
  'cursor',
  'gemini',
  'windsurf',
  'cline',
  'continue',
  'claude-desktop',
  'cli',
  'mcp',
  'rest-api',
  'external',
] as const;

export type WellKnownSourceKind = (typeof WELL_KNOWN_SOURCE_KINDS)[number];
