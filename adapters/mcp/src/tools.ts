import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import type { IMemoryEngine, RelationType } from '@memrosetta/types';

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
      const memory = await engine.store({
        userId: args.userId as string,
        content: args.content as string,
        memoryType: args.memoryType as 'fact' | 'preference' | 'decision' | 'event',
        keywords: args.keywords as readonly string[] | undefined,
        namespace: args.namespace as string | undefined,
        confidence: args.confidence as number | undefined,
      });
      return {
        content: [{ type: 'text', text: JSON.stringify(memory) }],
      };
    }

    case 'memrosetta_search': {
      const response = await engine.search({
        userId: args.userId as string,
        query: args.query as string,
        limit: (args.limit as number | undefined) ?? 5,
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
      const relation = await engine.relate(
        args.srcMemoryId as string,
        args.dstMemoryId as string,
        args.relationType as RelationType,
        args.reason as string | undefined,
      );
      return {
        content: [{ type: 'text', text: JSON.stringify(relation) }],
      };
    }

    case 'memrosetta_working_memory': {
      const memories = await engine.workingMemory(
        args.userId as string,
        args.maxTokens as number | undefined,
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
      const count = await engine.count(args.userId as string);
      return {
        content: [
          {
            type: 'text',
            text: `${count} memories stored for ${args.userId as string}`,
          },
        ],
      };
    }

    case 'memrosetta_invalidate': {
      await engine.invalidate(
        args.memoryId as string,
        args.reason as string | undefined,
      );
      return {
        content: [
          {
            type: 'text',
            text: `Memory ${args.memoryId as string} invalidated.`,
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
