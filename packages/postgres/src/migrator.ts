import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Pool } from 'pg';

const MIGRATIONS_TABLE = 'schema_version';

/**
 * Minimal migration runner.
 *
 * Scans the migrations/ directory for .sql files, sorts them
 * lexicographically, and executes each one that has not yet been
 * applied. Applied migrations are tracked in a `schema_version`
 * table inside the target database.
 */
export class Migrator {
  private readonly pool: Pool;
  private readonly migrationsDir: string;

  constructor(pool: Pool, migrationsDir: string) {
    this.pool = pool;
    this.migrationsDir = migrationsDir;
  }

  async migrate(): Promise<readonly string[]> {
    await this.ensureVersionTable();

    const applied = await this.getAppliedVersions();
    const pending = await this.getPendingFiles(applied);

    const results: string[] = [];

    for (const file of pending) {
      const sql = await readFile(join(this.migrationsDir, file), 'utf-8');
      const client = await this.pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(sql);
        await client.query(
          `INSERT INTO ${MIGRATIONS_TABLE} (version, applied_at) VALUES ($1, NOW())`,
          [file],
        );
        await client.query('COMMIT');
        results.push(file);
      } catch (err) {
        await client.query('ROLLBACK');
        throw new Error(`Migration ${file} failed: ${err instanceof Error ? err.message : String(err)}`);
      } finally {
        client.release();
      }
    }

    return results;
  }

  private async ensureVersionTable(): Promise<void> {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS ${MIGRATIONS_TABLE} (
        version     TEXT PRIMARY KEY,
        applied_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
  }

  private async getAppliedVersions(): Promise<ReadonlySet<string>> {
    const { rows } = await this.pool.query<{ version: string }>(
      `SELECT version FROM ${MIGRATIONS_TABLE} ORDER BY version`,
    );
    return new Set(rows.map((r) => r.version));
  }

  private async getPendingFiles(
    applied: ReadonlySet<string>,
  ): Promise<readonly string[]> {
    const entries = await readdir(this.migrationsDir);
    return entries
      .filter((f) => f.endsWith('.sql') && !applied.has(f))
      .sort();
  }
}
