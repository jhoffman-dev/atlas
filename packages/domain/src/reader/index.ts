/*
 * The PDF reader's rules (#504): a page's words and where they sit, what a
 * selection or a dragged box becomes, where a stored highlight is drawn,
 * find in a document, zoom, and what adding a PDF to the library names.
 * All pure; pdf.js is the adapters' and the screen is the UI's.
 */
export {
  EMPTY_PAGE_TEXT,
  hasWords,
  onPage,
  pdfPageText,
  rectsForRange,
  textOffsetNear,
} from './pdf-page-text.ts';
export type {
  PageVector,
  PdfPageText,
  PdfTextRun,
  PlacedTextRun,
  RunDirection,
} from './pdf-page-text.ts';
export {
  areaHighlight,
  draggedBox,
  SMALLEST_AREA,
  textHighlight,
  trimmedSelection,
} from './pdf-selection.ts';
export type { PagePoint, TextSelection } from './pdf-selection.ts';
export {
  inReadingOrder,
  isExact,
  placeByBoxes,
  placeByWords,
  placeOnItsPage,
} from './placement.ts';
export type { DrawnPlacement, HighlightPlacement } from './placement.ts';
export { findInDocument, MOST_MATCHES, stepMatch } from './find-in-document.ts';
export type { DocumentMatch } from './find-in-document.ts';
export {
  clampZoom,
  fitWidthZoom,
  LARGEST_ZOOM,
  SMALLEST_ZOOM,
  ZOOM_STEPS,
  zoomIn,
  zoomLabel,
  zoomOut,
} from './zoom.ts';
export {
  areaImageName,
  checkIncomingPdf,
  isPdfName,
  libraryFileName,
  libraryFolder,
  literatureDetails,
  literatureNoteFileName,
  looksLikePdf,
  MAX_PDF_BYTES,
} from './pdf-library.ts';
export type { IncomingPdf, PdfCheck, PdfMetadata } from './pdf-library.ts';
export { placeOfFile } from './document-place.ts';
