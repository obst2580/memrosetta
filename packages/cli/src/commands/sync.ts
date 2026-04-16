import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { userInfo, platform } from 'node:os';
import { createInterface, type Interface as ReadlineInterface } from 'node:readline';
import { output, outputError, type OutputFormat } from '../output.js';
import { requireOption, optionalOption, hasFlag } from '../parser.js';
import { getConfig, writeConfig, getDefaultDbPath, type MemRosettaConfig } from '../hooks/config.js';
import {
  openCliSyncContext,
  buildMemoryCreatedOp,
  buildRelationCreatedOp,
  deterministicOpId,
} from '../sync/cli-sync.js';
import type { SyncOp } from '@memrosetta/types';

const ENV_API_KEY = 'MEMROSETTA_SYNC_API_KEY';

const KEY_SOURCE_HINT = [
  'API key required. Use exactly one of:',
  '  --key <value>              (direct, visible in history)',
  '  --key-stdin                (pipe from stdin)',
  '  --key-file <path>          (read from file)',
  `  ${ENV_API_KEY}=<value>    (environment variable)`,
  '',
  'On POSIX TTYs an interactive hidden prompt is also available.',
  'See: memrosetta sync enable --help',
].join('\n');

interface SyncOptions {
  readonly args: readonly string[];
  readonly format: OutputFormat;
  readonly db?: string;
  readonly noEmbeddings: boolean;
}

type Subcommand = 'enable' | 'disable' | 'status' | 'now' | 'device-id' | 'backfill' | 'login' | 'logout';
type AuthProvider = 'github' | 'google';
type SyncAuthMode = 'api_key' | 'oauth';

interface RefreshResponse {
  readonly success: true;
  readonly data: {
    readonly accessToken: string;
    readonly refreshToken: string;
    readonly tokenExpiresAt: string;
  };
}

interface DeviceStartResponse {
  readonly success: true;
  readonly data: {
    readonly deviceRequestId: string;
    readonly provider: AuthProvider;
    readonly userCode: string;
    readonly verificationUri: string;
    readonly intervalSeconds: number;
    readonly expiresAt: string;
  };
}

interface DevicePollPendingResponse {
  readonly success: true;
  readonly data: {
    readonly status: 'pending';
    readonly intervalSeconds: number;
  };
}

interface DevicePollApprovedResponse {
  readonly success: true;
  readonly data: {
    readonly status: 'approved';
    readonly provider: AuthProvider;
    readonly accountEmail: string | null;
    readonly displayName: string | null;
    readonly accessToken: string;
    readonly refreshToken: string;
    readonly tokenExpiresAt: string;
  };
}

interface ErrorResponse {
  readonly success: false;
  readonly error: string;
}

function parseSubcommand(args: readonly string[]): Subcommand | null {
  const first = args[0];
  if (!first || first.startsWith('--')) return null;
  if (
    first === 'enable' ||
    first === 'disable' ||
    first === 'status' ||
    first === 'now' ||
    first === 'device-id' ||
    first === 'backfill' ||
    first === 'login' ||
    first === 'logout'
  ) {
    return first;
  }
  return null;
}

function normalizeServerUrl(serverUrl: string): string {
  return serverUrl.replace(/\/$/, '');
}

function getSyncAuthMode(config: MemRosettaConfig): SyncAuthMode | null {
  if (config.syncAuthMode === 'oauth' && config.syncAccessToken) {
    return 'oauth';
  }
  if (config.syncAuthMode === 'api_key' && config.syncApiKey) {
    return 'api_key';
  }
  if (config.syncAccessToken) {
    return 'oauth';
  }
  if (config.syncApiKey) {
    return 'api_key';
  }
  return null;
}

function getSyncBearer(config: MemRosettaConfig): string | null {
  const mode = getSyncAuthMode(config);
  if (mode === 'oauth') {
    return config.syncAccessToken ?? null;
  }
  if (mode === 'api_key') {
    return config.syncApiKey ?? null;
  }
  return null;
}

function tokenNeedsRefresh(config: MemRosettaConfig): boolean {
  if (getSyncAuthMode(config) !== 'oauth' || !config.syncTokenExpiresAt) {
    return false;
  }
  const expiresAt = Date.parse(config.syncTokenExpiresAt);
  if (Number.isNaN(expiresAt)) {
    return false;
  }
  return expiresAt <= Date.now() + 5 * 60 * 1000;
}

async function delay(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

// Characters that should never appear in a valid API key. We reject any
// control character (0x00-0x1F + 0x7F) except the separators we trim below.
const CONTROL_CHAR_REGEX = /[\x00-\x1F\x7F]/;

function validateApiKey(key: string, sourceLabel: string): string {
  const trimmed = key.trim();
  if (trimmed.length === 0) {
    throw new Error(`API key from ${sourceLabel} is empty.`);
  }
  if (CONTROL_CHAR_REGEX.test(trimmed)) {
    throw new Error(
      `API key from ${sourceLabel} contains control characters. ` +
        'Try --key-file or MEMROSETTA_SYNC_API_KEY instead.',
    );
  }
  return trimmed;
}

function readKeyFile(path: string): string {
  try {
    return readFileSync(path, 'utf-8');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Could not read --key-file '${path}': ${msg}`);
  }
}

/**
 * Resolve the API key from the first available source, enforcing that
 * explicit flags are mutually exclusive.
 *
 * Order (each is tried only if no earlier source matched):
 *   1. Exactly one of --key / --key-stdin / --key-file
 *   2. MEMROSETTA_SYNC_API_KEY environment variable
 *   3. Hidden prompt (POSIX TTY only)
 */
async function resolveApiKey(args: readonly string[]): Promise<string> {
  const directKey = optionalOption(args, '--key');
  const keyFile = optionalOption(args, '--key-file');
  const useStdin = hasFlag(args, '--key-stdin');

  const explicitCount = [directKey !== undefined, keyFile !== undefined, useStdin]
    .filter(Boolean).length;

  if (explicitCount > 1) {
    throw new Error(
      'Specify only one of --key, --key-stdin, --key-file.',
    );
  }

  if (directKey !== undefined) {
    return validateApiKey(directKey, '--key');
  }
  if (useStdin) {
    const raw = await readStdinKey();
    if (!raw) {
      throw new Error(
        '--key-stdin produced no input. ' +
          'On Windows PowerShell, prefer --key-file or MEMROSETTA_SYNC_API_KEY.',
      );
    }
    return validateApiKey(raw, '--key-stdin');
  }
  if (keyFile !== undefined) {
    return validateApiKey(readKeyFile(keyFile), `--key-file ${keyFile}`);
  }

  const envKey = process.env[ENV_API_KEY];
  if (envKey !== undefined && envKey.length > 0) {
    return validateApiKey(envKey, ENV_API_KEY);
  }

  // Fallback: hidden prompt, POSIX TTY only.
  if (platform() !== 'win32' && process.stdin.isTTY) {
    const raw = await readHiddenInput('API key: ');
    return validateApiKey(raw, 'hidden prompt');
  }

  throw new Error(KEY_SOURCE_HINT);
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
  const url = `${normalizeServerUrl(serverUrl)}/sync/health`;
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

async function refreshOAuthTokens(config: MemRosettaConfig): Promise<MemRosettaConfig> {
  if (!config.syncServerUrl || !config.syncRefreshToken) {
    throw new Error('OAuth sync is not fully configured. Run: memrosetta sync login');
  }

  const res = await fetch(`${normalizeServerUrl(config.syncServerUrl)}/auth/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshToken: config.syncRefreshToken }),
  });
  const body = (await res.json()) as RefreshResponse | ErrorResponse;
  if (!res.ok || body.success === false) {
    throw new Error(
      `Token refresh failed: ${'error' in body ? body.error : `${res.status} ${res.statusText}`}`,
    );
  }

  const nextConfig: MemRosettaConfig = {
    ...config,
    syncAuthMode: 'oauth',
    syncAccessToken: body.data.accessToken,
    syncRefreshToken: body.data.refreshToken,
    syncTokenExpiresAt: body.data.tokenExpiresAt,
  };
  writeConfig(nextConfig);
  return nextConfig;
}

async function withSyncClient<T>(
  dbPath: string,
  config: MemRosettaConfig,
  fn: (client: import('@memrosetta/sync-client').SyncClient, db: import('better-sqlite3').Database) => Promise<T>,
): Promise<T> {
  const Database = (await import('better-sqlite3')).default;
  const { SyncClient, ensureSyncSchema } = await import('@memrosetta/sync-client');

  let runtimeConfig = config;
  if (runtimeConfig.syncAuthMode === 'oauth' && tokenNeedsRefresh(runtimeConfig)) {
    runtimeConfig = await refreshOAuthTokens(runtimeConfig);
  }

  const bearer = getSyncBearer(runtimeConfig);
  if (!runtimeConfig.syncServerUrl || !bearer || !runtimeConfig.syncDeviceId) {
    throw new Error('Sync is not configured. Run: memrosetta sync enable --server <url>');
  }

  // Reject stored API keys that contain control characters. This is a
  // recovery path for users whose 0.4.1 `sync enable` captured garbage from
  // a Windows terminal.
  if (runtimeConfig.syncAuthMode !== 'oauth' && CONTROL_CHAR_REGEX.test(runtimeConfig.syncApiKey ?? '')) {
    throw new Error(
      'Stored API key is invalid (contains control characters from a previous ' +
        'terminal input). Re-run with one of:\n' +
        `  memrosetta sync enable --server ${runtimeConfig.syncServerUrl} --key <api-key>\n` +
        `  memrosetta sync enable --server ${runtimeConfig.syncServerUrl} --key-file path/to/key\n` +
        `  $env:${ENV_API_KEY}='<api-key>'; memrosetta sync enable --server ${runtimeConfig.syncServerUrl}`,
    );
  }

  const db = new Database(dbPath);
  try {
    ensureSyncSchema(db);
    const client = new SyncClient(db, {
      serverUrl: runtimeConfig.syncServerUrl,
      apiKey: bearer,
      deviceId: runtimeConfig.syncDeviceId,
      userId: runtimeConfig.syncUserId ?? userInfo().username,
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

  let apiKey: string;
  try {
    apiKey = await resolveApiKey(args);
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

  // --user overrides the stored syncUserId. If neither flag nor existing
  // config has a value we fall back to the OS username at runtime.
  const userOverride = optionalOption(args, '--user');
  const syncUserId = userOverride ?? existing.syncUserId ?? userInfo().username;

  writeConfig({
    ...existing,
    syncEnabled: true,
    syncAuthMode: 'api_key',
    syncServerUrl: normalizeServerUrl(serverUrl),
    syncApiKey: apiKey,
    syncDeviceId: deviceId,
    syncUserId,
    syncAccessToken: undefined,
    syncRefreshToken: undefined,
    syncTokenExpiresAt: undefined,
    syncAccountEmail: undefined,
    syncProvider: undefined,
  });

  if (format === 'text') {
    process.stdout.write('Sync enabled.\n');
    process.stdout.write(`  Server:   ${serverUrl}\n`);
    process.stdout.write(`  UserId:   ${syncUserId}\n`);
    process.stdout.write(`  DeviceId: ${deviceId}\n`);
    if (skipTest) {
      process.stdout.write('  (health check skipped)\n');
    }
    return;
  }

  output(
    { enabled: true, serverUrl, userId: syncUserId, deviceId, healthCheckSkipped: skipTest },
    format,
  );
}

async function runLogin(options: SyncOptions): Promise<void> {
  const { args, format } = options;
  const existing = getConfig();
  const provider = (optionalOption(args, '--provider') ?? 'github') as AuthProvider;
  if (provider !== 'github' && provider !== 'google') {
    outputError('Provider must be one of: github, google', format);
    process.exitCode = 1;
    return;
  }

  const serverUrl = optionalOption(args, '--server') ?? existing.syncServerUrl;
  if (!serverUrl) {
    outputError('OAuth login requires a sync server URL. Use: memrosetta sync login --server <url>', format);
    process.exitCode = 1;
    return;
  }

  const normalizedServerUrl = normalizeServerUrl(serverUrl);
  const deviceId = existing.syncDeviceId ?? `device-${randomUUID().slice(0, 8)}`;
  const syncUserId = existing.syncUserId ?? userInfo().username;

  const startRes = await fetch(`${normalizedServerUrl}/auth/device/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ provider, deviceId }),
  });
  const startBody = (await startRes.json()) as DeviceStartResponse | ErrorResponse;
  if (!startRes.ok || startBody.success === false) {
    outputError(
      `OAuth login start failed: ${'error' in startBody ? startBody.error : `${startRes.status} ${startRes.statusText}`}`,
      format,
    );
    process.exitCode = 1;
    return;
  }

  if (format === 'text') {
    process.stdout.write(`Open: ${startBody.data.verificationUri}\n`);
    process.stdout.write(`Code: ${startBody.data.userCode}\n`);
    process.stdout.write('Waiting for authorization...\n');
  }

  const expiresAt = Date.parse(startBody.data.expiresAt);
  let intervalMs = Math.max(1, startBody.data.intervalSeconds) * 1000;
  for (;;) {
    if (Date.now() >= expiresAt) {
      outputError('OAuth device code expired before approval. Run `memrosetta sync login` again.', format);
      process.exitCode = 1;
      return;
    }

    await delay(intervalMs);
    const pollRes = await fetch(`${normalizedServerUrl}/auth/device/poll`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deviceRequestId: startBody.data.deviceRequestId }),
    });
    const pollBody = (await pollRes.json()) as DevicePollPendingResponse | DevicePollApprovedResponse | ErrorResponse;

    if (pollRes.ok && pollBody.success && pollBody.data.status === 'pending') {
      intervalMs = Math.max(1, pollBody.data.intervalSeconds) * 1000;
      continue;
    }

    if (pollRes.ok && pollBody.success && pollBody.data.status === 'approved') {
      const nextConfig: MemRosettaConfig = {
        ...existing,
        syncEnabled: true,
        syncServerUrl: normalizedServerUrl,
        syncDeviceId: deviceId,
        syncUserId,
        syncAuthMode: 'oauth',
        syncAccessToken: pollBody.data.accessToken,
        syncRefreshToken: pollBody.data.refreshToken,
        syncTokenExpiresAt: pollBody.data.tokenExpiresAt,
        syncAccountEmail: pollBody.data.accountEmail ?? undefined,
        syncProvider: pollBody.data.provider,
      };
      writeConfig(nextConfig);

      if (format === 'text') {
        process.stdout.write('OAuth login complete.\n');
        process.stdout.write(`  Server:   ${normalizedServerUrl}\n`);
        process.stdout.write(`  Provider: ${pollBody.data.provider}\n`);
        if (pollBody.data.accountEmail) {
          process.stdout.write(`  Account:  ${pollBody.data.accountEmail}\n`);
        }
        process.stdout.write(`  UserId:   ${syncUserId}\n`);
        process.stdout.write(`  DeviceId: ${deviceId}\n`);
        return;
      }

      output({
        success: true,
        provider: pollBody.data.provider,
        accountEmail: pollBody.data.accountEmail,
        tokenExpiresAt: pollBody.data.tokenExpiresAt,
        userId: syncUserId,
        deviceId,
      }, format);
      return;
    }

    outputError(
      `OAuth login failed: ${'error' in pollBody ? pollBody.error : `${pollRes.status} ${pollRes.statusText}`}`,
      format,
    );
    process.exitCode = 1;
    return;
  }
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

async function runLogout(options: SyncOptions): Promise<void> {
  const { format } = options;
  const existing = getConfig();

  if (existing.syncAuthMode === 'oauth' && existing.syncServerUrl && existing.syncAccessToken) {
    try {
      await fetch(`${normalizeServerUrl(existing.syncServerUrl)}/auth/logout`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${existing.syncAccessToken}` },
      });
    } catch {
      // best effort
    }
  }

  writeConfig({
    ...existing,
    syncAuthMode: existing.syncApiKey ? 'api_key' : undefined,
    syncAccessToken: undefined,
    syncRefreshToken: undefined,
    syncTokenExpiresAt: undefined,
    syncAccountEmail: undefined,
    syncProvider: undefined,
  });

  if (format === 'text') {
    process.stdout.write('OAuth session removed.\n');
    return;
  }

  output({ loggedOut: true }, format);
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
      if (config.syncUserId) {
        process.stdout.write(`  UserId:   ${config.syncUserId}\n`);
      }
      if (config.syncDeviceId) {
        process.stdout.write(`  DeviceId: ${config.syncDeviceId}\n`);
      }
      if (config.syncAuthMode) {
        process.stdout.write(`  Auth:     ${config.syncAuthMode}\n`);
      }
      return;
    }
    output(
      {
        enabled: false,
        serverUrl: config.syncServerUrl ?? null,
        userId: config.syncUserId ?? null,
        deviceId: config.syncDeviceId ?? null,
      },
      format,
    );
    return;
  }

  try {
    const status = await withSyncClient(dbPath, config, async (client) => client.getStatus());
    const authMode = getSyncAuthMode(config);

    if (format === 'text') {
      process.stdout.write('Sync: enabled\n');
      process.stdout.write(`  Server:          ${status.serverUrl}\n`);
      process.stdout.write(`  UserId:          ${status.userId}\n`);
      process.stdout.write(`  DeviceId:        ${status.deviceId}\n`);
      process.stdout.write(`  Auth:            ${authMode ?? 'unknown'}\n`);
      if (authMode === 'oauth') {
        process.stdout.write(`  Provider:        ${config.syncProvider ?? 'unknown'}\n`);
        if (config.syncAccountEmail) {
          process.stdout.write(`  Account:         ${config.syncAccountEmail}\n`);
        }
        if (config.syncTokenExpiresAt) {
          process.stdout.write(`  Token expires:   ${config.syncTokenExpiresAt}\n`);
        }
      }
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

/**
 * Enqueue every existing memory and relation into the sync outbox as
 * memory_created / relation_created ops. Used once, after sync is enabled
 * on a device that already has local history, to push legacy memories up
 * to the sync hub.
 *
 * Idempotent at the server via (user_id, op_id); the client still generates
 * fresh op_ids each call, so re-running backfill inflates the outbox. Use
 * with care, and prefer --dry-run first.
 */
async function runBackfill(options: SyncOptions): Promise<void> {
  const { args, format, db } = options;
  const config = getConfig();
  const dbPath = db ?? config.dbPath ?? getDefaultDbPath();

  if (!config.syncEnabled) {
    outputError('Sync is disabled. Run: memrosetta sync enable --server <url>', format);
    process.exitCode = 1;
    return;
  }

  const dryRun = hasFlag(args, '--dry-run');
  const userFilter = optionalOption(args, '--user');
  const namespaceFilter = optionalOption(args, '--namespace');
  const includeRelations = !hasFlag(args, '--memories-only');

  const sync = await openCliSyncContext(dbPath);
  if (!sync.enabled) {
    outputError('Sync is not fully configured. Run: memrosetta sync enable', format);
    process.exitCode = 1;
    return;
  }

  try {
    const { default: Database } = await import('better-sqlite3');
    const readDb = new Database(dbPath, { readonly: true });
    try {
      const params: string[] = [];
      let where = '1=1';
      if (userFilter) {
        where += ' AND user_id = ?';
        params.push(userFilter);
      }
      if (namespaceFilter) {
        where += ' AND namespace = ?';
        params.push(namespaceFilter);
      }

      const memRows = readDb
        .prepare(
          `SELECT memory_id, user_id, namespace, memory_type, content, raw_text,
                  document_date, source_id, confidence, salience, keywords,
                  event_date_start, event_date_end, invalidated_at, learned_at
           FROM memories
           WHERE ${where}`,
        )
        .all(...params) as readonly {
          readonly memory_id: string;
          readonly user_id: string;
          readonly namespace: string | null;
          readonly memory_type: string;
          readonly content: string;
          readonly raw_text: string | null;
          readonly document_date: string | null;
          readonly source_id: string | null;
          readonly confidence: number;
          readonly salience: number;
          readonly keywords: string | null;
          readonly event_date_start: string | null;
          readonly event_date_end: string | null;
          readonly invalidated_at: string | null;
          readonly learned_at: string;
        }[];

      let memoriesQueued = 0;
      let relationsQueued = 0;
      const memoryIdSet = new Set<string>();

      for (const row of memRows) {
        memoryIdSet.add(row.memory_id);
        if (dryRun) continue;

        // Backfill MUST use a deterministic opId keyed on the memory_id so
        // re-running backfill is a no-op at the server log level. Using
        // randomUUID would bloat the outbox and re-publish every memory.
        const op: SyncOp = {
          opId: deterministicOpId('memory_created', row.memory_id),
          opType: 'memory_created',
          deviceId: sync.deviceId,
          userId: sync.userId,
          createdAt: row.learned_at,
          payload: {
            memoryId: row.memory_id,
            userId: row.user_id,
            namespace: row.namespace ?? undefined,
            memoryType: row.memory_type,
            content: row.content,
            rawText: row.raw_text ?? undefined,
            documentDate: row.document_date ?? undefined,
            sourceId: row.source_id ?? undefined,
            confidence: row.confidence,
            salience: row.salience,
            // core stores keywords as a space-joined string, not JSON.
            keywords: row.keywords
              ? row.keywords.split(' ').filter((k) => k.length > 0)
              : undefined,
            eventDateStart: row.event_date_start ?? undefined,
            eventDateEnd: row.event_date_end ?? undefined,
            invalidatedAt: row.invalidated_at ?? undefined,
            learnedAt: row.learned_at,
          },
        };
        sync.enqueue(op);
        memoriesQueued++;
      }
      if (dryRun) memoriesQueued = memRows.length;

      if (includeRelations) {
        const relRows = readDb
          .prepare(
            'SELECT src_memory_id, dst_memory_id, relation_type, created_at, reason FROM memory_relations',
          )
          .all() as readonly {
            readonly src_memory_id: string;
            readonly dst_memory_id: string;
            readonly relation_type: string;
            readonly created_at: string;
            readonly reason: string | null;
          }[];

        for (const row of relRows) {
          // Only emit relations whose both endpoints are in the backfill set.
          // Otherwise the remote apply will silently drop them when the
          // memory_id foreign key is missing on the other device.
          if (!memoryIdSet.has(row.src_memory_id) || !memoryIdSet.has(row.dst_memory_id)) {
            continue;
          }
          if (!dryRun) {
            const relKey = `${row.src_memory_id}|${row.dst_memory_id}|${row.relation_type}`;
            const op: SyncOp = {
              opId: deterministicOpId('relation_created', relKey),
              opType: 'relation_created',
              deviceId: sync.deviceId,
              userId: sync.userId,
              createdAt: row.created_at,
              payload: {
                srcMemoryId: row.src_memory_id,
                dstMemoryId: row.dst_memory_id,
                relationType: row.relation_type,
                createdAt: row.created_at,
                reason: row.reason ?? undefined,
              },
            };
            sync.enqueue(op);
          }
          relationsQueued++;
        }
      }

      const result = {
        memoriesQueued,
        relationsQueued,
        dryRun,
        userFilter: userFilter ?? null,
        namespaceFilter: namespaceFilter ?? null,
      };

      if (format === 'text') {
        process.stdout.write(
          `${dryRun ? 'Dry run: would enqueue' : 'Enqueued'} ${memoriesQueued} memories` +
            (includeRelations ? ` and ${relationsQueued} relations` : '') +
            '.\n',
        );
        if (userFilter || namespaceFilter) {
          process.stdout.write(
            `  Filters: user=${userFilter ?? '*'} namespace=${namespaceFilter ?? '*'}\n`,
          );
        }
        if (!dryRun) {
          process.stdout.write('Run `memrosetta sync now` to push to the server.\n');
        }
        return;
      }

      output(result, format);
    } finally {
      readDb.close();
    }
  } finally {
    sync.close();
  }
}

export async function run(options: SyncOptions): Promise<void> {
  const sub = parseSubcommand(options.args);

  if (!sub) {
    outputError(
      'Usage: memrosetta sync <enable|disable|status|now|device-id|backfill|login|logout>\n' +
        '\n' +
        '  enable    --server <url> [--key <key> | --key-stdin | --key-file <p>]\n' +
        '  disable\n' +
        '  login     [--provider github|google] [--server <url>]\n' +
        '  logout\n' +
        '  status\n' +
        '  now       [--push-only | --pull-only]\n' +
        '  device-id\n' +
        '  backfill  [--user <id>] [--namespace <ns>] [--memories-only] [--dry-run]\n',
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
    case 'login':
      await runLogin(rest);
      return;
    case 'logout':
      await runLogout(rest);
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
    case 'backfill':
      await runBackfill(rest);
      return;
  }
}
