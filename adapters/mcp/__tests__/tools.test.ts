import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { IMemoryEngine, Memory, SearchResponse, MemoryRelation } from '@memrosetta/types';
import { MemoryNotFoundError } from '@memrosetta/core';
import { TOOL_NAMES, TOOL_DEFINITIONS, handleToolCall } from '../src/tools.js';

// ---------------------------------------------------------------------------
// Mock engine factory
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
    useCount: 0,
    successCount: 0,
    keywords: ['typescript', 'javascript'],
    ...overrides,
  };
}

function createMockEngine(): IMemoryEngine {
  const mockMemory = createMockMemory();

  return {
    initialize: vi.fn(),
    close: vi.fn(),
    store: vi.fn().mockResolvedValue(mockMemory),
    storeBatch: vi.fn().mockResolvedValue([mockMemory]),
    getById: vi.fn().mockResolvedValue(mockMemory),
    search: vi.fn().mockResolvedValue({
      results: [
        { memory: mockMemory, score: 0.95, matchType: 'hybrid' as const },
      ],
      totalCount: 1,
      queryTimeMs: 5,
    } satisfies SearchResponse),
    relate: vi.fn().mockResolvedValue({
      srcMemoryId: 'mem-1',
      dstMemoryId: 'mem-2',
      relationType: 'updates',
      createdAt: '2025-01-01T00:00:00.000Z',
      reason: 'test',
    } satisfies MemoryRelation),
    getRelations: vi.fn().mockResolvedValue([]),
    count: vi.fn().mockResolvedValue(42),
    clear: vi.fn(),
    clearNamespace: vi.fn(),
    invalidate: vi.fn(),
    workingMemory: vi.fn().mockResolvedValue([mockMemory]),
    compress: vi.fn().mockResolvedValue({ compressed: 0, removed: 0 }),
    maintain: vi.fn().mockResolvedValue({
      activationUpdated: 0,
      tiersUpdated: 0,
      compressed: 0,
      removed: 0,
    }),
    setTier: vi.fn(),
    quality: vi.fn().mockResolvedValue({
      total: 0,
      fresh: 0,
      invalidated: 0,
      superseded: 0,
      withRelations: 0,
      avgActivation: 0,
    }),
    feedback: vi.fn(),
    reconstructRecall: vi.fn().mockResolvedValue({
      artifact: '- evidence text',
      artifactFormat: 'ranked_list',
      intent: 'browse' as const,
      evidence: [
        {
          memoryId: 'mem-test-001',
          episodeId: 'ep-1',
          role: 'fact',
          system: 'semantic' as const,
          confidence: 0.9,
          bindingStrength: 1.0,
          verbatimContent: 'evidence text',
          gistContent: 'evidence text',
        },
      ],
      completedFeatures: [],
      supportingEpisodes: ['ep-1'],
      confidence: 0.7,
      warnings: [],
    }),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('MCP tools', () => {
  let engine: IMemoryEngine;

  beforeEach(() => {
    engine = createMockEngine();
  });

  // -----------------------------------------------------------------------
  // TOOL_NAMES / TOOL_DEFINITIONS
  // -----------------------------------------------------------------------

  describe('TOOL_NAMES', () => {
    it('exports all expected tool names', () => {
      expect(TOOL_NAMES).toContain('memrosetta_store');
      expect(TOOL_NAMES).toContain('memrosetta_search');
      expect(TOOL_NAMES).toContain('memrosetta_relate');
      expect(TOOL_NAMES).toContain('memrosetta_working_memory');
      expect(TOOL_NAMES).toContain('memrosetta_count');
      expect(TOOL_NAMES).toContain('memrosetta_invalidate');
      expect(TOOL_NAMES).toContain('memrosetta_feedback');
      expect(TOOL_NAMES).toContain('memrosetta_reconstruct_recall');
      expect(TOOL_NAMES).toHaveLength(8);
    });
  });

  describe('TOOL_DEFINITIONS', () => {
    it('has 8 tool definitions', () => {
      expect(TOOL_DEFINITIONS).toHaveLength(8);
    });

    it('each definition has name, description, and inputSchema', () => {
      for (const tool of TOOL_DEFINITIONS) {
        expect(tool.name).toBeTruthy();
        expect(tool.description).toBeTruthy();
        expect(tool.inputSchema).toBeDefined();
        expect(tool.inputSchema.type).toBe('object');
        expect(tool.inputSchema.required).toBeDefined();
      }
    });

    it('store tool requires content and memoryType (userId optional)', () => {
      const storeTool = TOOL_DEFINITIONS.find((t) => t.name === 'memrosetta_store');
      expect(storeTool).toBeDefined();
      expect(storeTool!.inputSchema.required).toEqual([
        'content',
        'memoryType',
      ]);
    });

    it('search tool requires query (userId optional)', () => {
      const searchTool = TOOL_DEFINITIONS.find(
        (t) => t.name === 'memrosetta_search',
      );
      expect(searchTool!.inputSchema.required).toEqual(['query']);
    });

    it('relate tool requires srcMemoryId, dstMemoryId, relationType', () => {
      const relateTool = TOOL_DEFINITIONS.find(
        (t) => t.name === 'memrosetta_relate',
      );
      expect(relateTool!.inputSchema.required).toEqual([
        'srcMemoryId',
        'dstMemoryId',
        'relationType',
      ]);
    });

    it('working_memory tool has no required fields (userId optional)', () => {
      const wmTool = TOOL_DEFINITIONS.find(
        (t) => t.name === 'memrosetta_working_memory',
      );
      expect(wmTool!.inputSchema.required).toEqual([]);
    });

    it('count tool has no required fields (userId optional)', () => {
      const countTool = TOOL_DEFINITIONS.find(
        (t) => t.name === 'memrosetta_count',
      );
      expect(countTool!.inputSchema.required).toEqual([]);
    });

    it('invalidate tool requires memoryId', () => {
      const invalidTool = TOOL_DEFINITIONS.find(
        (t) => t.name === 'memrosetta_invalidate',
      );
      expect(invalidTool!.inputSchema.required).toEqual(['memoryId']);
    });

    it('feedback tool requires memoryId and helpful', () => {
      const feedbackTool = TOOL_DEFINITIONS.find(
        (t) => t.name === 'memrosetta_feedback',
      );
      expect(feedbackTool).toBeDefined();
      expect(feedbackTool!.inputSchema.required).toEqual(['memoryId', 'helpful']);
    });
  });

  // -----------------------------------------------------------------------
  // handleToolCall
  // -----------------------------------------------------------------------

  describe('handleToolCall', () => {
    describe('memrosetta_store', () => {
      it('calls engine.store with correct parameters', async () => {
        const result = await handleToolCall(engine, 'memrosetta_store', {
          userId: 'user-1',
          content: 'Test memory',
          memoryType: 'fact',
          keywords: ['test'],
          namespace: 'testing',
          confidence: 0.9,
        });

        expect(engine.store).toHaveBeenCalledWith({
          userId: 'user-1',
          content: 'Test memory',
          memoryType: 'fact',
          keywords: ['test'],
          namespace: 'testing',
          confidence: 0.9,
          sources: [{ sourceKind: 'mcp', sourceRef: 'memrosetta_store' }],
        });
        expect(result.isError).toBeUndefined();
        expect(result.content[0].type).toBe('text');

        const parsed = JSON.parse(result.content[0].text);
        expect(parsed.memoryId).toBe('mem-test-001');
      });

      it('handles optional parameters as undefined', async () => {
        await handleToolCall(engine, 'memrosetta_store', {
          userId: 'user-1',
          content: 'Minimal memory',
          memoryType: 'decision',
        });

        expect(engine.store).toHaveBeenCalledWith({
          userId: 'user-1',
          content: 'Minimal memory',
          memoryType: 'decision',
          keywords: undefined,
          namespace: undefined,
          confidence: undefined,
          sources: [{ sourceKind: 'mcp', sourceRef: 'memrosetta_store' }],
        });
      });

      it('preserves explicit source_kind over MCP default', async () => {
        await handleToolCall(engine, 'memrosetta_store', {
          userId: 'user-1',
          content: 'Codex memory',
          memoryType: 'fact',
          source_kind: 'codex',
          source_ref: 'turn-1',
        });

        expect(engine.store).toHaveBeenCalledWith(
          expect.objectContaining({
            sources: [{ sourceKind: 'codex', sourceRef: 'turn-1' }],
          }),
        );
      });
    });

    describe('memrosetta_search', () => {
      it('calls engine.search with correct parameters', async () => {
        const result = await handleToolCall(engine, 'memrosetta_search', {
          userId: 'user-1',
          query: 'typescript',
          limit: 10,
        });

        expect(engine.search).toHaveBeenCalledWith({
          userId: 'user-1',
          query: 'typescript',
          limit: 10,
          filters: { onlyLatest: true },
        });
        expect(result.content[0].text).toContain('0.95');
        expect(result.content[0].text).toContain('TypeScript');
      });

      it('returns JSON with sources when includeSource is true', async () => {
        (engine.search as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
          results: [
            {
              memory: createMockMemory(),
              score: 0.95,
              matchType: 'hybrid' as const,
              sources: [{ sourceKind: 'mcp', sourceRef: 'memrosetta_store' }],
            },
          ],
          totalCount: 1,
          queryTimeMs: 5,
        });

        const result = await handleToolCall(engine, 'memrosetta_search', {
          userId: 'user-1',
          query: 'typescript',
          includeSource: true,
        });

        expect(engine.search).toHaveBeenCalledWith(
          expect.objectContaining({ includeSource: true }),
        );
        const parsed = JSON.parse(result.content[0].text);
        expect(parsed.results[0].sources).toEqual([
          { sourceKind: 'mcp', sourceRef: 'memrosetta_store' },
        ]);
      });

      it('defaults limit to 5', async () => {
        await handleToolCall(engine, 'memrosetta_search', {
          userId: 'user-1',
          query: 'test',
        });

        expect(engine.search).toHaveBeenCalledWith(
          expect.objectContaining({ limit: 5 }),
        );
      });

      it('returns "No memories found." when results are empty', async () => {
        (engine.search as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
          results: [],
          totalCount: 0,
          queryTimeMs: 1,
        });

        const result = await handleToolCall(engine, 'memrosetta_search', {
          userId: 'user-1',
          query: 'nonexistent',
        });

        expect(result.content[0].text).toBe('No memories found.');
      });
    });

    describe('memrosetta_relate', () => {
      it('calls engine.relate with correct parameters', async () => {
        const result = await handleToolCall(engine, 'memrosetta_relate', {
          srcMemoryId: 'mem-1',
          dstMemoryId: 'mem-2',
          relationType: 'updates',
          reason: 'corrected information',
        });

        expect(engine.relate).toHaveBeenCalledWith(
          'mem-1',
          'mem-2',
          'updates',
          'corrected information',
        );
        expect(result.isError).toBeUndefined();

        const parsed = JSON.parse(result.content[0].text);
        expect(parsed.relationType).toBe('updates');
      });

      it('handles optional reason', async () => {
        await handleToolCall(engine, 'memrosetta_relate', {
          srcMemoryId: 'mem-1',
          dstMemoryId: 'mem-2',
          relationType: 'extends',
        });

        expect(engine.relate).toHaveBeenCalledWith(
          'mem-1',
          'mem-2',
          'extends',
          undefined,
        );
      });
    });

    describe('memrosetta_working_memory', () => {
      it('calls engine.workingMemory and formats output', async () => {
        const result = await handleToolCall(
          engine,
          'memrosetta_working_memory',
          {
            userId: 'user-1',
            maxTokens: 2000,
          },
        );

        expect(engine.workingMemory).toHaveBeenCalledWith('user-1', 2000);
        expect(result.content[0].text).toContain('warm/0.80');
        expect(result.content[0].text).toContain('TypeScript');
      });

      it('returns "No working memory." when empty', async () => {
        (engine.workingMemory as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
          [],
        );

        const result = await handleToolCall(
          engine,
          'memrosetta_working_memory',
          {
            userId: 'user-1',
          },
        );

        expect(result.content[0].text).toBe('No working memory.');
      });
    });

    describe('memrosetta_count', () => {
      it('returns formatted count string', async () => {
        const result = await handleToolCall(engine, 'memrosetta_count', {
          userId: 'user-1',
        });

        expect(engine.count).toHaveBeenCalledWith('user-1');
        expect(result.content[0].text).toBe('42 memories stored for user-1');
      });
    });

    describe('memrosetta_invalidate', () => {
      it('calls engine.invalidate and returns confirmation', async () => {
        const result = await handleToolCall(engine, 'memrosetta_invalidate', {
          memoryId: 'mem-test-001',
          reason: 'outdated',
        });

        expect(engine.invalidate).toHaveBeenCalledWith(
          'mem-test-001',
          'outdated',
        );
        expect(result.content[0].text).toBe(
          'Memory mem-test-001 invalidated.',
        );
      });

      it('handles optional reason', async () => {
        await handleToolCall(engine, 'memrosetta_invalidate', {
          memoryId: 'mem-test-001',
        });

        expect(engine.invalidate).toHaveBeenCalledWith(
          'mem-test-001',
          undefined,
        );
      });
    });

    describe('memrosetta_feedback', () => {
      it('calls engine.feedback with helpful=true', async () => {
        const result = await handleToolCall(engine, 'memrosetta_feedback', {
          memoryId: 'mem-test-001',
          helpful: true,
        });

        expect(engine.feedback).toHaveBeenCalledWith('mem-test-001', true);
        expect(result.content[0].text).toBe(
          'Feedback recorded for mem-test-001: helpful',
        );
      });

      it('calls engine.feedback with helpful=false', async () => {
        const result = await handleToolCall(engine, 'memrosetta_feedback', {
          memoryId: 'mem-test-001',
          helpful: false,
        });

        expect(engine.feedback).toHaveBeenCalledWith('mem-test-001', false);
        expect(result.content[0].text).toBe(
          'Feedback recorded for mem-test-001: not helpful',
        );
      });
    });

    describe('memrosetta_reconstruct_recall', () => {
      it('appears in TOOL_DEFINITIONS with required query', () => {
        const def = TOOL_DEFINITIONS.find(
          (t) => t.name === 'memrosetta_reconstruct_recall',
        );
        expect(def).toBeDefined();
        expect(def!.inputSchema.required).toContain('query');
      });

      it('calls engine.reconstructRecall with parsed input', async () => {
        const result = await handleToolCall(
          engine,
          'memrosetta_reconstruct_recall',
          {
            query: 'typescript review prompt',
            intent: 'reuse',
            context: {
              project: 'memrosetta',
              language: 'typescript',
              taskMode: 'review',
            },
            cues: [
              { featureType: 'topic', featureValue: 'review' },
            ],
            maxEvidence: 3,
          },
        );

        expect(engine.reconstructRecall).toHaveBeenCalledTimes(1);
        const call = (engine.reconstructRecall as ReturnType<typeof vi.fn>).mock
          .calls[0][0];
        expect(call.query).toBe('typescript review prompt');
        expect(call.intent).toBe('reuse');
        expect(call.context.project).toBe('memrosetta');
        expect(call.context.taskMode).toBe('review');
        expect(call.cues).toHaveLength(1);
        expect(call.maxEvidence).toBe(3);

        const payload = JSON.parse(result.content[0].text) as {
          artifact: string;
        };
        expect(payload.artifact).toContain('evidence text');
      });

      it('defaults intent to browse when omitted', async () => {
        await handleToolCall(engine, 'memrosetta_reconstruct_recall', {
          query: 'anything',
        });
        const call = (engine.reconstructRecall as ReturnType<typeof vi.fn>).mock
          .calls[0][0];
        expect(call.intent).toBe('browse');
      });

      it('rejects invalid intent via zod', async () => {
        await expect(
          handleToolCall(engine, 'memrosetta_reconstruct_recall', {
            query: 'x',
            intent: 'nonsense',
          }),
        ).rejects.toThrow();
      });

      it('rejects unknown featureType in cues', async () => {
        await expect(
          handleToolCall(engine, 'memrosetta_reconstruct_recall', {
            query: 'x',
            cues: [{ featureType: 'bogus', featureValue: 'v' }],
          }),
        ).rejects.toThrow();
      });
    });

    describe('error handling', () => {
      it('returns isError=true for unknown tool', async () => {
        const result = await handleToolCall(engine, 'nonexistent_tool', {});

        expect(result.isError).toBe(true);
        expect(result.content[0].text).toContain('Unknown tool');
      });

      it('propagates engine errors', async () => {
        (engine.store as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
          new Error('DB connection lost'),
        );

        await expect(
          handleToolCall(engine, 'memrosetta_store', {
            userId: 'user-1',
            content: 'test',
            memoryType: 'fact',
          }),
        ).rejects.toThrow('DB connection lost');
      });

      it('propagates MemoryNotFoundError from engine.relate', async () => {
        (engine.relate as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
          new MemoryNotFoundError('mem-nonexistent'),
        );

        await expect(
          handleToolCall(engine, 'memrosetta_relate', {
            srcMemoryId: 'mem-nonexistent',
            dstMemoryId: 'mem-2',
            relationType: 'updates',
          }),
        ).rejects.toThrow('Memory not found: mem-nonexistent');
      });

      it('propagates non-Error thrown values', async () => {
        (engine.count as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
          'string error',
        );

        await expect(
          handleToolCall(engine, 'memrosetta_count', {
            userId: 'user-1',
          }),
        ).rejects.toBe('string error');
      });
    });
  });
});
