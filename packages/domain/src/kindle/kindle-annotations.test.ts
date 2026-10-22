import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { readKindleAnnotations } from './kindle-annotations.ts';
import { hashOf, kindleHighlightKey, kindleNoteKey } from './kindle-highlight-key.ts';
import type { KindleHighlightKey, KindleRawPage } from './kindle-types.ts';

/*
 * A book's annotation pages, from hand-made fixtures in the shape of
 * Amazon's (fixtures/README.md: still to be checked against a real page).
 * Pride and Prejudice is public domain; the notes are invented.
 */

const fixture = (name: string) =>
  readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');

const ok = (html: string): KindleRawPage => ({ status: 200, html, redirectedTo: null });

const ASIN = 'B0EXAMPLE1';

const annotations = (rows: string, extra = '') =>
  ok(`${extra}<div id="kp-notebook-annotations">${rows}</div>`);

const row = (id: string, inner: string) =>
  `<div id="${id}" class="a-row a-spacing-base">${inner}</div>`;

const NOTE_ON_OPENING =
  "The famous opening — Ida Brenwick says it is ironic.\nCheck the narrator's voice.";

const ROW_ID = 'QTBFWEFNUExFMTpaWjpISUdITElHSFQ';

describe('readKindleAnnotations', () => {
  it('reads a page of highlights, underlines and notes, with what was typed under each', () => {
    const reading = readKindleAnnotations(ok(fixture('annotations-page-1.html')), ASIN);
    expect(reading).toEqual({
      kind: 'annotations',
      highlights: [
        {
          key: 'amazon:QTBFWEFNUExFMTpBMTpISUdITElHSFQ',
          asin: ASIN,
          annotationId: 'QTBFWEFNUExFMTpBMTpISUdITElHSFQ',
          style: 'highlight',
          colour: 'yellow',
          quote:
            'It is a truth universally acknowledged, that a single man in possession of a good fortune, must be in want of a wife.',
          note: null,
          location: 12,
          page: null,
          commentOn: null,
        },
        {
          key: kindleNoteKey(
            'amazon:QTBFWEFNUExFMTpBMTpISUdITElHSFQ' as KindleHighlightKey,
            NOTE_ON_OPENING,
          ),
          asin: ASIN,
          annotationId: 'QTBFWEFNUExFMTpBMTpISUdITElHSFQ',
          style: 'note',
          colour: null,
          quote: '',
          note: NOTE_ON_OPENING,
          location: 12,
          page: null,
          commentOn: 'amazon:QTBFWEFNUExFMTpBMTpISUdITElHSFQ',
        },
        {
          key: 'amazon:QTBFWEFNUExFMTpBMjpISUdITElHSFQ',
          asin: ASIN,
          annotationId: 'QTBFWEFNUExFMTpBMjpISUdITElHSFQ',
          style: 'highlight',
          colour: 'blue',
          quote: 'I could easily forgive his pride, if he had not mortified mine.',
          note: null,
          location: 1204,
          page: '14',
          commentOn: null,
        },
        {
          key: 'amazon:QTBFWEFNUExFMTpBMzpVTkRFUkxJTkU',
          asin: ASIN,
          annotationId: 'QTBFWEFNUExFMTpBMzpVTkRFUkxJTkU',
          style: 'underline',
          colour: null,
          quote:
            'There is a stubbornness about me that never can bear to be frightened at the will of others.',
          note: null,
          location: 2310,
          page: null,
          commentOn: null,
        },
        {
          key: kindleNoteKey(
            'amazon:QTBFWEFNUExFMTpBNDpOT1RF' as KindleHighlightKey,
            'Compare with Emma & Persuasion.',
          ),
          asin: ASIN,
          annotationId: 'QTBFWEFNUExFMTpBNDpOT1RF',
          style: 'note',
          colour: null,
          quote: '',
          note: 'Compare with Emma & Persuasion.',
          location: 2400,
          page: null,
          commentOn: null,
        },
      ],
      next: { token: 'CgUIAhCeAg', contentLimitState: 'eyJjb250ZW50TGltaXQiOiJleGFtcGxlIn0' },
    });
  });

  it('reads a typed note as an entry of its own, after the passage it was typed on', () => {
    const reading = readKindleAnnotations(
      annotations(
        row(
          ROW_ID,
          '<span id="annotationHighlightHeader">Yellow highlight | Page: 9 | Location: 77</span>' +
            '<span id="highlight">A passage</span><span id="note">A thought</span>',
        ),
      ),
      ASIN,
    );
    expect(reading).toMatchObject({
      kind: 'annotations',
      highlights: [
        {
          key: `amazon:${ROW_ID}`,
          style: 'highlight',
          quote: 'A passage',
          note: null,
          commentOn: null,
        },
        {
          key: `amazon:${ROW_ID}:note:${hashOf('A thought')}`,
          style: 'note',
          quote: '',
          note: 'A thought',
          commentOn: `amazon:${ROW_ID}`,
          annotationId: ROW_ID,
          location: 77,
          page: '9',
          colour: null,
        },
      ],
    });
  });

  it('keeps a passage’s key when a note is typed on it later or edited, and gives the note a key of its own', () => {
    const keysOf = (html: string) => {
      const reading = readKindleAnnotations(annotations(html), ASIN);
      return reading.kind === 'annotations' ? reading.highlights.map((h) => h.key) : [];
    };
    const bare = keysOf(row(ROW_ID, '<span id="highlight">A passage</span>'));
    const noted = keysOf(
      row(ROW_ID, '<span id="highlight">A passage</span><span id="note">First</span>'),
    );
    const edited = keysOf(
      row(ROW_ID, '<span id="highlight">A passage</span><span id="note">Second</span>'),
    );
    expect(noted[0]).toBe(bare[0]);
    expect(edited[0]).toBe(bare[0]);
    expect(noted[1]).not.toBe(edited[1]);
    expect(bare).toHaveLength(1);
  });

  it('keeps a note-only annotation as one entry, under its id and its words, so an edit is a new entry', () => {
    const keysOf = (note: string) => {
      const reading = readKindleAnnotations(
        annotations(row(ROW_ID, `<span id="note">${note}</span>`)),
        ASIN,
      );
      return reading.kind === 'annotations' ? reading.highlights.map((h) => h.key) : [];
    };
    expect(keysOf('First')).toEqual([`amazon:${ROW_ID}:note:${hashOf('First')}`]);
    expect(keysOf('Second')).toEqual([`amazon:${ROW_ID}:note:${hashOf('Second')}`]);
    expect(keysOf('First')).toEqual(keysOf('First'));
  });

  it('gives a typed note on a passage with no usable id a key built on the passage’s', () => {
    const reading = readKindleAnnotations(
      annotations(
        row('x', '<span id="highlight">A passage</span><span id="note">A thought</span>'),
      ),
      ASIN,
    );
    const passage = kindleHighlightKey({
      asin: ASIN,
      annotationId: null,
      location: null,
      words: 'A passage',
    });
    expect(reading).toMatchObject({
      highlights: [
        { key: passage },
        { key: `${passage}:note:${hashOf('A thought')}`, commentOn: passage },
      ],
    });
  });

  it('leaves out a bookmark, which marks a place and holds no words', () => {
    const reading = readKindleAnnotations(ok(fixture('annotations-page-1.html')), ASIN);
    expect(
      reading.kind === 'annotations' &&
        reading.highlights.map((highlight) => highlight.annotationId),
    ).not.toContain('QTBFWEFNUExFMTpBNTpCT09LTUFSSw');
  });

  it('reads the last page as having no next page', () => {
    expect(readKindleAnnotations(ok(fixture('annotations-page-2.html')), ASIN)).toMatchObject({
      kind: 'annotations',
      highlights: [
        { colour: 'orange', location: 5120, quote: 'Till this moment I never knew myself.' },
      ],
      next: null,
    });
  });

  it('reads a page with no next-page input at all as the last, and a missing limit state as empty', () => {
    expect(readKindleAnnotations(annotations(''), ASIN)).toEqual({
      kind: 'annotations',
      highlights: [],
      next: null,
    });
    const extra = '<input class="kp-notebook-annotations-next-page-start" value="T2">';
    expect(readKindleAnnotations(annotations('', extra), ASIN)).toMatchObject({
      next: { token: 'T2', contentLimitState: '' },
    });
  });

  it('refuses a page that says it is another book’s, so its highlights cannot land in the wrong note', () => {
    expect(readKindleAnnotations(ok(fixture('annotations-page-1.html')), 'B0EXAMPLE2')).toEqual({
      kind: 'unrecognised',
      reason: 'the page is for B0EXAMPLE1, not B0EXAMPLE2',
    });
  });

  it('refuses a page with no annotations, and passes on a sign-in', () => {
    expect(readKindleAnnotations(ok(fixture('library.html')), ASIN)).toEqual({
      kind: 'unrecognised',
      reason: 'the page has no annotations',
    });
    expect(readKindleAnnotations(ok(fixture('sign-in.html')), ASIN)).toEqual({
      kind: 'sign_in_required',
    });
  });

  it('refuses the whole page when a row has neither a passage nor a note, rather than reading the rest', () => {
    const page = annotations(
      row(ROW_ID, '<span id="highlight">kept?</span>') + row('QTBFWEFNUExFMTpaWjpPVEhFUg', ''),
    );
    expect(readKindleAnnotations(page, ASIN)).toEqual({
      kind: 'unrecognised',
      reason: 'an annotation has neither a passage nor a note',
    });
  });

  it('keys a row with no usable id by book, location and words, and reads the location from the header', () => {
    const page = annotations(
      row(
        'x',
        '<span id="annotationHighlightHeader">Pink highlight | Location: 3,001</span>' +
          '<div class="kp-notebook-highlight kp-notebook-highlight-pink"><span id="highlight">A passage</span></div>',
      ),
    );
    expect(readKindleAnnotations(page, ASIN)).toMatchObject({
      highlights: [
        {
          annotationId: null,
          colour: 'pink',
          location: 3001,
          key: kindleHighlightKey({
            asin: ASIN,
            annotationId: null,
            location: 3001,
            words: 'A passage',
          }),
        },
      ],
    });
  });

  it('reads a header only the note header fills, and no location anywhere as none', () => {
    const page = annotations(
      row(
        ROW_ID,
        '<span id="annotationHighlightHeader"></span><span id="annotationNoteHeader">Note | Page: xiv</span>' +
          '<span id="note">A thought</span>',
      ),
    );
    expect(readKindleAnnotations(page, ASIN)).toMatchObject({
      highlights: [{ style: 'note', page: 'xiv', location: null, note: 'A thought' }],
    });
  });

  it('reads a location input that is not a number as missing, falling back to the header', () => {
    const page = annotations(
      row(
        ROW_ID,
        '<input id="kp-annotation-location" value="12abc"><span id="annotationHighlightHeader">Yellow highlight | Location: 77</span><span id="highlight">q</span>',
      ),
    );
    expect(readKindleAnnotations(page, ASIN)).toMatchObject({ highlights: [{ location: 77 }] });
  });

  it('reads a highlight in a colour it does not know, or with no colour class, as no colour', () => {
    const page = annotations(
      row(
        ROW_ID,
        '<div class="kp-notebook-highlight kp-notebook-highlight-purple"><span id="highlight">q</span></div>',
      ) + row('QTBFWEFNUExFMTpaWjpOT0NPTE9VUg', '<span id="highlight">r</span>'),
    );
    expect(readKindleAnnotations(page, ASIN)).toMatchObject({
      highlights: [
        { style: 'highlight', colour: null },
        { style: 'highlight', colour: null },
      ],
    });
  });

  it('accepts a page that names no ASIN, read as the book that was asked for', () => {
    const page = annotations(row(ROW_ID, '<span id="highlight">q</span>'));
    expect(readKindleAnnotations(page, ASIN)).toMatchObject({ highlights: [{ asin: ASIN }] });
  });

  it('only reads rows inside the annotations, not a header row of the same classes outside it', () => {
    const page = ok(
      `<div id="${ROW_ID}" class="a-row a-spacing-base"><span id="highlight">outside</span></div><div id="kp-notebook-annotations"></div>`,
    );
    expect(readKindleAnnotations(page, ASIN)).toMatchObject({ highlights: [] });
  });
});
