import { invoke } from '@tauri-apps/api/core';
import type {
  CachedBlock,
  CachedEmbeddings,
  CachedNote,
  EmbeddingCachePort,
} from '@dfai/application';
import { throughHost } from '../vault/host-error.ts';

/** A block as `embedding_cache_load` lists it, before its vector is matched up. */
interface LoadedBlock extends Omit<CachedBlock, 'vector'> {
  readonly embedded: boolean;
}

interface LoadedHeader {
  readonly notes: readonly CachedNote[];
  readonly blocks: readonly LoadedBlock[];
}

const asError = (message: string) => new Error(`The embeddings cache: ${message}`);

/**
 * Reads the load's bytes (`embedding_cache.rs`): a little-endian u32 giving
 * the length of a JSON header, the header, then the vectors of the blocks
 * it marks embedded, in its order, as little-endian f32s. Every vector is
 * one length, so the rest is cut evenly among them; each is a view over the
 * one copy of the bytes, not a copy of its own.
 */
export function readCacheLoad(bytes: ArrayBuffer): CachedEmbeddings {
  const view = new DataView(bytes);
  const length = view.getUint32(0, true);
  const header = JSON.parse(
    new TextDecoder().decode(new Uint8Array(bytes, 4, length)),
  ) as LoadedHeader;
  const embedded = header.blocks.filter((block) => block.embedded).length;
  const start = 4 + length;
  const floats = (bytes.byteLength - start) / 4;
  if (embedded === 0 ? floats !== 0 : !Number.isInteger(floats / embedded)) {
    throw asError(`${floats} numbers cannot be ${embedded} vectors of one length`);
  }
  const dimensions = embedded === 0 ? 0 : floats / embedded;
  // A Float32Array must start on a multiple of 4, and the header is any length: copied once when not.
  const numbers =
    start % 4 === 0 ? new Float32Array(bytes, start) : new Float32Array(bytes.slice(start));
  let next = 0;
  const blocks = header.blocks.map(({ embedded: has, ...block }): CachedBlock => {
    if (!has) return { ...block, vector: null };
    const vector = numbers.subarray(next * dimensions, (next + 1) * dimensions);
    next += 1;
    return { ...block, vector };
  });
  return { notes: header.notes, blocks };
}

/**
 * The embeddings cache through the host (`embedding_cache.rs`), which keeps
 * it in `.atlas-cache/embeddings.sqlite`. This end only translates: vectors
 * go as plain numbers and come back as bytes.
 */
export const tauriEmbeddingCache: EmbeddingCachePort = {
  async open({ generation }) {
    return throughHost(invoke<{ fresh: boolean }>('embedding_cache_open', { generation }), asError);
  },
  async clear() {
    await throughHost(invoke('embedding_cache_clear'), asError);
  },
  async load() {
    return readCacheLoad(await throughHost(invoke<ArrayBuffer>('embedding_cache_load'), asError));
  },
  async excerpts(keys) {
    return throughHost(invoke<string[]>('embedding_cache_excerpts', { keys }), asError);
  },
  async put(notes, { vault }) {
    const sent = notes.map((note) => ({
      ...note,
      blocks: note.blocks.map((block) => ({
        ...block,
        vector: block.vector === null ? null : Array.from(block.vector),
      })),
    }));
    await throughHost(invoke('embedding_cache_put', { vault, notes: sent }), asError);
  },
  async remove(paths, { vault }) {
    await throughHost(invoke('embedding_cache_remove', { vault, paths }), asError);
  },
};
