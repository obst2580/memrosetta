import { readFileSync } from 'node:fs';

export interface ConversationTurn {
  readonly role: 'user' | 'assistant';
  readonly content: string;
}

export interface TranscriptData {
  readonly turns: readonly ConversationTurn[];
  readonly cwd: string;
  readonly sessionId: string;
}

interface TranscriptEntry {
  readonly cwd?: string;
  readonly sessionId?: string;
  readonly message?: {
    readonly role?: string;
    readonly content?: string | readonly ContentBlock[];
  };
}

interface ContentBlock {
  readonly type?: string;
  readonly text?: string;
}

function stripSystemReminders(text: string): string {
  let result = text;
  while (
    result.includes('<system-reminder>') &&
    result.includes('</system-reminder>')
  ) {
    const start = result.indexOf('<system-reminder>');
    const end =
      result.indexOf('</system-reminder>') + '</system-reminder>'.length;
    result = result.slice(0, start) + result.slice(end);
  }
  return result.trim();
}

function extractAssistantText(
  content: string | readonly ContentBlock[],
): string {
  if (typeof content === 'string') {
    return content.trim();
  }

  if (Array.isArray(content)) {
    return (content as readonly ContentBlock[])
      .filter(
        (block): block is ContentBlock & { text: string } =>
          block !== null &&
          typeof block === 'object' &&
          block.type === 'text' &&
          typeof block.text === 'string',
      )
      .map((block) => block.text)
      .join('\n')
      .trim();
  }

  return '';
}

function deduplicateTurns(
  turns: readonly ConversationTurn[],
): readonly ConversationTurn[] {
  const result: ConversationTurn[] = [];
  for (const turn of turns) {
    if (result.length === 0 || result[result.length - 1].content !== turn.content) {
      result.push(turn);
    }
  }
  return result;
}

export function parseTranscript(transcriptPath: string): TranscriptData {
  const content = readFileSync(transcriptPath, 'utf-8');
  return parseTranscriptContent(content);
}

export function parseTranscriptContent(content: string): TranscriptData {
  const lines = content.split('\n').filter((l) => l.trim());

  let cwd = '';
  let sessionId = '';
  const turns: ConversationTurn[] = [];

  for (const line of lines) {
    let entry: TranscriptEntry;
    try {
      entry = JSON.parse(line) as TranscriptEntry;
    } catch {
      continue;
    }

    if (!cwd && entry.cwd) {
      cwd = entry.cwd;
    }
    if (!sessionId && entry.sessionId) {
      sessionId = entry.sessionId;
    }

    const msg = entry.message;
    if (!msg || !msg.role) continue;

    if (msg.role === 'user' && typeof msg.content === 'string') {
      const clean = stripSystemReminders(msg.content);
      if (clean && clean.length > 5) {
        turns.push({ role: 'user', content: clean });
      }
    } else if (msg.role === 'assistant' && msg.content !== undefined) {
      const text = extractAssistantText(
        msg.content as string | readonly ContentBlock[],
      );
      if (text && text.length > 10) {
        turns.push({ role: 'assistant', content: text });
      }
    }
  }

  return {
    turns: deduplicateTurns(turns),
    cwd,
    sessionId,
  };
}
