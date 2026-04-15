/**
 * Resolve the installed @memrosetta/cli version.
 *
 * Tries several strategies so it works in every install mode:
 *   1. require('../../package.json') — dev checkouts run via tsx.
 *   2. require('@memrosetta/cli/package.json') — published tarballs where
 *      the exports map exposes ./package.json.
 *   3. Walk up the directory tree from the current module — catches cases
 *      where the exports map is missing or the caller runs a raw JS file
 *      out of an npm global install.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

export function resolveCliVersion(): string {
  const strategies: Array<() => string> = [
    () => {
      const require = createRequire(import.meta.url);
      return (require('../../package.json') as { version: string }).version;
    },
    () => {
      const require = createRequire(import.meta.url);
      return (require('@memrosetta/cli/package.json') as { version: string }).version;
    },
    () => {
      const dir = dirname(fileURLToPath(import.meta.url));
      for (let d = dir, i = 0; i < 5; i++) {
        const candidate = join(d, 'package.json');
        if (existsSync(candidate)) {
          const pkg = JSON.parse(readFileSync(candidate, 'utf-8')) as {
            name?: string;
            version?: string;
          };
          if (pkg.name?.includes('memrosetta') && pkg.version) {
            return pkg.version;
          }
        }
        d = dirname(d);
      }
      throw new Error('not found');
    },
  ];

  for (const strategy of strategies) {
    try {
      return strategy();
    } catch {}
  }
  return 'unknown';
}
