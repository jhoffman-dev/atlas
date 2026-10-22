import { describe, expect, it } from 'vitest';
import { rectsForRange } from '@dfai/domain';
import { PdfUnreadableError } from '@dfai/application';
import {
  brokenXrefPdf,
  embeddedFilePdf,
  hostilePdf,
  hugePagePdf,
  linkedPdf,
  passwordPdf,
  rotatedPagePdf,
} from '../../../../tools/pdf/hostile-pdf.ts';
import { pdfJsReader } from './pdfjs-reader.ts';

/*
 * Regression tests for the PDF reader (#504, review of PR #515): pdf.js behind the port, on
 * hostile PDFs made for the test (tools/pdf/hostile-pdf.ts). No network.
 */

const reader = pdfJsReader();
const open = (bytes: Buffer) => reader.open(new Uint8Array(bytes));
const LINE = 'The tide bell rang over the grey harbour.';

describe('text turned a quarter is boxed where it is on the page', () => {
  it('boxes a line on a page with /Rotate 90 tall and narrow, as it is shown', async () => {
    const document = await open(rotatedPagePdf());
    // Shown turned: 792 wide and 612 high.
    expect(await document.pageSize(1)).toEqual({ width: 792, height: 612 });
    const page = await document.pageText(1);
    expect(page.text).toBe(LINE);
    const [box] = rectsForRange(page, 0, page.text.length);
    // The line runs down the page as shown, so its box is taller than it is wide.
    expect(box?.height ?? 0).toBeGreaterThan(box?.width ?? 0);
    await document.close();
  });

  it('boxes a line set vertically with its text matrix tall and narrow', async () => {
    const document = await open(
      hostilePdf({ content: `BT /F1 12 Tf 0 1 -1 0 300 100 Tm (${LINE}) Tj ET` }),
    );
    const page = await document.pageText(1);
    const [box] = rectsForRange(page, 0, page.text.length);
    expect(box?.height ?? 0).toBeGreaterThan(box?.width ?? 0);
    await document.close();
  });
});

describe('text on a page turned three quarters, and stored boxes stay on the page', () => {
  it('boxes a line on a page with /Rotate 270 tall and narrow, inside the page', async () => {
    const document = await open(hostilePdf({ page: '/MediaBox [0 0 612 792] /Rotate 270' }));
    const page = await document.pageText(1);
    const rects = rectsForRange(page, 0, page.text.length);
    expect(rects[0]?.height ?? 0).toBeGreaterThan(rects[0]?.width ?? 0);
    for (const rect of rects) {
      expect(rect.x).toBeGreaterThanOrEqual(0);
      expect(rect.y).toBeGreaterThanOrEqual(0);
      expect(rect.x + rect.width).toBeLessThanOrEqual(1);
      expect(rect.y + rect.height).toBeLessThanOrEqual(1);
    }
    await document.close();
  });

  it('keeps every run of a turned and of a vertical page within the page', async () => {
    for (const bytes of [
      rotatedPagePdf(),
      hostilePdf({ content: `BT /F1 12 Tf 0 1 -1 0 300 100 Tm (${LINE}) Tj ET` }),
    ]) {
      const document = await open(bytes);
      const page = await document.pageText(1);
      for (const run of page.runs) {
        expect(run.box.x).toBeGreaterThanOrEqual(0);
        expect(run.box.y).toBeGreaterThanOrEqual(0);
        expect(run.box.x + run.box.width).toBeLessThanOrEqual(1.0001);
        expect(run.box.y + run.box.height).toBeLessThanOrEqual(1.0001);
      }
      await document.close();
    }
  });
});

describe('hostile PDFs', () => {
  it('refuses a PDF locked with a password, saying so', async () => {
    const opening = open(passwordPdf());
    await expect(opening).rejects.toBeInstanceOf(PdfUnreadableError);
    await expect(opening).rejects.toMatchObject({ reason: 'it is locked with a password' });
  });

  it('opens a PDF whose table of objects is in the wrong place, as pdf.js mends it', async () => {
    const document = await open(brokenXrefPdf());
    expect((await document.pageText(1)).text).toBe(LINE);
    await document.close();
  });

  it('reads the words of a PDF with links and JavaScript, the links not among them', async () => {
    const document = await open(linkedPdf());
    expect((await document.pageText(1)).text).toBe(LINE);
    await document.close();
  });

  it('reads a PDF with an embedded file as its pages alone', async () => {
    const document = await open(embeddedFilePdf());
    expect(document.pageCount).toBe(1);
    expect((await document.pageText(1)).text).toBe(LINE);
    await document.close();
  });

  it('gives a page 200 inches square its size in points', async () => {
    const document = await open(hugePagePdf());
    expect(await document.pageSize(1)).toEqual({ width: 14400, height: 14400 });
    await document.close();
  });
});
