import { invoke } from '@tauri-apps/api/core';
import { EmbeddingError, type EmbeddingPort, type RefusedText } from '@atlas/application';

/** A refusal as `refusal.rs` sends it; `textIndex` and `reason` are null for a whole call. */
interface HostFailure {
  message: string;
  textIndex: number | null;
  reason: RefusedText['reason'] | null;
}

function isHostFailure(rejection: unknown): rejection is HostFailure {
  return (
    typeof rejection === 'object' &&
    rejection !== null &&
    typeof (rejection as { message?: unknown }).message === 'string'
  );
}

/** The host's refusal as an `EmbeddingError`, naming the text it was about. */
function embeddingError(rejection: unknown): Error {
  if (rejection instanceof Error) return rejection;
  if (!isHostFailure(rejection)) return new EmbeddingError(String(rejection));
  const { message, textIndex, reason } = rejection;
  const refused = textIndex !== null && reason !== null ? { textIndex, reason } : undefined;
  return new EmbeddingError(message, refused);
}

/**
 * Embedding through the host (`embeddings.rs`), which fetches, checks, loads
 * and runs the model. This end only translates: the texts in, the vectors
 * back as `Float32Array`s — the shape they are compared and stored in — and a
 * refusal as an `EmbeddingError` that says which text it was about.
 */
export const tauriEmbeddings: EmbeddingPort = {
  async embed({ texts, purpose }) {
    let vectors: number[][];
    try {
      vectors = await invoke<number[][]>('embed', { texts, purpose });
    } catch (rejection) {
      throw embeddingError(rejection);
    }
    return vectors.map((vector) => Float32Array.from(vector));
  },
};
