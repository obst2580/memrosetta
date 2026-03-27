import type { Memory, MemoryType, MemoryState } from './memory.js';

export interface SearchQuery {
  readonly userId: string;
  readonly query: string;
  readonly namespace?: string;
  readonly limit?: number;
  readonly filters?: SearchFilters;
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
}

export interface SearchResponse {
  readonly results: readonly SearchResult[];
  readonly totalCount: number;
  readonly queryTimeMs: number;
}
