import { describe, expect, it } from 'vitest';
import type { PdfAnchor } from '../highlights/anchor.ts';
import { quoteSelectorAt } from '../highlights/reanchor.ts';
import { pdfPageText, type PdfPageText } from './pdf-page-text.ts';
import {
  inReadingOrder,
  isExact,
  placeByBoxes,
  placeByWords,
  placeOnItsPage,
  type HighlightPlacement,
} from './placement.ts';

const page = (text: string, y = 0.2): PdfPageText =>
  pdfPageText([
    { text, box: { x: 0.1, y, width: text.length * 0.01, height: 0.02 }, endsLine: false },
  ]);

const PAGES = [
  page('The keepers of Brightwater lit the lamps at dusk.'),
  page('Fog came in from the north channel each spring.'),
  page('The ferry waited for the lamps before it left.'),
];

const SAVED_BOX = { x: 0.5, y: 0.5, width: 0.1, height: 0.02 };

/** An anchor for `words` as they are on `onPage` (from 1), said to be on `page`. */
function anchorFor(words: string, onPage: number, page = onPage): PdfAnchor {
  const text = (PAGES[onPage - 1] as PdfPageText).text;
  const start = text.indexOf(words);
  return {
    kind: 'pdf',
    page,
    quote: quoteSelectorAt({ text, start, end: start + words.length }),
    rects: [SAVED_BOX],
  };
}

describe('placing a highlight on its own page', () => {
  it('finds its words there and covers them', () => {
    const placed = placeOnItsPage(anchorFor('north channel', 2), {
      count: 3,
      text: PAGES[1] as PdfPageText,
    });
    expect(placed).toMatchObject({ kind: 'words', page: 2, at: PAGES[1]!.text.indexOf('north') });
    expect(placed?.kind === 'lost' ? 0 : placed?.rects[0]?.x).toBeCloseTo(
      0.1 + 0.01 * PAGES[1]!.text.indexOf('north'),
    );
  });

  it('finds nothing when its words are not on that page, for an area, or past the document', () => {
    const elsewhere = anchorFor('north channel', 2, 1);
    expect(placeOnItsPage(elsewhere, { count: 3, text: PAGES[0] as PdfPageText })).toBeNull();
    const area: PdfAnchor = { kind: 'pdf', page: 1, quote: null, rects: [SAVED_BOX] };
    expect(placeOnItsPage(area, { count: 3, text: PAGES[0] as PdfPageText })).toBeNull();
    expect(
      placeOnItsPage(anchorFor('north channel', 2, 9), { count: 3, text: PAGES[1] as PdfPageText }),
    ).toBeNull();
  });
});

describe('placing a highlight whose words tie on its own page', () => {
  it('keeps it on its page at its saved boxes, never on another page', () => {
    const saved = 'Old words. Ring the tide bell at noon, she said.';
    const start = saved.indexOf('the tide bell');
    const anchor: PdfAnchor = {
      kind: 'pdf',
      page: 2,
      quote: quoteSelectorAt({ text: saved, start, end: start + 'the tide bell'.length }),
      rects: [SAVED_BOX],
    };
    const twice = page('First, the tide bell rang. Then the tide bell stopped.');
    const placed = placeOnItsPage(anchor, { count: 3, text: twice });
    expect(placed).toMatchObject({ kind: 'boxes', page: 2, rects: [SAVED_BOX] });
  });
});

describe('placing a highlight whose own page could not be read', () => {
  it('keeps it on its page at its saved boxes, its words unknown rather than missing', () => {
    const placed = placeOnItsPage(anchorFor('north channel', 2), { count: 3, text: null });
    expect(placed).toEqual({ kind: 'boxes', page: 2, rects: [SAVED_BOX] });
  });
});

describe('placing a highlight by its words anywhere', () => {
  it('finds words that moved to another page', () => {
    expect(placeByWords(anchorFor('ferry waited', 3, 1), PAGES)).toMatchObject({
      kind: 'words',
      page: 3,
    });
  });

  it('takes the copy nearest its own page when words repeat', () => {
    const repeated = [page('the lamps'), page('nothing here'), page('nothing'), page('the lamps')];
    const anchor: PdfAnchor = {
      kind: 'pdf',
      page: 4,
      quote: { exact: 'the lamps', prefix: '', suffix: '' },
      rects: [],
    };
    expect(placeByWords(anchor, repeated)).toMatchObject({ page: 4 });
    expect(placeByWords({ ...anchor, page: 1 }, repeated)).toMatchObject({ page: 1 });
  });

  it('finds nothing for words that changed, an area, or an empty document', () => {
    const changed: PdfAnchor = {
      ...anchorFor('north channel', 2),
      quote: { exact: 'south channel', prefix: '', suffix: '' },
    };
    expect(placeByWords(changed, PAGES)).toBeNull();
    expect(
      placeByWords({ kind: 'pdf', page: 1, quote: null, rects: [SAVED_BOX] }, PAGES),
    ).toBeNull();
    expect(placeByWords(anchorFor('north channel', 2), [])).toBeNull();
  });
});

describe('placing a highlight by its boxes', () => {
  it('draws an area at its boxes', () => {
    expect(placeByBoxes({ kind: 'pdf', page: 2, quote: null, rects: [SAVED_BOX] }, 3)).toEqual({
      kind: 'area',
      page: 2,
      rects: [SAVED_BOX],
    });
  });

  it('draws words that were not found where they were saved, said so', () => {
    expect(placeByBoxes(anchorFor('north channel', 2), 3)).toEqual({
      kind: 'boxes',
      page: 2,
      rects: [SAVED_BOX],
    });
  });

  it('draws nothing when its page is not in the document, or it has no box', () => {
    expect(placeByBoxes(anchorFor('north channel', 2, 7), 3)).toEqual({ kind: 'lost' });
    expect(placeByBoxes({ ...anchorFor('north channel', 2), rects: [] }, 3)).toEqual({
      kind: 'lost',
    });
  });

  it('is exact only when found by its words, or an area', () => {
    expect(isExact({ kind: 'words', page: 1, at: 0, rects: [] })).toBe(true);
    expect(isExact({ kind: 'area', page: 1, rects: [] })).toBe(true);
    expect(isExact({ kind: 'boxes', page: 1, rects: [] })).toBe(false);
    expect(isExact({ kind: 'lost' })).toBe(false);
  });
});

describe('highlights in reading order', () => {
  const at = (id: string, placement: HighlightPlacement, offset = 0) => ({
    id,
    placement,
    offset,
  });
  const box = (y: number, x = 0.1) => [{ x, y, width: 0.1, height: 0.02 }];

  it('goes by page, then from the top, then from the left, with the lost last', () => {
    const ordered = inReadingOrder([
      at('lost', { kind: 'lost' }),
      at('p2', { kind: 'words', page: 2, at: 0, rects: box(0.1) }),
      at('p1-low', { kind: 'area', page: 1, rects: box(0.8) }),
      at('p1-right', { kind: 'boxes', page: 1, rects: box(0.2, 0.6) }),
      at('p1-left', { kind: 'words', page: 1, at: 0, rects: box(0.2, 0.1) }),
      at('lost-2', { kind: 'lost' }),
    ]);
    expect(ordered.map((entry) => entry.id)).toEqual([
      'p1-left',
      'p1-right',
      'p1-low',
      'p2',
      'lost',
      'lost-2',
    ]);
  });

  it('follows the text across columns where top-then-left would read across them', () => {
    const ordered = inReadingOrder([
      at('right-top', { kind: 'words', page: 1, at: 40, rects: box(0.1, 0.6) }, 40),
      at('left-bottom', { kind: 'words', page: 1, at: 20, rects: box(0.8, 0.1) }, 20),
    ]);
    expect(ordered.map((entry) => entry.id)).toEqual(['left-bottom', 'right-top']);
  });

  it("keeps the note's order for two at one spot", () => {
    const ordered = inReadingOrder([
      at('first', { kind: 'words', page: 1, at: 0, rects: box(0.2) }),
      at('second', { kind: 'words', page: 1, at: 0, rects: box(0.2) }),
      at('none', { kind: 'words', page: 1, at: 0, rects: [] }),
    ]);
    expect(ordered.map((entry) => entry.id)).toEqual(['none', 'first', 'second']);
  });
});
