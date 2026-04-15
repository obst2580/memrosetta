#!/usr/bin/env node
/**
 * Claude Code Stop hook wrapper for `memrosetta enforce`.
 *
 * Claude Code calls Stop hooks with a JSON event on stdin. This wrapper
 * normalizes that event into the shape `memrosetta enforce stop` expects
 * (`--event-json <path>`) and then invokes the CLI.
 *
 * It is intentionally simple: read stdin, find the last assistant turn
 * in the transcript, write a normalized JSON file, exec enforce, and
 * stream the JSON envelope back to Claude Code's hook channel.
 *
 * On any error, this wrapper exits 0 to avoid breaking the user's
 * session — enforcement is a best-effort safety net, not a blocker.
 */

import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import { isValidTranscriptPath } from './path-validation.js';

interface ClaudeCodeStopEvent {
  readonly transcript_path?: string;
  readonly session_id?: string;
  readonly cwd?: string;
}

interface TranscriptTurn {
  readonly role?: 'user' | 'assistant';
  readonly type?: string;
  readonly message?: { role?: string; content?: unknown };
}

function readStdinSync(): string {
  try {
    return readFileSync(0, 'utf-8');
  } catch {
    return '';
  }
}

function parseEvent(raw: string): ClaudeCodeStopEvent {
  if (!raw.trim()) return {};
  try {
    return JSON.parse(raw) as ClaudeCodeStopEvent;
  } catch {
    return {};
  }
}

function normalizeContent(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === 'string') return part;
        if (part && typeof part === 'object' && 'text' in part && typeof (part as { text: unknown }).text === 'string') {
          return (part as { text: string }).text;
        }
        return '';
      })
      .filter((s) => s.length > 0)
      .join('\n');
  }
  return '';
}

function findLastAssistantMessage(transcriptPath: string): {
  readonly assistantMessage: string;
  readonly userPrompt?: string;
} {
  if (!isValidTranscriptPath(transcriptPath) || !existsSync(transcriptPath)) {
    return { assistantMessage: '' };
  }

  const lines = readFileSync(transcriptPath, 'utf-8')
    .split('\n')
    .filter((l) => l.trim().length > 0);

  let lastAssistant = '';
  let userPromptBeforeAssistant = '';
  let pendingUserPrompt = '';

  for (const line of lines) {
    let parsed: TranscriptTurn;
    try {
      parsed = JSON.parse(line) as TranscriptTurn;
    } catch {
      continue;
    }
    const role = parsed.role ?? parsed.message?.role;
    const content = normalizeContent(parsed.message?.content);
    if (!role || !content) continue;

    if (role === 'user') {
      pendingUserPrompt = content;
    } else if (role === 'assistant') {
      lastAssistant = content;
      userPromptBeforeAssistant = pendingUserPrompt;
    }
  }

  return {
    assistantMessage: lastAssistant,
    userPrompt: userPromptBeforeAssistant || undefined,
  };
}

function resolveMemrosettaCli(): string {
  // Prefer the published binary on PATH; this wrapper is designed to be
  // called by Claude Code where the user has installed memrosetta globally.
  return process.env.MEMROSETTA_BIN ?? 'memrosetta';
}

function main(): void {
  try {
    const stdin = readStdinSync();
    const event = parseEvent(stdin);

    if (!event.transcript_path) {
      // Nothing to enforce against.
      process.stdout.write('{}\n');
      return;
    }

    const turn = findLastAssistantMessage(event.transcript_path);
    if (!turn.assistantMessage) {
      process.stdout.write('{}\n');
      return;
    }

    // Write the normalized event to a temp file enforce can read.
    const dir = mkdtempSync(join(tmpdir(), 'mr-enforce-'));
    const eventFile = join(dir, 'event.json');
    writeFileSync(
      eventFile,
      JSON.stringify({
        client: 'claude-code',
        turnId: event.session_id,
        assistantMessage: turn.assistantMessage,
        userPrompt: turn.userPrompt,
        cwd: event.cwd,
        transcriptPath: event.transcript_path,
        attempt: 1,
      }),
      'utf-8',
    );

    const cli = resolveMemrosettaCli();
    const res = spawnSync(
      cli,
      ['enforce', 'stop', '--client', 'claude-code', '--event-json', eventFile, '--format', 'json'],
      { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] },
    );

    // Stream enforce's JSON envelope back to Claude Code so the result
    // is visible in the hook log. Non-zero exit codes are swallowed.
    if (res.stdout) {
      process.stdout.write(res.stdout);
    }
    if (res.stderr) {
      process.stderr.write(res.stderr);
    }
  } catch (err) {
    process.stderr.write(
      `[memrosetta enforce wrapper] ${err instanceof Error ? err.message : String(err)}\n`,
    );
  }
}

main();
