import { execSync } from 'node:child_process';

export async function run(): Promise<void> {
  // Check if installed via wrapper package (memrosetta) or directly (@memrosetta/cli)
  const wrapperCheck = execSync('npm list -g memrosetta --depth=0 --json 2>/dev/null || echo "{}"', { encoding: 'utf-8' });
  const cliCheck = execSync('npm list -g @memrosetta/cli --depth=0 --json 2>/dev/null || echo "{}"', { encoding: 'utf-8' });

  let packageName: string;
  let currentVersion: string;
  try {
    const wrapperParsed = JSON.parse(wrapperCheck);
    const cliParsed = JSON.parse(cliCheck);
    const wrapperVersion = wrapperParsed.dependencies?.['memrosetta']?.version;
    const cliVersion = cliParsed.dependencies?.['@memrosetta/cli']?.version;

    if (wrapperVersion) {
      packageName = 'memrosetta';
      currentVersion = wrapperVersion;
    } else {
      packageName = '@memrosetta/cli';
      currentVersion = cliVersion ?? 'unknown';
    }
  } catch {
    packageName = 'memrosetta';
    currentVersion = 'unknown';
  }

  process.stdout.write(`Current version: ${currentVersion} (${packageName})\n`);
  process.stdout.write('Checking for updates...\n');

  try {
    const latest = execSync(`npm view ${packageName} version`, { encoding: 'utf-8' }).trim();

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
