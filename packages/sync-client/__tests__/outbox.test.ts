import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { Outbox } from '../src/outbox.js';
import { ensureSyncSchema } from '../src/schema.js';
import type { SyncOp } from '../src/types.js';

function createTestOp(overrides?: Partial<SyncOp>): SyncOp {
  return {
    opId: `op-${Math.random().toString(36).slice(2, 8)}`,
    opType: 'memory_created',
    deviceId: 'device-1',
    userId: 'user-1',
    payload: { content: 'test' },
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('Outbox', () => {
  let db: Database.Database;
  let outbox: Outbox;

  beforeEach(() => {
    db = new Database(':memory:');
    ensureSyncSchema(db);
    outbox = new Outbox(db);
  });

  it('addOp inserts an op into the outbox', () => {
    const op = createTestOp({ opId: 'op-1' });
    outbox.addOp(op);

    const rows = db.prepare('SELECT * FROM sync_outbox').all();
    expect(rows).toHaveLength(1);
    expect((rows[0] as { op_id: string }).op_id).toBe('op-1');
  });

  it('getPending returns only unpushed ops', () => {
    outbox.addOp(createTestOp({ opId: 'op-1' }));
    outbox.addOp(createTestOp({ opId: 'op-2' }));
    outbox.addOp(createTestOp({ opId: 'op-3' }));

    // Simulate op-3 being pushed
    outbox.markPushed(['op-3']);

    const pending = outbox.getPending();
    expect(pending).toHaveLength(2);
    expect(pending.map((p) => p.opId)).toEqual(['op-1', 'op-2']);
  });

  it('getPending returns ops ordered by created_at', () => {
    outbox.addOp(createTestOp({ opId: 'op-b', createdAt: '2025-01-02T00:00:00Z' }));
    outbox.addOp(createTestOp({ opId: 'op-a', createdAt: '2025-01-01T00:00:00Z' }));
    outbox.addOp(createTestOp({ opId: 'op-c', createdAt: '2025-01-03T00:00:00Z' }));

    const pending = outbox.getPending();
    expect(pending.map((p) => p.opId)).toEqual(['op-a', 'op-b', 'op-c']);
  });

  it('markPushed updates pushed_at for given op IDs', () => {
    outbox.addOp(createTestOp({ opId: 'op-1' }));
    outbox.addOp(createTestOp({ opId: 'op-2' }));
    outbox.addOp(createTestOp({ opId: 'op-3' }));

    outbox.markPushed(['op-1', 'op-3']);

    const pending = outbox.getPending();
    expect(pending).toHaveLength(1);
    expect(pending[0].opId).toBe('op-2');
  });

  it('markPushed with empty array does nothing', () => {
    outbox.addOp(createTestOp({ opId: 'op-1' }));
    outbox.markPushed([]);

    const pending = outbox.getPending();
    expect(pending).toHaveLength(1);
  });

  it('getPending(userId) filters to a single user', () => {
    outbox.addOp(createTestOp({ opId: 'op-canonical-1', userId: 'obst' }));
    outbox.addOp(createTestOp({ opId: 'op-legacy-1', userId: 'work/tech-manage-api' }));
    outbox.addOp(createTestOp({ opId: 'op-canonical-2', userId: 'obst' }));
    outbox.addOp(createTestOp({ opId: 'op-legacy-2', userId: 'personal/memrosetta' }));

    const canonical = outbox.getPending('obst');
    expect(canonical.map((p) => p.opId).sort()).toEqual(['op-canonical-1', 'op-canonical-2']);

    const legacy = outbox.getPending('work/tech-manage-api');
    expect(legacy.map((p) => p.opId)).toEqual(['op-legacy-1']);

    // Unfiltered still sees everything.
    expect(outbox.getPending()).toHaveLength(4);
  });

  it('countPending(userId) matches getPending(userId)', () => {
    outbox.addOp(createTestOp({ opId: 'op-1', userId: 'obst' }));
    outbox.addOp(createTestOp({ opId: 'op-2', userId: 'obst' }));
    outbox.addOp(createTestOp({ opId: 'op-3', userId: 'general' }));

    expect(outbox.countPending('obst')).toBe(2);
    expect(outbox.countPending('general')).toBe(1);
    expect(outbox.countPending('no-such-user')).toBe(0);
    expect(outbox.countPending()).toBe(3);
  });
});
