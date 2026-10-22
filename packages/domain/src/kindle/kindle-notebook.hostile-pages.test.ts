import { describe, expect, it } from 'vitest';
import { MAX_HTML_DEPTH, parseHtml, textOf } from './html-tree.ts';
import { countedWork } from '../testing/counted-work.ts';
import { readKindleAnnotations } from './kindle-annotations.ts';
import { kindleHighlightKey } from './kindle-highlight-key.ts';
import { checkKindlePage } from './kindle-notebook-page.ts';
import type { KindleRawPage } from './kindle-types.ts';

/*
 * Regressions found in review of PR #511: the notebook reader against pages it was not written
 * for. The books are invented; the quotes are public domain.
 */

const page = (html: string): KindleRawPage => ({ status: 200, html, redirectedTo: null });
const row = (id: string, inner: string) =>
  `<div id="${id}" class="a-row a-spacing-base">${inner}</div>`;
const annotations = (rows: string) => `<div id="kp-notebook-annotations">${rows}</div>`;
/** A row's start tag alone, for rows nested inside one another. */
const openRow = (id: string) => `<div id="${id}" class="a-row a-spacing-base">`;

/** Milliseconds `read` takes. A linear reader does these pages in a few ms. */
function timed(read: () => void): number {
  const started = performance.now();
  read();
  return performance.now() - started;
}

// Over ten times what a linear pass needs here under coverage, and about a
// tenth of what the quadratic pass takes: a timing with room either side.
const LINEAR_BUDGET_MS = 250;

describe('the notebook reader against hostile pages', () => {
  it('reads a page of unclosed start tags in one pass, not one pass per tag', () => {
    // 18 KB. An 8 MB page, which the host lets through, is some 200 000 times this work.
    const html = '<a '.repeat(6_000);
    expect(timed(() => parseHtml(html))).toBeLessThan(LINEAR_BUDGET_MS);
  });

  it('reads a page of unterminated attribute values in one pass', () => {
    const html = '<a b="'.repeat(8_000);
    expect(timed(() => parseHtml(html))).toBeLessThan(LINEAR_BUDGET_MS);
  });

  it('refuses a book page whose annotations sit past the depth cap, rather than reading it as empty', () => {
    const deep =
      '<div>'.repeat(MAX_HTML_DEPTH + 5) +
      annotations(row('IDDEEP000001', '<span id="highlight">Call me Ishmael.</span>'));
    const reading = readKindleAnnotations(page(deep), 'B0EXAMPLE1');
    expect(reading.kind === 'annotations' && reading.highlights.length === 0).toBe(false);
  });

  it('refuses a page where two different passages claim one annotation id', () => {
    const html = annotations(
      row('IDDUPLICATE1', '<span id="highlight">It was the best of times.</span>') +
        row('IDDUPLICATE1', '<span id="highlight">It was the worst of times.</span>'),
    );
    const reading = readKindleAnnotations(page(html), 'B0EXAMPLE1');
    if (reading.kind === 'annotations') {
      const keys = new Set(reading.highlights.map((highlight) => highlight.key));
      expect(keys.size).toBe(reading.highlights.length);
    } else {
      expect(reading.kind).toBe('unrecognised');
    }
  });

  it('reads no page from a header whose Page is empty', () => {
    const html = annotations(
      row(
        'IDHEADER0001',
        '<span id="annotationHighlightHeader">Yellow highlight | Page: | Location: 12</span>' +
          '<span id="highlight">Reader, I married him.</span>',
      ),
    );
    const reading = readKindleAnnotations(page(html), 'B0EXAMPLE1');
    expect(reading.kind === 'annotations' ? reading.highlights[0]?.page : 'unread').toBeNull();
  });

  it('decodes the named entities a page may write accented words with', () => {
    expect(textOf(parseHtml('<p>caf&eacute; na&iuml;ve &euro;5 &copy;</p>'))).toBe(
      'café naïve €5 ©',
    );
  });

  it('keys one passage the same whether its accents arrive composed or decomposed', () => {
    const keyOf = (words: string) =>
      kindleHighlightKey({ asin: 'B0EXAMPLE1', annotationId: null, location: 120, words });
    expect(keyOf('the café at the corner')).toBe(keyOf('the café at the corner'));
  });

  it('reads a passage once when one annotation row sits inside another', () => {
    const html = annotations(
      `${openRow('IDOUTERROW01')}${openRow('IDINNERROW01')}<span id="highlight">Call me Ishmael.</span></div></div>`,
    );
    const reading = readKindleAnnotations(page(html), 'B0EXAMPLE1');
    if (reading.kind !== 'annotations') {
      expect(reading.kind).toBe('unrecognised');
      return;
    }
    expect(reading.highlights.map((highlight) => highlight.quote)).toEqual(['Call me Ishmael.']);
  });

  it('reads a row’s own passage and note, not those of a row nested inside it', () => {
    const html = annotations(
      row(
        'IDOUTERROW02',
        `<span id="highlight">It was the best of times.</span>${row('IDINNERROW02', '<span id="highlight">It was the worst of times.</span><span id="note">A thought</span>')}`,
      ),
    );
    const reading = readKindleAnnotations(page(html), 'B0EXAMPLE1');
    expect(
      reading.kind === 'annotations'
        ? reading.highlights.map((h) => [h.annotationId, h.quote, h.note])
        : reading.kind,
    ).toEqual([
      ['IDOUTERROW02', 'It was the best of times.', null],
      ['IDINNERROW02', 'It was the worst of times.', null],
      ['IDINNERROW02', '', 'A thought'],
    ]);
  });

  /*
   * The two nested-row pages below were first held to LINEAR_BUDGET_MS by the clock. Under the
   * full gate's load a linear read of them took 400 ms, so they count work instead, as #385 has
   * every growth rule do: double the page, and reading its rows does about twice the work, where
   * searching each row's whole subtree does four times. Parsing the page is counted apart and
   * left out: closing a tag looks along the open elements, so its work grows with the depth too,
   * but the depth is capped (MAX_HTML_DEPTH) and that is a bounded factor, not this rule.
   */
  const nestedPage = (rows: number, withPassages: boolean) =>
    annotations(
      Array.from(
        { length: rows },
        (_, at) =>
          `${openRow(`IDNESTED${String(at).padStart(4, '0')}`)}${withPassages ? `<span id="highlight">q${at}</span>` : ''}`,
      ).join('') +
        '<i></i>'.repeat(rows * 160) +
        (withPassages ? '' : '<span id="highlight">q</span>'),
    );
  const growth = (withPassages: boolean) => {
    const work = (rows: number) => {
      const raw = page(nestedPage(rows, withPassages));
      const parsing = countedWork(() => checkKindlePage(raw));
      return countedWork(() => readKindleAnnotations(raw, 'B0EXAMPLE1')) - parsing;
    };
    return work(250) / work(125);
  };

  it('reads a page of nested annotation rows in time linear in its size', () => {
    // 250 nested rows (under the depth cap) over 40 000 plain elements: about 300 KB. Each row
    // searching the whole subtree under it makes an 8 MB page of this shape take tens of seconds.
    expect(growth(false)).toBeLessThan(3);
  });

  it('reads many rows each nesting the next, every one with a passage, in linear time', () => {
    const reading = readKindleAnnotations(page(nestedPage(250, true)), 'B0EXAMPLE1');
    expect(reading.kind === 'annotations' ? reading.highlights.length : -1).toBe(250);
    expect(growth(true)).toBeLessThan(3);
  });
});

/*
 * Second verification of PR #511 (after the fix round at b4e81c01): note-only keys against the
 * unicode variants the key claims to read as one.
 */

const noteOnly = (note: string) =>
  page(annotations(row('IDNOTEONLY01', `<span id="note">${note}</span>`)));

const keysOf = (raw: KindleRawPage) => {
  const reading = readKindleAnnotations(raw, 'B0EXAMPLE1');
  return reading.kind === 'annotations' ? reading.highlights.map((h) => h.key) : [reading.kind];
};

describe('a note-only key across syncs of an unchanged note', () => {
  it('is the same when a zero-width space sits between a letter and its combining accent', () => {
    // "café" composed one day; the next, written e + ZWSP + combining acute. Stripped of the
    // zero-width space and composed, both are "café", so the note is unchanged.
    const composed = keysOf(noteOnly('Tea at the café.'));
    const decomposed = keysOf(noteOnly('Tea at the cafe​́.'));
    expect(composed[0]).toMatch(/^amazon:IDNOTEONLY01:note:/);
    expect(decomposed).toEqual(composed);
  });
});
