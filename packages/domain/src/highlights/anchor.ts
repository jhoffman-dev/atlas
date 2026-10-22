/*
 * Where a highlight is in its source file (#503, ADR-0043): what a reader
 * needs to find the passage again, kept apart from what the person reads.
 *
 * The quote and comment in the note are the person's to edit; the anchor is
 * the source's, so it keeps the passage's own words (`exact`) even after the
 * quote in the note has been tidied. Re-anchoring tries the words first and
 * the position second, so a re-downloaded file still finds its highlights.
 */

/**
 * A passage by its words (the W3C Web Annotation TextQuoteSelector): the
 * words themselves, and a little of the text either side to tell two copies
 * of them apart. `prefix` and `suffix` may be empty.
 */
export interface TextQuoteSelector {
  readonly exact: string;
  readonly prefix: string;
  readonly suffix: string;
}

/**
 * A box on a PDF page, as fractions of the page's width and height from its
 * top-left corner, so it holds at any zoom and on any screen.
 */
export interface PageRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/**
 * A PDF highlight: its page (from 1), its words, and the boxes it covers.
 * `quote` is null for an area highlight on a page with no text (a scan); the
 * boxes are then all there is, so there is at least one.
 */
export interface PdfAnchor {
  readonly kind: 'pdf';
  readonly page: number;
  readonly quote: TextQuoteSelector | null;
  readonly rects: readonly PageRect[];
}

/** An EPUB highlight: its EPUB CFI, and its words to find it by when the CFI misses. */
export interface EpubAnchor {
  readonly kind: 'epub';
  readonly cfi: string;
  readonly quote: TextQuoteSelector;
}

/**
 * A Kindle highlight: the location range Kindle gives it (from 1) or, for a
 * book whose export has pages and no locations, its `page`; at least one of
 * the two. `annotationId` is Amazon's id for the annotation when the export
 * carries one, which is what a later sync knows it by. `exact` is the
 * export's own words, kept as the marker holds them so a later sync can tell
 * the passage again after the person has tidied the quote; absent in a new
 * anchor, where the quote given with it is the export's words.
 */
export interface KindleAnchor {
  readonly kind: 'kindle';
  readonly location: { readonly start: number; readonly end: number | null } | null;
  readonly page?: number;
  readonly annotationId: string | null;
  readonly exact?: string;
}

export type HighlightAnchor = PdfAnchor | EpubAnchor | KindleAnchor;

export type SourceKind = HighlightAnchor['kind'];

export const SOURCE_KINDS: readonly SourceKind[] = ['pdf', 'epub', 'kindle'];

/** The colours a highlight can be: Kindle's four, and two more a reader offers. */
export const HIGHLIGHT_COLORS = ['yellow', 'green', 'blue', 'pink', 'purple', 'orange'] as const;

export type HighlightColor = (typeof HIGHLIGHT_COLORS)[number];

/** How a highlight is drawn: a wash of colour, or a line under the words. */
export interface HighlightStyle {
  readonly mark: 'highlight' | 'underline';
  readonly color: HighlightColor;
}

export const DEFAULT_HIGHLIGHT_STYLE: HighlightStyle = { mark: 'highlight', color: 'yellow' };

/** Why an anchor cannot be written: it would not be read back as the same one. */
export class InvalidHighlightAnchorError extends Error {
  constructor(reason: string) {
    super(`This highlight's place in its file cannot be kept: ${reason}.`);
    this.name = 'InvalidHighlightAnchorError';
  }
}

/** The reason `anchor` is not one the format holds, or null when it is. */
export function anchorProblem(anchor: HighlightAnchor): string | null {
  switch (anchor.kind) {
    case 'pdf':
      if (!isCount(anchor.page)) return 'a PDF page is a whole number from 1';
      if (anchor.quote !== null && isBlank(anchor.quote.exact)) return 'a quote has words';
      if (!anchor.rects.every(isPageRect)) return 'a box lies on its page';
      return anchor.quote === null && anchor.rects.length === 0
        ? 'a highlight with no words covers a box'
        : null;
    case 'epub':
      if (!anchor.cfi.startsWith('epubcfi(')) return 'an EPUB place is an epubcfi(…)';
      return isBlank(anchor.quote.exact) ? 'a quote has words' : null;
    case 'kindle':
      return kindleProblem(anchor);
  }
}

function kindleProblem(anchor: KindleAnchor): string | null {
  const { location, page } = anchor;
  if (location === null && page === undefined) return 'a Kindle highlight has a location or a page';
  if (page !== undefined && !isCount(page)) return 'a Kindle page is a whole number from 1';
  if (location !== null) {
    if (!isCount(location.start)) return 'a Kindle location is a whole number from 1';
    if (location.end !== null && (!isCount(location.end) || location.end < location.start))
      return 'a location range ends after it starts';
  }
  if (anchor.exact !== undefined && isBlank(anchor.exact)) return 'a Kindle quote has words';
  return anchor.annotationId === '' ? 'an annotation id has characters' : null;
}

/** Throws `InvalidHighlightAnchorError` when `anchor` is not one the format holds. */
export function assertAnchor(anchor: HighlightAnchor): void {
  const problem = anchorProblem(anchor);
  if (problem !== null) throw new InvalidHighlightAnchorError(problem);
}

const isCount = (value: number): boolean => Number.isInteger(value) && value >= 1;

const isBlank = (text: string): boolean => text.trim() === '';

/** How far past the page's edge a box may run for rounding: a reader divides by the page's size. */
const EDGE_TOLERANCE = 1e-6;

const isFraction = (value: number): boolean => Number.isFinite(value) && value >= 0 && value <= 1;

function isPageRect(rect: PageRect): boolean {
  return (
    isFraction(rect.x) &&
    isFraction(rect.y) &&
    isFraction(rect.width) &&
    isFraction(rect.height) &&
    rect.width > 0 &&
    rect.height > 0 &&
    rect.x + rect.width <= 1 + EDGE_TOLERANCE &&
    rect.y + rect.height <= 1 + EDGE_TOLERANCE
  );
}

/**
 * What makes two highlights the same passage, so a sync run again adds
 * nothing it added before. Kindle's own id wins when there is one; without
 * it a Kindle highlight is its place and the export's words (`exact`, else
 * the quote given), since two can start at one location. A person tidying
 * the quote in the note changes neither.
 */
export function highlightKey(anchor: HighlightAnchor, quote: string): string {
  switch (anchor.kind) {
    case 'pdf':
      return anchor.quote === null
        ? JSON.stringify(['pdf-area', anchor.page, anchor.rects.map(rectKey)])
        : JSON.stringify(['pdf', anchor.page, ...selectorKey(anchor.quote)]);
    case 'epub':
      return JSON.stringify(['epub', anchor.cfi]);
    case 'kindle':
      return anchor.annotationId !== null
        ? JSON.stringify(['kindle-id', anchor.annotationId])
        : JSON.stringify([
            'kindle',
            anchor.location?.start ?? null,
            anchor.location?.end ?? null,
            anchor.page ?? null,
            foldWords(anchor.exact ?? quote),
          ]);
  }
}

/** A Kindle highlight and the words it was given, which `exact` stands in for when the export gave them. */
export interface KindlePassage {
  readonly anchor: KindleAnchor;
  readonly quote: string;
}

/**
 * Whether two Kindle highlights are at one place with the same words, with no
 * regard for their annotation ids: what an export that learns the id later
 * shares with the copy synced without it, so the two are one passage. Their
 * places are compared by where the location starts when both have one — one
 * export gives a range (`77-79`) where another gives its start alone — and
 * else by page when both have one, since an export may give the page alone;
 * two that share neither are not known to be one place. The words tell two
 * passages at one place apart. A comparison, not a key: a copy with a
 * location and a page is the same place as one with either.
 */
export function sameKindlePlace(a: KindlePassage, b: KindlePassage): boolean {
  if (foldWords(a.anchor.exact ?? a.quote) !== foldWords(b.anchor.exact ?? b.quote)) return false;
  const [one, other] = [a.anchor, b.anchor];
  if (one.location !== null && other.location !== null) {
    return one.location.start === other.location.start;
  }
  return one.page !== undefined && one.page === other.page;
}

const selectorKey = (quote: TextQuoteSelector): string[] =>
  [quote.exact, quote.prefix, quote.suffix].map(foldWords);

const rectKey = (rect: PageRect): number[] => [rect.x, rect.y, rect.width, rect.height];

const foldWords = (text: string): string => text.replace(/\s+/g, ' ').trim();
