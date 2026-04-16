import { describe, it, expect } from 'vitest';
import { userInfo } from 'node:os';
import {
  resolveCanonicalUserId,
  type MemRosettaConfig,
} from '../../src/hooks/config.js';

const BASE_CONFIG: MemRosettaConfig = {
  dbPath: '/tmp/test.db',
  enableEmbeddings: false,
  maxRecallResults: 5,
  minQueryLength: 5,
  maxContextChars: 2000,
};

function loader(overrides: Partial<MemRosettaConfig>): () => MemRosettaConfig {
  return () => ({ ...BASE_CONFIG, ...overrides });
}

describe('resolveCanonicalUserId', () => {
  it('prefers explicit argument over everything else', () => {
    expect(
      resolveCanonicalUserId('from-cli', loader({ syncUserId: 'from-config' })),
    ).toBe('from-cli');
  });

  it('trims whitespace on explicit argument', () => {
    expect(resolveCanonicalUserId('  obst  ', loader({}))).toBe('obst');
  });

  it('falls back to config.syncUserId when no explicit argument', () => {
    expect(
      resolveCanonicalUserId(undefined, loader({ syncUserId: 'from-config' })),
    ).toBe('from-config');
  });

  it('falls back to OS username when neither explicit nor config is set', () => {
    expect(resolveCanonicalUserId(undefined, loader({}))).toBe(
      userInfo().username,
    );
  });

  it('ignores empty string as explicit argument', () => {
    const l = loader({ syncUserId: 'from-config' });
    expect(resolveCanonicalUserId('', l)).toBe('from-config');
    expect(resolveCanonicalUserId('   ', l)).toBe('from-config');
  });

  it('ignores whitespace-only config.syncUserId', () => {
    expect(
      resolveCanonicalUserId(undefined, loader({ syncUserId: '   ' })),
    ).toBe(userInfo().username);
  });

  it('null explicit falls back to config', () => {
    expect(
      resolveCanonicalUserId(null, loader({ syncUserId: 'from-config' })),
    ).toBe('from-config');
  });

  it('prefers explicit over OS username when config has no syncUserId', () => {
    expect(resolveCanonicalUserId('override', loader({}))).toBe('override');
  });
});
