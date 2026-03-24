import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { IMemoryEngine, Memory } from '@memrosetta/types';
import { exportToVault, importFromVault } from '../src/sync.js';

// ---------------------------------------------------------------------------
// Mock engine
// ---------------------------------------------------------------------------

function createMockMemory(overrides: Partial<Memory> = {}): Memory {
  return {
    memoryId: 'mem-test-001',
    userId: 'user-1',
    content: 'TypeScript is a typed superset of JavaScript',
    memoryType: 'fact',
    learnedAt: '2025-01-01T00:00:00.000Z',
    isLatest: true,
    tier: 'warm',
    activationScore: 0.8,
    accessCount: 2,
    confidence: 0.9,
    salience: 0.7,
    keywords: ['typescript', 'javascript'],
    ...overrides,
  };
}

function createMockEngine(memories: readonly Memory[] = []): IMemoryEngine {
  return {
    initialize: vi.fn(),
    close: vi.fn(),
    store: vi.fn().mockImplementation(async (input) =>
      createMockMemory({ content: input.content, memoryType: input.memoryType }),
    ),
    storeBatch: vi.fn().mockResolvedValue([]),
    getById: vi.fn().mockResolvedValue(null),
    search: vi.fn().mockResolvedValue({ results: [], totalCount: 0, queryTimeMs: 0 }),
    relate: vi.fn(),
    getRelations: vi.fn().mockResolvedValue([]),
    count: vi.fn().mockResolvedValue(0),
    clear: vi.fn(),
    clearNamespace: vi.fn(),
    invalidate: vi.fn(),
    workingMemory: vi.fn().mockResolvedValue(memories),
    compress: vi.fn().mockResolvedValue({ compressed: 0, removed: 0 }),
    maintain: vi.fn().mockResolvedValue({
      activationUpdated: 0, tiersUpdated: 0, compressed: 0, removed: 0,
    }),
    setTier: vi.fn(),
  };
}

// ---------------------------------------------------------------------------
// Setup & teardown
// ---------------------------------------------------------------------------

let tempDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'memrosetta-obsidian-test-'));
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// exportToVault
// ---------------------------------------------------------------------------

describe('exportToVault', () => {
  it('creates the target folder if it does not exist', async () => {
    const engine = createMockEngine([]);
    await exportToVault(engine, {
      vaultPath: tempDir,
      folderName: 'MemRosetta',
      userId: 'user-1',
    });

    const entries = readdirSync(tempDir);
    expect(entries).toContain('MemRosetta');
  });

  it('exports memories as markdown files', async () => {
    const mem1 = createMockMemory({ memoryId: 'mem-exp-001', content: 'First memory' });
    const mem2 = createMockMemory({ memoryId: 'mem-exp-002', content: 'Second memory' });
    const engine = createMockEngine([mem1, mem2]);

    const result = await exportToVault(engine, {
      vaultPath: tempDir,
      folderName: 'MemRosetta',
      userId: 'user-1',
    });

    expect(result.exported).toBe(2);
    expect(result.skipped).toBe(0);

    const folder = join(tempDir, 'MemRosetta');
    const files = readdirSync(folder);
    expect(files).toContain('mem-exp-001.md');
    expect(files).toContain('mem-exp-002.md');

    const content1 = readFileSync(join(folder, 'mem-exp-001.md'), 'utf-8');
    expect(content1).toContain('memory_id: mem-exp-001');
    expect(content1).toContain('First memory');
  });

  it('skips memories that already have files in the vault (non-destructive)', async () => {
    const folder = join(tempDir, 'MemRosetta');
    mkdirSync(folder, { recursive: true });

    // Pre-create a file for mem-exp-001
    writeFileSync(
      join(folder, 'mem-exp-001.md'),
      '---\nmemory_id: mem-exp-001\n---\n\nOld content\n',
      'utf-8',
    );

    const mem1 = createMockMemory({ memoryId: 'mem-exp-001', content: 'Updated content' });
    const mem2 = createMockMemory({ memoryId: 'mem-exp-002', content: 'New memory' });
    const engine = createMockEngine([mem1, mem2]);

    const result = await exportToVault(engine, {
      vaultPath: tempDir,
      folderName: 'MemRosetta',
      userId: 'user-1',
    });

    expect(result.exported).toBe(1);
    expect(result.skipped).toBe(1);

    // Original file should NOT be overwritten
    const oldContent = readFileSync(join(folder, 'mem-exp-001.md'), 'utf-8');
    expect(oldContent).toContain('Old content');
    expect(oldContent).not.toContain('Updated content');
  });

  it('handles empty memory list', async () => {
    const engine = createMockEngine([]);
    const result = await exportToVault(engine, {
      vaultPath: tempDir,
      folderName: 'MemRosetta',
      userId: 'user-1',
    });

    expect(result.exported).toBe(0);
    expect(result.skipped).toBe(0);
  });

  it('calls workingMemory with high token limit', async () => {
    const engine = createMockEngine([]);
    await exportToVault(engine, {
      vaultPath: tempDir,
      folderName: 'MemRosetta',
      userId: 'user-1',
    });

    expect(engine.workingMemory).toHaveBeenCalledWith('user-1', 1_000_000);
  });
});

// ---------------------------------------------------------------------------
// importFromVault
// ---------------------------------------------------------------------------

describe('importFromVault', () => {
  it('returns zeros when vault folder does not exist', async () => {
    const engine = createMockEngine();
    const result = await importFromVault(engine, {
      vaultPath: tempDir,
      folderName: 'NonExistent',
      userId: 'user-1',
    });

    expect(result.imported).toBe(0);
    expect(result.skipped).toBe(0);
  });

  it('imports markdown files with valid memory_id', async () => {
    const folder = join(tempDir, 'MemRosetta');
    mkdirSync(folder, { recursive: true });

    writeFileSync(
      join(folder, 'mem-import-001.md'),
      '---\nmemory_id: mem-import-001\ntype: fact\nkeywords: [test, import]\n---\n\nImported fact content\n',
      'utf-8',
    );

    const engine = createMockEngine();

    const result = await importFromVault(engine, {
      vaultPath: tempDir,
      folderName: 'MemRosetta',
      userId: 'user-1',
    });

    expect(result.imported).toBe(1);
    expect(result.skipped).toBe(0);
    expect(engine.store).toHaveBeenCalledWith({
      userId: 'user-1',
      content: 'Imported fact content',
      memoryType: 'fact',
      keywords: ['test', 'import'],
    });
  });

  it('skips files without memory_id (user notes)', async () => {
    const folder = join(tempDir, 'MemRosetta');
    mkdirSync(folder, { recursive: true });

    writeFileSync(
      join(folder, 'my-note.md'),
      '# My Personal Note\n\nThis is my own note, not a MemRosetta memory.\n',
      'utf-8',
    );

    const engine = createMockEngine();

    const result = await importFromVault(engine, {
      vaultPath: tempDir,
      folderName: 'MemRosetta',
      userId: 'user-1',
    });

    expect(result.imported).toBe(0);
    expect(result.skipped).toBe(1);
    expect(engine.store).not.toHaveBeenCalled();
  });

  it('skips files already in the database', async () => {
    const folder = join(tempDir, 'MemRosetta');
    mkdirSync(folder, { recursive: true });

    writeFileSync(
      join(folder, 'mem-existing.md'),
      '---\nmemory_id: mem-existing\ntype: fact\n---\n\nAlready exists\n',
      'utf-8',
    );

    const engine = createMockEngine();
    (engine.getById as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      createMockMemory({ memoryId: 'mem-existing' }),
    );

    const result = await importFromVault(engine, {
      vaultPath: tempDir,
      folderName: 'MemRosetta',
      userId: 'user-1',
    });

    expect(result.imported).toBe(0);
    expect(result.skipped).toBe(1);
    expect(engine.store).not.toHaveBeenCalled();
  });

  it('skips files with empty body', async () => {
    const folder = join(tempDir, 'MemRosetta');
    mkdirSync(folder, { recursive: true });

    writeFileSync(
      join(folder, 'empty-body.md'),
      '---\nmemory_id: mem-empty\ntype: fact\n---\n\n',
      'utf-8',
    );

    const engine = createMockEngine();

    const result = await importFromVault(engine, {
      vaultPath: tempDir,
      folderName: 'MemRosetta',
      userId: 'user-1',
    });

    expect(result.imported).toBe(0);
    expect(result.skipped).toBe(1);
  });

  it('skips non-markdown files', async () => {
    const folder = join(tempDir, 'MemRosetta');
    mkdirSync(folder, { recursive: true });

    writeFileSync(join(folder, 'data.json'), '{"key": "value"}', 'utf-8');
    writeFileSync(join(folder, 'image.png'), 'fake-image', 'utf-8');

    const engine = createMockEngine();

    const result = await importFromVault(engine, {
      vaultPath: tempDir,
      folderName: 'MemRosetta',
      userId: 'user-1',
    });

    expect(result.imported).toBe(0);
    expect(result.skipped).toBe(0);
  });

  it('imports multiple files in a single run', async () => {
    const folder = join(tempDir, 'MemRosetta');
    mkdirSync(folder, { recursive: true });

    writeFileSync(
      join(folder, 'mem-a.md'),
      '---\nmemory_id: mem-a\ntype: fact\n---\n\nFact A\n',
      'utf-8',
    );
    writeFileSync(
      join(folder, 'mem-b.md'),
      '---\nmemory_id: mem-b\ntype: preference\n---\n\nPreference B\n',
      'utf-8',
    );
    writeFileSync(
      join(folder, 'mem-c.md'),
      '---\nmemory_id: mem-c\ntype: decision\n---\n\nDecision C\n',
      'utf-8',
    );

    const engine = createMockEngine();

    const result = await importFromVault(engine, {
      vaultPath: tempDir,
      folderName: 'MemRosetta',
      userId: 'user-1',
    });

    expect(result.imported).toBe(3);
    expect(result.skipped).toBe(0);
    expect(engine.store).toHaveBeenCalledTimes(3);
  });

  it('preserves memory type from frontmatter', async () => {
    const folder = join(tempDir, 'MemRosetta');
    mkdirSync(folder, { recursive: true });

    writeFileSync(
      join(folder, 'mem-pref.md'),
      '---\nmemory_id: mem-pref\ntype: preference\n---\n\nPrefers dark mode\n',
      'utf-8',
    );

    const engine = createMockEngine();

    await importFromVault(engine, {
      vaultPath: tempDir,
      folderName: 'MemRosetta',
      userId: 'user-1',
    });

    expect(engine.store).toHaveBeenCalledWith(
      expect.objectContaining({ memoryType: 'preference' }),
    );
  });

  it('handles gracefully when store throws for one file', async () => {
    const folder = join(tempDir, 'MemRosetta');
    mkdirSync(folder, { recursive: true });

    writeFileSync(
      join(folder, 'mem-fail.md'),
      '---\nmemory_id: mem-fail\ntype: fact\n---\n\nWill fail\n',
      'utf-8',
    );
    writeFileSync(
      join(folder, 'mem-ok.md'),
      '---\nmemory_id: mem-ok\ntype: fact\n---\n\nWill succeed\n',
      'utf-8',
    );

    const engine = createMockEngine();
    let callCount = 0;
    (engine.store as ReturnType<typeof vi.fn>).mockImplementation(async (input) => {
      callCount++;
      if (callCount === 1) throw new Error('DB write failed');
      return createMockMemory({ content: input.content });
    });

    const result = await importFromVault(engine, {
      vaultPath: tempDir,
      folderName: 'MemRosetta',
      userId: 'user-1',
    });

    // One should succeed, one should be skipped due to error
    expect(result.imported + result.skipped).toBe(2);
  });
});
