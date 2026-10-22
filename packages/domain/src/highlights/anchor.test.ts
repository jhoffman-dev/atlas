import { describe, expect, it } from 'vitest';
import {
  anchorProblem,
  assertAnchor,
  highlightKey,
  InvalidHighlightAnchorError,
  kindlePlaceKey,
  type HighlightAnchor,
  type KindleAnchor,
} from './anchor.ts';

const quote = { exact: 'All warfare is based on deception.', prefix: 'said: ', suffix: ' Hence' };
const pdf = (
  overrides: Partial<Extract<HighlightAnchor, { kind: 'pdf' }>> = {},
): HighlightAnchor => ({
  kind: 'pdf',
  page: 3,
  quote,
  rects: [{ x: 0.1, y: 0.2, width: 0.5, height: 0.02 }],
  ...overrides,
});

describe('which anchors the format holds', () => {
  it.each<[string, HighlightAnchor]>([
    ['a PDF passage', pdf()],
    ['a PDF passage with no boxes', pdf({ rects: [] })],
    ['a PDF area with no words', pdf({ quote: null })],
    ['a box that fills its page', pdf({ rects: [{ x: 0, y: 0, width: 1, height: 1 }] })],
    ['an EPUB passage', { kind: 'epub', cfi: 'epubcfi(/6/4!/4/2/1:0)', quote }],
    [
      'a Kindle location',
      { kind: 'kindle', location: { start: 1, end: null }, annotationId: null },
    ],
    [
      'a Kindle range with an id',
      { kind: 'kindle', location: { start: 120, end: 120 }, annotationId: 'AMZ-1' },
    ],
  ])('holds %s', (_label, anchor) => {
    expect(anchorProblem(anchor)).toBeNull();
    expect(() => assertAnchor(anchor)).not.toThrow();
  });

  it.each<[string, HighlightAnchor, string]>([
    ['page 0', pdf({ page: 0 }), 'whole number from 1'],
    ['a fractional page', pdf({ page: 2.5 }), 'whole number from 1'],
    ['an empty PDF quote', pdf({ quote: { exact: '', prefix: '', suffix: '' } }), 'has words'],
    ['an area with no box', pdf({ quote: null, rects: [] }), 'covers a box'],
    ['a box off its page', pdf({ rects: [{ x: 1.2, y: 0, width: 0.1, height: 0.1 }] }), 'box'],
    ['a box of no width', pdf({ rects: [{ x: 0, y: 0, width: 0, height: 0.1 }] }), 'box'],
    ['a box of no height', pdf({ rects: [{ x: 0, y: 0, width: 0.1, height: 0 }] }), 'box'],
    ['a box at NaN', pdf({ rects: [{ x: Number.NaN, y: 0, width: 0.1, height: 0.1 }] }), 'box'],
    ['a box below its page', pdf({ rects: [{ x: 0, y: -0.1, width: 0.1, height: 0.1 }] }), 'box'],
    [
      'a tall box',
      pdf({ rects: [{ x: 0, y: 0, width: 0.1, height: Number.POSITIVE_INFINITY }] }),
      'box',
    ],
    ['a CFI that is not one', { kind: 'epub', cfi: '/6/4', quote }, 'epubcfi'],
    [
      'an empty EPUB quote',
      { kind: 'epub', cfi: 'epubcfi(/6/4)', quote: { ...quote, exact: '' } },
      'has words',
    ],
    [
      'location 0',
      { kind: 'kindle', location: { start: 0, end: null }, annotationId: null },
      'whole number from 1',
    ],
    [
      'a range that ends first',
      { kind: 'kindle', location: { start: 10, end: 9 }, annotationId: null },
      'ends after',
    ],
    [
      'a fractional end',
      { kind: 'kindle', location: { start: 10, end: 10.5 }, annotationId: null },
      'ends after',
    ],
    [
      'a Kindle page of 0',
      { kind: 'kindle', location: null, page: 0, annotationId: null },
      'whole number from 1',
    ],
    [
      'a Kindle highlight with neither location nor page',
      { kind: 'kindle', location: null, annotationId: null },
      'location or a page',
    ],
    [
      'an empty annotation id',
      { kind: 'kindle', location: { start: 10, end: null }, annotationId: '' },
      'annotation id',
    ],
    [
      'blank Kindle words',
      { kind: 'kindle', location: { start: 10, end: null }, annotationId: null, exact: ' \n' },
      'Kindle quote has words',
    ],
    [
      'empty Kindle words',
      { kind: 'kindle', location: { start: 10, end: null }, annotationId: null, exact: '' },
      'Kindle quote has words',
    ],
  ])('refuses %s', (_label, anchor, reason) => {
    expect(anchorProblem(anchor)).toContain(reason);
    expect(() => assertAnchor(anchor)).toThrow(InvalidHighlightAnchorError);
  });
});

describe('what makes two highlights the same passage', () => {
  it('is a PDF page and the words with their surroundings, whitespace aside', () => {
    const spaced = pdf({ quote: { ...quote, exact: 'All  warfare is\nbased on deception.' } });
    expect(highlightKey(spaced, '')).toBe(highlightKey(pdf(), 'anything'));
    expect(highlightKey(pdf({ page: 4 }), '')).not.toBe(highlightKey(pdf(), ''));
    expect(highlightKey(pdf({ quote: { ...quote, prefix: 'wrote: ' } }), '')).not.toBe(
      highlightKey(pdf(), ''),
    );
  });

  it('is a PDF area by its page and boxes', () => {
    const area = pdf({ quote: null });
    expect(highlightKey(area, '')).toBe(highlightKey(pdf({ quote: null }), ''));
    expect(highlightKey(area, '')).not.toBe(
      highlightKey(pdf({ quote: null, rects: [{ x: 0.3, y: 0.2, width: 0.5, height: 0.02 }] }), ''),
    );
    expect(highlightKey(area, '')).not.toBe(highlightKey(pdf(), ''));
  });

  it('is an EPUB CFI', () => {
    const epub = (cfi: string): HighlightAnchor => ({ kind: 'epub', cfi, quote });
    expect(highlightKey(epub('epubcfi(/6/4)'), 'a')).toBe(highlightKey(epub('epubcfi(/6/4)'), 'b'));
    expect(highlightKey(epub('epubcfi(/6/4)'), 'a')).not.toBe(
      highlightKey(epub('epubcfi(/6/6)'), 'a'),
    );
  });

  it("is Kindle's annotation id when there is one, whatever the location", () => {
    const kindle = (start: number, annotationId: string | null): HighlightAnchor => ({
      kind: 'kindle',
      location: { start, end: null },
      annotationId,
    });
    expect(highlightKey(kindle(10, 'AMZ-1'), 'a')).toBe(highlightKey(kindle(99, 'AMZ-1'), 'b'));
    expect(highlightKey(kindle(10, 'AMZ-1'), 'a')).not.toBe(highlightKey(kindle(10, 'AMZ-2'), 'a'));
  });

  it('is a Kindle location and its words without one', () => {
    const kindle: HighlightAnchor = {
      kind: 'kindle',
      location: { start: 10, end: 12 },
      annotationId: null,
    };
    expect(highlightKey(kindle, 'Call me  Ishmael.')).toBe(
      highlightKey(kindle, 'Call me Ishmael. '),
    );
    expect(highlightKey(kindle, 'Call me Ishmael.')).not.toBe(highlightKey(kindle, 'Call me.'));
    expect(
      highlightKey({ ...kindle, location: { start: 10, end: null } }, 'Call me Ishmael.'),
    ).not.toBe(highlightKey(kindle, 'Call me Ishmael.'));
  });

  it('is a Kindle page, location and words, the export words not the quote shown', () => {
    const kindle: HighlightAnchor = {
      kind: 'kindle',
      location: null,
      page: 12,
      annotationId: null,
      exact: 'Call me Ishmael.',
    };
    expect(highlightKey(kindle, 'tidied')).toBe(highlightKey(kindle, 'other'));
    expect(highlightKey({ ...kindle, page: 13 }, 'x')).not.toBe(highlightKey(kindle, 'x'));
  });

  it('shares a place key across annotation ids, which is how a late id finds its earlier copy', () => {
    const at = (annotationId: string | null): KindleAnchor => ({
      kind: 'kindle',
      location: { start: 3, end: null },
      annotationId,
    });
    expect(kindlePlaceKey(at('A1'), 'Words')).toBe(kindlePlaceKey(at(null), 'Words'));
  });

  it('places a Kindle highlight by where its location starts, its range end and page aside', () => {
    const at = (location: KindleAnchor['location'], page?: number): KindleAnchor => ({
      kind: 'kindle',
      location,
      annotationId: null,
      ...(page !== undefined && { page }),
    });
    const ranged = kindlePlaceKey(at({ start: 77, end: 79 }), 'Words');
    expect(kindlePlaceKey(at({ start: 77, end: null }), 'Words')).toBe(ranged);
    expect(kindlePlaceKey(at({ start: 77, end: 79 }, 12), 'Words')).toBe(ranged);
    expect(kindlePlaceKey(at({ start: 78, end: 79 }), 'Words')).not.toBe(ranged);
    expect(kindlePlaceKey(at({ start: 77, end: 79 }), 'Other words')).not.toBe(ranged);
    expect(kindlePlaceKey(at(null, 12), 'Words')).not.toBe(kindlePlaceKey(at(null, 13), 'Words'));
    expect(kindlePlaceKey(at(null, 77), 'Words')).not.toBe(ranged);
  });
});
