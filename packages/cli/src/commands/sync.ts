import { randomUUID } from 'node:crypto';
import { userInfo, platform } from 'node:os';
import { createInterface, type Interface as ReadlineInterface } from 'node:readline';
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

// Characters that should never appear in a valid API key. We reject any
// control character (0x00-0x1F + 0x7F) except the separators we trim below.
const CONTROL_CHAR_REGEX = /[\x00-\x1F\x7F]/;

function validateApiKey(key: string): string {
  const trimmed = key.trim();
  if (trimmed.length === 0) {
    throw new Error('API key is empty.');
  }
  if (CONTROL_CHAR_REGEX.test(trimmed)) {
    throw new Error(
      'API key contains control characters. Your terminal likely does not ' +
        'support hidden input (e.g. Windows PowerShell). Pipe the key instead:\n' +
        '  echo <api-key> | memrosetta sync enable --server <url> --key-stdin',
    );
  }
  return trimmed;
}

/**
 * Read a line from the terminal without echoing the typed characters.
 *
 * Uses readline with a muted output stream so it works consistently across
 * POSIX terminals and Windows ConPTY (PowerShell/cmd). The previous raw-mode
 * implementation mis-handled Windows input and let control characters leak
 * into the captured value (observed as U+0016 / SYN).
 */
async function readHiddenInput(prompt: string): Promise<string> {
  const stdin = process.stdin;
  const stdout = process.stdout;

  if (!stdin.isTTY) {
    throw new Error('Interactive input requires a TTY. Use --key-stdin to pipe the key instead.');
  }

  stdout.write(prompt);

  // Mute stdout while the user is typing. Let only the final newline through.
  const originalWrite = stdout.write.bind(stdout);
  let muted = true;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (stdout as any).write = (chunk: any, ...rest: any[]): boolean => {
    if (!muted) {
      return originalWrite(chunk, ...rest);
    }
    const str = typeof chunk === 'string' ? chunk : chunk?.toString?.('utf-8') ?? '';
    if (str === '\n' || str === '\r\n' || str === '\r') {
      return originalWrite(chunk, ...rest);
    }
    return true;
  };

  const rl: ReadlineInterface = createInterface({
    input: stdin,
    output: stdout,
    terminal: true,
  });

  try {
    const answer: string = await new Promise((resolve, reject) => {
      rl.once('close', () => {
        // If the user hits Ctrl+C or the stream closes without input
        reject(new Error('Aborted'));
      });
      rl.question('', (value) => {
        resolve(value);
      });
    });
    return answer;
  } finally {
    muted = false;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (stdout as any).write = originalWrite;
    rl.close();
  }
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

  // Reject stored API keys that contain control characters. This is a
  // recovery path for users whose 0.4.1 `sync enable` captured garbage from
  // a Windows terminal.
  if (CONTROL_CHAR_REGEX.test(config.syncApiKey)) {
    throw new Error(
      'Stored API key is invalid (contains control characters from a previous ' +
        'terminal input). Re-run with --key-stdin to fix it:\n' +
        '  echo <api-key> | memrosetta sync enable --server ' + config.syncServerUrl + ' --key-stdin',
    );
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

  let rawApiKey = optionalOption(args, '--key');
  if (hasFlag(args, '--key-stdin')) {
    rawApiKey = await readStdinKey();
  }
  if (!rawApiKey) {
    if (platform() === 'win32') {
      process.stdout.write(
        'Note: Windows terminals do not always mask pasted input. ' +
          'If characters appear or the key is rejected, pipe it via --key-stdin instead.\n',
      );
    }
    try {
      rawApiKey = await readHiddenInput('API key: ');
    } catch (err) {
      outputError(err instanceof Error ? err.message : String(err), format);
      process.exitCode = 1;
      return;
    }
  }

  if (!rawApiKey) {
    outputError('API key is required', format);
    process.exitCode = 1;
    return;
  }

  let apiKey: string;
  try {
    apiKey = validateApiKey(rawApiKey);
  } catch (err) {
    outputError(err instanceof Error ? err.message : String(err), format);
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
