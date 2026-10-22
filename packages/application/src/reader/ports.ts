import type { PdfMetadata, PdfPageText } from '@dfai/domain';

/*
 * What the PDF reader's use-cases need of a PDF (#504): its pages' words and
 * sizes, what it says about itself, and its outline. pdf.js answers it in
 * the adapters; drawing a page is the screen's, and not asked here.
 */

/** A page's size in PDF points (1/72 inch), as it is shown: rotation applied. */
export interface PdfPageSize {
  readonly width: number;
  readonly height: number;
}

/** One entry of a PDF's outline (its bookmarks), and the entries under it. */
export interface PdfOutlineEntry {
  readonly title: string;
  /** The page it goes to, from 1; null when the PDF's link names no page this reader can find. */
  readonly page: number | null;
  readonly children: readonly PdfOutlineEntry[];
}

/** An open PDF. */
export interface PdfDocument {
  readonly pageCount: number;
  /** Page `page` (from 1)'s size. */
  pageSize(page: number): Promise<PdfPageSize>;
  /** Page `page` (from 1)'s words and where they sit; a scanned page has none. */
  pageText(page: number): Promise<PdfPageText>;
  metadata(): Promise<PdfMetadata>;
  outline(): Promise<readonly PdfOutlineEntry[]>;
  /** Lets the PDF go: nothing may be asked of it after. */
  close(): Promise<void>;
}

/** Opens PDFs from their bytes. The bytes are the caller's still: they are not handed over. */
export interface PdfReaderPort {
  /** Throws `PdfUnreadableError` for bytes that are not a PDF it can read, or one with a password. */
  open(bytes: Uint8Array): Promise<PdfDocument>;
}

/** Bytes the PDF reader could not open: not a PDF, damaged, or locked with a password. */
export class PdfUnreadableError extends Error {
  constructor(readonly reason: string) {
    super(`This PDF could not be read: ${reason}`);
    this.name = 'PdfUnreadableError';
  }
}
