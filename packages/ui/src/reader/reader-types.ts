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

/** A highlight to bring into view and flash; `key` changes for each ask, so asking twice flashes twice. */
export interface ReaderReveal {
  readonly id: string;
  readonly key: number;
}

/** What the person marked, and how. */
export interface MarkRequest {
  readonly style: HighlightStyle;
  readonly comment?: string;
}

export interface ReaderActions {
  onHighlight(request: MarkRequest & { selection: TextSelection }): Promise<void>;
  onHighlightArea(request: MarkRequest & { page: number; box: PageRect }): Promise<void>;
  onEditComment(request: { id: string; comment: string }): Promise<void>;
  onRemove(id: string): Promise<void>;
  onSearch(phrase: string): Promise<{ matches: readonly DocumentMatch[]; more: boolean }>;
}
