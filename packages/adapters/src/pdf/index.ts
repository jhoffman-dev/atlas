/*
 * The PDF reader's adapter (#504), an entry point of its own: pdf.js is half a
 * megabyte, and only the reader's chunk, loaded the first time a PDF opens,
 * imports it. Exported from the package's main barrel it would land in the
 * start-up bundle.
 */
export { pdfJsReader } from './pdfjs-reader.ts';
export type { PageDrawing, PdfJsDocument, PdfJsFiles, PdfJsReader } from './pdfjs-reader.ts';
