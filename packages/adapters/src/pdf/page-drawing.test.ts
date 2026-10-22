import { describe, expect, it, vi } from 'vitest';
import type { PDFPageProxy } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { cappedScale, drawInto, MAX_CANVAS_PIXELS, pictureOf } from './page-drawing.ts';

/*
 * Drawing within what a webview can hold, and letting a page go when it
 * leaves the window (#504), against a page proxy that records what it is asked.
 */

/** A page `width` by `height` points that records its renders and cleanups. */
function fakePage({ width, height }: { width: number; height: number }) {
  const renders: { width: number; height: number; offsetX: number; offsetY: number }[] = [];
  const cleanups: number[] = [];
  let finish: () => void = () => {};
  const page = {
    getViewport: ({ scale, offsetX = 0, offsetY = 0 }: Record<string, number>) => ({
      width: width * (scale ?? 1),
      height: height * (scale ?? 1),
      offsetX,
      offsetY,
    }),
    render: ({ viewport }: { viewport: (typeof renders)[number] }) => {
      renders.push(viewport);
      return {
        promise: new Promise<void>((resolve) => (finish = resolve)),
        cancel: () => finish(),
      };
    },
    cleanup: () => {
      cleanups.push(renders.length);
      return true;
    },
  };
  return { page: page as unknown as PDFPageProxy, renders, cleanups, finish: () => finish() };
}

const canvas = () => ({ width: 0, height: 0 }) as HTMLCanvasElement;

describe('the scale a page is drawn at', () => {
  it('is the one asked for when the canvas it makes is small enough', () => {
    expect(cappedScale({ width: 612, height: 792, scale: 2 })).toBe(2);
  });

  it('is lowered until the canvas has no more than 2^24 pixels and no side past 16384', () => {
    const scale = cappedScale({ width: 14400, height: 14400, scale: 4 });
    expect(14400 * scale * 14400 * scale).toBeLessThanOrEqual(MAX_CANVAS_PIXELS + 1);
    const thin = cappedScale({ width: 20000, height: 100, scale: 4 });
    expect(20000 * thin).toBeLessThanOrEqual(16384);
  });
});

describe('drawing a page into a canvas', () => {
  it('draws a page 200 inches square at a canvas within the cap', async () => {
    const { page } = fakePage({ width: 14400, height: 14400 });
    const target = canvas();
    const drawing = drawInto(Promise.resolve(page), { canvas: target, scale: 4 });
    await Promise.resolve();
    await Promise.resolve();
    expect(target.width * target.height).toBeLessThanOrEqual(MAX_CANVAS_PIXELS);
    expect(target.width * target.height).toBeGreaterThan(0);
    drawing.cancel();
  });

  it('lets the page go once cancelled, after the drawing has stopped', async () => {
    const drawn = fakePage({ width: 612, height: 792 });
    const drawing = drawInto(Promise.resolve(drawn.page), { canvas: canvas(), scale: 1 });
    await vi.waitFor(() => expect(drawn.renders).toHaveLength(1));
    drawing.cancel();
    await drawing.done;
    await vi.waitFor(() => expect(drawn.cleanups).toHaveLength(1));
  });

  it('draws nothing, and still lets the page go, when cancelled before the page arrived', async () => {
    const drawn = fakePage({ width: 612, height: 792 });
    const drawing = drawInto(Promise.resolve(drawn.page), { canvas: canvas(), scale: 1 });
    drawing.cancel();
    await drawing.done;
    await vi.waitFor(() => expect(drawn.cleanups).toHaveLength(1));
    expect(drawn.renders).toEqual([]);
  });
});

describe('the picture of an area', () => {
  it('draws only the box, on a canvas of its own size, the page moved so the box is at the corner', async () => {
    const drawn = fakePage({ width: 14400, height: 14400 });
    const made = {
      width: 0,
      height: 0,
      toBlob: (done: (blob: Blob) => void) => done(new Blob([])),
    };
    vi.stubGlobal('document', { createElement: () => made });
    const picture = pictureOf(drawn.page, {
      box: { x: 0.5, y: 0.25, width: 0.01, height: 0.02 },
      scale: 2,
    });
    await vi.waitFor(() => expect(drawn.renders).toHaveLength(1));
    drawn.finish();
    await picture;
    vi.unstubAllGlobals();
    // 144 by 288 points at 2 pixels to a point; the page is nowhere drawn whole.
    expect([made.width, made.height]).toEqual([288, 576]);
    expect(drawn.renders[0]).toMatchObject({
      offsetX: -0.5 * 14400 * 2,
      offsetY: -0.25 * 14400 * 2,
    });
  });
});
