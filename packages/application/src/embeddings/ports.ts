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
   * waits for the model to be fetched (91 MB); the first call after each
   * launch waits for it to be checked and loaded.
   *
   * Rejects with `EmbeddingError` when the host will not take the call: more
   * texts or bytes than it takes at once, a model it cannot fetch or load, or
   * one text it cannot read whole — which the error names (ADR-0031).
   */
  embed(args: {
    texts: readonly string[];
    purpose: EmbeddingPurpose;
  }): Promise<readonly Float32Array[]>;
}

/**
 * Why the host refused one text. `too-long`: more tokens than the model reads,
 * so split it. `nothing-readable`: nothing but whitespace, control or
 * zero-width characters, emoji, or a script the model lacks. `unreadable-run`:
 * a long stretch the model would read as one unknown word, such as an unspaced
 * script or a pasted blob of data.
 */
export type EmbeddingRefusalReason = 'too-long' | 'nothing-readable' | 'unreadable-run';

/** The text a refusal is about: its position in the call, from 0, and why. */
export interface RefusedText {
  readonly textIndex: number;
  readonly reason: EmbeddingRefusalReason;
}

/**
 * A refusal from the host while embedding. `refused` is set when one text
 * was the cause, and absent when the call as a whole was refused or failed.
 */
export class EmbeddingError extends Error {
  readonly refused: RefusedText | undefined;

  constructor(message: string, refused?: RefusedText) {
    super(message);
    this.name = 'EmbeddingError';
    this.refused = refused;
  }
}
