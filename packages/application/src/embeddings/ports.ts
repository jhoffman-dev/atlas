/**
 * What a text is for. The model reads a question with a prefix it was trained
 * on and a passage without one, so the two must be asked for differently.
 */
export type EmbeddingPurpose = 'query' | 'passage';

/**
 * Turning text into vectors, with the small model the host runs on this Mac
 * (ADR-0031). The host only runs the model: which blocks are embedded, how a
 * note is cut into them and what counts as related are decided on this side.
 */
export interface EmbeddingPort {
  /**
   * One vector per text, in the order sent, each of unit length — so how alike
   * two texts are is the dot product of their vectors. The first call on a Mac
   * waits for the model to be fetched (91 MB); later calls after a launch wait
   * only for it to load.
   *
   * Rejects with `EmbeddingError` when the host will not take the call: more
   * texts or bytes than it takes at once, a text longer than the model reads
   * (the message names which), or a model it cannot fetch or load.
   */
  embed(args: {
    texts: readonly string[];
    purpose: EmbeddingPurpose;
  }): Promise<readonly Float32Array[]>;
}

/** A refusal from the host while embedding. */
export class EmbeddingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EmbeddingError';
  }
}
