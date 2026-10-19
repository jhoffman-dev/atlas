import type { RefObject } from 'react';
import type { CellAt } from './cell-keys.ts';

/** What a cell commits: a note's property as its editor typed or picked it. */
export type CellValue = string | number | boolean | readonly string[] | null;

/** One change to one cell of one note, as the table reports it. */
export interface CellEdit extends CellAt {
  readonly value: CellValue;
}

/**
 * The cell being edited, held by the table rather than the row: a row the
 * virtualiser drops while its cell is edited takes nothing with it, and the
 * editor is back, with what was typed, once the row is drawn again.
 */
export interface CellEditing extends CellAt {
  /** What a typed-in editor holds so far; null until something is typed. */
  readonly draft: string | null;
  /**
   * What the draft would commit, or null while it would commit nothing —
   * written when the edit is overtaken rather than ended: by another cell
   * opened, the row leaving the result, or the table leaving the page.
   */
  readonly pending: { readonly value: CellValue } | null;
}

/**
 * What a cell's editor can ask of the table, the same functions from one
 * render to the next so a row draws again only for a change of its own.
 */
export interface CellEditorHooks {
  /** Opens the editor in a cell. */
  readonly start: (at: CellAt) => void;
  /** Keeps what a typed-in editor holds so far, and what that would commit. */
  readonly draft: (text: string, pending: { readonly value: CellValue } | null) => void;
  /** Ends the edit: with a change, writing it; without one, as it was. */
  readonly end: (change?: { readonly value: CellValue }) => void;
  /** Ends the edit as `end` does, then opens the next or previous cell's editor. */
  readonly step: (to: 1 | -1, change?: { readonly value: CellValue }) => void;
  /** Writes a change that needs no editor open: a box ticked, a link removed. */
  readonly write: (edit: CellEdit) => void;
  /** The editing cell's element, which a picker hangs from. */
  readonly anchor: RefObject<HTMLElement | null>;
  /**
   * Set as the reader opens an edit; the editor that appears for it takes
   * the focus and clears it. An editor drawn again later — its row scrolled
   * back into the page — finds it clear, and takes the focus only if that
   * has nowhere else to be.
   */
  readonly opening: RefObject<boolean>;
  /**
   * The cell an edit just ended in, which takes the focus back once it is
   * drawn as a cell again — and clears this, so no later draw takes it.
   */
  readonly returning: RefObject<CellAt | null>;
}
