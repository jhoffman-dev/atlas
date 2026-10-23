import { describe, expect, it } from 'vitest';
import { lineNoteBlocks as noteBlocks } from '../testing/line-note-blocks.ts';
import { InvalidHighlightAnchorError, type HighlightAnchor } from './anchor.ts';
import {
  appendHighlights,
  HighlightCommentChangedError,
  HighlightNotFoundError,
  highlightNamed,
  withHighlightComment,
  withHighlightCommentAfter,
  withoutHighlight,
  type NewHighlight,
} from './edit-highlights.ts';
import { highlightBlockText, readHighlights } from './highlight-block.ts';
import { highlightMarker } from './highlight-marker.ts';
import { quoteLines } from './highlight-text.ts';
import { literatureNoteText } from './literature-note.ts';
import { createVaultPath } from '../vault/vault-path.ts';

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

/** A random source that gives these numbers, then the last forever. */
function scripted(...numbers: number[]): () => number {
  let at = 0;
  return () => numbers[Math.min(at++, numbers.length - 1)] as number;
}

/** The numbers that draw `id` from `[a-z0-9]`, one per character. */
const drawing = (id: string): number[] =>
  [...id].map((char) => ('abcdefghijklmnopqrstuvwxyz0123456789'.indexOf(char) + 0.5) / 36);

const pdf = (page: number, exact: string): HighlightAnchor => ({
  kind: 'pdf',
  page,
  quote: { exact, prefix: '', suffix: '' },
  rects: [{ x: 0.1, y: 0.1, width: 0.5, height: 0.02 }],
});

const SOURCE = literatureNoteText({
  kind: 'pdf',
  title: 'The Art of War',
  author: 'Sun Tzu',
  file: createVaultPath('Library/The Art of War.pdf'),
});

const deception: NewHighlight = {
  quote: 'All warfare is based on deception.',
  anchor: pdf(3, 'All warfare is based on deception.'),
};

describe('appending highlights', () => {
  it('writes the first highlight straight after the frontmatter of an empty literature note', () => {
    const { text, highlights } = appendHighlights({
      text: SOURCE,
      highlights: [{ ...deception, comment: 'Key line.' }],
      random: scripted(...drawing('k3x9q2')),
      noteBlocks,
    });
    expect(highlights).toEqual([{ id: 'k3x9q2', added: true }]);
    expect(text).toBe(
      `${SOURCE}> All warfare is based on deception.\n> ${highlightMarker({
        style: { mark: 'highlight', color: 'yellow' },
        anchor: deception.anchor,
      })}\n>\n> Key line.\n\n^k3x9q2\n`,
    );
  });

  it('keeps every byte before it, adding a blank line of its own after what is there', () => {
    const before = `${SOURCE}# Notes\n\nMy words, no final line ending`;
    const { text } = appendHighlights({
      text: before,
      highlights: [deception],
      random: seeded(1),
      noteBlocks,
    });
    expect(text.startsWith(`${before}\n\n> All warfare`)).toBe(true);
    const ended = `${SOURCE}My words.\n`;
    expect(
      appendHighlights({ text: ended, highlights: [deception], random: seeded(1), noteBlocks })
        .text,
    ).toMatch(/^[^]*My words\.\n\n> All warfare/);
    // A blank line the note already ends in is the person's, not reused (A11, verify #510).
    const spaced = `${SOURCE}My words.\n\n`;
    expect(
      appendHighlights({ text: spaced, highlights: [deception], random: seeded(1), noteBlocks })
        .text,
    ).toMatch(/My words\.\n\n\n> All warfare/);
  });

  it('writes to a note with no frontmatter, and to an empty one', () => {
    expect(
      appendHighlights({ text: '', highlights: [deception], random: seeded(1), noteBlocks }).text,
    ).toMatch(/^> All warfare/);
    expect(
      appendHighlights({ text: 'Words.', highlights: [deception], random: seeded(1), noteBlocks })
        .text,
    ).toMatch(/^Words\.\n\n> All warfare/);
  });

  it('appends many in order, each with its own id, and reads every one back', () => {
    const { text, highlights } = appendHighlights({
      text: SOURCE,
      highlights: [
        deception,
        { quote: 'Know the enemy.', anchor: pdf(4, 'Know the enemy.'), comment: 'And yourself.' },
        {
          quote: 'Opportunities multiply as they are seized.',
          anchor: {
            kind: 'epub',
            cfi: 'epubcfi(/6/2)',
            quote: { exact: 'x', prefix: '', suffix: '' },
          },
          style: { mark: 'underline', color: 'pink' },
        },
      ],
      random: seeded(20261021),
      noteBlocks,
    });
    const ids = highlights.map((highlight) => highlight.id);
    expect(new Set(ids).size).toBe(3);
    for (const id of ids) expect(id).toMatch(/^[a-z0-9]{6}$/);
    expect(
      readHighlights(text, noteBlocks).map(({ id, quote, comment, style }) => ({
        id,
        quote,
        comment,
        style,
      })),
    ).toEqual([
      {
        id: ids[0],
        quote: 'All warfare is based on deception.',
        comment: '',
        style: { mark: 'highlight', color: 'yellow' },
      },
      {
        id: ids[1],
        quote: 'Know the enemy.',
        comment: 'And yourself.',
        style: { mark: 'highlight', color: 'yellow' },
      },
      {
        id: ids[2],
        quote: 'Opportunities multiply as they are seized.',
        comment: '',
        style: { mark: 'underline', color: 'pink' },
      },
    ]);
  });

  it('draws the same ids from the same seed', () => {
    const draw = () =>
      appendHighlights({ text: SOURCE, highlights: [deception], random: seeded(7), noteBlocks })
        .highlights;
    expect(draw()).toEqual(draw());
  });

  it('never gives an id any block of the note already has', () => {
    const taken = `${SOURCE}A paragraph. ^aaaaaa\n\n| t |\n| - |\n\n^bbbbbb\n`;
    const { highlights } = appendHighlights({
      text: taken,
      highlights: [deception],
      random: scripted(...drawing('aaaaaa'), ...drawing('bbbbbb'), ...drawing('cccccc')),
      noteBlocks,
    });
    expect(highlights).toEqual([{ id: 'cccccc', added: true }]);
  });

  it('never gives two highlights of one batch the same id', () => {
    const { highlights } = appendHighlights({
      text: SOURCE,
      highlights: [deception, { quote: 'Other.', anchor: pdf(5, 'Other.') }],
      random: scripted(...drawing('dddddd'), ...drawing('dddddd'), ...drawing('eeeeee')),
      noteBlocks,
    });
    expect(highlights.map((highlight) => highlight.id)).toEqual(['dddddd', 'eeeeee']);
  });

  it('adds a passage the note already holds only once, answering its id', () => {
    const once = appendHighlights({
      text: SOURCE,
      highlights: [deception],
      random: seeded(3),
      noteBlocks,
    });
    const twice = appendHighlights({
      text: once.text,
      highlights: [{ ...deception, comment: 'again' }, deception],
      random: seeded(4),
      noteBlocks,
    });
    expect(twice.text).toBe(once.text);
    expect(twice.highlights).toEqual([
      { id: once.highlights[0]?.id, added: false },
      { id: once.highlights[0]?.id, added: false },
    ]);
  });

  it('adds a Kindle highlight again by its words when it has no id, and not when the words are the same', () => {
    const kindle = (quote: string): NewHighlight => ({
      quote,
      anchor: { kind: 'kindle', location: { start: 9, end: null }, annotationId: null },
    });
    const once = appendHighlights({
      text: SOURCE,
      highlights: [kindle('A *b*')],
      random: seeded(5),
      noteBlocks,
    });
    const again = appendHighlights({
      text: once.text,
      highlights: [kindle('A *b*'), kindle('Other words')],
      random: seeded(6),
      noteBlocks,
    });
    expect(again.highlights.map((highlight) => highlight.added)).toEqual([false, true]);
  });

  it('answers a Kindle passage synced without an id from an export with one, at its location start', () => {
    const words = 'Emma Woodhouse, handsome, clever, and rich';
    const kindle = (
      location: { start: number; end: number | null },
      annotationId: string | null,
      quote = words,
    ): NewHighlight => ({ quote, anchor: { kind: 'kindle', location, annotationId } });
    const append = (text: string, highlight: NewHighlight) =>
      appendHighlights({ text, highlights: [highlight], random: seeded(text.length), noteBlocks });
    const ranged = append(SOURCE, kindle({ start: 77, end: 79 }, null)).text;
    expect(append(ranged, kindle({ start: 77, end: null }, 'A1')).highlights[0]?.added).toBe(false);
    const started = append(SOURCE, kindle({ start: 77, end: null }, 'A1')).text;
    expect(append(started, kindle({ start: 77, end: 79 }, null)).highlights[0]?.added).toBe(false);
    expect(append(ranged, kindle({ start: 78, end: 79 }, 'A1')).highlights[0]?.added).toBe(true);
    expect(
      append(ranged, kindle({ start: 77, end: null }, 'A1', 'Other words')).highlights[0]?.added,
    ).toBe(true);
  });

  it('keeps the quote as the words of a Kindle export that gave blank ones', () => {
    const { text } = appendHighlights({
      text: SOURCE,
      highlights: [
        {
          quote: 'Call me Ishmael.',
          anchor: {
            kind: 'kindle',
            location: { start: 5, end: null },
            annotationId: null,
            exact: ' ',
          },
        },
      ],
      random: seeded(1),
      noteBlocks,
    });
    expect(readHighlights(text, noteBlocks)[0]?.anchor).toMatchObject({
      exact: 'Call me Ishmael.',
    });
  });

  it("writes in the note's own line ending", () => {
    const windows = SOURCE.replace(/\n/g, '\r\n') + 'Words.\r\n';
    const { text } = appendHighlights({
      text: windows,
      highlights: [{ ...deception, comment: 'a\nb' }],
      random: seeded(1),
      noteBlocks,
    });
    expect(text.replace(/\r\n/g, '')).not.toContain('\n');
    expect(readHighlights(text, noteBlocks)[0]?.comment).toBe('a\nb');
  });

  it('refuses a bad anchor or a quote with no words, and writes nothing', () => {
    expect(() =>
      appendHighlights({
        text: SOURCE,
        highlights: [deception, { quote: 'x', anchor: pdf(0, 'x') }],
        random: seeded(1),
        noteBlocks,
      }),
    ).toThrow(InvalidHighlightAnchorError);
    expect(() =>
      appendHighlights({
        text: SOURCE,
        highlights: [{ ...deception, quote: ' \n ' }],
        random: seeded(1),
        noteBlocks,
      }),
    ).toThrow(/quotes some words/);
  });
});

/** A note of three highlights, one hand-edited in Obsidian, and words between. */
function threeHighlights() {
  const { text, highlights } = appendHighlights({
    text: `${SOURCE}Intro words.\n`,
    highlights: [
      deception,
      { quote: 'Know the enemy.', anchor: pdf(4, 'Know the enemy.'), comment: 'First thought.' },
      { quote: 'Water shapes its course.', anchor: pdf(9, 'Water shapes its course.') },
    ],
    random: scripted(...drawing('aaaaa1'), ...drawing('bbbbb2'), ...drawing('ccccc3')),
    noteBlocks,
  });
  expect(highlights.map((highlight) => highlight.id)).toEqual(['aaaaa1', 'bbbbb2', 'ccccc3']);
  // In Obsidian: the first quote is tidied, a comment is added by hand, a paragraph between.
  const edited = text
    .replace('> All warfare is based on deception.', '>  All warfare is based on *deception*.')
    .replace('^aaaaa1\n', '^aaaaa1\n\nWritten in Obsidian.\n');
  return edited;
}

describe("editing a highlight's comment from a base (#534)", () => {
  const write = (text: string, base: string | undefined) =>
    withHighlightComment({
      text,
      id: 'aaaaa1',
      comment: 'Mine.',
      ...(base !== undefined && { base }),
      noteBlocks,
    });

  it('writes when the note still holds the comment the writer started from', () => {
    const text = threeHighlights();
    const current = highlightNamed(text, 'aaaaa1', noteBlocks).comment;
    expect(highlightNamed(write(text, current), 'aaaaa1', noteBlocks).comment).toBe('Mine.');
  });

  it("refuses, naming the comment now there, when it changed since (a sync's follow-up, Obsidian)", () => {
    const text = threeHighlights();
    expect(() => write(text, 'An older comment.')).toThrow(HighlightCommentChangedError);
    try {
      write(text, 'An older comment.');
    } catch (error) {
      expect((error as HighlightCommentChangedError).current).toBe(
        highlightNamed(text, 'aaaaa1', noteBlocks).comment,
      );
    }
  });

  it('holds a comment typed with `%%` to the one written from it', () => {
    const typed = 'Half of it, 50%% sure.';
    const written = withHighlightComment({
      text: threeHighlights(),
      id: 'aaaaa1',
      comment: typed,
      noteBlocks,
    });
    expect(
      withHighlightComment({
        text: written,
        id: 'aaaaa1',
        comment: 'Next.',
        base: typed,
        noteBlocks,
      }),
    ).toContain('Next.');
  });

  it('writes unconditionally without a base, as the readers do', () => {
    expect(write(threeHighlights(), undefined)).toContain('Mine.');
  });
});

describe("editing a highlight's comment", () => {
  it('gives a highlight with no comment one, changing nothing else', () => {
    const text = threeHighlights();
    const changed = withHighlightComment({
      text,
      id: 'ccccc3',
      comment: 'Like *water*.',
      noteBlocks,
    });
    expect(highlightNamed(changed, 'ccccc3', noteBlocks).comment).toBe('Like *water*.');
    const block = highlightNamed(text, 'ccccc3', noteBlocks);
    expect(changed.slice(0, block.markerEnd)).toBe(text.slice(0, block.markerEnd));
    expect(changed.slice(changed.length - (text.length - block.quoteEnd))).toBe(
      text.slice(block.quoteEnd),
    );
  });

  it("replaces a comment, keeping the quote the person tidied and every other block's bytes", () => {
    const text = threeHighlights();
    const changed = withHighlightComment({
      text,
      id: 'bbbbb2',
      comment: 'Second\n\nthought.',
      noteBlocks,
    });
    expect(highlightNamed(changed, 'bbbbb2', noteBlocks).comment).toBe('Second\n\nthought.');
    expect(changed).toContain('>  All warfare is based on *deception*.');
    expect(changed).toContain('Written in Obsidian.');
    expect(changed.replace('>\n> Second\n>\n> thought.\n', '>\n> First thought.\n')).toBe(text);
  });

  it('takes the comment off for a blank one', () => {
    const text = threeHighlights();
    const changed = withHighlightComment({ text, id: 'bbbbb2', comment: '  \n', noteBlocks });
    expect(highlightNamed(changed, 'bbbbb2', noteBlocks).comment).toBe('');
    expect(changed).toBe(text.replace('>\n> First thought.\n', ''));
  });

  it('writes back the same bytes for the comment DFAI wrote', () => {
    const text = threeHighlights();
    expect(
      withHighlightComment({ text, id: 'bbbbb2', comment: 'First thought.', noteBlocks }),
    ).toBe(text);
  });

  it.each([
    ['an empty note', ''],
    ['no body', SOURCE],
    ['a blank body', `${SOURCE}\n`],
    ['a body of spaces and no line ending', `${SOURCE}   `],
    ['words and no line ending', `${SOURCE}Words.`],
    ['words', `${SOURCE}Words.\n`],
    ['a blank line', `${SOURCE}Words.\n\n`],
    ['spaces and no line ending after a line', `${SOURCE}Words.\n  `],
    ['words, on Windows', `${SOURCE}Words.\n`.replace(/\n/g, '\r\n')],
  ])(
    'gives back a note that held %s, byte for byte, once all it was given is taken out',
    (_label, note) => {
      const { text, highlights } = appendHighlights({
        text: note,
        highlights: [deception, { quote: 'Know the enemy.', anchor: pdf(4, 'Know the enemy.') }],
        random: seeded(3),
        noteBlocks,
      });
      const removed = highlights.reduceRight(
        (current, { id }) => withoutHighlight({ text: current, id, noteBlocks }),
        text,
      );
      expect(removed).toBe(note);
    },
  );

  it('refuses a highlight the note does not hold', () => {
    expect(() =>
      withHighlightComment({ text: threeHighlights(), id: 'zzzzzz', comment: 'x', noteBlocks }),
    ).toThrow(HighlightNotFoundError);
  });
});

describe("adding to a highlight's comment", () => {
  it('writes a paragraph after the comment, the comment before it byte for byte as it was', () => {
    const text = threeHighlights().replace(
      '> First thought.\n',
      '>First  thought,\n>   odd *indent*\n',
    );
    const changed = withHighlightCommentAfter({
      text,
      id: 'bbbbb2',
      note: 'Then this.',
      noteBlocks,
    });
    expect(changed).toBe(text.replace('>   odd *indent*\n', '>   odd *indent*\n>\n> Then this.\n'));
    expect(highlightNamed(changed, 'bbbbb2', noteBlocks).comment).toBe(
      'First  thought,\n  odd *indent*\n\nThen this.',
    );
  });

  it('gives a highlight with no comment one, as a new comment would', () => {
    const text = threeHighlights();
    expect(withHighlightCommentAfter({ text, id: 'ccccc3', note: 'Like water.', noteBlocks })).toBe(
      withHighlightComment({ text, id: 'ccccc3', comment: 'Like water.', noteBlocks }),
    );
  });

  it('writes the note in the note’s own line ending, escaping what would hide the rest', () => {
    const text = threeHighlights().replace(/\n/g, '\r\n');
    const changed = withHighlightCommentAfter({
      text,
      id: 'bbbbb2',
      note: 'Half of 50%%',
      noteBlocks,
    });
    expect(changed).toContain('>\r\n> Half of 50%\\%\r\n');
    expect(readHighlights(changed, noteBlocks)).toHaveLength(3);
  });

  it('adds nothing for a blank note, and refuses a highlight the note lacks', () => {
    const text = threeHighlights();
    expect(withHighlightCommentAfter({ text, id: 'bbbbb2', note: ' \n', noteBlocks })).toBe(text);
    expect(() => withHighlightCommentAfter({ text, id: 'zzzzzz', note: 'x', noteBlocks })).toThrow(
      HighlightNotFoundError,
    );
  });
});

describe('removing a highlight', () => {
  it('takes out a highlight between others with the blank line after it', () => {
    const text = threeHighlights();
    const block = highlightNamed(text, 'bbbbb2', noteBlocks);
    const removed = withoutHighlight({ text, id: 'bbbbb2', noteBlocks });
    expect(removed).toBe(text.slice(0, block.start) + text.slice(block.end + 1));
    expect(readHighlights(removed, noteBlocks).map((highlight) => highlight.id)).toEqual([
      'aaaaa1',
      'ccccc3',
    ]);
  });

  it('takes out the last highlight with the blank line before it, the note still ending its line', () => {
    const text = threeHighlights();
    const removed = withoutHighlight({ text, id: 'ccccc3', noteBlocks });
    expect(removed.endsWith('^bbbbb2\n')).toBe(true);
    expect(readHighlights(removed, noteBlocks).map((highlight) => highlight.id)).toEqual([
      'aaaaa1',
      'bbbbb2',
    ]);
  });

  it('takes out a highlight followed by words', () => {
    const text = threeHighlights();
    const removed = withoutHighlight({ text, id: 'aaaaa1', noteBlocks });
    expect(removed).toContain('Intro words.\n\nWritten in Obsidian.\n\n> Know the enemy.');
  });

  it('takes out the only highlight, leaving the note as it was before it', () => {
    const { text } = appendHighlights({
      text: SOURCE,
      highlights: [deception],
      random: seeded(2),
      noteBlocks,
    });
    const [only] = readHighlights(text, noteBlocks);
    expect(withoutHighlight({ text, id: only?.id as string, noteBlocks })).toBe(SOURCE);
    const windows = `Words.\r\n\r\n> Q.\r\n> ${highlightMarker({ style: { mark: 'highlight', color: 'yellow' }, anchor: deception.anchor })}\r\n\r\n^abc123\r\n`;
    expect(withoutHighlight({ text: windows, id: 'abc123', noteBlocks })).toBe('Words.\r\n');
  });

  it('takes out a highlight ending the note with no final line ending', () => {
    const text = `Words.\n\n> Q.\n> ${highlightMarker({ style: { mark: 'highlight', color: 'yellow' }, anchor: deception.anchor })}\n\n^abc123`;
    // A block with no final line ending is one DFAI wrote to a note without one (A11): gone, so is it.
    expect(withoutHighlight({ text, id: 'abc123', noteBlocks })).toBe('Words.');
  });

  it('leaves a Kindle highlight’s tombstone where its block was, the blank lines as they were', () => {
    const kindle = {
      quote: 'Words from a book.',
      anchor: { kind: 'kindle', location: { start: 40, end: null }, annotationId: 'A1' },
    } as const;
    const { text } = appendHighlights({
      text: `${SOURCE}`,
      highlights: [kindle, deception],
      random: seeded(4),
      noteBlocks,
    });
    const [first] = readHighlights(text, noteBlocks);
    const removed = withoutHighlight({ text, id: first?.id as string, noteBlocks });
    expect(removed).toBe(
      text
        .slice(0, first?.start)
        .concat(
          removed.slice(first?.start, removed.indexOf('\n', first?.start) + 1),
          text.slice(first?.end),
        ),
    );
    expect(removed).toMatch(
      /<!-- atlas:highlight-removed \{[^\n]*"annotationId":"A1"[^\n]*\} -->\n\n/,
    );
    expect(removed).not.toContain('Words from a book.');
    expect(readHighlights(removed, noteBlocks)).toHaveLength(1);
  });

  it('refuses a highlight the note does not hold', () => {
    expect(() => withoutHighlight({ text: threeHighlights(), id: 'zzzzzz', noteBlocks })).toThrow(
      /\^zzzzzz/,
    );
  });
});

// Verification round 3 on PR #510: `sameKindlePlace` is a comparison, not a key, and is not
// transitive — a copy with only a page is the same place as two copies at different
// locations on that page, which are not the same place as each other.
describe('Kindle passages matched by place (verify3, PR #510)', () => {
  const words = 'Emma Woodhouse, handsome, clever, and rich';
  const kindleAt = (location: number | null, annotationId: string | null): NewHighlight => ({
    quote: words,
    anchor: {
      kind: 'kindle',
      location: location === null ? null : { start: location, end: null },
      page: 12,
      annotationId,
    },
  });
  const sync = (text: string, highlights: readonly NewHighlight[]) =>
    appendHighlights({ text, highlights, random: seeded(7), noteBlocks });

  it('answers one held passage for at most one export highlight with an id', () => {
    const held = sync(SOURCE, [kindleAt(null, null)]).text;
    const { highlights } = sync(held, [kindleAt(100, 'A1'), kindleAt(140, 'C1')]);
    expect(new Set(highlights.map((highlight) => highlight.id)).size).toBe(2);
  });

  it('keeps two passages at different locations apart when a page-only copy came first', () => {
    const { text } = sync(SOURCE, [kindleAt(null, null), kindleAt(100, null), kindleAt(140, null)]);
    expect(readHighlights(text, noteBlocks)).toHaveLength(2);
  });
  // Verification round 3 decisions (ADR-0043 §7): a location match is taken before a page match.
  it('gives a held passage to the highlight at its location before one matching only its page', () => {
    const held = sync(SOURCE, [kindleAt(100, null)]);
    const [heldId] = held.highlights.map((highlight) => highlight.id);
    const { highlights } = sync(held.text, [kindleAt(null, 'A1'), kindleAt(100, 'C1')]);
    expect(highlights[1]).toEqual({ id: heldId, added: false });
    expect(highlights[0]?.added).toBe(true);
  });

  it('answers the held passage at its location before one with only its page', () => {
    const block = (id: string, anchor: NewHighlight['anchor']) =>
      highlightBlockText(
        {
          id,
          quoteLines: quoteLines(words),
          commentLines: [],
          style: { mark: 'highlight', color: 'yellow' },
          anchor,
        },
        '\n',
      );
    const note = `${SOURCE}${block('pppppp', kindleAt(null, null).anchor)}\n${block('aaaaaa', kindleAt(100, 'A1').anchor)}`;
    expect(readHighlights(note, noteBlocks)).toHaveLength(2);
    expect(sync(note, [kindleAt(100, null)]).highlights).toEqual([{ id: 'aaaaaa', added: false }]);
  });

  // Shrunk from the property at HIGHLIGHT_PROPERTY_SEED=101 and 303, 3000 runs (PR #510).
  describe('a sync run again adds nothing, when a page-only copy joined a located passage', () => {
    const at = (
      location: { start: number; end: number | null } | null,
      page: number,
      annotationId: string | null = null,
    ): NewHighlight => ({
      quote: 'Emma Woodhouse, handsome',
      anchor: { kind: 'kindle', location, page, annotationId },
    });
    const KINDLE = literatureNoteText({
      kind: 'kindle',
      title: 'Emma',
      author: 'Jane Austen',
      asin: 'B000FC1ICM',
      file: null,
    });
    const syncedTwice = (held: NewHighlight, exported: readonly NewHighlight[]) => {
      const once = sync(sync(KINDLE, [held]).text, exported).text;
      return { once, twice: sync(once, exported) };
    };

    it('seed 101: a page-only copy beside two located copies on two pages', () => {
      const { once, twice } = syncedTwice(at(null, 13, 'C1'), [
        at({ start: 100, end: 104 }, 13),
        at({ start: 100, end: null }, 12),
        at(null, 12),
      ]);
      expect(twice.highlights.every((highlight) => !highlight.added)).toBe(true);
      expect(twice.text).toBe(once);
    });

    it('seed 303: a page-only copy beside two copies at one location on two pages', () => {
      const { once, twice } = syncedTwice(at(null, 12, 'C1'), [
        at({ start: 100, end: 104 }, 12),
        at({ start: 100, end: 104 }, 13),
        at(null, 13),
      ]);
      expect(twice.highlights.every((highlight) => !highlight.added)).toBe(true);
      expect(twice.text).toBe(once);
    });

    // Shrunk from the grown-note property at HIGHLIGHT_PROPERTY_SEED=101, 3000 runs.
    it('seed 101: part of an export synced again, its key placed by the held block', () => {
      const words = 'Emma Woodhouse, handsome, clever, and rich';
      const kindle = (
        location: number | null,
        page: number | undefined,
        annotationId: string | null,
      ): NewHighlight => ({
        quote: words,
        anchor: {
          kind: 'kindle',
          location: location === null ? null : { start: location, end: null },
          ...(page !== undefined && { page }),
          annotationId,
        },
      });
      const exported = [
        kindle(140, undefined, 'A1'),
        kindle(null, 13, null),
        kindle(140, 12, null),
      ];
      let grown = sync(KINDLE, [kindle(null, 12, 'A1'), kindle(140, 13, 'C1')]).text;
      for (let size = 1; size <= exported.length; size += 1) {
        grown = sync(grown, exported.slice(0, size)).text;
      }
      const again = sync(grown, exported.slice(1));
      expect(again.highlights.every((highlight) => !highlight.added)).toBe(true);
      expect(again.text).toBe(grown);
    });
  });
});
