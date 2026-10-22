import {
  getDocument,
  GlobalWorkerOptions,
  PasswordException,
  type PDFDocumentProxy,
  type PDFPageProxy,
} from 'pdfjs-dist/legacy/build/pdf.mjs';
import {
  onPage,
  pdfPageText,
  type PageRect,
  type PdfMetadata,
  type PdfPageText,
  type PdfTextRun,
  type RunDirection,
} from '@dfai/domain';
import { drawInto, MAX_CANVAS_PIXELS, pictureOf, type PageDrawing } from './page-drawing.ts';
import {
  PdfUnreadableError,
  type PdfDocument,
  type PdfOutlineEntry,
  type PdfPageSize,
  type PdfReaderPort,
} from '@dfai/application';

/*
 * pdf.js behind the reader's port (#504). It translates: a page's text items
 * into runs placed in fractions of the page, the outline's destinations into
 * page numbers, its exceptions into `PdfUnreadableError`. It never fetches:
 * every PDF is opened from bytes, and the worker, fonts and decoders are
 * files of the app's own build, at the addresses the composition root gives.
 */

/** Where pdf.js's own files are in the app's build; none of them is fetched from anywhere else. */
export interface PdfJsFiles {
  /** pdf.js's worker script; without it (in Node) pdf.js parses on the calling thread. */
  readonly worker?: string;
  /** Folders of the standard fonts, character maps and image decoders, each ending in `/`. */
  readonly standardFonts?: string;
  readonly characterMaps?: string;
  readonly decoders?: string;
}

/** An open PDF that can also draw its pages. */
export interface PdfJsDocument extends PdfDocument {
  /** Draws page `page` into `canvas`, `scale` canvas pixels to a point. */
  drawPage(args: { page: number; canvas: HTMLCanvasElement; scale: number }): PageDrawing;
  /** A PNG of `box` on page `page`, drawn `scale` pixels to a point. */
  pictureOf(args: { page: number; box: PageRect; scale: number }): Promise<Uint8Array>;
}

/** The reader's port, opening PDFs that can also draw themselves. */
export interface PdfJsReader extends PdfReaderPort {
  open(bytes: Uint8Array): Promise<PdfJsDocument>;
}

export type { PageDrawing };

export function pdfJsReader(files: PdfJsFiles = {}): PdfJsReader {
  if (files.worker !== undefined) GlobalWorkerOptions.workerSrc = files.worker;
  return {
    async open(bytes) {
      const task = getDocument({
        // pdf.js hands its bytes to the worker and they are gone from here: a copy keeps the caller's.
        data: bytes.slice(),
        verbosity: 0,
        enableXfa: false,
        // An image or a canvas past what a webview holds is skipped or shrunk, never a reason to crash the tab.
        maxImageSize: MAX_CANVAS_PIXELS * 4,
        canvasMaxAreaInBytes: MAX_CANVAS_PIXELS * 4,
        ...(files.standardFonts !== undefined && { standardFontDataUrl: files.standardFonts }),
        ...(files.characterMaps !== undefined && { cMapUrl: files.characterMaps }),
        ...(files.decoders !== undefined && { wasmUrl: files.decoders }),
      });
      try {
        return openedDocument(await task.promise);
      } catch (error) {
        await task.destroy();
        throw unreadable(error);
      }
    },
  };
}

function unreadable(error: unknown): PdfUnreadableError {
  if (error instanceof PasswordException)
    return new PdfUnreadableError('it is locked with a password');
  const reason = error instanceof Error ? error.message : String(error);
  return new PdfUnreadableError(`it is damaged or not a PDF (${reason})`);
}

function openedDocument(proxy: PDFDocumentProxy): PdfJsDocument {
  const texts = new Map<number, Promise<PdfPageText>>();
  const pageAt = (page: number) => proxy.getPage(page);
  return {
    pageCount: proxy.numPages,
    async pageSize(page) {
      return sizeOf(await pageAt(page));
    },
    pageText(page) {
      const known = texts.get(page);
      if (known !== undefined) return known;
      const text = pageAt(page).then(textOf);
      texts.set(page, text);
      // A failed read is not remembered: the next ask reads the page again. The caller gets the failure.
      text.catch(() => {
        if (texts.get(page) === text) texts.delete(page);
      });
      return text;
    },
    metadata: async () => metadataOf(await proxy.getMetadata()),
    outline: async () => outlineOf(proxy, (await proxy.getOutline()) ?? []),
    close: () => proxy.loadingTask.destroy(),
    drawPage: ({ page, canvas, scale }) => drawInto(pageAt(page), { canvas, scale }),
    pictureOf: async ({ page, box, scale }) => pictureOf(await pageAt(page), { box, scale }),
  };
}

function sizeOf(page: PDFPageProxy): PdfPageSize {
  const { width, height } = page.getViewport({ scale: 1 });
  return { width, height };
}

/** The page's text items as runs, each box in fractions of the page from its top-left corner. */
async function textOf(page: PDFPageProxy): Promise<PdfPageText> {
  const viewport = page.getViewport({ scale: 1 });
  const content = await page.getTextContent();
  const runs: PdfTextRun[] = [];
  for (const item of content.items) {
    if (!('str' in item)) continue;
    const vertical = content.styles[item.fontName]?.vertical === true;
    const shape = shapeOf(item, vertical);
    const direction = directionOnPage(shape, viewport);
    runs.push({
      text: item.str,
      endsLine: item.hasEOL,
      box: boxOnPage(shape, viewport),
      ...(!upright(direction) && { direction }),
    });
  }
  return pdfPageText(runs);
}

/** A point, or a step, in the PDF's user space (points, y up). */
interface UserPoint {
  readonly x: number;
  readonly y: number;
}

/** A text item in the PDF's user space: its first letter's baseline point, the step to its end, the step up its letters. */
interface ItemShape {
  readonly start: UserPoint;
  readonly along: UserPoint;
  readonly rise: UserPoint;
}

interface Viewport {
  readonly transform: number[];
  readonly width: number;
  readonly height: number;
}

/**
 * A text item's shape from its transform. A font written top to bottom
 * advances down its letters by `height` (pdf.js gives such an item its
 * length there, not in `width`), and its column is centred on the item's
 * origin, as vertical writing places a glyph.
 */
function shapeOf(
  item: { transform: number[]; width: number; height: number },
  vertical: boolean,
): ItemShape {
  const [a = 0, b = 0, c = 0, d = 0, left = 0, baseline = 0] = item.transform;
  if (vertical) {
    return {
      start: { x: left - a / 2, y: baseline - b / 2 },
      along: unit(-c, -d, item.height),
      rise: { x: a, y: b },
    };
  }
  return { start: { x: left, y: baseline }, along: unit(a, b, item.width), rise: { x: c, y: d } };
}

/**
 * Where a text item is on the page as it is shown, in fractions of its width
 * and height: the box round all four corners of the item's rectangle, so a
 * page turned a quarter, and text set sideways or at an angle, are boxed
 * where they are, not as a line along the page's width.
 */
function boxOnPage({ start, along, rise }: ItemShape, viewport: Viewport): PageRect {
  const corners = [
    [start.x, start.y],
    [start.x + along.x, start.y + along.y],
    [start.x + rise.x, start.y + rise.y],
    [start.x + along.x + rise.x, start.y + along.y + rise.y],
  ].map(([x = 0, y = 0]) => shown([x, y], viewport.transform));
  const xs = corners.map(([x = 0]) => x);
  const ys = corners.map(([, y = 0]) => y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return onPage({
    x: x / viewport.width,
    y: y / viewport.height,
    width: (Math.max(...xs) - x) / viewport.width,
    height: (Math.max(...ys) - y) / viewport.height,
  });
}

/** Which way a text item reads as it is shown, in fractions of the page. */
function directionOnPage({ start, along, rise }: ItemShape, viewport: Viewport): RunDirection {
  const [a = 1, b = 0, c = 0, d = 1] = viewport.transform;
  const fraction = ([x = 0, y = 0]: number[]) => ({
    x: x / viewport.width,
    y: y / viewport.height,
  });
  // A step is turned by the viewport but not moved: only its linear part applies.
  const step = (by: UserPoint) => fraction([a * by.x + c * by.y, b * by.x + d * by.y]);
  return {
    origin: fraction(shown([start.x, start.y], viewport.transform)),
    advance: step(along),
    rise: step(rise),
  };
}

/** How far off level a run's advance may lean, as a share of its length, and still read across the page. */
const LEVEL = 1e-6;

/**
 * Whether a run reads left to right across the page, as its box alone says:
 * decided by its advance only, so a slanted (oblique) line and a matrix with
 * rounding noise in it are still read along their box.
 */
const upright = ({ advance }: RunDirection): boolean =>
  advance.x >= 0 && Math.abs(advance.y) <= LEVEL * Math.hypot(advance.x, advance.y);

/** A point of the PDF's user space where the viewport puts it. */
function shown([x, y]: [number, number], [a = 1, b = 0, c = 0, d = 1, e = 0, f = 0]: number[]) {
  return [a * x + c * y + e, b * x + d * y + f];
}

/** A step of `length` the way `(x, y)` points; no step when it points nowhere. */
const unit = (x: number, y: number, length: number) => {
  const size = Math.hypot(x, y);
  return size === 0 ? { x: 0, y: 0 } : { x: (x / size) * length, y: (y / size) * length };
};

function metadataOf({ info }: { info: object }): PdfMetadata {
  const fields = info as { Title?: unknown; Author?: unknown };
  const text = (value: unknown) =>
    typeof value === 'string' && value.trim() !== '' ? value : null;
  return { title: text(fields.Title), author: text(fields.Author) };
}

interface OutlineNode {
  readonly title: string;
  readonly dest: string | unknown[] | null;
  readonly items: readonly OutlineNode[];
}

async function outlineOf(
  proxy: PDFDocumentProxy,
  nodes: readonly OutlineNode[],
): Promise<PdfOutlineEntry[]> {
  return Promise.all(
    nodes.map(async (node) => ({
      title: node.title,
      page: await pageOfDestination(proxy, node.dest),
      children: await outlineOf(proxy, node.items),
    })),
  );
}

/** The page (from 1) an outline entry goes to, or null when its destination names none. */
async function pageOfDestination(
  proxy: PDFDocumentProxy,
  dest: string | unknown[] | null,
): Promise<number | null> {
  try {
    const explicit = typeof dest === 'string' ? await proxy.getDestination(dest) : dest;
    const target = explicit?.[0];
    if (typeof target === 'number') return target + 1;
    if (typeof target === 'object' && target !== null) {
      return (
        (await proxy.getPageIndex(target as Parameters<PDFDocumentProxy['getPageIndex']>[0])) + 1
      );
    }
    return null;
  } catch {
    // A destination the PDF names wrongly costs that entry its page, not the outline.
    return null;
  }
}
