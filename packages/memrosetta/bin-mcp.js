#!/usr/bin/env node
import { createRequire } from 'node:module';
import { join, dirname } from 'node:path';
const require = createRequire(import.meta.url);
const pkgPath = dirname(require.resolve('@memrosetta/mcp/package.json'));
await import(join(pkgPath, 'dist', 'index.js'));
