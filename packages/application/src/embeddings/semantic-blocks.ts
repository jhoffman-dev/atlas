import type { CachedBlock, CachedEmbeddings, CachedNote } from './ports.ts';

/** A note as the window holds it of the cache: its digest and title, and its blocks in order. */
export interface HeldNote extends CachedNote {
  readonly blocks: readonly CachedBlock[];
}

/** The blocks that have vectors, side by side, as a search ranks them. */
export interface RankableBlocks {
  readonly blocks: readonly CachedBlock[];
  readonly vectors: readonly Float32Array[];
}

/**
 * The window's copy of the embeddings cache: what a search ranks, and what
 * the build reuses vectors from, so a block whose digest is unchanged is
 * never sent to the model again. It changes only as the build writes the
 * cache, so the two never disagree.
 */
export interface SemanticBlocks {
  /** Each note held, by path, to the digest of the text it was cut from. */
  digests(): Map<string, string>;
  note(path: string): HeldNote | undefined;
  /** Every note's path, in no order. */
  paths(): string[];
  put(note: HeldNote): void;
  remove(path: string): void;
  /** Every block with a vector, in path order then each note's: the same cache, the same order. */
  rankable(): RankableBlocks;
}

const byCodeUnit = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0;

export function createSemanticBlocks(cached: CachedEmbeddings): SemanticBlocks {
  const notes = new Map<string, HeldNote>();
  const blocksOf = new Map<string, CachedBlock[]>();
  for (const block of cached.blocks) {
    const list = blocksOf.get(block.path) ?? [];
    list.push(block);
    blocksOf.set(block.path, list);
  }
  for (const note of cached.notes)
    notes.set(note.path, { ...note, blocks: blocksOf.get(note.path) ?? [] });

  // Worked out again only after a change: a search over an unchanged cache reuses it.
  let rankable: RankableBlocks | null = null;
  return {
    digests: () => new Map([...notes].map(([path, note]) => [path, note.digest])),
    note: (path) => notes.get(path),
    paths: () => [...notes.keys()],
    put(note) {
      notes.set(note.path, note);
      rankable = null;
    },
    remove(path) {
      if (notes.delete(path)) rankable = null;
    },
    rankable() {
      rankable ??= rankableOf(notes);
      return rankable;
    },
  };
}

function rankableOf(notes: ReadonlyMap<string, HeldNote>): RankableBlocks {
  const blocks: CachedBlock[] = [];
  const vectors: Float32Array[] = [];
  for (const path of [...notes.keys()].sort(byCodeUnit)) {
    for (const block of (notes.get(path) as HeldNote).blocks) {
      if (block.vector === null) continue;
      blocks.push(block);
      vectors.push(block.vector);
    }
  }
  return { blocks, vectors };
}
