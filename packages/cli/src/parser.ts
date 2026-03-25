export interface GlobalOptions {
  readonly db?: string;
  readonly format: 'json' | 'text';
  readonly noEmbeddings: boolean;
  readonly help: boolean;
  readonly version: boolean;
}

export interface ParsedArgs {
  readonly command: string | undefined;
  readonly global: GlobalOptions;
  readonly rest: readonly string[];
}

const COMMANDS = new Set([
  'store',
  'search',
  'ingest',
  'get',
  'count',
  'clear',
  'relate',
  'invalidate',
  'working-memory',
  'maintain',
  'compress',
  'status',
  'init',
  'reset',
]);

function findFlag(args: readonly string[], flag: string): boolean {
  return args.includes(flag);
}

function findOption(
  args: readonly string[],
  flag: string,
): string | undefined {
  const idx = args.indexOf(flag);
  if (idx === -1 || idx + 1 >= args.length) return undefined;
  return args[idx + 1];
}

export function parseGlobalArgs(args: readonly string[]): ParsedArgs {
  const command = args.find((a) => !a.startsWith('-') && COMMANDS.has(a));
  const db = findOption(args, '--db');
  const formatRaw = findOption(args, '--format');
  const format =
    formatRaw === 'text' ? 'text' : ('json' as const);
  const noEmbeddings = findFlag(args, '--no-embeddings');
  const help = findFlag(args, '--help') || findFlag(args, '-h');
  const version = findFlag(args, '--version') || findFlag(args, '-v');

  const rest = args.filter((a) => a !== command);

  return {
    command,
    global: { db, format, noEmbeddings, help, version },
    rest,
  };
}

export function requireOption(
  args: readonly string[],
  flag: string,
  name: string,
): string {
  const value = findOption(args, flag);
  if (!value) {
    throw new Error(`Missing required option: ${name} (${flag})`);
  }
  return value;
}

export function optionalOption(
  args: readonly string[],
  flag: string,
): string | undefined {
  return findOption(args, flag);
}

export function hasFlag(args: readonly string[], flag: string): boolean {
  return findFlag(args, flag);
}
