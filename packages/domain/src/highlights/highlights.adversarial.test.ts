import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { anchorProblem, type HighlightAnchor } from './anchor.ts';
import {
  appendHighlights,
  withHighlightComment,
  withoutHighlight,
  type NewHighlight,
} from './edit-highlights.ts';
import { readHighlights } from './highlight-block.ts';
import { highlightMarker, readHighlightMarker } from './highlight-marker.ts';
import { quoteLines } from './highlight-text.ts';
import { findQuote, findQuoteNear, quoteSelectorAt } from './reanchor.ts';
import { literatureNoteText } from './literature-note.ts';
import { createVaultPath } from '../vault/vault-path.ts';

/**
 * Adversarial tests for #503, ADR-0043 (found in PR #510): the literature-note format under hostile
 * markers, Obsidian edits, Kindle re-syncs and re-anchoring. Each test is
 * one invariant the ADR states, and fails while the bug it names stands.
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

const KINDLE_NOTE = literatureNoteText({
  kind: 'kindle',
  title: 'Emma',
  author: 'Jane Austen',
  file: null,
});
const PDF_NOTE = literatureNoteText({
  kind: 'pdf',
  title: 'The Art of War',
  author: 'Sun Tzu',
  file: createVaultPath('Library/The Art of War.pdf'),
});

const kindle = (start: number, annotationId: string | null = null): HighlightAnchor => ({
  kind: 'kindle',
  location: { start, end: start + 2 },
  annotationId,
});

const pdf = (exact: string): HighlightAnchor => ({
  kind: 'pdf',
  page: 3,
  quote: { exact, prefix: '', suffix: '' },
  rects: [{ x: 0.1, y: 0.1, width: 0.5, height: 0.02 }],
});

const appended = (text: string, highlights: readonly NewHighlight[], seed = 1) =>
  appendHighlights({ text, highlights, random: seeded(seed) });

describe('the marker under hostile JSON (attack on #510)', () => {
  it('reads back a marker DFAI wrote for words holding a line or paragraph separator', () => {
    // PDF and EPUB text layers carry U+2028/U+2029; JSON.stringify leaves them raw,
    // and the marker pattern's `.` stops at them, so the highlight would vanish.
    const anchor = pdf('All warfare is based on deception.');
    const marker = highlightMarker({ style: { mark: 'highlight', color: 'yellow' }, anchor });
    expect(readHighlightMarker(marker)?.anchor).toEqual(anchor);
  });

  it('keeps a highlight whose exact words hold a paragraph separator readable after appending', () => {
    const { text, highlights } = appended(PDF_NOTE, [
      { quote: 'Know the enemy.', anchor: pdf('Know the enemy. Know yourself.') },
    ]);
    expect(readHighlights(text).map((block) => block.id)).toEqual([highlights[0]?.id]);
  });

  it('refuses a hand-written marker whose JSON holds a raw `-->`, which closes the comment in every reader', () => {
    // CommonMark ends the HTML comment at the first `-->`, so Obsidian shows `b"} -->`
    // as text while DFAI treats the line as a hidden, valid marker.
    const line =
      '<!-- atlas:highlight {"v":1,"kind":"pdf","page":1,"exact":"a --> b","rects":[[0.1,0.1,0.2,0.2]]} -->';
    expect(readHighlightMarker(line)).toBeNull();
  });
});

describe('anchors the format would keep (attack on #510)', () => {
  it('refuses a PDF quote whose exact words are only whitespace', () => {
    expect(anchorProblem(pdf(' \t\n '))).not.toBeNull();
  });

  it('refuses a PDF box that runs off the right or bottom of its page', () => {
    const anchor: HighlightAnchor = {
      kind: 'pdf',
      page: 1,
      quote: null,
      rects: [{ x: 0.9, y: 0.95, width: 0.9, height: 0.9 }],
    };
    expect(anchorProblem(anchor)).not.toBeNull();
  });
});

describe('quoted words never become markup (attack on #510)', () => {
  it('escapes a paragraph that is only an ordered-list number, which would read as an empty list item', () => {
    // `> 1.` alone is an empty ordered list item in CommonMark; `-` alone is escaped, `1.` is not.
    expect(quoteLines('Chapter\n\n1.\n\nIt began.')).not.toContain('1.');
    expect(quoteLines('2)')).not.toEqual(['2)']);
  });
});

describe('Kindle re-sync adds a passage once (attack on #510)', () => {
  it('answers the existing id after the person tidied the quote of a Kindle highlight with no annotation id', () => {
    // ADR-0043 §4: the person may tidy a quote and it still finds its passage; §7:
    // a sync hands over everything each time. A Kindle anchor keeps no words of
    // its own, so the key falls back to the (edited) quote and the sync duplicates it.
    const words =
      'It is a truth universally acknowledged, that a single man in possesion of a fortune';
    const first = appended(KINDLE_NOTE, [{ quote: words, anchor: kindle(77) }]);
    const tidied = first.text.replace('possesion', 'possession');
    const again = appended(tidied, [{ quote: words, anchor: kindle(77) }], 2);
    expect(again.highlights).toEqual([{ id: first.highlights[0]?.id, added: false }]);
  });

  it('answers the existing id for the same untouched words, whatever markdown or whitespace they hold', () => {
    const random = seeded(503);
    const alphabet = [
      'a',
      'Z',
      ' ',
      '\n',
      '\n\n',
      '\t',
      ' ',
      '*',
      '_',
      '#',
      '^',
      '>',
      '<',
      '\\',
      '1.',
      '- ',
      '[[',
      '==',
      '%%',
      '`',
      'é',
      '📚',
      '|',
      '$',
      '\r\n',
    ];
    const duplicated: string[] = [];
    for (let run = 0; run < 200; run += 1) {
      const words = `w${Array.from({ length: 12 }, () => alphabet[Math.floor(random() * alphabet.length)]).join('')}`;
      const first = appended(KINDLE_NOTE, [{ quote: words, anchor: kindle(5) }], run);
      const again = appended(first.text, [{ quote: words, anchor: kindle(5) }], run + 1);
      if (again.highlights[0]?.added !== false) duplicated.push(JSON.stringify(words));
    }
    expect(duplicated.slice(0, 3)).toEqual([]);
  });

  it('answers the existing id when a later export knows the annotation id of a passage already synced without one', () => {
    const words = 'Emma Woodhouse, handsome, clever, and rich';
    const first = appended(KINDLE_NOTE, [{ quote: words, anchor: kindle(12) }]);
    const again = appended(first.text, [{ quote: words, anchor: kindle(12, 'A1B2C3') }], 2);
    expect(again.highlights[0]?.added).toBe(false);
  });
});

describe('appending always reads back (attack on #510)', () => {
  it('reads back a highlight appended to a note whose body ends inside an unclosed code fence', () => {
    // Every sync would otherwise append the same passage again: the block sits inside the fence.
    const note = `${PDF_NOTE}My notes.\n\n\`\`\`js\nconst draft = 1;\n`;
    const once = appended(note, [{ quote: 'Know the enemy.', anchor: pdf('Know the enemy.') }]);
    const twice = appended(
      once.text,
      [{ quote: 'Know the enemy.', anchor: pdf('Know the enemy.') }],
      2,
    );
    expect(twice.highlights[0]?.added).toBe(false);
  });

  it('gives the note back byte for byte when the one highlight added to a note with no final newline is removed', () => {
    const note = `${PDF_NOTE}My closing thought`;
    const { text, highlights } = appended(note, [
      { quote: 'Know the enemy.', anchor: pdf('Know the enemy.') },
    ]);
    expect(withoutHighlight({ text, id: highlights[0]?.id as string })).toBe(note);
  });
});

describe('a highlight edited in Obsidian (attack on #510)', () => {
  const block = (comment: string) =>
    [
      '> All warfare is based on deception.',
      `> ${highlightMarker({ style: { mark: 'highlight', color: 'yellow' }, anchor: pdf('All warfare is based on deception.') })}`,
      '>',
      comment,
      '',
      '^k3x9q2',
      '',
    ].join('\n');

  it('is still a highlight when a comment line lost its `>` (a lazy continuation, still the quote in Obsidian)', () => {
    const text = PDF_NOTE + block('> The line every summary quotes,\nand every general forgets.');
    expect(readHighlights(text).map((found) => found.id)).toEqual(['k3x9q2']);
  });

  it('edits only the comment of a highlight whose comment line lost its `>`', () => {
    const text = PDF_NOTE + block('> First thought,\nsecond thought.');
    expect(() => withHighlightComment({ text, id: 'k3x9q2', comment: 'Rewritten.' })).not.toThrow();
  });
});

describe('a source file the note could not name back (attack on #510)', () => {
  // The `file:` is a wiki link, and `#`, `[`, `]`, `^` and `|` mean something inside one,
  // so such a name would read back as a different file. Decision A5: the writer refuses it.
  const noteFor = (file: string) =>
    literatureNoteText({ kind: 'pdf', title: 'T', author: null, file: createVaultPath(file) });

  it.each([
    'Library/C# in Depth.pdf',
    'Library/Notes [draft].pdf',
    'Library/A^b.pdf',
    'Library/A|b.pdf',
  ])('refuses the file %j', (file) => {
    expect(() => noteFor(file)).toThrow();
  });
});

describe('re-anchoring (attack on #510)', () => {
  it('finds the selection quoteSelectorAt took, even when the selection starts on a space', () => {
    // PDF selections often take the space before a word. The trimmed exact no longer
    // abuts the prefix, so neither copy scores, and the first copy wins: the wrong place.
    const text = 'Alpha wrote: deception wins. Beta wrote: deception wins.';
    const start = text.lastIndexOf(' deception');
    const end = text.length;
    const found = findQuote(text, quoteSelectorAt({ text, start, end }));
    expect(found?.start).toBeGreaterThan(text.indexOf('Beta'));
  });

  it('round-trips quoteSelectorAt through findQuote for every seeded selection', () => {
    const random = seeded(510);
    const words = ['war', 'deception', 'the', 'enemy', 'know', ' ', '  ', '\n'];
    const misses: string[] = [];
    for (let run = 0; run < 300; run += 1) {
      const text = Array.from(
        { length: 30 },
        () => words[Math.floor(random() * words.length)],
      ).join(' ');
      const start = Math.floor(random() * (text.length - 1));
      const end = start + 1 + Math.floor(random() * Math.min(20, text.length - start - 1));
      const selector = quoteSelectorAt({ text, start, end });
      if (selector.exact.trim() === '') continue;
      const found = findQuote(text, selector);
      const covers = found !== null && found.start >= start && found.end <= end;
      if (!covers) misses.push(JSON.stringify({ text, start, end }));
    }
    expect(misses.slice(0, 3)).toEqual([]);
  });

  it('answers no match rather than an arbitrary copy when two copies score the same', () => {
    // ADR-0043 §9: changed words are not found rather than found in the wrong place.
    const text = 'One said: know the enemy. Two said: know the enemy.';
    expect(
      findQuote(text, { exact: 'know the enemy.', prefix: 'Other edition: ', suffix: ' Next' }),
    ).toBeNull();
  });

  it('does not throw for a page between two sections', () => {
    const sections = ['first page', 'second page', 'third page'];
    expect(() =>
      findQuoteNear({ sections, selector: { exact: 'third', prefix: '', suffix: '' }, near: 1.5 }),
    ).not.toThrow();
  });

  it('returns for a page that is not a number instead of looping forever', () => {
    // Run in a child process: the loop never yields, so an in-process timeout cannot stop it.
    const module = fileURLToPath(new URL('./reanchor.ts', import.meta.url));
    const script = `import { findQuoteNear } from ${JSON.stringify(module)};
      findQuoteNear({ sections: ['a page'], selector: { exact: 'page', prefix: '', suffix: '' }, near: NaN });`;
    const run = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
      timeout: 5000,
    });
    expect(run.error, 'findQuoteNear hung on near = NaN').toBeUndefined();
    expect(run.status).toBe(0);
  });
});
