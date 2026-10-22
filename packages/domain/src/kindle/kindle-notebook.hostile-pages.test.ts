import { describe, expect, it } from 'vitest';
import { MAX_HTML_DEPTH, parseHtml, textOf } from './html-tree.ts';
import { readKindleAnnotations } from './kindle-annotations.ts';
import { kindleHighlightKey } from './kindle-highlight-key.ts';
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

  it('reads a page of nested annotation rows in time linear in its size', () => {
    // 250 nested rows (under the depth cap) over 40 000 plain elements: about 300 KB. Each row
    // searches the whole subtree under it; an 8 MB page of this shape takes tens of seconds.
    const rows = Array.from({ length: 250 }, (_, at) =>
      openRow(`IDNESTED${String(at).padStart(4, '0')}`),
    ).join('');
    const html = annotations(`${rows}${'<i></i>'.repeat(40_000)}<span id="highlight">q</span>`);
    expect(timed(() => readKindleAnnotations(page(html), 'B0EXAMPLE1'))).toBeLessThan(
      LINEAR_BUDGET_MS,
    );
  });

  it('reads many rows each nesting the next, every one with a passage, in linear time', () => {
    const rows = Array.from(
      { length: 250 },
      (_, at) =>
        `${openRow(`IDCHAIN${String(at).padStart(5, '0')}`)}<span id="highlight">q${at}</span>`,
    ).join('');
    const html = annotations(`${rows}${'<i></i>'.repeat(40_000)}`);
    let count = 0;
    const took = timed(() => {
      const reading = readKindleAnnotations(page(html), 'B0EXAMPLE1');
      count = reading.kind === 'annotations' ? reading.highlights.length : -1;
    });
    expect({ count, fast: took < LINEAR_BUDGET_MS }).toEqual({ count: 250, fast: true });
  });
});
