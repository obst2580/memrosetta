export type RelationType = 'updates' | 'extends' | 'derives' | 'contradicts' | 'supports';

export interface MemoryRelation {
  readonly srcMemoryId: string;
  readonly dstMemoryId: string;
  readonly relationType: RelationType;
  readonly createdAt: string;
  readonly reason?: string;
}
