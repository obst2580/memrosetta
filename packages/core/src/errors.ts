/**
 * Thrown when a memory ID referenced in an operation does not exist.
 */
export class MemoryNotFoundError extends Error {
  readonly memoryId: string;

  constructor(memoryId: string) {
    super(`Memory not found: ${memoryId}`);
    this.name = 'MemoryNotFoundError';
    this.memoryId = memoryId;
  }
}
