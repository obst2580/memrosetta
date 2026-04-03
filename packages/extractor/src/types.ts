export interface FactDecomposer {
  /** Decompose text into atomic facts */
  decompose(text: string): Promise<readonly string[]>;

  /** Decompose with title/section context (Propositionizer format) */
  decomposeWithContext(
    content: string,
    title?: string,
    section?: string,
  ): Promise<readonly string[]>;
}

export interface PropositionizerOptions {
  /** HuggingFace model ID or local path */
  readonly model?: string;
  /** Maximum length of generated output */
  readonly maxLength?: number;
  /** Number of beams for beam search */
  readonly numBeams?: number;
}
