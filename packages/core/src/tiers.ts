import type { MemoryTier, TierConfig } from '@memrosetta/types';

const MS_PER_DAY = 1000 * 60 * 60 * 24;

export const DEFAULT_TIER_CONFIG: TierConfig = {
  hotMaxTokens: 3000,
  warmDays: 30,
  coldActivationThreshold: 0.3,
};

/**
 * Determine the appropriate tier for a memory based on its properties.
 *
 * - hot: manually promoted memories stay hot
 * - warm: memories within warmDays of creation
 * - cold: older than warmDays
 */
export function determineTier(
  memory: {
    readonly learnedAt: string;
    readonly activationScore: number;
    readonly tier: string;
  },
  config?: TierConfig,
  now?: Date,
): MemoryTier {
  const cfg = config ?? DEFAULT_TIER_CONFIG;

  // Hot tier is sticky: only manual promotion sets it, and only manual demotion clears it
  if (memory.tier === 'hot') return 'hot';

  const currentTime = now ?? new Date();
  const age = (currentTime.getTime() - new Date(memory.learnedAt).getTime()) / MS_PER_DAY;

  // Warm: within warmDays
  if (age <= cfg.warmDays) return 'warm';

  // Cold: older than warmDays
  return 'cold';
}

/**
 * Estimate token count from content length.
 * Rough heuristic: 1 token ~ 4 characters.
 */
export function estimateTokens(content: string): number {
  return Math.ceil(content.length / 4);
}
