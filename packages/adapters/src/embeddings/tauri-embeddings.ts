import { invoke } from '@tauri-apps/api/core';
import { EmbeddingError, type EmbeddingPort } from '@atlas/application';
import { throughHost } from '../vault/host-error.ts';

/**
 * Embedding through the host (`embeddings.rs`), which fetches, loads and runs
 * the model. This end only translates: the texts in, and the vectors back as
 * `Float32Array`s, the shape they are compared and stored in.
 */
export const tauriEmbeddings: EmbeddingPort = {
  async embed({ texts, purpose }) {
    const vectors = await throughHost(
      invoke<number[][]>('embed', { texts, purpose }),
      (message) => new EmbeddingError(message),
    );
    return vectors.map((vector) => Float32Array.from(vector));
  },
};
