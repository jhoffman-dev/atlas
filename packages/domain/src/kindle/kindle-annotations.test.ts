import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { readKindleAnnotations } from './kindle-annotations.ts';
import { kindleHighlightKey } from './kindle-highlight-key.ts';
import type { KindleRawPage } from './kindle-types.ts';

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
          note: "The famous opening — Mara Quill says it is ironic.\nCheck the narrator's voice.",
          location: 12,
          page: null,
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
        },
        {
          key: 'amazon:QTBFWEFNUExFMTpBNDpOT1RF',
          asin: ASIN,
          annotationId: 'QTBFWEFNUExFMTpBNDpOT1RF',
          style: 'note',
          colour: null,
          quote: '',
          note: 'Compare with Emma & Persuasion.',
          location: 2400,
          page: null,
        },
      ],
      next: { token: 'CgUIAhCeAg', contentLimitState: 'eyJjb250ZW50TGltaXQiOiJleGFtcGxlIn0' },
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
