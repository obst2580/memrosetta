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
 * - hot: manually promoted memories stay hot, OR auto-promoted via high access count (>= 10)
 * - warm: memories within warmDays of creation, OR old but with high activation
 * - cold: older than warmDays AND low activation
 */
export function determineTier(
  memory: {
    readonly learnedAt: string;
    readonly activationScore: number;
    readonly tier: string;
    readonly accessCount?: number;
  },
  config?: TierConfig,
  now?: Date,
): MemoryTier {
  const cfg = config ?? DEFAULT_TIER_CONFIG;

  // Hot tier is sticky: manually promoted memories stay hot
  if (memory.tier === 'hot') return 'hot';

  // Auto-promote frequently accessed memories to hot
  const accessCount = memory.accessCount ?? 0;
  if (accessCount >= 10) return 'hot';

  const currentTime = now ?? new Date();
  const age = (currentTime.getTime() - new Date(memory.learnedAt).getTime()) / MS_PER_DAY;

  // Warm: within warmDays
  if (age <= cfg.warmDays) return 'warm';

  // Old but still active stays warm instead of going cold
  if (memory.activationScore >= cfg.coldActivationThreshold) return 'warm';

  // Cold: old AND low activation
  return 'cold';
}

/**
 * Estimate token count from content length.
 * Rough heuristic: 1 token ~ 4 characters.
 */
export function estimateTokens(content: string): number {
  return Math.ceil(content.length / 4);
}
