import type { Memory, MemoryType, MemoryState, SourceAttestation } from './memory.js';

export interface SearchCurrentContext {
  readonly namespace?: string;
  readonly project?: string;
  readonly episodeId?: string;
  readonly keywords?: readonly string[];
  readonly timeBucket?: string;
}

export interface SearchQuery {
  readonly userId: string;
  readonly query: string;
  readonly namespace?: string;
  readonly limit?: number;
  readonly filters?: SearchFilters;
  readonly includeSource?: boolean;
  readonly currentContext?: SearchCurrentContext;
}

export interface SearchFilters {
  readonly memoryTypes?: readonly MemoryType[];
  readonly dateRange?: {
    readonly start?: string;
    readonly end?: string;
  };
  readonly minConfidence?: number;
  readonly onlyLatest?: boolean;
  readonly eventDateRange?: {
    readonly start?: string;
    readonly end?: string;
  };
  /** When true (default), exclude memories that have been invalidated */
  readonly excludeInvalidated?: boolean;
  /**
   * Filter by derived memory state. When set, supersedes onlyLatest and excludeInvalidated.
   * Possible values: 'current', 'superseded', 'invalidated'.
   * Default (when not specified): falls back to onlyLatest + excludeInvalidated behavior.
   */
  readonly states?: readonly MemoryState[];
}

export type MatchType = 'fts' | 'vector' | 'hybrid';

export interface SearchResult {
  readonly memory: Memory;
  readonly score: number;
  readonly matchType: MatchType;
  readonly sources?: readonly SourceAttestation[];
}

export interface SearchResponse {
  readonly results: readonly SearchResult[];
  readonly totalCount: number;
  readonly queryTimeMs: number;
}
