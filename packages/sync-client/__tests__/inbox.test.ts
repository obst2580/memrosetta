import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { Inbox } from '../src/inbox.js';
import { ensureSyncSchema } from '../src/schema.js';
import type { SyncPulledOp } from '../src/types.js';

function createTestPulledOp(overrides?: Partial<SyncPulledOp>): SyncPulledOp {
  return {
    opId: `op-${Math.random().toString(36).slice(2, 8)}`,
    opType: 'store_memory',
    deviceId: 'device-2',
    userId: 'user-1',
    payload: JSON.stringify({ content: 'pulled' }),
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('Inbox', () => {
  let db: Database.Database;
  let inbox: Inbox;

  beforeEach(() => {
    db = new Database(':memory:');
    ensureSyncSchema(db);
    inbox = new Inbox(db);
  });

  it('addOps inserts ops into the inbox', () => {
    const ops = [
      createTestPulledOp({ opId: 'op-1' }),
      createTestPulledOp({ opId: 'op-2' }),
    ];
    inbox.addOps(ops);

    const rows = db.prepare('SELECT * FROM sync_inbox').all();
    expect(rows).toHaveLength(2);
  });

  it('addOps ignores duplicate op_ids', () => {
    const op = createTestPulledOp({ opId: 'op-dup' });
    inbox.addOps([op]);
    inbox.addOps([op]);

    const rows = db.prepare('SELECT * FROM sync_inbox').all();
    expect(rows).toHaveLength(1);
  });

  it('addOps with empty array does nothing', () => {
    inbox.addOps([]);

    const rows = db.prepare('SELECT * FROM sync_inbox').all();
    expect(rows).toHaveLength(0);
  });

  it('getPending returns only unapplied ops', () => {
    inbox.addOps([
      createTestPulledOp({ opId: 'op-1' }),
      createTestPulledOp({ opId: 'op-2' }),
    ]);

    // Manually mark one as applied
    db.prepare("UPDATE sync_inbox SET applied_at = ? WHERE op_id = ?")
      .run(new Date().toISOString(), 'op-1');

    const pending = inbox.getPending();
    expect(pending).toHaveLength(1);
    expect(pending[0].opId).toBe('op-2');
  });

  it('getPending returns ops ordered by created_at', () => {
    inbox.addOps([
      createTestPulledOp({ opId: 'op-b', createdAt: '2025-01-02T00:00:00Z' }),
      createTestPulledOp({ opId: 'op-a', createdAt: '2025-01-01T00:00:00Z' }),
      createTestPulledOp({ opId: 'op-c', createdAt: '2025-01-03T00:00:00Z' }),
    ]);

    const pending = inbox.getPending();
    expect(pending.map((p) => p.opId)).toEqual(['op-a', 'op-b', 'op-c']);
  });

  it('markApplied updates applied_at for given op IDs', () => {
    inbox.addOps([
      createTestPulledOp({ opId: 'op-1' }),
      createTestPulledOp({ opId: 'op-2' }),
      createTestPulledOp({ opId: 'op-3' }),
    ]);

    inbox.markApplied(['op-1', 'op-3']);

    const pending = inbox.getPending();
    expect(pending).toHaveLength(1);
    expect(pending[0].opId).toBe('op-2');
  });

  it('markApplied with empty array does nothing', () => {
    inbox.addOps([createTestPulledOp({ opId: 'op-1' })]);
    inbox.markApplied([]);

    const pending = inbox.getPending();
    expect(pending).toHaveLength(1);
  });
});
