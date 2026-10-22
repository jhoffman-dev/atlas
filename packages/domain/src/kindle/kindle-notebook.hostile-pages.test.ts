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
});
