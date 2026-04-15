#!/usr/bin/env node
/**
 * Codex CLI Stop hook wrapper for `memrosetta enforce`.
 *
 * Codex CLI (`~/.codex/hooks.json`) invokes Stop hooks with a JSON
 * event on stdin:
 *   {
 *     session_id, turn_id, cwd, model,
 *     hook_event_name: "Stop",
 *     stop_hook_active: boolean,
 *     transcript_path: string | null,
 *     last_assistant_message: string | null,
 *   }
 *
 * Unlike Claude Code, Codex provides `last_assistant_message` directly
 * in the event payload, so no transcript walking is needed.
 *
 * This wrapper:
 *   1. Reads the event from stdin.
 *   2. Writes a normalized JSON file for `memrosetta enforce stop`.
 *   3. Exec()s the CLI and streams its envelope back on stdout.
 *   4. When enforce returns `status == "needs-continuation"`, this
 *      wrapper emits `{ decision: "block", reason: "..." }` so Codex
 *      re-prompts the model with a continuation turn. Otherwise it
 *      emits `{}` to let the session end cleanly.
 *
 * Fails open on any error — enforcement is a best-effort safety net,
 * never a blocker for the user's session.
 */

import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

interface CodexStopEvent {
  readonly session_id?: string;
  readonly turn_id?: string;
  readonly cwd?: string;
  readonly model?: string;
  readonly hook_event_name?: string;
  readonly stop_hook_active?: boolean;
  readonly transcript_path?: string | null;
  readonly last_assistant_message?: string | null;
}

interface EnforceEnvelope {
  readonly status?: 'stored' | 'needs-continuation' | 'noop';
  readonly reason?: string;
  readonly attempt?: number;
  readonly maxAttempts?: number;
}

function readStdinSync(): string {
  try {
    return readFileSync(0, 'utf-8');
  } catch {
    return '';
  }
}

function parseEvent(raw: string): CodexStopEvent {
  if (!raw.trim()) return {};
  try {
    return JSON.parse(raw) as CodexStopEvent;
  } catch {
    return {};
  }
}

function resolveMemrosettaCli(): string {
  return process.env.MEMROSETTA_BIN ?? 'memrosetta';
}

function main(): void {
  try {
    const stdin = readStdinSync();
    const event = parseEvent(stdin);

    // Continuation guard: if Codex already re-prompted this turn because
    // of an earlier block, do not block again — otherwise a misbehaving
    // extractor could loop indefinitely. `memrosetta enforce stop` also
    // caps attempt count, but we gate here first as an extra safety
    // net on Codex's side.
    if (event.stop_hook_active) {
      process.stdout.write('{}\n');
      return;
    }

    const assistantMessage = event.last_assistant_message ?? '';
    if (!assistantMessage.trim()) {
      process.stdout.write('{}\n');
      return;
    }

    const dir = mkdtempSync(join(tmpdir(), 'mr-enforce-codex-'));
    const eventFile = join(dir, 'event.json');
    writeFileSync(
      eventFile,
      JSON.stringify({
        client: 'codex',
        turnId: event.turn_id ?? event.session_id,
        assistantMessage,
        cwd: event.cwd,
        transcriptPath: event.transcript_path ?? undefined,
        attempt: 1,
      }),
      'utf-8',
    );

    const cli = resolveMemrosettaCli();
    const res = spawnSync(
      cli,
      ['enforce', 'stop', '--client', 'codex', '--event-json', eventFile, '--format', 'json'],
      { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] },
    );

    if (res.stderr) {
      process.stderr.write(res.stderr);
    }

    let envelope: EnforceEnvelope | null = null;
    if (res.stdout) {
      try {
        envelope = JSON.parse(res.stdout) as EnforceEnvelope;
      } catch {
        envelope = null;
      }
    }

    // Map enforce envelope -> Codex hook response.
    if (envelope?.status === 'needs-continuation' && envelope.reason) {
      process.stdout.write(
        JSON.stringify({
          decision: 'block',
          reason: `MemRosetta enforce: ${envelope.reason} — please revisit the turn and call memrosetta_store for anything worth keeping.`,
        }) + '\n',
      );
      return;
    }

    // Stored / noop / unparsable: let the session end.
    process.stdout.write('{}\n');
  } catch (err) {
    process.stderr.write(
      `[memrosetta enforce codex wrapper] ${err instanceof Error ? err.message : String(err)}\n`,
    );
    process.stdout.write('{}\n');
  }
}

main();
