import type { PDFPageProxy } from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { PageRect } from '@dfai/domain';

/*
 * Drawing a pdf.js page into a canvas (#504), within what a webview can hold:
 * the pages of a poster or a plan are far larger than a canvas may be, so
 * the canvas is drawn at fewer pixels than the page is shown at, and the
 * page stretches it. A page that leaves the window is let go of (pdf.js's
 * `cleanup`), so a long book does not keep every page it was scrolled past.
 */

/** The most pixels a canvas is drawn with: pdf.js's own viewer holds to 2^24. */
export const MAX_CANVAS_PIXELS = 2 ** 24;

/** The longest a canvas side is: past 16384 pixels WebKit draws nothing. */
export const MAX_CANVAS_SIDE = 16384;

/** A page being drawn into a canvas: wait for it, or stop it. */
export interface PageDrawing {
  readonly done: Promise<void>;
  cancel(): void;
}

/**
 * `scale` (canvas pixels to a point), lowered when a `width` by `height`
 * points area drawn at it would be more pixels, or a longer side, than a
 * canvas may have.
 */
export function cappedScale({
  width,
  height,
  scale,
}: {
  width: number;
  height: number;
  scale: number;
}): number {
  const byArea = Math.sqrt(MAX_CANVAS_PIXELS / (width * height));
  const bySide = MAX_CANVAS_SIDE / Math.max(width, height);
  return Math.min(scale, byArea, bySide);
}

/**
 * Draws `page` into `canvas`, `scale` pixels to a point at most. Cancelling
 * stops the drawing and lets go of what pdf.js kept for the page.
 */
export function drawInto(
  page: Promise<PDFPageProxy>,
  { canvas, scale }: { canvas: HTMLCanvasElement; scale: number },
): PageDrawing {
  let cancelled = false;
  let stop = () => {
    cancelled = true;
  };
  let release: () => void = () => {};
  const done = page.then(async (proxy) => {
    release = () => void proxy.cleanup();
    if (cancelled) return;
    const shown = proxy.getViewport({ scale: 1 });
    const viewport = proxy.getViewport({ scale: cappedScale({ ...shown, scale }) });
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    const task = proxy.render({ canvas, viewport });
    stop = () => task.cancel();
    await task.promise;
  });
  return {
    done,
    cancel() {
      stop();
      // cleanup() declines while a render is still stopping, so it waits for the drawing to end either way.
      const letGo = () => release();
      void done.then(letGo, letGo);
    },
  };
}

/** A PNG of `box` of `page`, drawn `scale` pixels to a point at most; only the box is drawn, never the whole page. */
export async function pictureOf(
  page: PDFPageProxy,
  { box, scale }: { box: PageRect; scale: number },
): Promise<Uint8Array> {
  const shown = page.getViewport({ scale: 1 });
  const wide = box.width * shown.width;
  const high = box.height * shown.height;
  const drawn = cappedScale({ width: wide, height: high, scale });
  const cut = document.createElement('canvas');
  cut.width = Math.max(1, Math.round(wide * drawn));
  cut.height = Math.max(1, Math.round(high * drawn));
  const viewport = page.getViewport({
    scale: drawn,
    // The page is moved up and left so the box's corner is the canvas's.
    offsetX: -box.x * shown.width * drawn,
    offsetY: -box.y * shown.height * drawn,
  });
  await page.render({ canvas: cut, viewport }).promise;
  const blob = await new Promise<Blob | null>((resolve) => cut.toBlob(resolve, 'image/png'));
  if (blob === null) throw new Error('the picture of the area could not be saved as PNG');
  return new Uint8Array(await blob.arrayBuffer());
}
