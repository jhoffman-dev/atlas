import { describe, expect, it } from 'vitest';
import { findQuote, hasWords, quoteSelectorAt, rectsForRange } from '@dfai/domain';
import { PdfUnreadableError } from '@dfai/application';
import { fixturePdf, lanternFixturePdf } from '../../../../tools/pdf/fixture-pdf.ts';
import { pdfJsReader } from './pdfjs-reader.ts';

/*
 * pdf.js itself, on PDFs made for the test (tools/pdf/fixture-pdf.ts): in
 * Node it parses on this thread, so what is read here is what the worker
 * reads in the app. Drawing a page needs a canvas, which the e2e suite has.
 */

const reader = pdfJsReader();
const open = () => reader.open(new Uint8Array(lanternFixturePdf()));

describe('opening a PDF with pdf.js', () => {
  it('reads its pages, its title and author, and leaves the bytes it was given alone', async () => {
    const bytes = new Uint8Array(lanternFixturePdf());
    const document = await reader.open(bytes);
    expect(document.pageCount).toBe(4);
    expect(await document.metadata()).toEqual({
      title: 'The Lantern Keepers',
      author: 'Mara Quill',
    });
    expect(await document.pageSize(1)).toEqual({ width: 612, height: 792 });
    expect(new TextDecoder().decode(bytes.subarray(0, 5))).toBe('%PDF-');
    await document.close();
  });

  it("reads a page's words line by line, each run placed on the page from its top-left", async () => {
    const document = await open();
    const page = await document.pageText(1);
    expect(page.text).toBe(
      'Chapter One. The keepers of Brightwater lit the lamps at dusk.\n' +
        'Every lantern on the harbour wall was trimmed by hand.\n' +
        'A light kept is a promise kept, the old keeper said.',
    );
    const first = page.runs[0]?.box;
    // The first line's baseline is 72pt from the top of a 792pt page, its font 12pt.
    expect(first?.x).toBeCloseTo(72 / 612);
    expect(first?.y).toBeCloseTo((72 - 12) / 792);
    expect(first?.height).toBeCloseTo(12 / 792);
    expect(page.runs[1]?.box.y).toBeGreaterThan(first?.y ?? 1);
    await document.close();
  });

  it('gives the same words twice without reading the page again', async () => {
    const document = await open();
    expect(await document.pageText(2)).toBe(await document.pageText(2));
    await document.close();
  });

  it('reads no words on a page with none, as a scan has', async () => {
    const document = await open();
    expect(hasWords(await document.pageText(4))).toBe(false);
    await document.close();
  });

  it('finds a highlight it made again by its words, on the same boxes', async () => {
    const document = await open();
    const page = await document.pageText(2);
    const start = page.text.indexOf('A light kept');
    const selector = quoteSelectorAt({ text: page.text, start, end: start + 12 });
    const found = findQuote(page.text, selector);
    expect(found?.start).toBe(start);
    const [box] = rectsForRange(page, start, start + 12);
    expect(box?.x).toBeCloseTo(72 / 612);
    expect(box?.width).toBeGreaterThan(0.05);
    await document.close();
  });

  it('reads the outline with the page each entry goes to', async () => {
    const document = await open();
    expect(await document.outline()).toEqual([
      { title: 'Chapter One', page: 1, children: [] },
      { title: 'Chapter Two', page: 2, children: [] },
      { title: 'Chapter Three', page: 3, children: [] },
    ]);
    await document.close();
  });

  it('reads no outline, title or author from a PDF without them', async () => {
    const document = await reader.open(
      new Uint8Array(fixturePdf({ pages: [{ lines: ['Only words.'] }] })),
    );
    expect(await document.outline()).toEqual([]);
    expect(await document.metadata()).toEqual({ title: null, author: null });
    await document.close();
  });
});

describe('a PDF pdf.js cannot read', () => {
  it('is refused as damaged when its bytes are not a PDF', async () => {
    await expect(reader.open(new TextEncoder().encode('<html>not a pdf</html>'))).rejects.toThrow(
      PdfUnreadableError,
    );
  });

  it('is refused as damaged when it is cut short', async () => {
    const whole = lanternFixturePdf();
    const error = await reader
      .open(new Uint8Array(whole.subarray(0, 40)))
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(PdfUnreadableError);
    expect((error as PdfUnreadableError).reason).toMatch(/^it is damaged or not a PDF/);
  });
});
