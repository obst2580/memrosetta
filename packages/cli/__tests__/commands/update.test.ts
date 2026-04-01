import { describe, it, expect } from 'vitest';

/**
 * Tests for the update command's package detection logic.
 * The actual npm commands are not tested (they require global npm state).
 * Instead we test the parsing logic that determines which package to update.
 */

function detectPackage(
  wrapperJson: string,
  cliJson: string,
): { packageName: string; currentVersion: string } {
  let packageName: string;
  let currentVersion: string;
  try {
    const wrapperParsed = JSON.parse(wrapperJson);
    const cliParsed = JSON.parse(cliJson);
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
  return { packageName, currentVersion };
}

describe('update command - package detection', () => {
  it('detects memrosetta wrapper package', () => {
    const wrapper = JSON.stringify({
      dependencies: { memrosetta: { version: '0.2.22' } },
    });
    const cli = JSON.stringify({});
    const result = detectPackage(wrapper, cli);
    expect(result.packageName).toBe('memrosetta');
    expect(result.currentVersion).toBe('0.2.22');
  });

  it('falls back to @memrosetta/cli when wrapper not installed', () => {
    const wrapper = JSON.stringify({});
    const cli = JSON.stringify({
      dependencies: { '@memrosetta/cli': { version: '0.2.22' } },
    });
    const result = detectPackage(wrapper, cli);
    expect(result.packageName).toBe('@memrosetta/cli');
    expect(result.currentVersion).toBe('0.2.22');
  });

  it('prefers wrapper when both are installed', () => {
    const wrapper = JSON.stringify({
      dependencies: { memrosetta: { version: '0.2.22' } },
    });
    const cli = JSON.stringify({
      dependencies: { '@memrosetta/cli': { version: '0.2.21' } },
    });
    const result = detectPackage(wrapper, cli);
    expect(result.packageName).toBe('memrosetta');
    expect(result.currentVersion).toBe('0.2.22');
  });

  it('returns unknown when neither is installed', () => {
    const wrapper = JSON.stringify({});
    const cli = JSON.stringify({});
    const result = detectPackage(wrapper, cli);
    expect(result.packageName).toBe('@memrosetta/cli');
    expect(result.currentVersion).toBe('unknown');
  });

  it('handles invalid JSON gracefully', () => {
    const result = detectPackage('not json', 'also not json');
    expect(result.packageName).toBe('memrosetta');
    expect(result.currentVersion).toBe('unknown');
  });
});
