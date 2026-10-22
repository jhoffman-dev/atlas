import {
  anchorProblem,
  DEFAULT_HIGHLIGHT_STYLE,
  HIGHLIGHT_COLORS,
  type HighlightAnchor,
  type HighlightStyle,
  type PageRect,
  type TextQuoteSelector,
} from './anchor.ts';

/*
 * The hidden half of a highlight (ADR-0043): one HTML comment, in the style
 * of the bookmark's (ADR-0020), that holds the highlight's anchor and style
 * as one line of JSON. Obsidian's reading view, GitHub and every CommonMark
 * reader hide it, so the note shows only the quote and the comment.
 *
 *     <!-- atlas:highlight {"v":1,"mark":"highlight","color":"yellow","kind":"pdf","page":3,…} -->
 *
 * The comment keeps `atlas:`, as every marker does (ADR-0042). `<` and `>`
 * in the JSON are written as `\u003c` and `\u003e`, so no quoted words can
 * close the comment early, and U+2028 and U+2029 as `\u2028` and `\u2029`,
 * which some readers take for a line end; the JSON stays on one line.
 */

/** The version of the marker's JSON this build writes, and the only one it reads. */
export const HIGHLIGHT_MARKER_VERSION = 1;

// `[^\r\n]`, not `.`: a hand-written marker may hold a raw U+2028, which `.` stops at.
const MARKER = /^<!--[ \t]*atlas:highlight[ \t]+(\{[^\r\n]*\})[ \t]*-->$/;

/** What the marker says: how the highlight is drawn and where it is in its file. */
export interface HighlightMarker {
  readonly style: HighlightStyle;
  readonly anchor: HighlightAnchor;
}

/** The marker comment for a highlight, as DFAI writes it. */
export function highlightMarker({ style, anchor }: HighlightMarker): string {
  const fields = { v: HIGHLIGHT_MARKER_VERSION, ...style, ...anchorFields(anchor) };
  const json = JSON.stringify(fields)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
  return `<!-- atlas:highlight ${json} -->`;
}

/**
 * The highlight a line of text marks, or null when the line is not a marker
 * this build can read: not the comment, JSON that does not parse, another
 * version's, or an anchor the format would not write. Such a line is kept
 * exactly as it is and never edited, since what it says is not known.
 */
export function readHighlightMarker(line: string): HighlightMarker | null {
  const json = MARKER.exec(line.trim())?.[1];
  // CommonMark ends a comment at the first `-->`, so one inside the JSON shows the rest as text.
  if (json === undefined || json.includes('-->')) return null;
  const fields = parsedObject(json);
  if (fields === null || fields.v !== HIGHLIGHT_MARKER_VERSION) return null;
  const anchor = anchorOf(fields);
  if (anchor === null || anchorProblem(anchor) !== null) return null;
  return { style: styleOf(fields), anchor };
}

/** Whether a line could be meant as a marker, read or not: a quoted comment line must not become one. */
export function looksLikeHighlightMarker(line: string): boolean {
  return /^<!--[ \t]*atlas:highlight\b/.test(line.trim());
}

type Fields = Readonly<Record<string, unknown>>;

function parsedObject(json: string): Fields | null {
  try {
    const parsed: unknown = JSON.parse(json);
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Fields)
      : null;
  } catch {
    // A marker someone broke by hand is not a highlight; its line is kept as written.
    return null;
  }
}

function anchorFields(anchor: HighlightAnchor): Record<string, unknown> {
  switch (anchor.kind) {
    case 'pdf':
      return {
        kind: 'pdf',
        page: anchor.page,
        ...(anchor.quote ?? {}),
        rects: anchor.rects.map(({ x, y, width, height }) => [x, y, width, height]),
      };
    case 'epub':
      return { kind: 'epub', cfi: anchor.cfi, ...anchor.quote };
    case 'kindle':
      return {
        kind: 'kindle',
        ...(anchor.location !== null && { location: anchor.location.start }),
        ...(anchor.location?.end !== undefined &&
          anchor.location.end !== null && { locationEnd: anchor.location.end }),
        ...(anchor.page !== undefined && { page: anchor.page }),
        ...(anchor.annotationId !== null && { annotationId: anchor.annotationId }),
        ...(anchor.exact !== undefined && { exact: anchor.exact }),
      };
  }
}

function anchorOf(fields: Fields): HighlightAnchor | null {
  switch (fields.kind) {
    case 'pdf': {
      const rects = rectsOf(fields.rects);
      if (typeof fields.page !== 'number' || rects === null) return null;
      const quote = fields.exact === undefined ? null : selectorOf(fields);
      if (fields.exact !== undefined && quote === null) return null;
      return { kind: 'pdf', page: fields.page, quote, rects };
    }
    case 'epub': {
      const quote = selectorOf(fields);
      return typeof fields.cfi === 'string' && quote !== null
        ? { kind: 'epub', cfi: fields.cfi, quote }
        : null;
    }
    case 'kindle':
      return kindleOf(fields);
    default:
      return null;
  }
}

function kindleOf(fields: Fields): HighlightAnchor | null {
  const { location, locationEnd, page, annotationId, exact } = fields;
  if (location !== undefined && typeof location !== 'number') return null;
  if (locationEnd !== undefined && typeof locationEnd !== 'number') return null;
  if (page !== undefined && typeof page !== 'number') return null;
  if (annotationId !== undefined && typeof annotationId !== 'string') return null;
  if (exact !== undefined && typeof exact !== 'string') return null;
  return {
    kind: 'kindle',
    // A range with no start is no place; the anchor check refuses it with the rest.
    location: location === undefined ? null : { start: location, end: locationEnd ?? null },
    ...(page !== undefined && { page }),
    annotationId: annotationId ?? null,
    ...(exact !== undefined && { exact }),
  };
}

function selectorOf(fields: Fields): TextQuoteSelector | null {
  const { exact, prefix = '', suffix = '' } = fields;
  return typeof exact === 'string' && typeof prefix === 'string' && typeof suffix === 'string'
    ? { exact, prefix, suffix }
    : null;
}

function rectsOf(value: unknown): PageRect[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value)) return null;
  const rects: PageRect[] = [];
  for (const item of value as unknown[]) {
    if (!Array.isArray(item) || item.length !== 4) return null;
    const [x, y, width, height] = item as unknown[];
    if (![x, y, width, height].every((part) => typeof part === 'number')) return null;
    rects.push({ x, y, width, height } as PageRect);
  }
  return rects;
}

/** A style as written; a mark or colour this build does not know is drawn as the default. */
function styleOf(fields: Fields): HighlightStyle {
  const mark = fields.mark === 'underline' ? 'underline' : DEFAULT_HIGHLIGHT_STYLE.mark;
  const color = HIGHLIGHT_COLORS.find((known) => known === fields.color);
  return { mark, color: color ?? DEFAULT_HIGHLIGHT_STYLE.color };
}
