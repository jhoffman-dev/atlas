import { describe, expect, it } from 'vitest';
import { anchorProblem, DEFAULT_HIGHLIGHT_STYLE, type PdfAnchor } from '../highlights/anchor.ts';
import { pdfPageText } from './pdf-page-text.ts';
import {
  areaHighlight,
  draggedBox,
  SMALLEST_AREA,
  textHighlight,
  trimmedSelection,
} from './pdf-selection.ts';

const PAGE = pdfPageText([
  {
    text: 'A light kept is a promise kept, the old keeper said.',
    box: { x: 0.1, y: 0.2, width: 0.52, height: 0.02 },
    endsLine: true,
  },
  {
    text: 'The ferry waited.',
    box: { x: 0.1, y: 0.23, width: 0.17, height: 0.02 },
    endsLine: false,
  },
]);

const at = (words: string) => {
  const start = PAGE.text.indexOf(words);
  return { page: 2, start, end: start + words.length };
};

describe('a text selection', () => {
  it('leaves out the space at either end and puts its ends in order', () => {
    const { start, end } = at(' a promise kept, ');
    expect(trimmedSelection({ page: 2, start: end, end: start }, PAGE)).toEqual(
      at('a promise kept,'),
    );
  });

  it('is nothing when only space is picked', () => {
    const lineEnd = PAGE.text.indexOf('\n');
    expect(trimmedSelection({ page: 1, start: lineEnd, end: lineEnd + 1 }, PAGE)).toBeNull();
  });

  it('is kept to the text when its ends run past it', () => {
    expect(trimmedSelection({ page: 1, start: -4, end: 9_999 }, PAGE)).toEqual({
      page: 1,
      start: 0,
      end: PAGE.text.length,
    });
  });
});

describe('the highlight words make', () => {
  it('quotes the words, anchors them by their selector and covers their boxes', () => {
    const highlight = textHighlight({
      selection: at('a promise kept'),
      page: PAGE,
      style: { mark: 'underline', color: 'green' },
      comment: 'Said twice.',
    });
    expect(highlight?.quote).toBe('a promise kept');
    expect(highlight?.style).toEqual({ mark: 'underline', color: 'green' });
    expect(highlight?.comment).toBe('Said twice.');
    const anchor = highlight?.anchor as PdfAnchor;
    expect(anchor.page).toBe(2);
    expect(anchor.quote).toEqual({
      exact: 'a promise kept',
      prefix: 'A light kept is ',
      suffix: ', the old keeper said.\nThe ferry',
    });
    expect(anchor.rects).toHaveLength(1);
    expect(anchorProblem(anchor)).toBeNull();
  });

  it('covers a box on each line a selection crosses', () => {
    const highlight = textHighlight({
      selection: at('said.\nThe ferry'),
      page: PAGE,
      style: DEFAULT_HIGHLIGHT_STYLE,
    });
    expect((highlight?.anchor as PdfAnchor).rects).toHaveLength(2);
    expect(highlight).not.toHaveProperty('comment');
  });

  it('is nothing for a selection of space alone', () => {
    const lineEnd = PAGE.text.indexOf('\n');
    expect(
      textHighlight({
        selection: { page: 1, start: lineEnd, end: lineEnd + 1 },
        page: PAGE,
        style: DEFAULT_HIGHLIGHT_STYLE,
      }),
    ).toBeNull();
  });

  it('is nothing when the words cover no box the page can draw', () => {
    const flat = pdfPageText([
      { text: 'invisible', box: { x: 0.1, y: 0.1, width: 0, height: 0.02 }, endsLine: false },
    ]);
    expect(
      textHighlight({
        selection: { page: 1, start: 0, end: 9 },
        page: flat,
        style: DEFAULT_HIGHLIGHT_STYLE,
      }),
    ).toBeNull();
  });
});

describe('a dragged box', () => {
  it('is the box between the corners, dragged either way', () => {
    expect(draggedBox({ x: 0.6, y: 0.7 }, { x: 0.2, y: 0.3 })).toEqual({
      x: 0.2,
      y: 0.3,
      width: expect.closeTo(0.4) as unknown as number,
      height: expect.closeTo(0.4) as unknown as number,
    });
  });

  it('is cut to the page', () => {
    const box = draggedBox({ x: 0.8, y: 0.8 }, { x: 1.4, y: 1.2 });
    expect(box).toMatchObject({ x: 0.8, y: 0.8 });
    expect((box?.x ?? 0) + (box?.width ?? 0)).toBeCloseTo(1);
  });

  it('is nothing when it is too small to be meant', () => {
    expect(draggedBox({ x: 0.5, y: 0.5 }, { x: 0.5 + SMALLEST_AREA / 2, y: 0.7 })).toBeNull();
    expect(draggedBox({ x: 0.5, y: 0.5 }, { x: 0.7, y: 0.5 })).toBeNull();
  });
});

describe('an area highlight', () => {
  it('has no words, its box, and its picture', () => {
    const box = { x: 0.1, y: 0.5, width: 0.4, height: 0.2 };
    const highlight = areaHighlight({
      page: 4,
      box,
      image: 'attachments/The Lantern Keepers p4 area.png',
      style: DEFAULT_HIGHLIGHT_STYLE,
      comment: 'The map.',
    });
    expect(highlight.image).toBe('attachments/The Lantern Keepers p4 area.png');
    expect(highlight.anchor).toEqual({ kind: 'pdf', page: 4, quote: null, rects: [box] });
    expect(highlight.comment).toBe('The map.');
    expect(anchorProblem(highlight.anchor)).toBeNull();
  });
});
