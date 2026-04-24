/**
 * Spreading Activation Lite (v0.8.0).
 *
 * Given a set of seed memory ids (from the initial search), expands
 * the candidate set by traversing both:
 *   1. Explicit semantic relations (memory_relations)
 *   2. Implicit co-access edges (memory_coaccess)
 *
 * Each hop applies a decay factor so distant memories get a smaller
 * activation boost. The result is a Map<memoryId, activationBoost>
 * that the search ranker uses to re-score candidates.
 *
 * This implements a simplified version of HippoRAG's retrieval-phase
 * spreading activation without full Personalized PageRank — 1-2 hop
 * expansion with type-weighted edges is sufficient for the current
 * graph density and keeps latency low.
 *
 * Relation type weights (tunable):
 *   supports:    +0.35
 *   decided:     +0.30
 *   prefers:     +0.28
 *   uses:        +0.25
 *   extends:     +0.25
 *   derives:     +0.20
 *   updates:     +0.10
 *   invalidates: -0.35
 *   contradicts: -0.40  (negative = suppression)
 *
 * Hop decay:
 *   1-hop: base * 0.5
 *   2-hop: base * 0.2
 *
 * Co-access edges use their stored `strength` scaled by 0.15 (same
 * as the v0.7.0 co-access boost weight).
 */

import type Database from 'better-sqlite3';

const RELATION_WEIGHTS: Record<string, number> = {
  supports: 0.35,
  decided: 0.30,
  prefers: 0.28,
  uses: 0.25,
  extends: 0.25,
  derives: 0.20,
  updates: 0.10,
  invalidates: -0.35,
  contradicts: -0.40,
};

const HOP_DECAY = [1.0, 0.5, 0.2];
const COACCESS_WEIGHT = 0.15;

interface SpreadingOptions {
  readonly maxHops?: number;
  readonly maxNeighborsPerHop?: number;
  readonly includeCoAccess?: boolean;
}

const DEFAULT_OPTIONS: Required<SpreadingOptions> = {
  maxHops: 2,
  maxNeighborsPerHop: 10,
  includeCoAccess: true,
};

/**
 * Compute spreading activation from seed memories.
 *
 * Returns a Map<memoryId, activationBoost> for memories reachable
 * within `maxHops` hops. Seeds themselves are NOT included (they are
 * already in the result set). Only novel candidates get a boost.
 *
 * Gracefully returns an empty map if relation/coaccess tables do not
 * exist (pre-v7 databases).
 */
export function spreadActivation(
  db: Database.Database,
  seedIds: readonly string[],
  opts: SpreadingOptions = {},
): ReadonlyMap<string, number> {
  const options = { ...DEFAULT_OPTIONS, ...opts };
  const activation = new Map<string, number>();
  const seedSet = new Set(seedIds);
  if (seedIds.length === 0) return activation;

  const hasRelations = Boolean(
    db
      .prepare(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name='memory_relations'",
      )
      .get(),
  );

  const hasCoaccess =
    options.includeCoAccess &&
    Boolean(
      db
        .prepare(
          "SELECT 1 FROM sqlite_master WHERE type='table' AND name='memory_coaccess'",
        )
        .get(),
    );

  if (!hasRelations && !hasCoaccess) return activation;

  let frontier = new Set(seedIds);

  for (let hop = 1; hop <= options.maxHops; hop++) {
    const decay = HOP_DECAY[hop] ?? HOP_DECAY[HOP_DECAY.length - 1];
    const nextFrontier = new Set<string>();

    if (frontier.size === 0) break;
    const frontierIds = [...frontier];

    // 1. Expand via explicit relations
    if (hasRelations) {
      try {
        const placeholders = frontierIds.map(() => '?').join(', ');

        // Outgoing edges (src -> dst)
        const outgoing = db
          .prepare(
            `SELECT dst_memory_id AS neighbor, relation_type
             FROM memory_relations
             WHERE src_memory_id IN (${placeholders})
             LIMIT ?`,
          )
          .all(...frontierIds, options.maxNeighborsPerHop * frontierIds.length) as readonly {
            neighbor: string;
            relation_type: string;
          }[];

        for (const row of outgoing) {
          if (seedSet.has(row.neighbor)) continue;
          const weight = (RELATION_WEIGHTS[row.relation_type] ?? 0.1) * decay;
          const current = activation.get(row.neighbor) ?? 0;
          activation.set(row.neighbor, current + weight);
          nextFrontier.add(row.neighbor);
        }

        // Incoming edges (dst -> src, reverse direction)
        const incoming = db
          .prepare(
            `SELECT src_memory_id AS neighbor, relation_type
             FROM memory_relations
             WHERE dst_memory_id IN (${placeholders})
             LIMIT ?`,
          )
          .all(...frontierIds, options.maxNeighborsPerHop * frontierIds.length) as readonly {
            neighbor: string;
            relation_type: string;
          }[];

        for (const row of incoming) {
          if (seedSet.has(row.neighbor)) continue;
          const weight = (RELATION_WEIGHTS[row.relation_type] ?? 0.1) * decay * 0.7;
          const current = activation.get(row.neighbor) ?? 0;
          activation.set(row.neighbor, current + weight);
          nextFrontier.add(row.neighbor);
        }
      } catch {
        // Non-fatal
      }
    }

    // 2. Expand via co-access edges
    if (hasCoaccess) {
      try {
        const placeholders = frontierIds.map(() => '?').join(', ');

        const coaccessRows = db
          .prepare(
            `SELECT memory_b_id AS neighbor, strength
             FROM memory_coaccess
             WHERE memory_a_id IN (${placeholders}) AND strength > 0.1
             UNION ALL
             SELECT memory_a_id AS neighbor, strength
             FROM memory_coaccess
             WHERE memory_b_id IN (${placeholders}) AND strength > 0.1
             ORDER BY strength DESC
             LIMIT ?`,
          )
          .all(
            ...frontierIds,
            ...frontierIds,
            options.maxNeighborsPerHop * frontierIds.length,
          ) as readonly { neighbor: string; strength: number }[];

        for (const row of coaccessRows) {
          if (seedSet.has(row.neighbor)) continue;
          const weight = row.strength * COACCESS_WEIGHT * decay;
          const current = activation.get(row.neighbor) ?? 0;
          activation.set(row.neighbor, current + weight);
          nextFrontier.add(row.neighbor);
        }
      } catch {
        // Non-fatal
      }
    }

    frontier = nextFrontier;
  }

  return activation;
}
