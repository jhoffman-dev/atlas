export { addPdfToLibrary, PdfNotAddedError } from './add-pdf.ts';
export type { AddedPdf, AddPdfPorts, PickedPdf } from './add-pdf.ts';
export { findLiteratureNote } from './find-literature-note.ts';
export type { FindLiteratureNotePorts } from './find-literature-note.ts';
export { allPageTexts, placeHighlights } from './place-highlights.ts';
export type { PlacedHighlight } from './place-highlights.ts';
export {
  highlightArea,
  highlightSelection,
  NothingToHighlightError,
  readLiteratureNoteAt,
} from './pdf-highlights.ts';
export type { ReadLiteratureNote } from './pdf-highlights.ts';
export { PdfUnreadableError } from './ports.ts';
export type { PdfDocument, PdfOutlineEntry, PdfPageSize, PdfReaderPort } from './ports.ts';
