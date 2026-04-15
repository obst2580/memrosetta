import { randomUUID } from 'node:crypto';
import { userInfo } from 'node:os';
import { output, outputError, type OutputFormat } from '../output.js';
import { requireOption, optionalOption, hasFlag } from '../parser.js';
import { getConfig, writeConfig, getDefaultDbPath, type MemRosettaConfig } from '../hooks/config.js';

interface SyncOptions {
  readonly args: readonly string[];
  readonly format: OutputFormat;
  readonly db?: string;
  readonly noEmbeddings: boolean;
}

type Subcommand = 'enable' | 'disable' | 'status' | 'now' | 'device-id';

function parseSubcommand(args: readonly string[]): Subcommand | null {
  const first = args[0];
  if (!first || first.startsWith('--')) return null;
  if (
    first === 'enable' ||
    first === 'disable' ||
    first === 'status' ||
    first === 'now' ||
    first === 'device-id'
  ) {
    return first;
  }
  return null;
}

async function readHiddenInput(prompt: string): Promise<string> {
  const stdin = process.stdin;
  const stdout = process.stdout;

  if (!stdin.isTTY) {
    throw new Error('Interactive input requires a TTY. Use --key-stdin to pipe the key instead.');
  }

  stdout.write(prompt);

  const wasRaw = stdin.isRaw;
  stdin.setRawMode(true);
  stdin.resume();
  stdin.setEncoding('utf-8');

  return new Promise((resolve, reject) => {
    let buffer = '';
    const onData = (chunk: string): void => {
      for (const ch of chunk) {
        const code = ch.charCodeAt(0);
        if (code === 0x0d || code === 0x0a) {
          stdin.removeListener('data', onData);
          stdin.setRawMode(wasRaw);
          stdin.pause();
          stdout.write('\n');
          resolve(buffer);
          return;
        }
        if (code === 0x03) {
          stdin.removeListener('data', onData);
          stdin.setRawMode(wasRaw);
          stdin.pause();
          stdout.write('\n');
          reject(new Error('Aborted'));
          return;
        }
        if (code === 0x7f || code === 0x08) {
          buffer = buffer.slice(0, -1);
          continue;
        }
        buffer += ch;
      }
    };
    stdin.on('data', onData);
  });
}

async function readStdinKey(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString('utf-8').trim();
}

async function testConnection(serverUrl: string, apiKey: string): Promise<void> {
  const url = `${serverUrl.replace(/\/$/, '')}/sync/health`;
  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} ${res.statusText}`);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Sync server health check failed: ${msg}`);
  }
}

async function withSyncClient<T>(
  dbPath: string,
  config: MemRosettaConfig,
  fn: (client: import('@memrosetta/sync-client').SyncClient, db: import('better-sqlite3').Database) => Promise<T>,
): Promise<T> {
  const Database = (await import('better-sqlite3')).default;
  const { SyncClient, ensureSyncSchema } = await import('@memrosetta/sync-client');

  if (!config.syncServerUrl || !config.syncApiKey || !config.syncDeviceId) {
    throw new Error('Sync is not configured. Run: memrosetta sync enable --server <url>');
  }

  const db = new Database(dbPath);
  try {
    ensureSyncSchema(db);
    const client = new SyncClient(db, {
      serverUrl: config.syncServerUrl,
      apiKey: config.syncApiKey,
      deviceId: config.syncDeviceId,
      userId: userInfo().username,
    });
    return await fn(client, db);
  } finally {
    db.close();
  }
}

async function runEnable(options: SyncOptions): Promise<void> {
  const { args, format } = options;

  let serverUrl: string;
  try {
    serverUrl = requireOption(args, '--server', 'server URL');
  } catch (err) {
    outputError(err instanceof Error ? err.message : String(err), format);
    process.exitCode = 1;
    return;
  }

  let apiKey = optionalOption(args, '--key');
  if (hasFlag(args, '--key-stdin')) {
    apiKey = await readStdinKey();
  }
  if (!apiKey) {
    try {
      apiKey = await readHiddenInput('API key: ');
    } catch (err) {
      outputError(err instanceof Error ? err.message : String(err), format);
      process.exitCode = 1;
      return;
    }
  }

  if (!apiKey) {
    outputError('API key is required', format);
    process.exitCode = 1;
    return;
  }

  const skipTest = hasFlag(args, '--no-test');
  if (!skipTest) {
    try {
      await testConnection(serverUrl, apiKey);
    } catch (err) {
      outputError(
        `${err instanceof Error ? err.message : String(err)}\nUse --no-test to skip the health check.`,
        format,
      );
      process.exitCode = 1;
      return;
    }
  }

  const existing = getConfig();
  const deviceId = existing.syncDeviceId ?? `device-${randomUUID().slice(0, 8)}`;

  writeConfig({
    ...existing,
    syncEnabled: true,
    syncServerUrl: serverUrl,
    syncApiKey: apiKey,
    syncDeviceId: deviceId,
  });

  if (format === 'text') {
    process.stdout.write('Sync enabled.\n');
    process.stdout.write(`  Server:   ${serverUrl}\n`);
    process.stdout.write(`  DeviceId: ${deviceId}\n`);
    if (skipTest) {
      process.stdout.write('  (health check skipped)\n');
    }
    return;
  }

  output({ enabled: true, serverUrl, deviceId, healthCheckSkipped: skipTest }, format);
}

function runDisable(options: SyncOptions): void {
  const { format } = options;
  const existing = getConfig();

  writeConfig({
    ...existing,
    syncEnabled: false,
  });

  if (format === 'text') {
    process.stdout.write('Sync disabled. (server URL and API key preserved for re-enable)\n');
    return;
  }

  output({ enabled: false }, format);
}

async function runStatus(options: SyncOptions): Promise<void> {
  const { format, db } = options;
  const config = getConfig();
  const dbPath = db ?? config.dbPath ?? getDefaultDbPath();

  if (!config.syncEnabled) {
    if (format === 'text') {
      process.stdout.write('Sync: disabled\n');
      if (config.syncServerUrl) {
        process.stdout.write(`  Server:   ${config.syncServerUrl}\n`);
      }
      if (config.syncDeviceId) {
        process.stdout.write(`  DeviceId: ${config.syncDeviceId}\n`);
      }
      return;
    }
    output(
      {
        enabled: false,
        serverUrl: config.syncServerUrl ?? null,
        deviceId: config.syncDeviceId ?? null,
      },
      format,
    );
    return;
  }

  try {
    const status = await withSyncClient(dbPath, config, async (client) => client.getStatus());

    if (format === 'text') {
      process.stdout.write('Sync: enabled\n');
      process.stdout.write(`  Server:          ${status.serverUrl}\n`);
      process.stdout.write(`  DeviceId:        ${status.deviceId}\n`);
      process.stdout.write(`  Pending ops:     ${status.pendingOps}\n`);
      process.stdout.write(`  Current cursor:  ${status.cursor}\n`);
      process.stdout.write(
        `  Last push:       ${status.lastPush.successAt ?? 'never'}` +
          (status.lastPush.attemptAt && status.lastPush.attemptAt !== status.lastPush.successAt
            ? ` (last attempt: ${status.lastPush.attemptAt})`
            : '') +
          '\n',
      );
      process.stdout.write(
        `  Last pull:       ${status.lastPull.successAt ?? 'never'}` +
          (status.lastPull.attemptAt && status.lastPull.attemptAt !== status.lastPull.successAt
            ? ` (last attempt: ${status.lastPull.attemptAt})`
            : '') +
          '\n',
      );
      return;
    }

    output(status, format);
  } catch (err) {
    outputError(err instanceof Error ? err.message : String(err), format);
    process.exitCode = 1;
  }
}

async function runNow(options: SyncOptions): Promise<void> {
  const { args, format, db } = options;
  const config = getConfig();
  const dbPath = db ?? config.dbPath ?? getDefaultDbPath();

  if (!config.syncEnabled) {
    outputError('Sync is disabled. Run: memrosetta sync enable --server <url>', format);
    process.exitCode = 1;
    return;
  }

  const pushOnly = hasFlag(args, '--push-only');
  const pullOnly = hasFlag(args, '--pull-only');

  try {
    const result = await withSyncClient(dbPath, config, async (client) => {
      let pushed = 0;
      let pulled = 0;

      if (!pullOnly) {
        const pushResult = await client.push();
        pushed = pushResult.pushed;
      }
      if (!pushOnly) {
        pulled = await client.pull();
      }
      return { pushed, pulled };
    });

    if (format === 'text') {
      process.stdout.write(`Sync complete. pushed=${result.pushed} pulled=${result.pulled}\n`);
      return;
    }
    output(result, format);
  } catch (err) {
    outputError(err instanceof Error ? err.message : String(err), format);
    process.exitCode = 1;
  }
}

function runDeviceId(options: SyncOptions): void {
  const { format } = options;
  const config = getConfig();

  if (!config.syncDeviceId) {
    outputError('No deviceId set. Run: memrosetta sync enable --server <url>', format);
    process.exitCode = 1;
    return;
  }

  if (format === 'text') {
    process.stdout.write(`${config.syncDeviceId}\n`);
    return;
  }

  output({ deviceId: config.syncDeviceId }, format);
}

export async function run(options: SyncOptions): Promise<void> {
  const sub = parseSubcommand(options.args);

  if (!sub) {
    outputError(
      'Usage: memrosetta sync <enable|disable|status|now|device-id>\n' +
        '\n' +
        '  enable    --server <url> [--key <key> | --key-stdin] [--no-test]\n' +
        '  disable\n' +
        '  status\n' +
        '  now       [--push-only | --pull-only]\n' +
        '  device-id\n',
      options.format,
    );
    process.exitCode = 1;
    return;
  }

  // Strip subcommand from args so flag parsing still works
  const rest: SyncOptions = { ...options, args: options.args.slice(1) };

  switch (sub) {
    case 'enable':
      await runEnable(rest);
      return;
    case 'disable':
      runDisable(rest);
      return;
    case 'status':
      await runStatus(rest);
      return;
    case 'now':
      await runNow(rest);
      return;
    case 'device-id':
      runDeviceId(rest);
      return;
  }
}
