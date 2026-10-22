import { classesOf, findFirst, textOf, withClass, withId } from './html-tree.ts';
import type { HtmlElement } from './html-tree.ts';
import { findKindleKeyClash, kindleHighlightKey, kindleNoteKey } from './kindle-highlight-key.ts';
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
 * what was typed in `#note` (an entry of its own, after the passage). The page ends with hidden inputs saying where
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
// The page starts with a letter or digit: "Page: | Location: 12" has none.
const PAGE_IN_HEADER = /\bpage:?\s*([a-z0-9][^\s|]*)/i;

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
  { readonly highlights: readonly KindleHighlight[] } | { readonly problem: string };

/**
 * A row's entries: the passage, and after it the note typed on it, if any,
 * as an entry of its own with a key built on the passage's. A note at a
 * place with no passage is the one entry, under the row's id.
 */
function readRow(row: HtmlElement, asin: string): RowReading {
  const quoteElement = findFirst(row, withId('highlight'));
  const noteElement = findFirst(row, withId('note'));
  if (quoteElement === null && noteElement === null) {
    return { problem: 'an annotation has neither a passage nor a note' };
  }
  const quote = quoteElement === null ? '' : textOf(quoteElement);
  const note = noteElement === null ? '' : textOf(noteElement);
  // A bookmark: a place, with nothing marked or typed.
  if (quote === '' && note === '') return { highlights: [] };
  const header = headerOf(row);
  const style = styleOf(quote, header);
  const rowId = row.attributes.get('id') ?? '';
  const annotationId = ANNOTATION_ID.test(rowId) ? rowId : null;
  const location = locationOf(row, header);
  const page = PAGE_IN_HEADER.exec(header)?.[1] ?? null;
  const key = kindleHighlightKey({ asin, annotationId, location, words: quote || note });
  const entry: KindleHighlight = {
    key,
    asin,
    annotationId,
    style,
    colour: style === 'highlight' ? colourOf(row) : null,
    quote,
    note: quote === '' ? note : null,
    location,
    page,
    commentOn: null,
  };
  if (quote === '' || note === '') return { highlights: [entry] };
  const comment: KindleHighlight = {
    ...entry,
    key: kindleNoteKey(key, note),
    style: 'note',
    colour: null,
    quote: '',
    note,
    commentOn: key,
  };
  return { highlights: [entry, comment] };
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
    highlights.push(...reading.highlights);
  }
  // Two passages under one id: one would be lost behind the other, so the page is refused.
  if (findKindleKeyClash(highlights) !== null) {
    return { kind: 'unrecognised', reason: 'two different annotations share one id' };
  }
  return { kind: 'annotations', highlights, next: nextCursorOf(checked.tree) };
}
