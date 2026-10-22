import type {
  DocumentMatch,
  HighlightPlacement,
  HighlightStyle,
  PageRect,
  PdfPageText,
  TextSelection,
} from '@dfai/domain';

/*
 * What the PDF reader is handed (#504): a document it can ask for pages,
 * the highlights already placed on it, and what to call when the person
 * marks something. It draws; every rule is the caller's.
 */

/** A page's size in PDF points. */
export interface ReaderPageSize {
  readonly width: number;
  readonly height: number;
}

/** A page being drawn: wait for it, or stop it. */
export interface ReaderDrawing {
  readonly done: Promise<void>;
  cancel(): void;
}

/** The open PDF, as the reader draws it. */
export interface ReaderDocument {
  readonly pageCount: number;
  pageSize(page: number): Promise<ReaderPageSize>;
  pageText(page: number): Promise<PdfPageText>;
  drawPage(args: { page: number; canvas: HTMLCanvasElement; scale: number }): ReaderDrawing;
}

export interface ReaderOutlineEntry {
  readonly title: string;
  readonly page: number | null;
  readonly children: readonly ReaderOutlineEntry[];
}

/** A highlight of the document, and where it is drawn. */
export interface ReaderHighlight {
  readonly id: string;
  /** Its words as the note shows them; empty for an area. */
  readonly quote: string;
  readonly comment: string;
  readonly style: HighlightStyle;
  readonly placement: HighlightPlacement;
}

/**
 * A highlight to bring into view and flash, or a page to bring into view
 * (`[[file.pdf#page=3]]`); `key` changes for each ask, so asking twice acts
 * twice.
 */
export type ReaderReveal =
  { readonly id: string; readonly key: number } | { readonly page: number; readonly key: number };

/** What the person marked, and how. */
export interface MarkRequest {
  readonly style: HighlightStyle;
  readonly comment?: string;
}

/**
 * What the reader asks the note to do. A write answers whether the note took
 * it: false is a write refused (and said by the reader's notice), so a form
 * holding the person's words stays open for them to try again.
 */
export interface ReaderActions {
  onHighlight(request: MarkRequest & { selection: TextSelection }): Promise<boolean>;
  onHighlightArea(request: MarkRequest & { page: number; box: PageRect }): Promise<boolean>;
  onEditComment(request: { id: string; comment: string }): Promise<boolean>;
  onRemove(id: string): Promise<boolean>;
  onSearch(phrase: string): Promise<{ matches: readonly DocumentMatch[]; more: boolean }>;
}
