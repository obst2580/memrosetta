import { execSync } from 'node:child_process';
import { resolveCliVersion } from '../version.js';

/**
 * Parse `npm list -g <name> --depth=0 --json` output, tolerating warnings
 * that npm sometimes prints before the JSON body.
 */
function parseNpmList(raw: string): Record<string, unknown> {
  // Find the first `{` so we skip any stderr-on-stdout noise.
  const start = raw.indexOf('{');
  if (start === -1) return {};
  try {
    return JSON.parse(raw.slice(start)) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function getInstalledVersion(packageName: string): string | null {
  try {
    const raw = execSync(`npm list -g ${packageName} --depth=0 --json`, {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const parsed = parseNpmList(raw);
    const deps = (parsed.dependencies ?? {}) as Record<string, { version?: string }>;
    return deps[packageName]?.version ?? null;
  } catch {
    return null;
  }
}

export async function run(): Promise<void> {
  // The currently-running binary always has a valid version. Use that as the
  // ground truth for "what am I" instead of re-parsing npm list output.
  const runningVersion = resolveCliVersion();

  // Figure out which distribution path is installed globally so `npm install`
  // can update the right one. Wrapper package (memrosetta) takes precedence
  // because it drops the `memrosetta` binary + hooks.
  const wrapperInstalled = getInstalledVersion('memrosetta');
  const cliInstalled = getInstalledVersion('@memrosetta/cli');

  let packageName: string;
  let currentVersion: string;

  if (wrapperInstalled) {
    packageName = 'memrosetta';
    currentVersion = wrapperInstalled;
  } else if (cliInstalled) {
    packageName = '@memrosetta/cli';
    currentVersion = cliInstalled;
  } else {
    // Neither `memrosetta` nor `@memrosetta/cli` appeared in `npm list -g`
    // (common when `memrosetta` is running via `npx` or a local workspace
    // path). Fall back to the running binary's own version.
    packageName = 'memrosetta';
    currentVersion = runningVersion;
  }

  process.stdout.write(`Current version: ${currentVersion} (${packageName})\n`);
  if (currentVersion !== runningVersion && runningVersion !== 'unknown') {
    process.stdout.write(`Running binary:   ${runningVersion}\n`);
  }
  process.stdout.write('Checking for updates...\n');

  try {
    const latest = execSync(`npm view ${packageName} version`, {
      encoding: 'utf-8',
    }).trim();

    if (latest === currentVersion) {
      process.stdout.write(`Already up to date (${currentVersion}).\n`);
      return;
    }

    process.stdout.write(`New version available: ${latest}\n`);
    process.stdout.write('Updating...\n');

    execSync(`npm install -g ${packageName}@latest --force`, {
      stdio: 'inherit',
    });

    process.stdout.write(`\nUpdated: ${currentVersion} -> ${latest}\n`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`Update failed: ${message}\n`);
    process.exitCode = 1;
  }
}
