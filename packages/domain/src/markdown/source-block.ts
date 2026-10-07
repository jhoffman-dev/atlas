import type { AnchorStyle } from './block-anchor.ts';
import type { EditorDocument } from './editor-node.ts';

/**
 * Where a block id is, or would go, in a block's bytes (P26-01): the bytes an
 * id there takes up — nothing, where there is none yet — and the id.
 */
export interface AnchorSlot {
  /** Offsets into the body, like the block's own. */
  readonly start: number;
  readonly end: number;
  readonly id: string | null;
  readonly style: AnchorStyle;
}

/** One top-level markdown block, and exactly where it came from in the file. */
export interface SourceBlock {
  readonly id: string;
  /** Position among the original blocks, used to tell whether two were adjacent. */
  readonly index: number;
  /** The block's exact bytes in the original body. */
  readonly source: string;
  readonly start: number;
  readonly end: number;
  /** What `source` looks like after a parse-and-serialize round trip. */
  readonly normalized: string;
  /**
   * Where each of the block's ids is or could go, in the order
   * `anchorPlaces` lists them; null when the two could not be matched up, and
   * a change to an id rewrites the block.
   */
  readonly anchors?: readonly AnchorSlot[] | null;
  /** `normalized` with every id taken out: what the block is apart from its ids. */
  readonly bare?: string;
}

export interface ParsedBody {
  readonly blocks: readonly SourceBlock[];
  readonly doc: EditorDocument;
}
