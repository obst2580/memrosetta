export type OutputFormat = 'json' | 'text';

export function output(data: unknown, format: OutputFormat): void {
  if (format === 'json') {
    process.stdout.write(JSON.stringify(data) + '\n');
  } else {
    formatText(data);
  }
}

export function outputError(message: string, format: OutputFormat): void {
  if (format === 'json') {
    process.stdout.write(JSON.stringify({ error: message }) + '\n');
  } else {
    process.stderr.write(`Error: ${message}\n`);
  }
}

interface SearchResultItem {
  readonly memory: {
    readonly content: string;
    readonly memoryType: string;
    readonly learnedAt: string;
  };
  readonly score: number;
}

interface SearchResponseLike {
  readonly results: readonly SearchResultItem[];
  readonly totalCount: number;
  readonly queryTimeMs: number;
}

interface MemoryLike {
  readonly memoryId: string;
  readonly content: string;
  readonly memoryType: string;
  readonly learnedAt: string;
  readonly namespace?: string;
  readonly keywords?: readonly string[];
}

function isSearchResponse(data: unknown): data is SearchResponseLike {
  return (
    typeof data === 'object' &&
    data !== null &&
    'results' in data &&
    'totalCount' in data &&
    'queryTimeMs' in data
  );
}

function isMemory(data: unknown): data is MemoryLike {
  return (
    typeof data === 'object' &&
    data !== null &&
    'memoryId' in data &&
    'content' in data &&
    'memoryType' in data
  );
}

function formatDate(iso: string): string {
  return iso.slice(0, 10);
}

function formatText(data: unknown): void {
  if (isSearchResponse(data)) {
    if (data.results.length === 0) {
      process.stdout.write('No results found.\n');
      return;
    }
    for (const result of data.results) {
      const score = result.score.toFixed(2);
      const date = formatDate(result.memory.learnedAt);
      const type = result.memory.memoryType;
      process.stdout.write(
        `[${score}] ${result.memory.content} (${type}, ${date})\n`,
      );
    }
    process.stdout.write(
      `\n${data.totalCount} result(s) in ${data.queryTimeMs.toFixed(1)}ms\n`,
    );
    return;
  }

  if (isMemory(data)) {
    process.stdout.write(`ID: ${data.memoryId}\n`);
    process.stdout.write(`Content: ${data.content}\n`);
    process.stdout.write(`Type: ${data.memoryType}\n`);
    process.stdout.write(`Date: ${formatDate(data.learnedAt)}\n`);
    if (data.namespace) {
      process.stdout.write(`Namespace: ${data.namespace}\n`);
    }
    if (data.keywords && data.keywords.length > 0) {
      process.stdout.write(`Keywords: ${data.keywords.join(', ')}\n`);
    }
    return;
  }

  if (typeof data === 'object' && data !== null && 'count' in data) {
    const countData = data as { count: number };
    process.stdout.write(`Count: ${countData.count}\n`);
    return;
  }

  if (typeof data === 'string') {
    process.stdout.write(data + '\n');
    return;
  }

  process.stdout.write(JSON.stringify(data, null, 2) + '\n');
}
