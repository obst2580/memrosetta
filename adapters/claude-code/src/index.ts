#!/usr/bin/env node
/**
 * @memrosetta/claude-code -- DEPRECATED
 *
 * This package is deprecated. All functionality has moved to @memrosetta/cli.
 *
 * Migration:
 *   npm install -g @memrosetta/cli
 *   memrosetta init --claude-code
 */

process.stderr.write(
  '[memrosetta] @memrosetta/claude-code is deprecated.\n' +
  '[memrosetta] Use @memrosetta/cli instead:\n' +
  '[memrosetta]   npm install -g @memrosetta/cli\n' +
  '[memrosetta]   memrosetta init --claude-code\n\n',
);

process.exit(0);
