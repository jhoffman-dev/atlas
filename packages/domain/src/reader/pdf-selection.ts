import type { HighlightStyle, PageRect } from '../highlights/anchor.ts';
import type { NewHighlight } from '../highlights/edit-highlights.ts';
import { quoteSelectorAt } from '../highlights/reanchor.ts';
import { onPage, rectsForRange, type PdfPageText } from './pdf-page-text.ts';

/*
 * What a selection in the PDF reader becomes (#504, ADR-0043): words picked
 * on a page make a highlight anchored by those words and the boxes they
 * cover; a box dragged on a page with no words (a scan) makes an area
 * highlight, its boxes all there is.
 */

/** Words picked on one page: `[start, end)` of that page's text. */
export interface TextSelection {
  /** From 1. */
  readonly page: number;
  readonly start: number;
  readonly end: number;
}

/** A point on a page, in fractions of it from its top-left corner. */
export interface PagePoint {
  readonly x: number;
  readonly y: number;
}

/**
 * The selection with the space at either end left out — a selection dragged
 * past a line's end takes its line break — and its ends put in order and on
 * the page's text. Null when nothing but space is left.
 */
export function trimmedSelection(
  selection: TextSelection,
  page: PdfPageText,
): TextSelection | null {
  let start = clampOffset(Math.min(selection.start, selection.end), page.text.length);
  let end = clampOffset(Math.max(selection.start, selection.end), page.text.length);
  while (start < end && /\s/.test(page.text[start] as string)) start += 1;
  while (end > start && /\s/.test(page.text[end - 1] as string)) end -= 1;
  return start === end ? null : { page: selection.page, start, end };
}

const clampOffset = (offset: number, length: number): number =>
  Number.isFinite(offset) ? Math.min(Math.max(Math.round(offset), 0), length) : 0;

/**
 * The highlight words picked on a page make: the words as the page gives
 * them, their selector, and the boxes they cover. Null when the selection
 * holds nothing but space, or covers no box the page can draw.
 */
export function textHighlight({
  selection,
  page,
  style,
  comment,
}: {
  selection: TextSelection;
  page: PdfPageText;
  style: HighlightStyle;
  comment?: string;
}): NewHighlight | null {
  const trimmed = trimmedSelection(selection, page);
  if (trimmed === null) return null;
  const rects = rectsForRange(page, trimmed.start, trimmed.end);
  if (rects.length === 0) return null;
  const quote = quoteSelectorAt({ text: page.text, start: trimmed.start, end: trimmed.end });
  return {
    quote: quote.exact,
    anchor: { kind: 'pdf', page: trimmed.page, quote, rects },
    style,
    ...(comment !== undefined && { comment }),
  };
}

/** The smallest area, as a fraction of the page's width or height, that is taken for a highlight rather than a stray click. */
export const SMALLEST_AREA = 0.01;

/** The box between two corners of a drag, cut to the page; null when it is too small to mean anything. */
export function draggedBox(from: PagePoint, to: PagePoint): PageRect | null {
  const box = onPage({
    x: Math.min(from.x, to.x),
    y: Math.min(from.y, to.y),
    width: Math.abs(to.x - from.x),
    height: Math.abs(to.y - from.y),
  });
  return box.width < SMALLEST_AREA || box.height < SMALLEST_AREA ? null : box;
}

/**
 * The highlight a box dragged on a page makes: no words, the box, and the
 * picture of it saved at `image`, which the note shows as the quote.
 */
export function areaHighlight({
  page,
  box,
  image,
  style,
  comment,
}: {
  page: number;
  box: PageRect;
  image: string;
  style: HighlightStyle;
  comment?: string;
}): NewHighlight {
  return {
    quote: '',
    image,
    anchor: { kind: 'pdf', page, quote: null, rects: [box] },
    style,
    ...(comment !== undefined && { comment }),
  };
}
