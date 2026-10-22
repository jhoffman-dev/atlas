import type { PageRect, PdfAnchor } from '../highlights/anchor.ts';
import { findQuote, findQuoteNear } from '../highlights/reanchor.ts';
import { rectsForRange, type PdfPageText } from './pdf-page-text.ts';

/*
 * Where a stored PDF highlight is drawn when its document opens (#504,
 * ADR-0043 §9): by its words first — on the page it names, then outward —
 * so a file downloaded again or another edition still finds it; by the
 * boxes it was saved with when the words are not there; and nowhere, said
 * so, when neither fits the document.
 */

export type HighlightPlacement =
  /** Found by its words, on `page`, covering `rects`. */
  | { readonly kind: 'words'; readonly page: number; readonly rects: readonly PageRect[] }
  /** An area of a page with no words: drawn at its boxes. */
  | { readonly kind: 'area'; readonly page: number; readonly rects: readonly PageRect[] }
  /** Its words are not in the document: drawn where it was saved, which may no longer be the passage. */
  | { readonly kind: 'boxes'; readonly page: number; readonly rects: readonly PageRect[] }
  /** Its page is not in the document: drawn nowhere. */
  | { readonly kind: 'lost' };

/** A placement that is drawn on a page. */
export type DrawnPlacement = Exclude<HighlightPlacement, { kind: 'lost' }>;

/**
 * The highlight's words on the page it names, or null when they are not
 * there (or two copies tie, as `findQuote` says). An area has no words, and
 * a page out of the document has none either.
 */
export function placeOnItsPage(
  anchor: PdfAnchor,
  pages: { readonly count: number; readonly text: PdfPageText },
): DrawnPlacement | null {
  if (anchor.quote === null || anchor.page > pages.count) return null;
  const match = findQuote(pages.text.text, anchor.quote);
  if (match === null) return null;
  return {
    kind: 'words',
    page: anchor.page,
    rects: rectsForRange(pages.text, match.start, match.end),
  };
}

/** The highlight's words anywhere in the document, nearest its own page first; null when they are nowhere. */
export function placeByWords(
  anchor: PdfAnchor,
  pages: readonly PdfPageText[],
): DrawnPlacement | null {
  if (anchor.quote === null || pages.length === 0) return null;
  const match = findQuoteNear({
    sections: pages.map((page) => page.text),
    selector: anchor.quote,
    near: anchor.page - 1,
  });
  if (match === null) return null;
  const page = pages[match.section] as PdfPageText;
  return {
    kind: 'words',
    page: match.section + 1,
    rects: rectsForRange(page, match.start, match.end),
  };
}

/**
 * Where a highlight is drawn when its words were not found: an area, or one
 * whose words moved away, at the boxes it was saved with on its own page;
 * nowhere when that page is not in the document or it has no box.
 */
export function placeByBoxes(anchor: PdfAnchor, pageCount: number): HighlightPlacement {
  if (anchor.page > pageCount || anchor.rects.length === 0) return { kind: 'lost' };
  return { kind: anchor.quote === null ? 'area' : 'boxes', page: anchor.page, rects: anchor.rects };
}

/** Whether a placement is exactly where the highlight was made: found by its words, or an area. */
export const isExact = (placement: HighlightPlacement): boolean =>
  placement.kind === 'words' || placement.kind === 'area';

/**
 * Highlights in the order they come in the document: by page, then from the
 * top, then from the left; one drawn nowhere after all the rest, in the
 * order given. Sorting is stable, so two at one spot keep the note's order.
 */
export function inReadingOrder<T extends { readonly placement: HighlightPlacement }>(
  placed: readonly T[],
): T[] {
  return [...placed].sort((a, b) => readingKey(a.placement, b.placement));
}

function readingKey(a: HighlightPlacement, b: HighlightPlacement): number {
  if (a.kind === 'lost' || b.kind === 'lost')
    return Number(a.kind === 'lost') - Number(b.kind === 'lost');
  const [first, second] = [a.rects[0], b.rects[0]];
  return (
    a.page - b.page || (first?.y ?? 0) - (second?.y ?? 0) || (first?.x ?? 0) - (second?.x ?? 0)
  );
}
