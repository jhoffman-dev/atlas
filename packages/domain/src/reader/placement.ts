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
  /** Found by its words, on `page` from offset `at` of the page's text, covering `rects`. */
  | {
      readonly kind: 'words';
      readonly page: number;
      readonly at: number;
      readonly rects: readonly PageRect[];
    }
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
 * there. Two copies that tie (`findQuote` finds neither) are not a reason to
 * look on another page, where a copy is a different passage: the highlight
 * stays on its own page, at the boxes it was saved with. An area has no
 * words, and a page out of the document has none either.
 */
export function placeOnItsPage(
  anchor: PdfAnchor,
  pages: { readonly count: number; readonly text: PdfPageText },
): HighlightPlacement | null {
  if (anchor.quote === null || anchor.page > pages.count) return null;
  const match = findQuote(pages.text.text, anchor.quote);
  if (match === null) {
    return hasWordsOf(anchor.quote.exact, pages.text) ? placeByBoxes(anchor, pages.count) : null;
  }
  return {
    kind: 'words',
    page: anchor.page,
    at: match.start,
    rects: rectsForRange(pages.text, match.start, match.end),
  };
}

const foldSpaces = (text: string): string => text.replace(/\s+/g, ' ').trim();

const hasWordsOf = (exact: string, page: PdfPageText): boolean => {
  const words = foldSpaces(exact);
  return words !== '' && foldSpaces(page.text).includes(words);
};

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
    at: match.start,
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
 * Highlights in the order they come in the document: by page, then by where
 * their words begin in the page's text (`offset`) — which follows the
 * columns as a reader does, where top-then-left would read across them —
 * then from the top and the left; one drawn nowhere after all the rest, in
 * the order given. Sorting is stable, so two at one spot keep the note's order.
 */
export function inReadingOrder<
  T extends { readonly placement: HighlightPlacement; readonly offset: number },
>(placed: readonly T[]): T[] {
  return [...placed].sort(readingKey);
}

function readingKey(
  a: { readonly placement: HighlightPlacement; readonly offset: number },
  b: { readonly placement: HighlightPlacement; readonly offset: number },
): number {
  if (a.placement.kind === 'lost' || b.placement.kind === 'lost')
    return Number(a.placement.kind === 'lost') - Number(b.placement.kind === 'lost');
  const [first, second] = [a.placement.rects[0], b.placement.rects[0]];
  return (
    a.placement.page - b.placement.page ||
    a.offset - b.offset ||
    (first?.y ?? 0) - (second?.y ?? 0) ||
    (first?.x ?? 0) - (second?.x ?? 0)
  );
}
