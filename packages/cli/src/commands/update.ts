import { execSync } from 'node:child_process';

export async function run(): Promise<void> {
  const current = execSync('npm list -g @memrosetta/cli --depth=0 --json 2>/dev/null || echo "{}"', { encoding: 'utf-8' });
  let currentVersion: string;
  try {
    const parsed = JSON.parse(current);
    currentVersion = parsed.dependencies?.['@memrosetta/cli']?.version ?? 'unknown';
  } catch {
    currentVersion = 'unknown';
  }

  process.stdout.write(`Current version: ${currentVersion}\n`);
  process.stdout.write('Checking for updates...\n');

  try {
    const latest = execSync('npm view @memrosetta/cli version', { encoding: 'utf-8' }).trim();

    if (latest === currentVersion) {
      process.stdout.write(`Already up to date (${currentVersion}).\n`);
      return;
    }

    process.stdout.write(`New version available: ${latest}\n`);
    process.stdout.write('Updating...\n');

    execSync('npm install -g @memrosetta/cli@latest --force', {
      stdio: 'inherit',
    });

    process.stdout.write(`\nUpdated: ${currentVersion} -> ${latest}\n`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`Update failed: ${message}\n`);
    process.exitCode = 1;
  }
}
