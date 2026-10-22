import {
  getDocument,
  GlobalWorkerOptions,
  PasswordException,
  Util,
  type PDFDocumentProxy,
  type PDFPageProxy,
} from 'pdfjs-dist/legacy/build/pdf.mjs';
import {
  pdfPageText,
  type PageRect,
  type PdfMetadata,
  type PdfPageText,
  type PdfTextRun,
} from '@dfai/domain';
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

/** A page being drawn into a canvas: wait for it, or stop it. */
export interface PageDrawing {
  readonly done: Promise<void>;
  cancel(): void;
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

export function pdfJsReader(files: PdfJsFiles = {}): PdfJsReader {
  if (files.worker !== undefined) GlobalWorkerOptions.workerSrc = files.worker;
  return {
    async open(bytes) {
      const task = getDocument({
        // pdf.js hands its bytes to the worker and they are gone from here: a copy keeps the caller's.
        data: bytes.slice(),
        verbosity: 0,
        enableXfa: false,
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
      let text = texts.get(page);
      if (text === undefined) {
        text = pageAt(page).then(textOf);
        texts.set(page, text);
      }
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
    const [, , c, d, left, baseline] = Util.transform(
      viewport.transform,
      item.transform,
    ) as number[];
    const height = Math.hypot(c ?? 0, d ?? 0);
    runs.push({
      text: item.str,
      endsLine: item.hasEOL,
      box: {
        x: (left ?? 0) / viewport.width,
        y: ((baseline ?? 0) - height) / viewport.height,
        width: item.width / viewport.width,
        height: height / viewport.height,
      },
    });
  }
  return pdfPageText(runs);
}

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

function drawInto(
  page: Promise<PDFPageProxy>,
  { canvas, scale }: { canvas: HTMLCanvasElement; scale: number },
): PageDrawing {
  let cancelled = false;
  let stop = () => {
    cancelled = true;
  };
  const done = page.then(async (proxy) => {
    if (cancelled) return;
    const viewport = proxy.getViewport({ scale });
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    const task = proxy.render({ canvas, viewport });
    stop = () => task.cancel();
    await task.promise;
  });
  return { done, cancel: () => stop() };
}

async function pictureOf(
  page: PDFPageProxy,
  { box, scale }: { box: PageRect; scale: number },
): Promise<Uint8Array> {
  const whole = document.createElement('canvas');
  await drawInto(Promise.resolve(page), { canvas: whole, scale }).done;
  const cut = document.createElement('canvas');
  cut.width = Math.max(1, Math.round(box.width * whole.width));
  cut.height = Math.max(1, Math.round(box.height * whole.height));
  const context = cut.getContext('2d');
  if (context === null) throw new Error('the picture of the area could not be drawn');
  context.drawImage(
    whole,
    box.x * whole.width,
    box.y * whole.height,
    cut.width,
    cut.height,
    0,
    0,
    cut.width,
    cut.height,
  );
  const blob = await new Promise<Blob | null>((resolve) => cut.toBlob(resolve, 'image/png'));
  if (blob === null) throw new Error('the picture of the area could not be saved as PNG');
  return new Uint8Array(await blob.arrayBuffer());
}
