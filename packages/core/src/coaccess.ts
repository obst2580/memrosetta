/**
 * Hebbian co-access tracking.
 *
 * When multiple memories appear together in a search result set, they
 * are implicitly "co-activated" — analogous to neurons firing together.
 * Over time, frequently co-accessed pairs build up strength, creating
 * an implicit associative graph on top of the sparse explicit relation
 * graph.
 *
 * The memory_coaccess table stores pair-wise co-access counts with a
 * strength score that can decay during maintenance.
 */

import type Database from 'better-sqlite3';

/**
 * Record co-access for a set of memory ids that appeared together in
 * a search result. Generates all unique pairs (canonical order a < b)
 * and upserts into memory_coaccess.
 *
 * Called after search() returns — only the top-K result ids are passed
 * so we don't flood the table with low-relevance co-occurrences.
 *
 * Gracefully no-ops if the memory_coaccess table does not exist (e.g.
 * pre-v7 database that has not been upgraded yet).
 */
export function recordCoAccess(
  db: Database.Database,
  memoryIds: readonly string[],
  maxPairs: number = 10,
): void {
  if (memoryIds.length < 2) return;

  try {
    const hasTable = db
      .prepare(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name='memory_coaccess'",
      )
      .get();
    if (!hasTable) return;

    const now = new Date().toISOString();
    const ids = memoryIds.slice(0, maxPairs);
    const pairs: Array<[string, string]> = [];

    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const [a, b] = ids[i] < ids[j] ? [ids[i], ids[j]] : [ids[j], ids[i]];
        pairs.push([a, b]);
      }
    }

    if (pairs.length === 0) return;

    const upsert = db.prepare(`
      INSERT INTO memory_coaccess (memory_a_id, memory_b_id, co_access_count, last_co_accessed_at, strength)
      VALUES (?, ?, 1, ?, 1.0)
      ON CONFLICT(memory_a_id, memory_b_id) DO UPDATE SET
        co_access_count = co_access_count + 1,
        last_co_accessed_at = excluded.last_co_accessed_at,
        strength = MIN(strength + 0.1, 5.0)
    `);

    const run = db.transaction(() => {
      for (const [a, b] of pairs) {
        upsert.run(a, b, now);
      }
    });

    run();
  } catch {
    // Non-fatal: co-access tracking is best-effort
  }
}

/**
 * Get the strongest co-access neighbors for a set of memory ids.
 * Used by the search ranker to boost co-accessed memories.
 *
 * Returns a Map<memoryId, totalStrength> aggregated across all seed ids.
 */
export function getCoAccessNeighbors(
  db: Database.Database,
  seedIds: readonly string[],
  limit: number = 20,
): ReadonlyMap<string, number> {
  const result = new Map<string, number>();
  if (seedIds.length === 0) return result;

  try {
    const hasTable = db
      .prepare(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name='memory_coaccess'",
      )
      .get();
    if (!hasTable) return result;

    const placeholders = seedIds.map(() => '?').join(', ');

    const rows = db
      .prepare(
        `SELECT memory_b_id AS neighbor, SUM(strength) AS total_strength
         FROM memory_coaccess
         WHERE memory_a_id IN (${placeholders})
         GROUP BY memory_b_id
         UNION ALL
         SELECT memory_a_id AS neighbor, SUM(strength) AS total_strength
         FROM memory_coaccess
         WHERE memory_b_id IN (${placeholders})
         GROUP BY memory_a_id
         ORDER BY total_strength DESC
         LIMIT ?`,
      )
      .all(...seedIds, ...seedIds, limit) as readonly {
        neighbor: string;
        total_strength: number;
      }[];

    for (const row of rows) {
      if (seedIds.includes(row.neighbor)) continue;
      const existing = result.get(row.neighbor) ?? 0;
      result.set(row.neighbor, existing + row.total_strength);
    }
  } catch {
    // Non-fatal
  }

  return result;
}

/**
 * Decay co-access strength for entries not accessed recently.
 * Called during `memrosetta maintain`.
 */
export function decayCoAccess(
  db: Database.Database,
  decayFactor: number = 0.95,
  minStrength: number = 0.1,
): { decayed: number; pruned: number } {
  try {
    const hasTable = db
      .prepare(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name='memory_coaccess'",
      )
      .get();
    if (!hasTable) return { decayed: 0, pruned: 0 };

    const decayed = db
      .prepare(
        `UPDATE memory_coaccess SET strength = strength * ?
         WHERE strength > ?`,
      )
      .run(decayFactor, minStrength).changes;

    const pruned = db
      .prepare(`DELETE FROM memory_coaccess WHERE strength <= ?`)
      .run(minStrength).changes;

    return { decayed, pruned };
  } catch {
    return { decayed: 0, pruned: 0 };
  }
}
