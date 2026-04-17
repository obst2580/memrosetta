import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { rmSync } from 'node:fs';

// Integration-style test: wire up a real SqliteMemoryEngine against a
// temp file, seed a multi-user partial-state scenario that mirrors
// Codex's Windows observation (one user fully bound, another user
// partially bound), then drive `status` from the CLI and assert that
// scope handling produces the right readiness for each scope.

const { dbPath } = vi.hoisted(() => {
  // Node imports happen before hoisted blocks run, so we re-require
  // fs/os/path inline here instead of relying on top-level imports.
  const fs = require('node:fs') as typeof import('node:fs');
  const os = require('node:os') as typeof import('node:os');
  const path = require('node:path') as typeof import('node:path');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mro-status-scope-'));
  return { dbPath: path.join(dir, 'memories.db') };
});

vi.mock('../../src/integrations/index.js', () => ({
  isClaudeCodeConfigured: vi.fn().mockReturnValue(false),
  isCursorConfigured: vi.fn().mockReturnValue(false),
  isCodexConfigured: vi.fn().mockReturnValue(false),
  isGeminiConfigured: vi.fn().mockReturnValue(false),
  isGenericMCPConfigured: vi.fn().mockReturnValue(false),
}));

vi.mock('../../src/engine.js', () => ({
  getDefaultDbPath: vi.fn().mockReturnValue(dbPath),
}));

vi.mock('../../src/hooks/config.js', () => ({
  getConfig: vi.fn().mockReturnValue({ dbPath }),
  getDefaultUserId: vi.fn().mockReturnValue('obst'),
}));

import { SqliteMemoryEngine } from '@memrosetta/core';
import { run } from '../../src/commands/status.js';

describe('status scope (v0.12.2)', () => {
  let engine: SqliteMemoryEngine;
  let stdoutSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    engine = new SqliteMemoryEngine({ dbPath });
    await engine.initialize();

    // Scenario: Codex's real DB shape at reduced scale.
    //  - user `obst`: 10 memories, all will be backfilled → 100% coverage
    //  - user `other`: 10 memories, NONE backfilled → 0% coverage
    // Global coverage would be 10/20 = 50% → `degraded` globally,
    // but obst-scoped coverage is 100% → `ready`.
    for (let i = 0; i < 10; i++) {
      await engine.store({
        userId: 'obst',
        memoryType: 'fact',
        content: `obst fact ${i}`,
        project: 'p',
        documentDate: '2026-04-17T09:00:00Z',
        autoBindEpisode: false,
      });
    }
    for (let i = 0; i < 10; i++) {
      await engine.store({
        userId: 'other',
        memoryType: 'fact',
        content: `other fact ${i}`,
        project: 'p',
        documentDate: '2026-04-17T09:00:00Z',
        autoBindEpisode: false,
      });
    }
    // Backfill ONLY for obst. `other` stays orphan.
    await engine.buildEpisodes('obst');
    await engine.close();

    stdoutSpy = vi
      .spyOn(process.stdout, 'write')
      .mockImplementation(() => true);
  });

  afterEach(() => {
    stdoutSpy.mockRestore();
    try {
      rmSync(dbPath, { force: true });
    } catch {
      /* best-effort */
    }
  });

  async function runAndParse(args: string[]): Promise<{
    readonly memories: number;
    readonly scope: { kind: string; userId: string | null };
    readonly recall: {
      episodes: number;
      episodicBindings: number;
      readiness: string;
    };
  }> {
    await run({ args, format: 'json', noEmbeddings: true });
    const written = stdoutSpy.mock.calls[0]?.[0] as string;
    return JSON.parse(written);
  }

  it('defaults to current user and reports ready when that user is fully bound', async () => {
    const parsed = await runAndParse([]);
    expect(parsed.scope.kind).toBe('user');
    expect(parsed.scope.userId).toBe('obst');
    expect(parsed.memories).toBe(10); // obst only
    expect(parsed.recall.episodicBindings).toBe(10);
    expect(parsed.recall.readiness).toBe('ready');
  });

  it('--all-users reports the global degraded state', async () => {
    const parsed = await runAndParse(['--all-users']);
    expect(parsed.scope.kind).toBe('global');
    expect(parsed.scope.userId).toBeNull();
    expect(parsed.memories).toBe(20); // obst + other
    expect(parsed.recall.episodicBindings).toBe(10); // only obst bound
    // 10/20 = 50% → well below 95% → degraded (not ready)
    expect(parsed.recall.readiness).toBe('degraded');
  });

  it('--user other reports the unbound user as empty', async () => {
    const parsed = await runAndParse(['--user', 'other']);
    expect(parsed.scope.userId).toBe('other');
    expect(parsed.memories).toBe(10);
    expect(parsed.recall.episodes).toBe(0);
    expect(parsed.recall.episodicBindings).toBe(0);
    expect(parsed.recall.readiness).toBe('empty');
  });

  it('--user obst explicitly matches the default-user result', async () => {
    const parsed = await runAndParse(['--user', 'obst']);
    expect(parsed.scope.userId).toBe('obst');
    expect(parsed.memories).toBe(10);
    expect(parsed.recall.readiness).toBe('ready');
  });
});
