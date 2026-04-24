import type Database from 'better-sqlite3';
import type { MemoryRelation, RelationType } from '@memrosetta/types';
import { MemoryNotFoundError } from './errors.js';
import { nowIso } from './utils.js';

export interface RelationStatements {
  readonly insertRelation: Database.Statement;
  readonly updateIsLatest: Database.Statement;
  readonly checkMemoryExists: Database.Statement;
  readonly getRelationsByMemory: Database.Statement;
}

export interface DeterministicRelationInference {
  readonly relationType: RelationType;
  readonly reason: string;
}

const DETERMINISTIC_RELATION_RULES: readonly {
  readonly relationType: RelationType;
  readonly label: string;
  readonly patterns: readonly RegExp[];
}[] = [
  {
    relationType: 'invalidates',
    label: 'invalidates',
    patterns: [
      /\b(invalidates?|replaces?|supersedes?|deprecates?|cancels?|cancelled|canceled|retires?|removes?|drops?)\b/u,
      /\bno longer\b/u,
      /(무효|폐기|취소|대체|철회|더 이상|사용하지 않|중단)/u,
    ],
  },
  {
    relationType: 'decided',
    label: 'decided',
    patterns: [
      /\b(decided|decision|settled on|chose|chosen|adopted|agreed to|we will|will use)\b/u,
      /(결정|하기로|채택|합의|정했다|정함)/u,
    ],
  },
  {
    relationType: 'prefers',
    label: 'prefers',
    patterns: [
      /\b(prefers?|preferred|favor(?:s|ed)?|rather than|default to)\b/u,
      /(선호|우선|prefer)/u,
    ],
  },
  {
    relationType: 'uses',
    label: 'uses',
    patterns: [
      /\b(uses?|using|built with|powered by|depends on|integrates? with|based on|leverages?)\b/u,
      /(사용|활용|쓴다|쓰고|기반|연동|의존)/u,
    ],
  },
];

export function inferDeterministicRelation(
  content: string,
): DeterministicRelationInference | null {
  const normalized = content.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
  const rule = DETERMINISTIC_RELATION_RULES.find((candidate) =>
    candidate.patterns.some((pattern) => pattern.test(normalized)),
  );
  if (!rule) return null;
  return {
    relationType: rule.relationType,
    reason: `Auto: deterministic ${rule.label} verb pattern`,
  };
}

export function createRelationStatements(db: Database.Database): RelationStatements {
  return {
    insertRelation: db.prepare(`
      INSERT INTO memory_relations (src_memory_id, dst_memory_id, relation_type, created_at, reason)
      VALUES (?, ?, ?, ?, ?)
    `),
    updateIsLatest: db.prepare(
      'UPDATE memories SET is_latest = ? WHERE memory_id = ?'
    ),
    checkMemoryExists: db.prepare(
      'SELECT memory_id FROM memories WHERE memory_id = ?'
    ),
    getRelationsByMemory: db.prepare(
      'SELECT * FROM memory_relations WHERE src_memory_id = ? OR dst_memory_id = ?'
    ),
  };
}

export function createRelation(
  db: Database.Database,
  stmts: RelationStatements,
  srcMemoryId: string,
  dstMemoryId: string,
  relationType: RelationType,
  reason?: string,
): MemoryRelation {
  // Verify both memories exist
  const srcExists = stmts.checkMemoryExists.get(srcMemoryId);
  if (!srcExists) {
    throw new MemoryNotFoundError(srcMemoryId);
  }
  const dstExists = stmts.checkMemoryExists.get(dstMemoryId);
  if (!dstExists) {
    throw new MemoryNotFoundError(dstMemoryId);
  }

  const createdAt = nowIso();

  stmts.insertRelation.run(
    srcMemoryId,
    dstMemoryId,
    relationType,
    createdAt,
    reason ?? null,
  );

  // For 'updates' relations, mark the destination as no longer latest
  if (relationType === 'updates') {
    stmts.updateIsLatest.run(0, dstMemoryId);
  }

  return {
    srcMemoryId,
    dstMemoryId,
    relationType,
    createdAt,
    reason,
  };
}

interface RelationRow {
  readonly src_memory_id: string;
  readonly dst_memory_id: string;
  readonly relation_type: string;
  readonly created_at: string;
  readonly reason: string | null;
}

export function getRelationsByMemory(
  stmts: RelationStatements,
  memoryId: string,
): readonly MemoryRelation[] {
  const rows = stmts.getRelationsByMemory.all(memoryId, memoryId) as readonly RelationRow[];
  return rows.map((row) => ({
    srcMemoryId: row.src_memory_id,
    dstMemoryId: row.dst_memory_id,
    relationType: row.relation_type as RelationType,
    createdAt: row.created_at,
    reason: row.reason ?? undefined,
  }));
}
