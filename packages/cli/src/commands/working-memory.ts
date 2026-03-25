import { getEngine } from '../engine.js';
import { output, type OutputFormat } from '../output.js';
import { optionalOption } from '../parser.js';
import { getDefaultUserId } from '../hooks/config.js';

interface WorkingMemoryOptions {
  readonly args: readonly string[];
  readonly format: OutputFormat;
  readonly db?: string;
  readonly noEmbeddings: boolean;
}

export async function run(options: WorkingMemoryOptions): Promise<void> {
  const { args, format, db, noEmbeddings } = options;

  const userId = optionalOption(args, '--user') ?? getDefaultUserId();
  const maxTokensStr = optionalOption(args, '--max-tokens');
  const maxTokens = maxTokensStr ? parseInt(maxTokensStr, 10) : undefined;

  if (maxTokens !== undefined && (isNaN(maxTokens) || maxTokens <= 0)) {
    throw new Error('--max-tokens must be a positive integer');
  }

  const engine = await getEngine({ db, noEmbeddings });
  const memories = await engine.workingMemory(userId, maxTokens);

  if (format === 'text') {
    if (memories.length === 0) {
      process.stdout.write('No working memory found.\n');
      return;
    }

    const totalTokens = memories.reduce(
      (sum, m) => sum + Math.ceil(m.content.length / 4),
      0,
    );

    for (const memory of memories) {
      const tier = memory.tier.toUpperCase();
      const score = memory.activationScore.toFixed(2);
      process.stdout.write(
        `[${tier}|${score}] ${memory.content} (${memory.memoryType})\n`,
      );
    }
    process.stdout.write(
      `\n${memories.length} memories, ~${totalTokens} tokens\n`,
    );
    return;
  }

  output({ userId, maxTokens: maxTokens ?? 3000, memories }, format);
}
