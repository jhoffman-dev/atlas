import type { PageRect } from '../highlights/anchor.ts';

/*
 * A PDF page's words as the reader works with them (#504): one string per
 * page, so a selection, a search and a re-anchored highlight all speak in
 * offsets into it, and where each run of it sits on the page, so any range
 * of it can be drawn. Positions are fractions of the page from its top-left
 * corner, as ADR-0043 stores a box, so they hold at any zoom.
 */

/** A point on the page, or a step across it, in fractions of the page's width and height. */
export interface PageVector {
  readonly x: number;
  readonly y: number;
}

/**
 * Which way a run reads as it is shown, for a run not set left to right
 * across the page: from `origin`, where its first letter sits on its
 * baseline, `advance` to where its last letter ends, and `rise` from the
 * baseline to the top of its letters. A page turned upside down reads right
 * to left, a quarter turn reads down the page.
 */
export interface RunDirection {
  readonly origin: PageVector;
  readonly advance: PageVector;
  readonly rise: PageVector;
}

/**
 * One run of text as the PDF lays it out: its words, its box, whether a line
 * ends after it, and, when it is turned, which way it reads. A run with no
 * direction reads left to right along its box.
 */
export interface PdfTextRun {
  readonly text: string;
  readonly box: PageRect;
  readonly endsLine: boolean;
  readonly direction?: RunDirection;
}

/** A run with where its words are in the page's text: `[start, end)`. */
export interface PlacedTextRun extends PdfTextRun {
  readonly start: number;
  readonly end: number;
}

/** A page's words, and its runs in order. */
export interface PdfPageText {
  readonly text: string;
  readonly runs: readonly PlacedTextRun[];
}

/** A page with no words: a scan, or a page of pictures. */
export const EMPTY_PAGE_TEXT: PdfPageText = { text: '', runs: [] };

/**
 * The page's text: its runs one after another, a line break after each run
 * that ends a line, so words at a line's end and the next line's start are
 * not run together.
 */
export function pdfPageText(runs: readonly PdfTextRun[]): PdfPageText {
  let text = '';
  const placed: PlacedTextRun[] = [];
  for (const run of runs) {
    placed.push({ ...run, start: text.length, end: text.length + run.text.length });
    text += run.text;
    if (run.endsLine) text += '\n';
  }
  return { text, runs: placed };
}

/** Whether the page has words to select: false for a scanned page. */
export const hasWords = (page: PdfPageText): boolean => page.text.trim() !== '';

/** How near two boxes' tops and heights must be to be one line. */
const SAME_LINE = 0.002;

/**
 * The boxes that cover `[start, end)` of the page's text: a part of each run
 * it touches, in proportion to the characters it takes, cut along the way
 * the run reads from its first letter, then the parts that sit side by side
 * on one line made one box. A range of only line breaks, or outside the
 * text, covers nothing.
 */
export function rectsForRange(page: PdfPageText, start: number, end: number): PageRect[] {
  const parts: PageRect[] = [];
  for (const run of page.runs) {
    const from = Math.max(start, run.start);
    const to = Math.min(end, run.end);
    if (to <= from || run.text.length === 0) continue;
    parts.push(onPage(partOfRun(run, from - run.start, to - run.start)));
  }
  return joinLines(parts.filter((rect) => rect.width > 0 && rect.height > 0));
}

/** The box round characters `[from, to)` of a run, measured from its first letter. */
function partOfRun(run: PdfTextRun, from: number, to: number): PageRect {
  const { box, direction } = run;
  if (direction === undefined) {
    const share = box.width / run.text.length;
    return { x: box.x + share * from, y: box.y, width: share * (to - from), height: box.height };
  }
  const { origin, advance, rise } = direction;
  const at = (share: number) => ({
    x: origin.x + advance.x * share,
    y: origin.y + advance.y * share,
  });
  const first = at(from / run.text.length);
  const last = at(to / run.text.length);
  const corners = [
    first,
    last,
    ...[first, last].map((p) => ({ x: p.x + rise.x, y: p.y + rise.y })),
  ];
  const xs = corners.map((corner) => corner.x);
  const ys = corners.map((corner) => corner.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}

/**
 * Where in the page's text the words nearest `box` begin: the start of the
 * run whose box is closest to the box's top-left corner. Zero for a page
 * with no words. It places an area, which has no words of its own, among
 * the highlights that do, in the order the page is read.
 */
export function textOffsetNear(page: PdfPageText, box: PageRect): number {
  let nearest = { start: 0, distance: Number.POSITIVE_INFINITY };
  for (const run of page.runs) {
    const distance = Math.hypot(run.box.x - box.x, run.box.y - box.y);
    if (distance < nearest.distance) nearest = { start: run.start, distance };
  }
  return nearest.start;
}

function joinLines(parts: readonly PageRect[]): PageRect[] {
  const joined: PageRect[] = [];
  for (const part of parts) {
    const last = joined.at(-1);
    if (last !== undefined && sameLine(last, part) && part.x >= last.x) {
      const right = Math.max(last.x + last.width, part.x + part.width);
      joined[joined.length - 1] = { ...last, width: right - last.x };
    } else {
      joined.push(part);
    }
  }
  return joined;
}

const sameLine = (a: PageRect, b: PageRect): boolean =>
  Math.abs(a.y - b.y) < SAME_LINE && Math.abs(a.height - b.height) < SAME_LINE;

/** `rect` cut to the page: a box partly off it is kept for the part on it. */
export function onPage(rect: PageRect): PageRect {
  const x = clamp(rect.x);
  const y = clamp(rect.y);
  return {
    x,
    y,
    width: Math.max(0, clamp(rect.x + rect.width) - x),
    height: Math.max(0, clamp(rect.y + rect.height) - y),
  };
}

const clamp = (value: number): number =>
  Number.isFinite(value) ? Math.min(Math.max(value, 0), 1) : 0;
