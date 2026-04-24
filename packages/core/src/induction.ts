import type Database from 'better-sqlite3';
import type { Memory } from '@memrosetta/types';
import { createRelation, type RelationStatements } from './relations.js';
import { storeMemory, type PreparedStatements } from './store.js';

const DEFAULT_MIN_CLUSTER_SIZE = 5;
const DEFAULT_AGREEMENT_THRESHOLD = 0.8;
const DEFAULT_MAX_PROTOTYPES = 5;

interface CandidateRow {
  readonly memory_id: string;
  readonly content: string;
  readonly keywords: string | null;
}

interface VerbObjectPattern {
  readonly verb: string;
  readonly object: string;
}

export interface PrototypeCandidate {
  readonly keyword: string;
  readonly verb: string;
  readonly object: string;
  readonly sourceMemoryIds: readonly string[];
  readonly clusterSignature: string;
  readonly content: string;
}

export interface PrototypeInductionOptions {
  readonly userId: string;
  readonly minClusterSize?: number;
  readonly agreementThreshold?: number;
  readonly maxPrototypes?: number;
}

export interface PrototypeInductionResult {
  readonly candidates: number;
  readonly created: readonly Memory[];
  readonly relationsCreated: number;
  readonly skippedDuplicates: number;
}

function parseKeywords(value: string | null): readonly string[] {
  return (value ?? '')
    .split(/\s+/)
    .map((keyword) => keyword.trim().toLowerCase())
    .filter(Boolean);
}

function normalizeToken(value: string): string {
  return value.normalize('NFKC').toLowerCase().replace(/[^a-z0-9가-힣._/-]/gi, '');
}

function normalizeVerb(value: string): string {
  const verb = value.toLowerCase();
  if (/^pref/.test(verb) || verb === '선호') return 'prefer';
  if (/^(use|using|uses|used)$/.test(verb) || verb === '사용' || verb === '활용') return 'use';
  if (/^(decide|decided|choose|chose|chosen|adopt|adopted)$/.test(verb) || verb === '결정' || verb === '채택') {
    return 'decide';
  }
  if (/^avoid/.test(verb)) return 'avoid';
  return verb;
}

function extractEnglishPattern(content: string): VerbObjectPattern | null {
  const normalized = content.normalize('NFKC').toLowerCase();
  const match = normalized.match(
    /\b(prefer(?:s|red)?|uses?|using|used|decided|decide|choose|chose|chosen|adopt(?:s|ed)?|avoid(?:s|ed)?)\s+(.+)$/u,
  );
  if (!match) return null;
  const verb = normalizeVerb(match[1]);
  const objectTokens = match[2]
    .split(/\s+/)
    .map(normalizeToken)
    .filter(Boolean);
  const stopAt = objectTokens.findIndex((token) =>
    ['for', 'because', 'when', 'while', 'with', 'instead', 'rather', 'in', 'on', 'to'].includes(token) ||
    /^\d+$/.test(token),
  );
  const object = objectTokens
    .slice(0, stopAt >= 0 ? stopAt : 4)
    .slice(0, 4)
    .join(' ');
  if (!object) return null;
  return { verb, object };
}

function extractKoreanPattern(content: string): VerbObjectPattern | null {
  const normalized = content.normalize('NFKC').toLowerCase();
  const match = normalized.match(/([a-z0-9가-힣._/-]+(?:\s+[a-z0-9가-힣._/-]+){0,3}).*(선호|사용|활용|결정|채택)/u);
  if (!match) return null;
  return {
    verb: normalizeVerb(match[2]),
    object: match[1].split(/\s+/).map(normalizeToken).filter(Boolean).join(' '),
  };
}

export function extractVerbObjectPattern(content: string): VerbObjectPattern | null {
  return extractEnglishPattern(content) ?? extractKoreanPattern(content);
}

function clusterSignature(keyword: string, pattern: VerbObjectPattern): string {
  return `prototype:${keyword}:${pattern.verb}:${pattern.object}`;
}

function prototypeContent(keyword: string, pattern: VerbObjectPattern): string {
  return `Prototype: For ${keyword}, user tends to ${pattern.verb} ${pattern.object}.`;
}

function loadCandidateRows(db: Database.Database, userId: string): readonly CandidateRow[] {
  return db
    .prepare(
      `SELECT memory_id, content, keywords
         FROM memories
        WHERE user_id = ?
          AND memory_type IN ('preference', 'decision')
          AND is_latest = 1
          AND invalidated_at IS NULL
          AND COALESCE(source_id, '') != 'induction'
        ORDER BY learned_at ASC`,
    )
    .all(userId) as readonly CandidateRow[];
}

export function findPrototypeCandidates(
  db: Database.Database,
  options: PrototypeInductionOptions,
): readonly PrototypeCandidate[] {
  const minClusterSize = Math.max(2, Math.floor(options.minClusterSize ?? DEFAULT_MIN_CLUSTER_SIZE));
  const agreementThreshold = Math.max(
    0.5,
    Math.min(1, options.agreementThreshold ?? DEFAULT_AGREEMENT_THRESHOLD),
  );
  const rows = loadCandidateRows(db, options.userId);
  const byKeyword = new Map<string, CandidateRow[]>();

  for (const row of rows) {
    for (const keyword of parseKeywords(row.keywords)) {
      const bucket = byKeyword.get(keyword) ?? [];
      bucket.push(row);
      byKeyword.set(keyword, bucket);
    }
  }

  const candidates: PrototypeCandidate[] = [];
  for (const [keyword, cluster] of byKeyword.entries()) {
    if (cluster.length < minClusterSize) continue;
    const patterns = new Map<string, { readonly pattern: VerbObjectPattern; readonly rows: CandidateRow[] }>();
    for (const row of cluster) {
      const pattern = extractVerbObjectPattern(row.content);
      if (!pattern) continue;
      const key = `${pattern.verb}:${pattern.object}`;
      const existing = patterns.get(key);
      patterns.set(key, {
        pattern,
        rows: [...(existing?.rows ?? []), row],
      });
    }

    const dominant = [...patterns.values()]
      .sort((a, b) => b.rows.length - a.rows.length || a.pattern.object.localeCompare(b.pattern.object))[0];
    if (!dominant) continue;
    if (dominant.rows.length < Math.ceil(cluster.length * agreementThreshold)) continue;

    candidates.push({
      keyword,
      verb: dominant.pattern.verb,
      object: dominant.pattern.object,
      sourceMemoryIds: dominant.rows.map((row) => row.memory_id),
      clusterSignature: clusterSignature(keyword, dominant.pattern),
      content: prototypeContent(keyword, dominant.pattern),
    });
  }

  return candidates.sort((a, b) => a.clusterSignature.localeCompare(b.clusterSignature));
}

function hasExistingPrototype(db: Database.Database, signature: string): boolean {
  const row = db
    .prepare(
      `SELECT 1
         FROM source_attestations
        WHERE source_kind = 'induction'
          AND source_ref = ?
        LIMIT 1`,
    )
    .get(signature);
  return Boolean(row);
}

export function runPrototypeInduction(
  db: Database.Database,
  storeStmts: PreparedStatements,
  relationStmts: RelationStatements,
  options: PrototypeInductionOptions,
): PrototypeInductionResult {
  const maxPrototypes = Math.max(1, Math.floor(options.maxPrototypes ?? DEFAULT_MAX_PROTOTYPES));
  const candidates = findPrototypeCandidates(db, options);
  const created: Memory[] = [];
  let relationsCreated = 0;
  let skippedDuplicates = 0;

  for (const candidate of candidates) {
    if (created.length >= maxPrototypes) break;
    if (hasExistingPrototype(db, candidate.clusterSignature)) {
      skippedDuplicates += 1;
      continue;
    }

    const prototype = storeMemory(db, storeStmts, {
      userId: options.userId,
      memoryType: 'preference',
      content: candidate.content,
      keywords: [candidate.keyword, ...candidate.object.split(/\s+/)],
      salience: 0.7,
      sourceId: 'induction',
      sources: [{ sourceKind: 'induction', sourceRef: candidate.clusterSignature }],
    });
    created.push(prototype);

    for (const sourceMemoryId of candidate.sourceMemoryIds) {
      try {
        createRelation(
          db,
          relationStmts,
          prototype.memoryId,
          sourceMemoryId,
          'derives',
          'induction_prototype',
        );
        relationsCreated += 1;
      } catch {
        // Duplicate relation or concurrent deletion should not abort the whole cluster.
      }
    }
  }

  return {
    candidates: candidates.length,
    created,
    relationsCreated,
    skippedDuplicates,
  };
}
