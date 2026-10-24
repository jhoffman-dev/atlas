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
 * What a pane keeps between one reading of its note and the next (#534): the
 * set of highlight ids, built only once the note's highlight-bearing lines
 * change, and the views already read. A literature note of 500 highlights is
 * then parsed once to open and not again for each save of its prose.
 */
export interface HighlightReadMemo {
  signature: string | null;
  ids: ReadonlySet<string> | null;
  readonly views: Map<string, HighlightView | null>;
}

export const createHighlightReadMemo = (): HighlightReadMemo => ({
  signature: null,
  ids: null,
  views: new Map(),
});

/** Views kept before the oldest are let go: a comment typed leaves its older block behind. */
const MOST_VIEWS_KEPT = 2000;

/**
 * The lines of a note that decide which of its quotes are highlights: the
 * markers, the `^id` lines, and whatever could hide a block — comments,
 * code fences, HTML. Prose edits leave this text as it was.
 */
export function highlightBearingText(text: string): string {
  return text
    .split('\n')
    .filter((line) =>
      /atlas:highlight|%%|```|~~~|<!--|-->|^\s*<[a-zA-Z/!]|^\^[a-z0-9]+\s*$/.test(line),
    )
    .join('\n');
}

/**
 * How the editor reads the note's blocks as highlights, or null for a note
 * that is no literature note, whose quotes are only quotes. Nothing is read
 * until the first block asks, so opening a note costs the pane's render
 * nothing; with a `memo` kept across readings, a note whose highlight-bearing
 * lines did not change keeps its ids, and a block read once is not parsed
 * again by whichever of the gate or the component asks second.
 */
export function literatureHighlightReader(
  markdown: Pick<MarkdownPort, 'noteBlocks'>,
  note: { readonly properties: Readonly<Record<string, unknown>>; readonly text: string },
  memo: HighlightReadMemo = createHighlightReadMemo(),
): HighlightBlockReader | null {
  if (!isLiteratureNote(note.properties)) return null;
  const noteBlocks: ReadNoteBlocks = (text) => markdown.noteBlocks(text);
  const idsOfNote = (): ReadonlySet<string> => {
    const signature = highlightBearingText(note.text);
    if (memo.ids === null || memo.signature !== signature) {
      memo.ids = new Set(readHighlights(note.text, noteBlocks).map((highlight) => highlight.id));
      memo.signature = signature;
      memo.views.clear();
    }
    return memo.ids;
  };
  return ({ markdown: block, id }) => {
    if (!idsOfNote().has(id)) return null;
    const key = `${id}\u0000${block}`;
    const known = memo.views.get(key);
    if (known !== undefined) return known;
    // The block with its id after it, as the note writes a highlight (ADR-0022).
    const [read, ...more] = readHighlights(`${block}\n\n^${id}\n`, noteBlocks);
    const view =
      read === undefined || more.length > 0 || read.id !== id ? null : highlightView(read);
    if (memo.views.size >= MOST_VIEWS_KEPT) memo.views.clear();
    memo.views.set(key, view);
    return view;
  };
}
