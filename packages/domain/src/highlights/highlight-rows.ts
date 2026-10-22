import type { SourceKind } from './anchor.ts';
import { readHighlights } from './highlight-block.ts';
import { highlightMarker } from './highlight-marker.ts';
import { plainQuote } from './highlight-text.ts';

/** A highlight as the index keeps it, for search and the research views to ask for. */
export interface HighlightRow {
  readonly id: string;
  readonly kind: SourceKind;
  /** The quote's words, its markdown escapes taken off. */
  readonly quote: string;
  /** The comment's markdown as written; empty when there is none. */
  readonly comment: string;
  readonly mark: 'highlight' | 'underline';
  readonly color: string;
  /** The anchor and style as the marker holds them: one line of JSON. */
  readonly anchor: string;
}

/** Cheaply, before anything is read: whether a note's text could hold a highlight. */
export function mayHoldHighlights(text: string): boolean {
  return text.includes('atlas:highlight');
}

/** The rows of a source note's highlights, in the order written. Only a source note's count. */
export function highlightRows(text: string): HighlightRow[] {
  if (!mayHoldHighlights(text)) return [];
  return readHighlights(text).map((block) => ({
    id: block.id,
    kind: block.anchor.kind,
    quote: plainQuote(block.quote),
    comment: block.comment,
    mark: block.style.mark,
    color: block.style.color,
    anchor: markerJson(highlightMarker(block)),
  }));
}

const markerJson = (marker: string): string =>
  marker.slice(marker.indexOf('{'), marker.lastIndexOf('}') + 1);
