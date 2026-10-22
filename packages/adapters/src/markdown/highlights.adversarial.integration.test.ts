import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  anchorProblem,
  type HighlightAnchor,
  appendHighlights,
  HighlightNotReadBackError,
  UnreadableHighlightMarkerError,
  withHighlightComment,
  withoutHighlight,
  type NewHighlight,
  readHighlights,
  highlightMarker,
  readHighlightMarker,
  quoteLines,
  findQuote,
  findQuoteNear,
  quoteSelectorAt,
  literatureNoteText,
  createVaultPath,
} from '@dfai/domain';
import { noteBlocks } from './note-blocks.ts';

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
  appendHighlights({ text, highlights, random: seeded(seed), noteBlocks });

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
    expect(readHighlights(text, noteBlocks).map((block) => block.id)).toEqual([highlights[0]?.id]);
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
  it('refuses, before writing, a highlight it could not read back from a note whose body ends inside an unclosed code fence', () => {
    // Decision R1: the block would sit inside the fence, so every sync would append the
    // same passage again. The postcondition (every added id reads back) throws instead.
    const note = `${PDF_NOTE}My notes.\n\n\`\`\`js\nconst draft = 1;\n`;
    expect(() =>
      appended(note, [{ quote: 'Know the enemy.', anchor: pdf('Know the enemy.') }]),
    ).toThrow(HighlightNotReadBackError);
  });

  it('gives the note back byte for byte when the one highlight added to a note with no final newline is removed', () => {
    const note = `${PDF_NOTE}My closing thought`;
    const { text, highlights } = appended(note, [
      { quote: 'Know the enemy.', anchor: pdf('Know the enemy.') },
    ]);
    expect(withoutHighlight({ text, id: highlights[0]?.id as string, noteBlocks })).toBe(note);
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
    expect(readHighlights(text, noteBlocks).map((found) => found.id)).toEqual(['k3x9q2']);
  });

  it('edits only the comment of a highlight whose comment line lost its `>`', () => {
    const text = PDF_NOTE + block('> First thought,\nsecond thought.');
    expect(() =>
      withHighlightComment({ text, id: 'k3x9q2', comment: 'Rewritten.', noteBlocks }),
    ).not.toThrow();
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
      // A9 (verify #510): copies whose surroundings differ only in whitespace tie, and a
      // tie finds nothing. Only such a selection may go unfound; none is found elsewhere.
      const ties =
        found === null
          ? occurrences(fold(text), fold(selector.prefix + selector.exact + selector.suffix))
          : 0;
      if (!covers && ties < 2) misses.push(JSON.stringify({ text, start, end }));
    }
    expect(misses.slice(0, 3)).toEqual([]);
  });

  it('answers no match rather than an arbitrary copy when two copies score the same', () => {
    // ADR-0043 §9: changed words are not found rather than found in the wrong place.
    // (The attack's text ended at the second copy, which gave it one less character of
    // suffix, so the copies did not tie; ending both on ' Done.' makes them tie.)
    const text = 'One said: know the enemy. Two said: know the enemy. Done.';
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
    const module = fileURLToPath(
      new URL('../../../domain/src/highlights/reanchor.ts', import.meta.url),
    );
    const script = `import { findQuoteNear } from ${JSON.stringify(module)};
      findQuoteNear({ sections: ['a page'], selector: { exact: 'page', prefix: '', suffix: '' }, near: NaN });`;
    const run = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
      timeout: 5000,
    });
    expect(run.error, 'findQuoteNear hung on near = NaN').toBeUndefined();
    expect(run.status).toBe(0);
  });
});

describe('review findings on #510', () => {
  it('refuses to append inside an unclosed HTML comment, which hides everything after it', () => {
    const note = `${PDF_NOTE}My notes.\n\n<!-- a draft I never closed\n`;
    expect(() =>
      appended(note, [{ quote: 'Know the enemy.', anchor: pdf('Know the enemy.') }]),
    ).toThrow(HighlightNotReadBackError);
  });

  it('names the ids that would not read back, and writes nothing', () => {
    const note = `${PDF_NOTE}\`\`\`\n`;
    try {
      appended(note, [{ quote: 'Know the enemy.', anchor: pdf('Know the enemy.') }]);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(HighlightNotReadBackError);
      expect((error as HighlightNotReadBackError).ids).toHaveLength(1);
    }
  });

  it('reads a closed HTML comment block and a closed fence as ordinary text around highlights', () => {
    const note = `${PDF_NOTE}<!-- a note\nto self -->\n\n\`\`\`\ncode\n\`\`\`\n`;
    const { text, highlights } = appended(note, [
      { quote: 'Know the enemy.', anchor: pdf('Know the enemy.') },
    ]);
    expect(readHighlights(text, noteBlocks).map((block) => block.id)).toEqual([highlights[0]?.id]);
  });

  it('refuses to append to a note holding a marker this build cannot read (a newer version)', () => {
    const newer = '> Words.\n> <!-- atlas:highlight {"v":2,"kind":"pdf","page":1} -->\n\n^abc123\n';
    expect(() =>
      appended(`${PDF_NOTE}${newer}`, [{ quote: 'Know.', anchor: pdf('Know.') }]),
    ).toThrow(UnreadableHighlightMarkerError);
  });

  it('refuses to append to a note holding a marker whose JSON is broken', () => {
    const broken = '> Words.\n> <!-- atlas:highlight {"v":1,"kind": -->\n\n^abc123\n';
    expect(() =>
      appended(`${PDF_NOTE}${broken}`, [{ quote: 'Know.', anchor: pdf('Know.') }]),
    ).toThrow(UnreadableHighlightMarkerError);
  });

  it('still edits and removes a readable highlight in a note that also holds an unreadable marker', () => {
    const { text: readable, highlights } = appended(PDF_NOTE, [
      { quote: 'Know the enemy.', anchor: pdf('Know the enemy.') },
    ]);
    const newer =
      '\n> Words.\n> <!-- atlas:highlight {"v":2,"kind":"pdf","page":1} -->\n\n^abc123\n';
    const id = highlights[0]?.id as string;
    const edited = withHighlightComment({
      text: readable + newer,
      id,
      comment: 'Mine.',
      noteBlocks,
    });
    expect(edited.endsWith(newer)).toBe(true);
    expect(withoutHighlight({ text: edited, id, noteBlocks }).endsWith(newer)).toBe(true);
  });

  it('answers the existing id for a Kindle passage by the words the export gave, not the quote now', () => {
    const first = appended(KINDLE_NOTE, [{ quote: 'Original words here', anchor: kindle(9) }]);
    expect(first.text).toContain('"exact":"Original words here"');
    const rewritten = first.text.replace('Original words here\n', 'Rewritten by hand\n');
    const again = appended(rewritten, [{ quote: 'Original words here', anchor: kindle(9) }], 2);
    expect(again.highlights[0]?.added).toBe(false);
  });

  it('keeps two Kindle highlights that start at one location but say different things', () => {
    const { highlights } = appended(KINDLE_NOTE, [
      { quote: 'First passage', anchor: kindle(9) },
      { quote: 'Second passage', anchor: kindle(9) },
    ]);
    expect(highlights.map((entry) => entry.added)).toEqual([true, true]);
  });

  it('does not match two Kindle highlights that both have, and differ in, annotation ids', () => {
    const first = appended(KINDLE_NOTE, [{ quote: 'Same words', anchor: kindle(9, 'A1') }]);
    const again = appended(first.text, [{ quote: 'Same words', anchor: kindle(9, 'B2') }], 2);
    expect(again.highlights[0]?.added).toBe(true);
  });

  it('matches an id-less export against the copy that has an annotation id', () => {
    const first = appended(KINDLE_NOTE, [{ quote: 'Same words', anchor: kindle(9, 'A1') }]);
    const again = appended(first.text, [{ quote: 'Same words', anchor: kindle(9) }], 2);
    expect(again.highlights[0]?.added).toBe(false);
  });

  it('keeps a Kindle highlight by its page when the export has no location', () => {
    const anchor: HighlightAnchor = {
      kind: 'kindle',
      location: null,
      page: 12,
      annotationId: null,
    };
    expect(anchorProblem(anchor)).toBeNull();
    const { text } = appended(KINDLE_NOTE, [{ quote: 'Paged words', anchor }]);
    expect(readHighlights(text, noteBlocks)[0]?.anchor).toMatchObject({
      kind: 'kindle',
      location: null,
      page: 12,
    });
  });

  it('refuses a Kindle anchor with neither a location nor a page', () => {
    expect(
      anchorProblem({ kind: 'kindle', location: null, annotationId: null } as HighlightAnchor),
    ).not.toBeNull();
  });

  it('writes U+2028 and U+2029 as escapes, so the marker stays one visible line', () => {
    const marker = highlightMarker({
      style: { mark: 'highlight', color: 'yellow' },
      anchor: pdf('a\u2028b\u2029c'),
    });
    expect(marker).not.toMatch(/[\u2028\u2029]/);
    expect(marker).toContain('\\u2028');
  });

  it('reads a hand-written marker that holds a raw U+2028 inside its JSON', () => {
    const line =
      '<!-- atlas:highlight {"v":1,"kind":"pdf","page":1,"exact":"a\u2028b","rects":[[0.1,0.1,0.2,0.2]]} -->';
    expect(readHighlightMarker(line)?.anchor).toMatchObject({ quote: { exact: 'a\u2028b' } });
  });

  it('accepts a box that ends on the page edge, within rounding', () => {
    const edge: HighlightAnchor = {
      kind: 'pdf',
      page: 1,
      quote: null,
      rects: [{ x: 0.7, y: 0.9, width: 0.3 + 1e-9, height: 0.1 }],
    };
    expect(anchorProblem(edge)).toBeNull();
  });

  it('escapes a lone list number whatever follows it, and leaves a number in a sentence alone', () => {
    expect(quoteLines('3.')).toEqual(['3\\.']);
    expect(quoteLines('12) of them')).toEqual(['12\\) of them']);
    expect(quoteLines('1.5 percent')).toEqual(['1.5 percent']);
  });

  it('keeps a comment edited on a lazy-continued highlight with its `>` and the lines either side', () => {
    const text = `${PDF_NOTE}> All warfare is based on deception.\n> ${highlightMarker({ style: { mark: 'highlight', color: 'yellow' }, anchor: pdf('All warfare is based on deception.') })}\n>\n> First thought,\nsecond thought.\n\n^k3x9q2\n`;
    const edited = withHighlightComment({
      text,
      id: 'k3x9q2',
      comment: 'Rewritten.\nTwo lines.',
      noteBlocks,
    });
    expect(edited).toContain('>\n> Rewritten.\n> Two lines.\n\n^k3x9q2\n');
    expect(edited).not.toContain('second thought');
  });

  it('takes a lazy-continued highlight out whole', () => {
    const block = `> Words.\n> ${highlightMarker({ style: { mark: 'highlight', color: 'yellow' }, anchor: pdf('Words.') })}\n>\n> A thought\nthat wandered.\n\n^k3x9q2\n`;
    expect(withoutHighlight({ text: PDF_NOTE + block, id: 'k3x9q2', noteBlocks })).toBe(PDF_NOTE);
  });

  it('ends a quote at a line that would start something else, rather than swallowing it', () => {
    const text = `${PDF_NOTE}> Words.\n> ${highlightMarker({ style: { mark: 'highlight', color: 'yellow' }, anchor: pdf('Words.') })}\n>\n> A thought\n# A heading\n\n^k3x9q2\n`;
    expect(readHighlights(text, noteBlocks)).toEqual([]);
  });

  it('answers no match for a non-finite or fractional page without hanging', () => {
    const sections = ['first', 'second', 'third'];
    const selector = { exact: 'third', prefix: '', suffix: '' };
    for (const near of [Infinity, -Infinity, 1.5, -3, 99]) {
      expect(findQuoteNear({ sections, selector, near })?.section).toBe(2);
    }
  });

  it('finds the nearer of two sections from a fractional page, the earlier first', () => {
    const sections = ['x', 'word', 'y', 'word'];
    const selector = { exact: 'word', prefix: '', suffix: '' };
    expect(findQuoteNear({ sections, selector, near: 2.5 })?.section).toBe(1);
  });
});

/** `text` with every run of whitespace one space, as re-anchoring compares it. */
const fold = (text: string): string => text.replace(/\s+/g, ' ');

/** How many times `part` is in `text`, overlapping copies counted. */
function occurrences(text: string, part: string): number {
  let count = 0;
  for (let at = text.indexOf(part); at !== -1; at = text.indexOf(part, at + 1)) count += 1;
  return count;
}

// Verification round 3 on PR #510: appending checks that what it wrote reads back
// (ADR-0043 §5), but a comment edit does not, so a comment holding one `%%` opens an
// Obsidian comment that hides every highlight after it, with no error.
describe('a comment edit and the highlights after it (verify3, PR #510)', () => {
  const marker = (page: number, exact: string) =>
    highlightMarker({
      style: { mark: 'highlight', color: 'yellow' },
      anchor: {
        kind: 'pdf',
        page,
        quote: { exact, prefix: '', suffix: '' },
        rects: [{ x: 0.1, y: 0.1, width: 0.5, height: 0.02 }],
      },
    });
  const TWO = `${PDF_NOTE}> One.\n> ${marker(1, 'One.')}\n\n^aaa111\n\n> Two.\n> ${marker(2, 'Two.')}\n\n^bbb222\n`;

  /** The ids the note reads after the edit; a refused edit leaves the note as it was. */
  function idsAfterEditing(comment: string): string[] {
    let text = TWO;
    try {
      text = withHighlightComment({ text: TWO, id: 'aaa111', comment, noteBlocks });
    } catch {
      // Refusing the edit is a safe answer: the note is left as it was.
    }
    return readHighlights(text, noteBlocks).map((block) => block.id);
  }

  it('never makes another highlight unreadable', () => {
    expect(idsAfterEditing('Up 50%% on the year.')).toEqual(['aaa111', 'bbb222']);
  });
});

// Verification round 3 decisions on PR #510 (ADR-0043 §5): a comment DFAI writes never opens an
// Obsidian comment, and no write leaves a highlight the note read before unreadable after.
describe('every write keeps the other highlights readable (verify3, PR #510)', () => {
  const marker = (page: number, exact: string) =>
    highlightMarker({
      style: { mark: 'highlight', color: 'yellow' },
      anchor: {
        kind: 'pdf',
        page,
        quote: { exact, prefix: '', suffix: '' },
        rects: [{ x: 0.1, y: 0.1, width: 0.5, height: 0.02 }],
      },
    });
  const one = (quote: string) => `> ${quote}\n> ${marker(1, 'One.')}\n`;
  const two = `> Two.\n> ${marker(2, 'Two.')}\n\n^bbb222\n`;
  const ids = (text: string) => readHighlights(text, noteBlocks).map((block) => block.id);

  it('writes a `%%` in a comment so Obsidian shows it, and reads it back as written', () => {
    const before = `${PDF_NOTE}${one('One.')}\n^aaa111\n\n${two}`;
    const text = withHighlightComment({
      text: before,
      id: 'aaa111',
      comment: 'Up 50%% on the year, %%% more.',
      noteBlocks,
    });
    expect(text).toContain('> Up 50%\\% on the year, %\\%\\% more.\n');
    expect(text).not.toMatch(/%%/);
    expect(ids(text)).toEqual(['aaa111', 'bbb222']);
    const [read] = readHighlights(text, noteBlocks);
    expect(
      withHighlightComment({ text, id: 'aaa111', comment: read?.comment ?? '', noteBlocks }),
    ).toBe(text);
  });

  it('writes a `%%` in the comment of a highlight it appends so Obsidian shows it', () => {
    const { text } = appendHighlights({
      text: PDF_NOTE,
      highlights: [
        { quote: 'One.', anchor: pdf('One.'), comment: 'Up 50%% on the year.' },
        { quote: 'Two.', anchor: pdf('Two.') },
      ],
      random: seeded(3),
      noteBlocks,
    });
    expect(text).toContain('> Up 50%\\% on the year.\n');
    expect(readHighlights(text, noteBlocks)).toHaveLength(2);
  });

  it('refuses a comment edit that would let a `%%` edited into a quote hide the highlights after it', () => {
    // The person put a `%%` in the quote and closed it in the comment, in Obsidian.
    const before = `${PDF_NOTE}${one('One %% opened.')}>\n> Closed %% here.\n\n^aaa111\n\n${two}`;
    expect(ids(before)).toEqual(['aaa111', 'bbb222']);
    let refused: unknown = null;
    try {
      withHighlightComment({ text: before, id: 'aaa111', comment: 'Fine.', noteBlocks });
    } catch (error) {
      refused = error;
    }
    expect(refused).toBeInstanceOf(HighlightNotReadBackError);
    expect((refused as HighlightNotReadBackError).ids).toEqual(['bbb222']);
  });

  it('refuses a removal that would let a `%%` written between blocks hide the highlights after it', () => {
    const before = `${PDF_NOTE}${one('One %% opened.')}\n^aaa111\n\nClosed %% here.\n\n${two}`;
    expect(ids(before)).toEqual(['aaa111', 'bbb222']);
    let refused: unknown = null;
    try {
      withoutHighlight({ text: before, id: 'aaa111', noteBlocks });
    } catch (error) {
      refused = error;
    }
    expect(refused).toBeInstanceOf(HighlightNotReadBackError);
    expect((refused as HighlightNotReadBackError).ids).toEqual(['bbb222']);
  });

  it('keeps a byte order mark that starts a note with no frontmatter', () => {
    const bom = '﻿';
    const { text, highlights } = appendHighlights({
      text: bom,
      highlights: [{ quote: 'One.', anchor: pdf('One.') }],
      random: seeded(3),
      noteBlocks,
    });
    expect(text.startsWith(bom)).toBe(true);
    expect(readHighlights(text, noteBlocks)).toHaveLength(1);
    expect(withoutHighlight({ text, id: highlights[0]?.id ?? '', noteBlocks })).toBe(bom);
    const written = `${bom}${one('One.')}\n^aaa111\n`;
    expect(ids(written)).toEqual(['aaa111']);
    expect(withoutHighlight({ text: written, id: 'aaa111', noteBlocks })).toBe(bom);
  });
});
