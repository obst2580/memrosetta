import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { writeFileSync, unlinkSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const { mockStoreBatch } = vi.hoisted(() => {
  const mockStoreBatch = vi.fn().mockResolvedValue([
    {
      memoryId: 'mem-1',
      userId: 'obst',
      content: 'This is a user message with enough content to be stored',
      memoryType: 'event',
      learnedAt: '2026-03-24T00:00:00.000Z',
      isLatest: true,
    },
    {
      memoryId: 'mem-2',
      userId: 'obst',
      content:
        'This is an assistant response with enough content to be stored as well',
      memoryType: 'fact',
      learnedAt: '2026-03-24T00:00:00.000Z',
      isLatest: true,
    },
  ]);
  return { mockStoreBatch };
});

vi.mock('../../src/engine.js', () => ({
  getEngine: vi.fn().mockImplementation(async () => ({
    storeBatch: mockStoreBatch,
    close: vi.fn(),
  })),
  closeEngine: vi.fn(),
  getDefaultDbPath: vi.fn().mockReturnValue('/tmp/test.db'),
}));

import { run } from '../../src/commands/ingest.js';

describe('ingest command', () => {
  let stdoutSpy: ReturnType<typeof vi.spyOn>;
  let stderrSpy: ReturnType<typeof vi.spyOn>;
  let tmpFile: string;

  beforeEach(() => {
    stdoutSpy = vi
      .spyOn(process.stdout, 'write')
      .mockImplementation(() => true);
    stderrSpy = vi
      .spyOn(process.stderr, 'write')
      .mockImplementation(() => true);
    process.exitCode = undefined;
    mockStoreBatch.mockClear();

    const tmpDir = join(tmpdir(), 'memrosetta-test');
    mkdirSync(tmpDir, { recursive: true });
    tmpFile = join(tmpDir, `ingest-test-${Date.now()}.jsonl`);
  });

  afterEach(() => {
    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
    try {
      unlinkSync(tmpFile);
    } catch {
      // ignore
    }
  });

  it('should ingest JSONL from file', async () => {
    const jsonl = [
      JSON.stringify({ sessionId: 'abc12345-6789' }),
      JSON.stringify({
        message: {
          role: 'user',
          content:
            'This is a user message with enough content to be stored',
        },
      }),
      JSON.stringify({
        message: {
          role: 'assistant',
          content: [
            {
              type: 'text',
              text: 'This is an assistant response with enough content to be stored as well',
            },
          ],
        },
      }),
    ].join('\n');

    writeFileSync(tmpFile, jsonl);

    await run({
      args: ['--user', 'obst', '--file', tmpFile],
      format: 'json',
      noEmbeddings: true,
    });

    expect(process.exitCode).toBeUndefined();
    const written = stdoutSpy.mock.calls[0]?.[0] as string;
    const parsed = JSON.parse(written);
    expect(parsed.stored).toBe(2);
    expect(parsed.sessionId).toBe('abc12345-6789');
  });

  it('should use custom namespace', async () => {
    const jsonl = [
      JSON.stringify({ sessionId: 'abc12345-6789' }),
      JSON.stringify({
        message: {
          role: 'user',
          content:
            'This is a long enough user message to be ingested properly',
        },
      }),
    ].join('\n');

    writeFileSync(tmpFile, jsonl);

    await run({
      args: [
        '--user',
        'obst',
        '--file',
        tmpFile,
        '--namespace',
        'my-session',
      ],
      format: 'json',
      noEmbeddings: true,
    });

    const written = stdoutSpy.mock.calls[0]?.[0] as string;
    const parsed = JSON.parse(written);
    expect(parsed.namespace).toBe('my-session');
  });

  it('should report zero stored when transcript has no valid turns', async () => {
    const jsonl = [
      JSON.stringify({ sessionId: 'abc12345' }),
      JSON.stringify({ message: { role: 'user', content: 'hi' } }),
    ].join('\n');

    writeFileSync(tmpFile, jsonl);

    await run({
      args: ['--user', 'obst', '--file', tmpFile],
      format: 'json',
      noEmbeddings: true,
    });

    const written = stdoutSpy.mock.calls[0]?.[0] as string;
    const parsed = JSON.parse(written);
    expect(parsed.stored).toBe(0);
  });

  it('should error when file does not exist', async () => {
    await run({
      args: ['--user', 'obst', '--file', '/nonexistent/file.jsonl'],
      format: 'json',
      noEmbeddings: true,
    });

    expect(process.exitCode).toBe(1);
    const written = stdoutSpy.mock.calls[0]?.[0] as string;
    const parsed = JSON.parse(written);
    expect(parsed.error).toContain('Failed to read file');
  });

  it('should strip system-reminder tags from user messages', async () => {
    const jsonl = [
      JSON.stringify({ sessionId: 'test1234' }),
      JSON.stringify({
        message: {
          role: 'user',
          content:
            '<system-reminder>hidden content</system-reminder>This is the actual user message with enough content',
        },
      }),
    ].join('\n');

    writeFileSync(tmpFile, jsonl);

    await run({
      args: ['--user', 'obst', '--file', tmpFile],
      format: 'json',
      noEmbeddings: true,
    });

    expect(mockStoreBatch).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          content:
            'This is the actual user message with enough content',
        }),
      ]),
    );
  });
});
