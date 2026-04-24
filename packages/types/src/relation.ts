export type RelationType =
  | 'updates'
  | 'extends'
  | 'derives'
  | 'contradicts'
  | 'supports'
  | 'duplicates'
  | 'uses'
  | 'prefers'
  | 'decided'
  | 'invalidates';

export interface MemoryRelation {
  readonly srcMemoryId: string;
  readonly dstMemoryId: string;
  readonly relationType: RelationType;
  readonly createdAt: string;
  readonly reason?: string;
}
