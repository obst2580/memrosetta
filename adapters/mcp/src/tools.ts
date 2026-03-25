import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import type { IMemoryEngine, RelationType } from '@memrosetta/types';
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Input validation schemas
// ---------------------------------------------------------------------------

const storeSchema = z.object({
  userId: z.string().min(1).max(256),
  content: z.string().min(1).max(10_000),
  memoryType: z.enum(['fact', 'preference', 'decision', 'event']),
  keywords: z.array(z.string().max(100)).max(50).optional(),
  namespace: z.string().max(256).optional(),
  confidence: z.number().min(0).max(1).optional(),
});

const searchSchema = z.object({
  userId: z.string().min(1).max(256),
  query: z.string().min(1).max(1_000),
  limit: z.number().int().min(1).max(100).optional(),
});

const relateSchema = z.object({
  srcMemoryId: z.string().min(1).max(256),
  dstMemoryId: z.string().min(1).max(256),
  relationType: z.enum(['updates', 'extends', 'derives', 'contradicts', 'supports']),
  reason: z.string().max(2_000).optional(),
});

const workingMemorySchema = z.object({
  userId: z.string().min(1).max(256),
  maxTokens: z.number().int().min(100).max(100_000).optional(),
});

const countSchema = z.object({
  userId: z.string().min(1).max(256),
});

const invalidateSchema = z.object({
  memoryId: z.string().min(1).max(256),
  reason: z.string().max(2_000).optional(),
});

/** MCP tool response shape. */
export interface ToolResponse {
  readonly content: ReadonlyArray<{ readonly type: 'text'; readonly text: string }>;
  readonly isError?: boolean;
}

/** Single MCP tool definition. */
export interface ToolDefinition {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: {
    readonly type: 'object';
    readonly properties: Record<string, unknown>;
    readonly required: readonly string[];
  };
}

/** All MCP tool definitions exposed by the MemRosetta server. */
export const TOOL_DEFINITIONS: readonly ToolDefinition[] = [
  {
    name: 'memrosetta_store',
    description:
      'Store an atomic memory (one fact, preference, decision, or event)',
    inputSchema: {
      type: 'object',
      properties: {
        userId: { type: 'string', description: 'User identifier' },
        content: {
          type: 'string',
          description: 'The memory content (one atomic fact)',
        },
        memoryType: {
          type: 'string',
          enum: ['fact', 'preference', 'decision', 'event'],
          description: 'Type of memory',
        },
        keywords: {
          type: 'array',
          items: { type: 'string' },
          description: 'Search keywords',
        },
        namespace: {
          type: 'string',
          description: 'Optional namespace/category',
        },
        confidence: { type: 'number', description: 'Confidence 0-1' },
      },
      required: ['userId', 'content', 'memoryType'],
    },
  },
  {
    name: 'memrosetta_search',
    description: 'Search memories using hybrid search (keyword + semantic)',
    inputSchema: {
      type: 'object',
      properties: {
        userId: { type: 'string', description: 'User identifier' },
        query: { type: 'string', description: 'Search query' },
        limit: { type: 'number', description: 'Max results (default 5)' },
      },
      required: ['userId', 'query'],
    },
  },
  {
    name: 'memrosetta_relate',
    description: 'Create a relation between two memories',
    inputSchema: {
      type: 'object',
      properties: {
        srcMemoryId: { type: 'string', description: 'Source memory ID' },
        dstMemoryId: { type: 'string', description: 'Destination memory ID' },
        relationType: {
          type: 'string',
          enum: ['updates', 'extends', 'derives', 'contradicts', 'supports'],
          description: 'Relation type',
        },
        reason: {
          type: 'string',
          description: 'Optional reason for the relation',
        },
      },
      required: ['srcMemoryId', 'dstMemoryId', 'relationType'],
    },
  },
  {
    name: 'memrosetta_working_memory',
    description:
      'Get the most relevant memories for current context (working memory)',
    inputSchema: {
      type: 'object',
      properties: {
        userId: { type: 'string', description: 'User identifier' },
        maxTokens: {
          type: 'number',
          description: 'Max tokens (default 3000)',
        },
      },
      required: ['userId'],
    },
  },
  {
    name: 'memrosetta_count',
    description: 'Count stored memories for a user',
    inputSchema: {
      type: 'object',
      properties: {
        userId: { type: 'string', description: 'User identifier' },
      },
      required: ['userId'],
    },
  },
  {
    name: 'memrosetta_invalidate',
    description: 'Mark a memory as no longer valid',
    inputSchema: {
      type: 'object',
      properties: {
        memoryId: {
          type: 'string',
          description: 'Memory ID to invalidate',
        },
        reason: {
          type: 'string',
          description: 'Optional reason for invalidation',
        },
      },
      required: ['memoryId'],
    },
  },
];

/** Tool names exposed by the MCP server. */
export const TOOL_NAMES: readonly string[] = TOOL_DEFINITIONS.map((t) => t.name);

/** Register all MemRosetta tools on the given MCP server. */
export function registerTools(server: Server, engine: IMemoryEngine): void {
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [...TOOL_DEFINITIONS],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    if (!args) {
      return {
        content: [{ type: 'text' as const, text: 'Error: No arguments provided.' }],
        isError: true,
      } as { content: Array<{ type: 'text'; text: string }>; isError: boolean; [key: string]: unknown };
    }

    try {
      const result = await handleToolCall(engine, name, args);
      return result as typeof result & { [key: string]: unknown };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        content: [{ type: 'text' as const, text: `Error: ${message}` }],
        isError: true,
      } as { content: Array<{ type: 'text'; text: string }>; isError: boolean; [key: string]: unknown };
    }
  });
}

/**
 * Dispatch a tool call to the appropriate engine method.
 * Exported for direct testing without MCP server infrastructure.
 */
export async function handleToolCall(
  engine: IMemoryEngine,
  name: string,
  args: Record<string, unknown>,
): Promise<ToolResponse> {
  switch (name) {
    case 'memrosetta_store': {
      const validated = storeSchema.parse(args);
      const memory = await engine.store({
        userId: validated.userId,
        content: validated.content,
        memoryType: validated.memoryType,
        keywords: validated.keywords,
        namespace: validated.namespace,
        confidence: validated.confidence,
      });
      return {
        content: [{ type: 'text', text: JSON.stringify(memory) }],
      };
    }

    case 'memrosetta_search': {
      const validated = searchSchema.parse(args);
      const response = await engine.search({
        userId: validated.userId,
        query: validated.query,
        limit: validated.limit ?? 5,
        filters: { onlyLatest: true },
      });
      const text = response.results
        .map(
          (r) =>
            `[${r.score.toFixed(2)}] ${r.memory.content} (${r.memory.memoryType})`,
        )
        .join('\n');
      return {
        content: [{ type: 'text', text: text || 'No memories found.' }],
      };
    }

    case 'memrosetta_relate': {
      const validated = relateSchema.parse(args);
      const relation = await engine.relate(
        validated.srcMemoryId,
        validated.dstMemoryId,
        validated.relationType as RelationType,
        validated.reason,
      );
      return {
        content: [{ type: 'text', text: JSON.stringify(relation) }],
      };
    }

    case 'memrosetta_working_memory': {
      const validated = workingMemorySchema.parse(args);
      const memories = await engine.workingMemory(
        validated.userId,
        validated.maxTokens,
      );
      const text = memories
        .map(
          (m) =>
            `[${m.tier}/${m.activationScore.toFixed(2)}] ${m.content}`,
        )
        .join('\n');
      return {
        content: [{ type: 'text', text: text || 'No working memory.' }],
      };
    }

    case 'memrosetta_count': {
      const validated = countSchema.parse(args);
      const count = await engine.count(validated.userId);
      return {
        content: [
          {
            type: 'text',
            text: `${count} memories stored for ${validated.userId}`,
          },
        ],
      };
    }

    case 'memrosetta_invalidate': {
      const validated = invalidateSchema.parse(args);
      await engine.invalidate(
        validated.memoryId,
        validated.reason,
      );
      return {
        content: [
          {
            type: 'text',
            text: `Memory ${validated.memoryId} invalidated.`,
          },
        ],
      };
    }

    default:
      return {
        content: [{ type: 'text', text: `Unknown tool: ${name}` }],
        isError: true,
      };
  }
}
