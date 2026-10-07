import type { NodePath, NoteSuggestion, OutlineEntry, VaultPath } from '@atlas/domain';

/**
 * What the `[[` and `![[` picker offers (P26-02): notes first; then, once a
 * `#` follows a note's name, that note's headings and blocks.
 */
export type LinkChoice =
  | { readonly kind: 'note'; readonly note: NoteSuggestion }
  | {
      readonly kind: 'fragment';
      /** The note's name as the link writes it: empty for this note's own. */
      readonly target: string;
      /** Where the note is; null for this note, whose blocks are the editor's own. */
      readonly path: VaultPath | null;
      readonly entry: OutlineEntry;
    };

/** A note's headings and blocks, as the page reads them for the picker. */
export type BlockChoices =
  | {
      /** The link names this very note: its blocks are the ones on screen. */
      readonly same: true;
      readonly target: string;
    }
  | {
      readonly same: false;
      readonly target: string;
      readonly path: VaultPath;
      readonly entries: readonly OutlineEntry[];
    };

/** What the page does for the picker once a `#` follows a note's name. */
export interface BlockPicking {
  /** The note a link's name opens, and its headings and blocks; null when it names none. */
  readonly choicesFor: (target: string) => Promise<BlockChoices | null>;
  /**
   * Gives a block of another note an id where it has none — a write to that
   * note — resolving to the id; rejects, with why, when it cannot.
   */
  readonly anchor: (block: { path: VaultPath; at: NodePath; text: string }) => Promise<string>;
  /** A new id no block in this note has, for one of its own blocks. */
  readonly newId: (taken: ReadonlySet<string>) => string;
  /** Tells the person a block could not be linked, and why. */
  readonly onRefused: (reason: string) => void;
}
