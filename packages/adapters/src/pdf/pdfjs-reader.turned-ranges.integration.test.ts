import { describe, expect, it } from 'vitest';
import { rectsForRange, type PageRect, type PdfPageText } from '@dfai/domain';
import { hostilePdf } from '../../../../tools/pdf/hostile-pdf.ts';
import { pdfJsReader } from './pdfjs-reader.ts';

/*
 * Verification of PR #515 (#504) after ad1cc5f7: a run's box is now drawn
 * round all four corners, so a whole run on a turned page is boxed where it
 * is. These pin the part of a run — a word picked, a passage re-anchored —
 * which `rectsForRange` still cuts along the box's width, from its left
 * edge, as if every run read left to right across the page. PDFs are made
 * for the test; every word is made up. No network.
 */

const reader = pdfJsReader();
const LINE = 'The tide bell rang over the grey harbour.';
const FIRST_WORDS = 'The tide';

async function firstWordsAndRun(
  bytes: Buffer,
): Promise<{ part: PageRect; run: PageRect; page: PdfPageText }> {
  const document = await reader.open(new Uint8Array(bytes));
  const page = await document.pageText(1);
  await document.close();
  const [part] = rectsForRange(page, 0, FIRST_WORDS.length);
  const run = page.runs[0]?.box;
  if (part === undefined || run === undefined) throw new Error('the line has no box');
  return { part, run, page };
}

describe('a word picked on a page turned a quarter (/Rotate 90) is boxed where it is shown', () => {
  it('covers only the top of the line, which runs down the page, not a sliver of its whole length', async () => {
    const { part, run, page } = await firstWordsAndRun(
      hostilePdf({ page: '/MediaBox [0 0 612 792] /Rotate 90' }),
    );
    expect(page.text).toBe(LINE);
    // The line runs top to bottom as shown; its first 8 of 41 characters are its top fifth.
    expect(part.height).toBeLessThan(run.height / 2);
    expect(part.y).toBeCloseTo(run.y, 3);
  });
});

describe('a word picked on a page turned upside down (/Rotate 180) is boxed where it is shown', () => {
  it('covers the right end of the line, where its first words are drawn, not the left', async () => {
    const { part, run } = await firstWordsAndRun(
      hostilePdf({ page: '/MediaBox [0 0 612 792] /Rotate 180' }),
    );
    // Upside down the line reads right to left, so "The tide" is at its right end.
    expect(part.x).toBeGreaterThan(run.x + run.width / 2);
    expect(part.x + part.width).toBeCloseTo(run.x + run.width, 3);
  });
});

describe('a word picked in a line set upward by its text matrix is boxed where it is', () => {
  it('covers only the bottom of the line, where its first words are drawn', async () => {
    const { part, run } = await firstWordsAndRun(
      hostilePdf({ content: `BT /F1 12 Tf 0 1 -1 0 300 100 Tm (${LINE}) Tj ET` }),
    );
    // The text runs up the page from y = 100, so its first words are at the bottom of its box.
    expect(part.height).toBeLessThan(run.height / 2);
    expect(part.y + part.height).toBeCloseTo(run.y + run.height, 3);
  });
});

/*
 * A font written top to bottom (`/Identity-V`, as Japanese books are set):
 * pdf.js gives such an item no width and its advance as `height`, which the
 * corner box does not read, so the column is boxed as one glyph's square.
 */
function verticalFontPdf(): Buffer {
  const stream = (body: string) =>
    `<< /Length ${Buffer.byteLength(body, 'latin1')} >>\nstream\n${body}\nendstream`;
  const toUnicode =
    '/CIDInit /ProcSet findresource begin 12 dict begin begincmap /CMapName /Fen def ' +
    '/CMapType 2 def 1 begincodespacerange <0000> <FFFF> endcodespacerange ' +
    '1 beginbfrange <0001> <0005> <0041> endbfrange endcmap ' +
    'CMapName currentdict /CMap defineresource pop end end';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [5 0 R] /Count 1 >>',
    '<< /Type /Font /Subtype /Type0 /BaseFont /FenMincho /Encoding /Identity-V /DescendantFonts [6 0 R] /ToUnicode 7 0 R >>',
    // Five glyphs at 20 points, down the page from (300, 700).
    stream('BT /F1 20 Tf 300 700 Td <00010002000300040005> Tj ET'),
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents 4 0 R >>',
    '<< /Type /Font /Subtype /CIDFontType2 /BaseFont /FenMincho /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /DW 1000 /CIDToGIDMap /Identity >>',
    stream(toUnicode),
  ];
  let body = '%PDF-1.7\n';
  const offsets: number[] = [];
  objects.forEach((object, at) => {
    offsets.push(Buffer.byteLength(body, 'latin1'));
    body += `${at + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = Buffer.byteLength(body, 'latin1');
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  body += offsets.map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(body, 'latin1');
}

describe('a column of text in a font written top to bottom is boxed down its length', () => {
  it('boxes five 20-point glyphs set vertically as a column about 100 points tall', async () => {
    const document = await reader.open(new Uint8Array(verticalFontPdf()));
    const page = await document.pageText(1);
    await document.close();
    expect(page.text).toBe('ABCDE');
    const [box] = rectsForRange(page, 0, page.text.length);
    // 5 glyphs x 20 points down a 792-point page: at least 90 points of it.
    expect((box?.height ?? 0) * 792).toBeGreaterThan(90);
  });
});
