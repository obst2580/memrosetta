/**
 * ACT-R base-level learning activation score.
 *
 * The ACT-R base-level learning equation:
 *   B_i = ln(sum(t_j^(-d))) + beta_i
 *
 * Where:
 *   t_j = time since j-th access (in days)
 *   d   = decay parameter (typically 0.5)
 *   beta_i = base-level constant (derived from salience)
 *
 * The raw activation value is normalized to [0, 1] via sigmoid.
 */

const MS_PER_DAY = 1000 * 60 * 60 * 24;
const DEFAULT_DECAY = 0.5;

/**
 * Compute the ACT-R activation score for a memory.
 *
 * @param accessTimestamps - ISO 8601 timestamps of each access event
 * @param salience - memory salience value (0-1)
 * @param now - reference time (defaults to current time)
 * @returns activation score in [0, 1]
 */
export function computeActivation(
  accessTimestamps: readonly string[],
  salience: number,
  now?: Date,
): number {
  const currentTime = now ?? new Date();

  if (accessTimestamps.length === 0) {
    // Never accessed: very low activation, still influenced by salience
    return sigmoid(salience * 0.1);
  }

  const d = DEFAULT_DECAY;
  let sum = 0;

  for (const ts of accessTimestamps) {
    const accessTime = new Date(ts);
    const daysSinceAccess = (currentTime.getTime() - accessTime.getTime()) / MS_PER_DAY;
    if (daysSinceAccess <= 0) continue;
    sum += Math.pow(daysSinceAccess, -d);
  }

  // Base-level activation = ln(sum) + beta
  const beta = salience;
  const activation = sum > 0 ? Math.log(sum) + beta : beta * 0.1;

  return sigmoid(activation);
}

/**
 * Sigmoid function to normalize activation to [0, 1].
 */
function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x));
}
