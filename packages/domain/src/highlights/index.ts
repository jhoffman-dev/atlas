/*
 * Literature notes and their anchored highlights (#503, ADR-0043): the format
 * the PDF and EPUB readers, Kindle sync, jump-to-location and the library
 * all read and write. Every function here is pure; the vault writes are
 * `addHighlight`, `editHighlightComment` and `removeHighlight` in the
 * application package.
 */
export {
  anchorProblem,
  assertAnchor,
  DEFAULT_HIGHLIGHT_STYLE,
  HIGHLIGHT_COLORS,
  highlightKey,
  InvalidHighlightAnchorError,
  SOURCE_KINDS,
} from './anchor.ts';
export type {
  EpubAnchor,
  HighlightAnchor,
  HighlightColor,
  HighlightStyle,
  KindleAnchor,
  PageRect,
  PdfAnchor,
  SourceKind,
  TextQuoteSelector,
} from './anchor.ts';
export {
  HIGHLIGHT_MARKER_VERSION,
  highlightMarker,
  readHighlightMarker,
} from './highlight-marker.ts';
export type { HighlightMarker } from './highlight-marker.ts';
export { readHighlights } from './highlight-block.ts';
export type { HighlightBlock } from './highlight-block.ts';
export { plainQuote } from './highlight-text.ts';
export {
  appendHighlights,
  HighlightNotFoundError,
  highlightNamed,
  withHighlightComment,
  withoutHighlight,
} from './edit-highlights.ts';
export type { AppendedHighlight, NewHighlight } from './edit-highlights.ts';
export { findQuote, findQuoteNear, QUOTE_CONTEXT, quoteSelectorAt } from './reanchor.ts';
export type { QuoteMatch, SectionMatch } from './reanchor.ts';
export {
  isLiteratureNote,
  readLiteratureNote,
  LITERATURE_NOTE_TYPE,
  LIBRARY_HOME,
  literatureNotePath,
  literatureNoteText,
} from './literature-note.ts';
export type { LiteratureNote } from './literature-note.ts';
export { highlightRows, mayHoldHighlights } from './highlight-rows.ts';
export type { HighlightRow } from './highlight-rows.ts';
