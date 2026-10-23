import {
  highlightView,
  isLiteratureNote,
  readHighlights,
  type HighlightView,
  type ReadNoteBlocks,
} from '@dfai/domain';
import type { MarkdownPort } from '../notes/ports.ts';

/*
 * Which blocks of an open note the editor draws as highlights (#523), and how.
 * Whether a block is one is the note's answer, read in place (ADR-0043 §8): a
 * quote a `%%` comment hides is no highlight, and only a literature note has
 * any. What it shows is read from the block as the editor holds it, so a block
 * drawn after a save shows the bytes it was drawn from, never an older read.
 */

/** A block of the editor's note — its markdown and its `^id` — as the highlight it is, or null. */
export type HighlightBlockReader = (block: {
  readonly markdown: string;
  readonly id: string;
}) => HighlightView | null;

/**
 * How the editor reads the note's blocks as highlights, or null for a note
 * that is no literature note, whose quotes are only quotes.
 */
export function literatureHighlightReader(
  markdown: Pick<MarkdownPort, 'noteBlocks'>,
  note: { readonly properties: Readonly<Record<string, unknown>>; readonly text: string },
): HighlightBlockReader | null {
  if (!isLiteratureNote(note.properties)) return null;
  const noteBlocks: ReadNoteBlocks = (text) => markdown.noteBlocks(text);
  const ids = new Set(readHighlights(note.text, noteBlocks).map((highlight) => highlight.id));
  return ({ markdown: block, id }) => {
    if (!ids.has(id)) return null;
    // The block with its id after it, as the note writes a highlight (ADR-0022).
    const [read, ...more] = readHighlights(`${block}\n\n^${id}\n`, noteBlocks);
    return read === undefined || more.length > 0 || read.id !== id ? null : highlightView(read);
  };
}
