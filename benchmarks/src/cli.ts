import { parseArgs } from 'node:util';
import { join } from 'node:path';
import { MockEngine } from './adapters/mock-engine.js';
import { runBenchmarks } from './runner/benchmark-runner.js';
import { printReport } from './report/terminal-reporter.js';
import {
  saveReport,
  findLatestReport,
  loadReport,
} from './report/json-reporter.js';
import type { LoCoMoConverterStrategy } from './datasets/locomo/converter-types.js';
import type { LoCoMoLoaderOptions } from './datasets/locomo/locomo-loader.js';

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

const { values } = parseArgs({
  options: {
    phase: { type: 'string', default: '1' },
    engine: { type: 'string', default: 'mock' },
    verbose: { type: 'boolean', default: false },
    output: { type: 'string', default: './results' },
    converter: { type: 'string', default: 'turn' },
    'llm-provider': { type: 'string' },
    'llm-model': { type: 'string' },
    'llm-base-url': { type: 'string' },
    help: { type: 'boolean', default: false },
  },
  allowPositionals: true,
});

if (values.help) {
  process.stdout.write(`
Usage: memrosetta-bench [options]

Options:
  --phase <n>            Phase to run (default: 1)
  --engine <type>        Engine to use: mock, sqlite, hybrid (default: mock)
  --verbose              Show detailed progress
  --output <dir>         Results output directory (default: ./results)
  --converter <type>     Conversion strategy: turn (default), fact
  --llm-provider <type>  LLM provider for fact extraction: openai, anthropic
  --llm-model <model>    Override LLM model
  --llm-base-url <url>   Custom API base URL
  --help                 Show this help
`);
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Converter factory
// ---------------------------------------------------------------------------

async function buildConverter(
  converterType: string,
  llmProvider?: string,
  llmModel?: string,
  llmBaseUrl?: string,
): Promise<LoCoMoConverterStrategy | undefined> {
  if (converterType === 'turn') {
    return undefined; // Use default
  }

  if (converterType === 'fact') {
    if (!llmProvider) {
      throw new Error(
        '--llm-provider is required when using --converter fact. Available: openai, anthropic',
      );
    }

    const { FactExtractor, ExtractionCache, PROMPT_VERSION } = await import('@memrosetta/llm');
    const { FactExtractionConverter } = await import(
      './datasets/locomo/fact-extraction-converter.js'
    );

    let provider;
    switch (llmProvider) {
      case 'openai': {
        const { OpenAIProvider } = await import('@memrosetta/llm');
        provider = new OpenAIProvider({
          model: llmModel ?? 'gpt-4o-mini',
          ...(llmBaseUrl ? { baseURL: llmBaseUrl } : {}),
        });
        break;
      }
      case 'anthropic': {
        const { AnthropicProvider } = await import('@memrosetta/llm');
        provider = new AnthropicProvider({
          model: llmModel ?? 'claude-sonnet-4-20250514',
        });
        break;
      }
      default:
        throw new Error(
          `Unknown LLM provider: ${llmProvider}. Available: openai, anthropic`,
        );
    }

    const extractor = new FactExtractor(provider, {
      model: llmModel,
    });

    const cacheDir = join(process.cwd(), 'data', 'extraction-cache');
    const cache = new ExtractionCache(cacheDir, PROMPT_VERSION);
    await cache.load();

    return new FactExtractionConverter({
      extractor,
      cache,
      model: llmModel ?? `${llmProvider}-default`,
      verbose: values.verbose ?? false,
    });
  }

  throw new Error(
    `Unknown converter type: ${converterType}. Available: turn, fact`,
  );
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const engineType = values.engine ?? 'mock';
  const outputDir = values.output ?? './results';
  const verbose = values.verbose ?? false;
  const phases = (values.phase ?? '1').split(',');
  const converterType = values.converter ?? 'turn';

  const converter = await buildConverter(
    converterType,
    values['llm-provider'],
    values['llm-model'],
    values['llm-base-url'],
  );

  const loaderOptions: LoCoMoLoaderOptions | undefined = converter
    ? { converter }
    : undefined;

  const engineFactory = async () => {
    switch (engineType) {
      case 'mock':
        return new MockEngine();
      case 'sqlite': {
        const { SqliteMemoryEngine } = await import('@memrosetta/core');
        const os = await import('node:os');
        const path = await import('node:path');
        const fs = await import('node:fs/promises');
        const tmpDir = path.join(os.tmpdir(), 'memrosetta-bench');
        await fs.mkdir(tmpDir, { recursive: true });
        const dbPath = path.join(tmpDir, `bench-${Date.now()}.db`);
        return new SqliteMemoryEngine({ dbPath });
      }
      case 'hybrid': {
        const { SqliteMemoryEngine } = await import('@memrosetta/core');
        const { HuggingFaceEmbedder } = await import('@memrosetta/embeddings');
        const embedder = new HuggingFaceEmbedder();
        await embedder.initialize();
        const os = await import('node:os');
        const path = await import('node:path');
        const fs = await import('node:fs/promises');
        const tmpDir = path.join(os.tmpdir(), 'memrosetta-bench');
        await fs.mkdir(tmpDir, { recursive: true });
        const dbPath = path.join(tmpDir, `bench-hybrid-${Date.now()}.db`);
        return new SqliteMemoryEngine({ dbPath, embedder });
      }
      default:
        throw new Error(
          `Unknown engine: ${engineType}. Available: mock, sqlite, hybrid`,
        );
    }
  };

  const results = await runBenchmarks({
    phases,
    engineFactory,
    outputDir,
    verbose,
    loaderOptions,
  });

  for (const result of results) {
    // Try to load previous result for comparison
    const previousPath = await findLatestReport(outputDir, result.phase);
    const previous = previousPath
      ? await loadReport(previousPath)
      : undefined;

    // Print to terminal
    printReport(result, previous);

    // Save JSON report
    const savedPath = await saveReport(result, outputDir);
    process.stdout.write(`\nReport saved: ${savedPath}\n`);
  }
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(`Benchmark failed: ${message}\n`);
  process.exit(1);
});
