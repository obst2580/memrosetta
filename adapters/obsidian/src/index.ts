#!/usr/bin/env node

import { parseArgs } from 'node:util';
import { SqliteMemoryEngine } from '@memrosetta/core';
import { exportToVault, importFromVault } from './sync.js';
import { homedir } from 'node:os';

const USAGE = `Usage:
  memrosetta-obsidian export --vault <path> --user <userId> [--folder MemRosetta] [--db <path>]
  memrosetta-obsidian import --vault <path> --user <userId> [--folder MemRosetta] [--db <path>]

Options:
  --vault   Path to Obsidian vault directory (required)
  --user    User ID to sync (required)
  --folder  Folder name inside vault (default: MemRosetta)
  --db      Path to SQLite database (default: ~/.memrosetta/memories.db)
  -h, --help  Show this help message
`;

async function main(): Promise<void> {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: {
      vault: { type: 'string' },
      folder: { type: 'string', default: 'MemRosetta' },
      user: { type: 'string' },
      db: { type: 'string' },
      help: { type: 'boolean', short: 'h' },
    },
  });

  if (values.help || positionals.length === 0) {
    process.stdout.write(USAGE);
    return;
  }

  const command = positionals[0];

  if (command !== 'export' && command !== 'import') {
    process.stderr.write(`Unknown command: ${command}\n\n${USAGE}`);
    process.exit(1);
  }

  if (!values.vault) {
    process.stderr.write('Error: --vault is required\n');
    process.exit(1);
  }

  if (!values.user) {
    process.stderr.write('Error: --user is required\n');
    process.exit(1);
  }

  const dbPath =
    values.db ?? `${homedir()}/.memrosetta/memories.db`;

  const engine = new SqliteMemoryEngine({ dbPath });
  await engine.initialize();

  try {
    const options = {
      vaultPath: values.vault,
      folderName: values.folder ?? 'MemRosetta',
      userId: values.user,
    };

    if (command === 'export') {
      const result = await exportToVault(engine, options);
      process.stdout.write(
        `Export complete: ${result.exported} exported, ${result.skipped} skipped\n`,
      );
    } else {
      const result = await importFromVault(engine, options);
      process.stdout.write(
        `Import complete: ${result.imported} imported, ${result.skipped} skipped\n`,
      );
    }
  } finally {
    await engine.close();
  }
}

main().catch((err) => {
  process.stderr.write(`MemRosetta Obsidian error: ${String(err)}\n`);
  process.exit(1);
});
