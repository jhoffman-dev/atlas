import { describe, expect, it } from 'vitest';
import type { HighlightAnchor, HighlightStyle } from './anchor.ts';
import {
  highlightMarker,
  kindleTombstoneLine,
  looksLikeHighlightMarker,
  readHighlightMarker,
  readKindleTombstone,
} from './highlight-marker.ts';
import { hashOf, passageWords } from './passage-words.ts';

const style: HighlightStyle = { mark: 'underline', color: 'blue' };
const quote = { exact: 'All warfare is based on deception.', prefix: 'said: ', suffix: ' Hence' };

const anchors: [string, HighlightAnchor][] = [
  [
    'a PDF passage',
    { kind: 'pdf', page: 3, quote, rects: [{ x: 0.125, y: 0.25, width: 0.5, height: 0.03125 }] },
  ],
  [
    'a PDF area',
    { kind: 'pdf', page: 9, quote: null, rects: [{ x: 0, y: 0, width: 1, height: 0.5 }] },
  ],
  ['a PDF passage with no boxes', { kind: 'pdf', page: 1, quote, rects: [] }],
  ['an EPUB passage', { kind: 'epub', cfi: 'epubcfi(/6/4!/4/2,/1:0,/1:12)', quote }],
  ['a Kindle location', { kind: 'kindle', location: { start: 41, end: null }, annotationId: null }],
  [
    'a Kindle page with no location',
    { kind: 'kindle', location: null, page: 12, annotationId: null },
  ],
  [
    'a Kindle highlight with the export words',
    { kind: 'kindle', location: { start: 5, end: null }, annotationId: 'A1', exact: 'The words' },
  ],
  [
    'a Kindle range with its id',
    { kind: 'kindle', location: { start: 41, end: 44 }, annotationId: 'AMZ-QX1' },
  ],
];

const json = (fields: Record<string, unknown>) =>
  `<!-- atlas:highlight ${JSON.stringify(fields)} -->`;

describe('the highlight marker', () => {
  it.each(anchors)('reads back %s as it was written', (_label, anchor) => {
    const marker = highlightMarker({ style, anchor });
    expect(marker).toMatch(/^<!-- atlas:highlight \{.*\} -->$/);
    expect(marker).not.toContain('\n');
    expect(readHighlightMarker(marker)).toEqual({ style, anchor });
  });

  it('writes the version first, then the style, then the anchor', () => {
    const marker = highlightMarker({ style, anchor: anchors[4]?.[1] as HighlightAnchor });
    expect(marker).toBe(
      '<!-- atlas:highlight {"v":1,"mark":"underline","color":"blue","kind":"kindle","location":41} -->',
    );
  });

  it('keeps quoted words that would close a comment, or open one, from doing so', () => {
    const tricky = { exact: 'a --> b <!-- c', prefix: '-->', suffix: '<b>\n</b>' };
    const marker = highlightMarker({
      style,
      anchor: { kind: 'epub', cfi: 'epubcfi(/2)', quote: tricky },
    });
    expect(marker.indexOf('-->')).toBe(marker.length - 3);
    expect(marker.slice(4)).not.toContain('<');
    expect(readHighlightMarker(marker)).toEqual({
      style,
      anchor: { kind: 'epub', cfi: 'epubcfi(/2)', quote: tricky },
    });
  });

  it.each([
    ['no space inside the comment', '<!--atlas:highlight {"v":1,"kind":"kindle","location":2}-->'],
    ['tabs and spaces', '  <!--\tatlas:highlight   {"v":1,"kind":"kindle","location":2} \t-->  '],
  ])('reads it with %s', (_label, line) => {
    expect(readHighlightMarker(line)?.anchor).toEqual({
      kind: 'kindle',
      location: { start: 2, end: null },
      annotationId: null,
    });
  });

  it('draws a mark or colour it does not know as a yellow highlight', () => {
    const read = readHighlightMarker(
      json({ v: 1, mark: 'squiggle', color: 'chartreuse', kind: 'kindle', location: 2 }),
    );
    expect(read?.style).toEqual({ mark: 'highlight', color: 'yellow' });
  });

  it('defaults a PDF or EPUB prefix and suffix to nothing', () => {
    const read = readHighlightMarker(json({ v: 1, kind: 'epub', cfi: 'epubcfi(/2)', exact: 'Hi' }));
    expect(read?.anchor).toEqual({
      kind: 'epub',
      cfi: 'epubcfi(/2)',
      quote: { exact: 'Hi', prefix: '', suffix: '' },
    });
  });

  it.each([
    ['another comment', '<!-- atlas:bookmark -->'],
    ['words before it', 'see <!-- atlas:highlight {"v":1,"kind":"kindle","location":2} -->'],
    ['no JSON', '<!-- atlas:highlight -->'],
    ['broken JSON', '<!-- atlas:highlight {"v":1,"kind": -->'],
    ['a JSON list', '<!-- atlas:highlight [1] -->'],
    ['another version', json({ v: 2, kind: 'kindle', location: 2 })],
    ['no version', json({ kind: 'kindle', location: 2 })],
    ['an unknown kind', json({ v: 1, kind: 'scroll', location: 2 })],
    ['a PDF with no page', json({ v: 1, kind: 'pdf', exact: 'a' })],
    ['a PDF page as text', json({ v: 1, kind: 'pdf', page: '3', exact: 'a' })],
    ['a PDF page 0', json({ v: 1, kind: 'pdf', page: 0, exact: 'a' })],
    ['a PDF quote as a number', json({ v: 1, kind: 'pdf', page: 1, exact: 4 })],
    ['a PDF prefix as a number', json({ v: 1, kind: 'pdf', page: 1, exact: 'a', prefix: 4 })],
    ['boxes that are not a list', json({ v: 1, kind: 'pdf', page: 1, exact: 'a', rects: 'x' })],
    [
      'a box of three numbers',
      json({ v: 1, kind: 'pdf', page: 1, exact: 'a', rects: [[0, 0, 1]] }),
    ],
    ['a box of words', json({ v: 1, kind: 'pdf', page: 1, exact: 'a', rects: [['0', 0, 1, 1]] })],
    ['a box that is not a list', json({ v: 1, kind: 'pdf', page: 1, exact: 'a', rects: [4] })],
    ['an area with no box', json({ v: 1, kind: 'pdf', page: 1 })],
    ['an EPUB with no CFI', json({ v: 1, kind: 'epub', exact: 'a' })],
    ['an EPUB with no words', json({ v: 1, kind: 'epub', cfi: 'epubcfi(/2)' })],
    ['a Kindle location as text', json({ v: 1, kind: 'kindle', location: '2' })],
    ['a Kindle end as text', json({ v: 1, kind: 'kindle', location: 2, locationEnd: '3' })],
    ['a Kindle id as a number', json({ v: 1, kind: 'kindle', location: 2, annotationId: 7 })],
    ['a Kindle page as text', json({ v: 1, kind: 'kindle', page: '2' })],
    ['a Kindle export words as a number', json({ v: 1, kind: 'kindle', location: 2, exact: 4 })],
    ['a Kindle with neither location nor page', json({ v: 1, kind: 'kindle' })],
    [
      'a PDF whose words hold --> raw',
      json({ v: 1, kind: 'pdf', page: 1, exact: 'a --> b', rects: [[0.1, 0.1, 0.2, 0.2]] }),
    ],
    ['a Kindle range that ends first', json({ v: 1, kind: 'kindle', location: 5, locationEnd: 4 })],
  ])('is not read from %s', (_label, line) => {
    expect(readHighlightMarker(line)).toBeNull();
  });

  it('tells a line meant as a marker from other lines, readable or not', () => {
    expect(looksLikeHighlightMarker('<!-- atlas:highlight {broken -->')).toBe(true);
    expect(looksLikeHighlightMarker('  <!--atlas:highlight')).toBe(true);
    expect(looksLikeHighlightMarker('<!-- atlas:highlights -->')).toBe(false);
    expect(looksLikeHighlightMarker('<!-- atlas:bookmark -->')).toBe(false);
    expect(looksLikeHighlightMarker('A note on atlas:highlight')).toBe(false);
  });

  it('does not take a tombstone for a marker it cannot read', () => {
    expect(looksLikeHighlightMarker('<!-- atlas:highlight-removed {"v":1} -->')).toBe(false);
  });
});

describe('the tombstone of a removed Kindle highlight', () => {
  const anchor = { kind: 'kindle', location: { start: 9, end: null }, annotationId: 'A1' } as const;

  it('keeps where it was and a hash of its words, never the words', () => {
    const line = kindleTombstoneLine({ anchor, words: 'Words the reader removed.' });
    expect(line).toMatch(/^<!-- atlas:highlight-removed \{.*\} -->$/);
    expect(line).not.toContain('Words the reader');
    expect(readKindleTombstone(line)).toEqual({
      location: 9,
      annotationId: 'A1',
      wordsHash: hashOf(passageWords('Words the reader removed.')),
    });
  });

  it('reads back a highlight with no location and no id, and one whose id holds markup', () => {
    const page = { kind: 'kindle', location: null, page: 4, annotationId: null } as const;
    expect(readKindleTombstone(kindleTombstoneLine({ anchor: page, words: 'x' }))).toMatchObject({
      location: null,
      annotationId: null,
    });
    const odd = { ...anchor, annotationId: 'a-->b<c>\u2028' };
    const line = kindleTombstoneLine({ anchor: odd, words: 'x' });
    expect(line).not.toContain('-->b');
    expect(line.split('\n')).toHaveLength(1);
    expect(readKindleTombstone(line)?.annotationId).toBe('a-->b<c>\u2028');
  });

  it.each([
    ['a highlight marker', '<!-- atlas:highlight {"v":1,"kind":"kindle","location":2} -->'],
    ['a quoted line', '> <!-- atlas:highlight-removed {"v":1,"kind":"kindle","words":"ab"} -->'],
    ['another version', '<!-- atlas:highlight-removed {"v":2,"kind":"kindle","words":"ab"} -->'],
    ['another source', '<!-- atlas:highlight-removed {"v":1,"kind":"pdf","words":"ab"} -->'],
    ['no words', '<!-- atlas:highlight-removed {"v":1,"kind":"kindle","location":2} -->'],
    [
      'a location as text',
      '<!-- atlas:highlight-removed {"v":1,"kind":"kindle","location":"2","words":"ab"} -->',
    ],
    ['broken JSON', '<!-- atlas:highlight-removed {"v":1, -->'],
    [
      'words after it',
      '<!-- atlas:highlight-removed {"v":1,"kind":"kindle","words":"ab"} --> and more',
    ],
  ])('is not read from %s', (_label, line) => {
    expect(readKindleTombstone(line)).toBeNull();
  });
});
