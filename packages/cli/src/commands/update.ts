import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';

export async function run(): Promise<void> {
  const require = createRequire(import.meta.url);
  const pkg = require('../../package.json') as { version: string };
  const current = pkg.version;

  process.stdout.write(`Current version: ${current}\n`);
  process.stdout.write('Checking for updates...\n');

  try {
    const latest = execSync('npm view @memrosetta/cli version', { encoding: 'utf-8' }).trim();

    if (latest === current) {
      process.stdout.write(`Already up to date (${current}).\n`);
      return;
    }

    process.stdout.write(`New version available: ${latest}\n`);
    process.stdout.write('Updating...\n');

    execSync('npm install -g @memrosetta/cli@latest --force', {
      stdio: 'inherit',
    });

    process.stdout.write(`\nUpdated: ${current} -> ${latest}\n`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`Update failed: ${message}\n`);
    process.exitCode = 1;
  }
}
