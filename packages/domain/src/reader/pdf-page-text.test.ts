import { describe, expect, it } from 'vitest';
import { hasWords, onPage, pdfPageText, rectsForRange, type PdfTextRun } from './pdf-page-text.ts';

/** A run of `text` at `x`, `y`, `width` wide, one line of 0.02 high. */
const run = (text: string, x: number, y: number, width: number, endsLine = false): PdfTextRun => ({
  text,
  box: { x, y, width, height: 0.02 },
  endsLine,
});

const PAGE = pdfPageText([
  run('Every lantern ', 0.1, 0.1, 0.28),
  run('was trimmed', 0.38, 0.1, 0.22, true),
  run('by hand.', 0.1, 0.13, 0.16),
]);

describe("a page's text", () => {
  it('runs one after another, a line break after a run that ends its line', () => {
    expect(PAGE.text).toBe('Every lantern was trimmed\nby hand.');
    expect(PAGE.runs.map(({ start, end }) => [start, end])).toEqual([
      [0, 14],
      [14, 25],
      [26, 34],
    ]);
  });

  it('has words unless it is only space, as a scan is', () => {
    expect(hasWords(PAGE)).toBe(true);
    expect(hasWords(pdfPageText([run('  ', 0, 0, 0.1, true)]))).toBe(false);
    expect(hasWords(pdfPageText([]))).toBe(false);
  });
});

describe('the boxes a range covers', () => {
  it('takes the part of a run in proportion to its characters', () => {
    const [box] = rectsForRange(PAGE, 6, 13);
    // "lantern" is characters 6–13 of a 14-character run 0.28 wide.
    expect(box?.x).toBeCloseTo(0.1 + 0.02 * 6);
    expect(box?.width).toBeCloseTo(0.02 * 7);
    expect(box?.y).toBeCloseTo(0.1);
    expect(box?.height).toBeCloseTo(0.02);
  });

  it('makes runs side by side on one line one box', () => {
    const boxes = rectsForRange(PAGE, 0, 25);
    expect(boxes).toHaveLength(1);
    expect(boxes[0]?.x).toBeCloseTo(0.1);
    expect(boxes[0]?.width).toBeCloseTo(0.5);
  });

  it('gives one box per line across a line break', () => {
    const boxes = rectsForRange(PAGE, 20, 33);
    expect(boxes).toHaveLength(2);
    expect(boxes.map((box) => box.y)).toEqual([0.1, 0.13]);
  });

  it('covers nothing for a range of only a line break, or past the text', () => {
    expect(rectsForRange(PAGE, 25, 26)).toEqual([]);
    expect(rectsForRange(PAGE, 40, 50)).toEqual([]);
  });

  it('keeps boxes on the page when a run reaches past its edge', () => {
    const wide = pdfPageText([run('edge', 0.9, 0.99, 0.2)]);
    const [box] = rectsForRange(wide, 0, 4);
    expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(1);
    expect((box?.y ?? 0) + (box?.height ?? 0)).toBeLessThanOrEqual(1);
  });

  it('does not join boxes on different lines that happen to touch', () => {
    const page = pdfPageText([run('top', 0.1, 0.1, 0.1), run('low', 0.2, 0.2, 0.1)]);
    expect(rectsForRange(page, 0, 6)).toHaveLength(2);
  });
});

describe('a box cut to its page', () => {
  it('keeps the part on the page, and takes a number that is not one as the edge', () => {
    const cut = onPage({ x: -0.1, y: 0.5, width: 0.3, height: 0.8 });
    expect(cut).toMatchObject({ x: 0, y: 0.5 });
    expect(cut.width).toBeCloseTo(0.2);
    expect(cut.height).toBeCloseTo(0.5);
    expect(onPage({ x: Number.NaN, y: 0, width: 0.1, height: 0.1 }).x).toBe(0);
  });
});
