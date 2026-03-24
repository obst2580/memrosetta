import { existsSync } from 'node:fs';
import { getEngine, getDefaultDbPath } from '../engine.js';
import { output, type OutputFormat } from '../output.js';

interface InitOptions {
  readonly args: readonly string[];
  readonly format: OutputFormat;
  readonly db?: string;
  readonly noEmbeddings: boolean;
}

export async function run(options: InitOptions): Promise<void> {
  const { format, db, noEmbeddings } = options;

  const dbPath = db ?? getDefaultDbPath();
  const existed = existsSync(dbPath);

  const engine = await getEngine({ db: dbPath, noEmbeddings });
  await engine.close();

  output(
    {
      path: dbPath,
      created: !existed,
      message: existed
        ? `Database already exists at ${dbPath}`
        : `Database initialized at ${dbPath}`,
    },
    format,
  );
}
