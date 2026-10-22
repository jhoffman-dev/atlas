import { classesOf, findFirst, textOf, withClass, withId } from './html-tree.ts';
import type { HtmlElement } from './html-tree.ts';
import { kindleHighlightKey } from './kindle-highlight-key.ts';
import { allWithClass, checkKindlePage, inputValue } from './kindle-notebook-page.ts';
import { KINDLE_HIGHLIGHT_COLOURS } from './kindle-types.ts';
import type {
  KindleAnnotationsReading,
  KindleHighlight,
  KindleHighlightColour,
  KindleHighlightStyle,
  KindlePageCursor,
  KindleRawPage,
} from './kindle-types.ts';

/**
 * One page of a book's annotations. Each annotation is a row whose id is
 * Amazon's annotation id; inside it, a header ("Yellow highlight | Location:
 * 128"), a hidden input with the location, the passage in `#highlight` and
 * what was typed in `#note`. The page ends with hidden inputs saying where
 * the next page starts. A row this cannot read means the page is not the
 * shape it knows, and the page is refused rather than read in part.
 */

const ANNOTATIONS_ID = 'kp-notebook-annotations';
const ASIN_INPUT_ID = 'kp-notebook-annotations-asin';
const NEXT_PAGE_CLASS = 'kp-notebook-annotations-next-page-start';
const CONTENT_LIMIT_CLASS = 'kp-notebook-content-limit-state';
const HIGHLIGHT_CLASS = 'kp-notebook-highlight';
const COLOUR_CLASS_PREFIX = `${HIGHLIGHT_CLASS}-`;

/** What an annotation id may be; anything else is not trusted as one, and the quote hash is used. */
const ANNOTATION_ID = /^[A-Za-z0-9_+=/-]{8,256}$/;

const LOCATION_IN_HEADER = /location:?\s*([\d,]+)/i;
const PAGE_IN_HEADER = /page:?\s*([^\s|]+)/i;

function isAnnotationRow(element: HtmlElement): boolean {
  return withClass('a-row', 'a-spacing-base')(element) && element.attributes.has('id');
}

function headerOf(row: HtmlElement): string {
  for (const id of ['annotationHighlightHeader', 'annotationNoteHeader']) {
    const header = findFirst(row, withId(id));
    const text = header === null ? '' : textOf(header);
    if (text !== '') return text;
  }
  return '';
}

function locationOf(row: HtmlElement, header: string): number | null {
  const written = inputValue(row, withId('kp-annotation-location')) ?? '';
  const digits = (
    /^[\d,]+$/.test(written) ? written : (LOCATION_IN_HEADER.exec(header)?.[1] ?? '')
  ).replace(/,/g, '');
  return digits === '' ? null : Number(digits);
}

function colourOf(row: HtmlElement): KindleHighlightColour | null {
  const marked = findFirst(row, withClass(HIGHLIGHT_CLASS));
  const named = (marked === null ? [] : classesOf(marked))
    .filter((name) => name.startsWith(COLOUR_CLASS_PREFIX))
    .map((name) => name.slice(COLOUR_CLASS_PREFIX.length));
  return KINDLE_HIGHLIGHT_COLOURS.find((colour) => named.includes(colour)) ?? null;
}

function styleOf(quote: string, header: string): KindleHighlightStyle {
  if (quote === '') return 'note';
  return /underline/i.test(header) ? 'underline' : 'highlight';
}

type RowReading =
  | { readonly highlight: KindleHighlight }
  | { readonly skipped: true }
  | { readonly problem: string };

function readRow(row: HtmlElement, asin: string): RowReading {
  const quoteElement = findFirst(row, withId('highlight'));
  const noteElement = findFirst(row, withId('note'));
  if (quoteElement === null && noteElement === null) {
    return { problem: 'an annotation has neither a passage nor a note' };
  }
  const quote = quoteElement === null ? '' : textOf(quoteElement);
  const note = noteElement === null ? '' : textOf(noteElement);
  // A bookmark: a place, with nothing marked or typed.
  if (quote === '' && note === '') return { skipped: true };
  const header = headerOf(row);
  const style = styleOf(quote, header);
  const rowId = row.attributes.get('id') ?? '';
  const annotationId = ANNOTATION_ID.test(rowId) ? rowId : null;
  const location = locationOf(row, header);
  return {
    highlight: {
      key: kindleHighlightKey({ asin, annotationId, location, words: quote || note }),
      asin,
      annotationId,
      style,
      colour: style === 'highlight' ? colourOf(row) : null,
      quote,
      note: note === '' ? null : note,
      location,
      page: PAGE_IN_HEADER.exec(header)?.[1] ?? null,
    },
  };
}

function nextCursorOf(tree: HtmlElement): KindlePageCursor | null {
  const token = inputValue(tree, withClass(NEXT_PAGE_CLASS)) ?? '';
  if (token === '') return null;
  return { token, contentLimitState: inputValue(tree, withClass(CONTENT_LIMIT_CLASS)) ?? '' };
}

/** Reads one page of the annotations of the book `asin`. */
export function readKindleAnnotations(page: KindleRawPage, asin: string): KindleAnnotationsReading {
  const checked = checkKindlePage(page);
  if (checked.kind !== 'page') return checked;
  const annotations = findFirst(checked.tree, withId(ANNOTATIONS_ID));
  if (annotations === null) return { kind: 'unrecognised', reason: 'the page has no annotations' };
  const named = inputValue(checked.tree, withId(ASIN_INPUT_ID));
  if (named !== null && named !== '' && named !== asin) {
    return { kind: 'unrecognised', reason: `the page is for ${named}, not ${asin}` };
  }
  const highlights: KindleHighlight[] = [];
  for (const row of allWithClass(annotations, 'a-row').filter(isAnnotationRow)) {
    const reading = readRow(row, asin);
    if ('problem' in reading) return { kind: 'unrecognised', reason: reading.problem };
    if ('highlight' in reading) highlights.push(reading.highlight);
  }
  return { kind: 'annotations', highlights, next: nextCursorOf(checked.tree) };
}
