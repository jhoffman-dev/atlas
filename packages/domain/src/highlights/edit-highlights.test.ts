import { describe, expect, it } from 'vitest';
import { InvalidHighlightAnchorError, type HighlightAnchor } from './anchor.ts';
import {
  appendHighlights,
  HighlightNotFoundError,
  highlightNamed,
  withHighlightComment,
  withoutHighlight,
  type NewHighlight,
} from './edit-highlights.ts';
import { readHighlights } from './highlight-block.ts';
import { highlightMarker } from './highlight-marker.ts';
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
    const { text } = appendHighlights({ text: before, highlights: [deception], random: seeded(1) });
    expect(text.startsWith(`${before}\n\n> All warfare`)).toBe(true);
    const ended = `${SOURCE}My words.\n`;
    expect(
      appendHighlights({ text: ended, highlights: [deception], random: seeded(1) }).text,
    ).toMatch(/^[^]*My words\.\n\n> All warfare/);
    // A blank line the note already ends in is the person's, not reused (A11, verify #510).
    const spaced = `${SOURCE}My words.\n\n`;
    expect(
      appendHighlights({ text: spaced, highlights: [deception], random: seeded(1) }).text,
    ).toMatch(/My words\.\n\n\n> All warfare/);
  });

  it('writes to a note with no frontmatter, and to an empty one', () => {
    expect(appendHighlights({ text: '', highlights: [deception], random: seeded(1) }).text).toMatch(
      /^> All warfare/,
    );
    expect(
      appendHighlights({ text: 'Words.', highlights: [deception], random: seeded(1) }).text,
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
    });
    const ids = highlights.map((highlight) => highlight.id);
    expect(new Set(ids).size).toBe(3);
    for (const id of ids) expect(id).toMatch(/^[a-z0-9]{6}$/);
    expect(
      readHighlights(text).map(({ id, quote, comment, style }) => ({ id, quote, comment, style })),
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
      appendHighlights({ text: SOURCE, highlights: [deception], random: seeded(7) }).highlights;
    expect(draw()).toEqual(draw());
  });

  it('never gives an id any block of the note already has', () => {
    const taken = `${SOURCE}A paragraph. ^aaaaaa\n\n| t |\n| - |\n\n^bbbbbb\n`;
    const { highlights } = appendHighlights({
      text: taken,
      highlights: [deception],
      random: scripted(...drawing('aaaaaa'), ...drawing('bbbbbb'), ...drawing('cccccc')),
    });
    expect(highlights).toEqual([{ id: 'cccccc', added: true }]);
  });

  it('never gives two highlights of one batch the same id', () => {
    const { highlights } = appendHighlights({
      text: SOURCE,
      highlights: [deception, { quote: 'Other.', anchor: pdf(5, 'Other.') }],
      random: scripted(...drawing('dddddd'), ...drawing('dddddd'), ...drawing('eeeeee')),
    });
    expect(highlights.map((highlight) => highlight.id)).toEqual(['dddddd', 'eeeeee']);
  });

  it('adds a passage the note already holds only once, answering its id', () => {
    const once = appendHighlights({ text: SOURCE, highlights: [deception], random: seeded(3) });
    const twice = appendHighlights({
      text: once.text,
      highlights: [{ ...deception, comment: 'again' }, deception],
      random: seeded(4),
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
    });
    const again = appendHighlights({
      text: once.text,
      highlights: [kindle('A *b*'), kindle('Other words')],
      random: seeded(6),
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
      appendHighlights({ text, highlights: [highlight], random: seeded(text.length) });
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
    });
    expect(readHighlights(text)[0]?.anchor).toMatchObject({ exact: 'Call me Ishmael.' });
  });

  it("writes in the note's own line ending", () => {
    const windows = SOURCE.replace(/\n/g, '\r\n') + 'Words.\r\n';
    const { text } = appendHighlights({
      text: windows,
      highlights: [{ ...deception, comment: 'a\nb' }],
      random: seeded(1),
    });
    expect(text.replace(/\r\n/g, '')).not.toContain('\n');
    expect(readHighlights(text)[0]?.comment).toBe('a\nb');
  });

  it('refuses a bad anchor or a quote with no words, and writes nothing', () => {
    expect(() =>
      appendHighlights({
        text: SOURCE,
        highlights: [deception, { quote: 'x', anchor: pdf(0, 'x') }],
        random: seeded(1),
      }),
    ).toThrow(InvalidHighlightAnchorError);
    expect(() =>
      appendHighlights({
        text: SOURCE,
        highlights: [{ ...deception, quote: ' \n ' }],
        random: seeded(1),
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
  });
  expect(highlights.map((highlight) => highlight.id)).toEqual(['aaaaa1', 'bbbbb2', 'ccccc3']);
  // In Obsidian: the first quote is tidied, a comment is added by hand, a paragraph between.
  const edited = text
    .replace('> All warfare is based on deception.', '>  All warfare is based on *deception*.')
    .replace('^aaaaa1\n', '^aaaaa1\n\nWritten in Obsidian.\n');
  return edited;
}

describe("editing a highlight's comment", () => {
  it('gives a highlight with no comment one, changing nothing else', () => {
    const text = threeHighlights();
    const changed = withHighlightComment({ text, id: 'ccccc3', comment: 'Like *water*.' });
    expect(highlightNamed(changed, 'ccccc3').comment).toBe('Like *water*.');
    const block = highlightNamed(text, 'ccccc3');
    expect(changed.slice(0, block.markerEnd)).toBe(text.slice(0, block.markerEnd));
    expect(changed.slice(changed.length - (text.length - block.quoteEnd))).toBe(
      text.slice(block.quoteEnd),
    );
  });

  it("replaces a comment, keeping the quote the person tidied and every other block's bytes", () => {
    const text = threeHighlights();
    const changed = withHighlightComment({ text, id: 'bbbbb2', comment: 'Second\n\nthought.' });
    expect(highlightNamed(changed, 'bbbbb2').comment).toBe('Second\n\nthought.');
    expect(changed).toContain('>  All warfare is based on *deception*.');
    expect(changed).toContain('Written in Obsidian.');
    expect(changed.replace('>\n> Second\n>\n> thought.\n', '>\n> First thought.\n')).toBe(text);
  });

  it('takes the comment off for a blank one', () => {
    const text = threeHighlights();
    const changed = withHighlightComment({ text, id: 'bbbbb2', comment: '  \n' });
    expect(highlightNamed(changed, 'bbbbb2').comment).toBe('');
    expect(changed).toBe(text.replace('>\n> First thought.\n', ''));
  });

  it('writes back the same bytes for the comment DFAI wrote', () => {
    const text = threeHighlights();
    expect(withHighlightComment({ text, id: 'bbbbb2', comment: 'First thought.' })).toBe(text);
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
      });
      const removed = highlights.reduceRight(
        (current, { id }) => withoutHighlight({ text: current, id }),
        text,
      );
      expect(removed).toBe(note);
    },
  );

  it('refuses a highlight the note does not hold', () => {
    expect(() =>
      withHighlightComment({ text: threeHighlights(), id: 'zzzzzz', comment: 'x' }),
    ).toThrow(HighlightNotFoundError);
  });
});

describe('removing a highlight', () => {
  it('takes out a highlight between others with the blank line after it', () => {
    const text = threeHighlights();
    const block = highlightNamed(text, 'bbbbb2');
    const removed = withoutHighlight({ text, id: 'bbbbb2' });
    expect(removed).toBe(text.slice(0, block.start) + text.slice(block.end + 1));
    expect(readHighlights(removed).map((highlight) => highlight.id)).toEqual(['aaaaa1', 'ccccc3']);
  });

  it('takes out the last highlight with the blank line before it, the note still ending its line', () => {
    const text = threeHighlights();
    const removed = withoutHighlight({ text, id: 'ccccc3' });
    expect(removed.endsWith('^bbbbb2\n')).toBe(true);
    expect(readHighlights(removed).map((highlight) => highlight.id)).toEqual(['aaaaa1', 'bbbbb2']);
  });

  it('takes out a highlight followed by words', () => {
    const text = threeHighlights();
    const removed = withoutHighlight({ text, id: 'aaaaa1' });
    expect(removed).toContain('Intro words.\n\nWritten in Obsidian.\n\n> Know the enemy.');
  });

  it('takes out the only highlight, leaving the note as it was before it', () => {
    const { text } = appendHighlights({ text: SOURCE, highlights: [deception], random: seeded(2) });
    const [only] = readHighlights(text);
    expect(withoutHighlight({ text, id: only?.id as string })).toBe(SOURCE);
    const windows = `Words.\r\n\r\n> Q.\r\n> ${highlightMarker({ style: { mark: 'highlight', color: 'yellow' }, anchor: deception.anchor })}\r\n\r\n^abc123\r\n`;
    expect(withoutHighlight({ text: windows, id: 'abc123' })).toBe('Words.\r\n');
  });

  it('takes out a highlight ending the note with no final line ending', () => {
    const text = `Words.\n\n> Q.\n> ${highlightMarker({ style: { mark: 'highlight', color: 'yellow' }, anchor: deception.anchor })}\n\n^abc123`;
    // A block with no final line ending is one DFAI wrote to a note without one (A11): gone, so is it.
    expect(withoutHighlight({ text, id: 'abc123' })).toBe('Words.');
  });

  it('refuses a highlight the note does not hold', () => {
    expect(() => withoutHighlight({ text: threeHighlights(), id: 'zzzzzz' })).toThrow(/\^zzzzzz/);
  });
});
