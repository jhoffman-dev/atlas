import { describe, expect, it } from 'vitest';
import type { HighlightAnchor } from './anchor.ts';
import { appendHighlights, withoutHighlight, type NewHighlight } from './edit-highlights.ts';
import { readHighlights } from './highlight-block.ts';
import { literatureNoteText } from './literature-note.ts';
import { createVaultPath } from '../vault/vault-path.ts';

/**
 * Second verification pass on PR #510 (#503, ADR-0043), after the hidden-block,
 * lazy-line, Kindle-place and exact-removal fixes. Each test is one invariant
 * the fixes claim, attacked past the tests that came with them; each fails
 * while the gap it names stands.
 */

/** mulberry32: a seeded random source, so every run draws the same ids. */
function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const PDF_NOTE = literatureNoteText({
  kind: 'pdf',
  title: 'The Art of War',
  author: 'Sun Tzu',
  file: createVaultPath('Library/The Art of War.pdf'),
});
const KINDLE_NOTE = literatureNoteText({
  kind: 'kindle',
  title: 'Emma',
  author: 'Jane Austen',
  file: null,
});

const pdf = (exact: string): HighlightAnchor => ({
  kind: 'pdf',
  page: 3,
  quote: { exact, prefix: '', suffix: '' },
  rects: [{ x: 0.1, y: 0.1, width: 0.5, height: 0.02 }],
});

const appended = (text: string, highlights: readonly NewHighlight[], seed = 1) =>
  appendHighlights({ text, highlights, random: seeded(seed) });

const KNOW = { quote: 'Know the enemy.', anchor: pdf('Know the enemy.') };
const WARFARE = {
  quote: 'All warfare is based on deception.',
  anchor: pdf('All warfare is based on deception.'),
};

const idsOf = (text: string) => readHighlights(text).map((block) => block.id);

describe('R1: a %% inside code hides nothing (verify2 #510)', () => {
  /*
   * The tracker already lets a fence and a single-backtick span keep `%%` as
   * text; Obsidian shows code literally everywhere. A `%%` in any other code —
   * a fence in a highlight's comment, an indented code block, a double-backtick
   * span — is counted as opening a comment, so every later highlight drops out
   * of the index and every later append is refused.
   */
  it('keeps the highlights after one whose comment holds a fenced `%%` (a MATLAB cell)', () => {
    const first = appended(PDF_NOTE, [
      { ...WARFARE, comment: '```matlab\n%% Section one\nx = 1;\n```' },
    ]);
    const both = appended(first.text, [KNOW], 2);
    expect(idsOf(both.text)).toEqual([first.highlights[0]?.id, both.highlights[0]?.id]);
  });

  it('keeps the highlights after an indented code block holding `%%`', () => {
    const note = `${PDF_NOTE}Example:\n\n    printf("100%%\\n");\n\n`;
    expect(() => appended(note, [KNOW])).not.toThrow();
  });

  it('keeps the highlights after a double-backtick code span holding `%%`', () => {
    const note = `${PDF_NOTE}Escape it as \`\`%%\`\` in a format string.\n\n`;
    expect(() => appended(note, [KNOW])).not.toThrow();
  });

  it('keeps the highlights after a plain quote holding a fenced `%%`', () => {
    const note = `${PDF_NOTE}> [!example]\n> \`\`\`matlab\n> %% Section one\n> \`\`\`\n\n`;
    expect(() => appended(note, [KNOW])).not.toThrow();
  });
});

describe('R2: a quote line indented under the block still belongs to it (verify2 #510)', () => {
  it('reads a highlight whose comment line has spaces before its `>`, so a sync adds nothing twice', () => {
    // CommonMark (micromark) keeps `  > more` in the block quote; Obsidian shows one quote.
    const first = appended(PDF_NOTE, [{ ...KNOW, comment: 'Mine.' }]);
    const id = first.highlights[0]?.id as string;
    const edited = first.text.replace('> Mine.\n', '> Mine.\n  > And more.\n');
    const again = appended(edited, [KNOW], 2);
    expect(again.highlights).toEqual([{ id, added: false }]);
  });
});

describe('R3: a Kindle passage is one passage across exports that place it differently (verify2 #510)', () => {
  it('matches an id-less location-and-page copy from an export that gives the page alone', () => {
    // My Clippings gives "page 5 | Location 77-79"; a notebook export of a book with
    // real page numbers gives "Page 5" and the annotation id. Same words, same page.
    const words = 'It is a truth universally acknowledged.';
    const first = appended(KINDLE_NOTE, [
      {
        quote: words,
        anchor: { kind: 'kindle', location: { start: 77, end: 79 }, page: 5, annotationId: null },
      },
    ]);
    const again = appended(
      first.text,
      [
        {
          quote: words,
          anchor: { kind: 'kindle', location: null, page: 5, annotationId: 'AMZ-1' },
        },
      ],
      2,
    );
    expect(again.highlights).toEqual([{ id: first.highlights[0]?.id, added: false }]);
  });
});

describe('A11: removing what was appended gives the note back byte for byte (verify2 #510)', () => {
  it.each([
    ['LF', '---\ntype: literature\n---'],
    ['CRLF', '---\r\ntype: literature\r\n---'],
  ])('to a frontmatter-only note with no final newline (%s)', (_, note) => {
    const added = appended(note, [KNOW]);
    const id = added.highlights[0]?.id as string;
    expect(withoutHighlight({ text: added.text, id })).toBe(note);
  });
});
