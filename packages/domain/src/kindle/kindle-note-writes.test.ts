import { describe, expect, it } from 'vitest';
import { lineNoteBlocks as noteBlocks } from '../testing/line-note-blocks.ts';
import { readHighlights } from '../highlights/highlight-block.ts';
import { literatureNoteText } from '../highlights/literature-note.ts';
import { kindleHighlightKey, kindleNoteKey, newKindleHighlights } from './kindle-highlight-key.ts';
import {
  KindleHighlightUnplaceableError,
  KindlePassageGoneError,
  recordedKindleKeys,
  withKindleHighlights,
} from './kindle-note-writes.ts';
import type { KindleHighlight, KindleHighlightColour } from './kindle-types.ts';

const ASIN = 'B0EXAMPLE1';
const EMPTY = literatureNoteText({
  kind: 'kindle',
  title: 'Pride and Prejudice',
  author: 'Jane Austen',
  asin: ASIN,
  file: null,
});

/** A seeded source of ids, so each run draws the same ones. */
function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

function passage(args: {
  id: string | null;
  quote: string;
  location?: number | null;
  page?: string | null;
  style?: 'highlight' | 'underline';
  colour?: KindleHighlightColour | null;
}): KindleHighlight {
  const location = args.location === undefined ? 100 : args.location;
  return {
    key: kindleHighlightKey({ asin: ASIN, annotationId: args.id, location, words: args.quote }),
    asin: ASIN,
    annotationId: args.id,
    style: args.style ?? 'highlight',
    colour: args.colour === undefined ? 'yellow' : args.colour,
    quote: args.quote,
    note: null,
    location,
    page: args.page ?? null,
    commentOn: null,
  };
}

/** A note typed on `on`, as the notebook gives it: an entry of its own after the passage. */
function typedOn(on: KindleHighlight, note: string): KindleHighlight {
  return {
    ...on,
    key: kindleNoteKey(on.key, note),
    style: 'note',
    colour: null,
    quote: '',
    note,
    commentOn: on.key,
  };
}

/** A note at a place with no passage. */
function noteOnly(id: string | null, note: string, location = 2400): KindleHighlight {
  const placed = kindleHighlightKey({ asin: ASIN, annotationId: id, location, words: note });
  return {
    key: id === null ? placed : kindleNoteKey(placed, note),
    asin: ASIN,
    annotationId: id,
    style: 'note',
    colour: null,
    quote: '',
    note,
    location,
    page: null,
    commentOn: null,
  };
}

function write(text: string, highlights: readonly KindleHighlight[], seed = 7) {
  return withKindleHighlights({ text, asin: ASIN, highlights, random: seeded(seed), noteBlocks });
}

/** What a sync would hand over next: the entries the note has not recorded. */
const freshIn = (text: string, highlights: readonly KindleHighlight[]) =>
  newKindleHighlights(highlights, recordedKindleKeys(text, ASIN, noteBlocks));

const VANITY = passage({ id: 'A1', quote: 'Vanity and pride are different things.' });

describe('withKindleHighlights', () => {
  it('writes a passage and the note typed on it as one block, and records both', () => {
    const highlights = [VANITY, typedOn(VANITY, 'Mary, of all people.')];
    const { text, written } = write(EMPTY, highlights);
    const [block, ...more] = readHighlights(text, noteBlocks);
    expect(more).toEqual([]);
    expect(block?.quote).toBe('Vanity and pride are different things.');
    expect(block?.comment).toBe('Mary, of all people.');
    expect(block?.anchor).toMatchObject({
      kind: 'kindle',
      annotationId: 'A1',
      location: { start: 100 },
    });
    expect(written).toBe(2);
    expect(freshIn(text, highlights)).toEqual([]);
  });

  it('adds nothing the second time, byte for byte', () => {
    const highlights = [VANITY, typedOn(VANITY, 'Mary, of all people.')];
    const once = write(EMPTY, highlights).text;
    const twice = write(once, highlights, 99);
    expect(twice).toEqual({ text: once, written: 0 });
  });

  it('gives a note typed after the passage synced as the passage comment', () => {
    const synced = write(EMPTY, [VANITY]).text;
    const later = typedOn(VANITY, 'Mary, of all people.');
    expect(freshIn(synced, [VANITY, later])).toEqual([later]);
    const { text, written } = write(synced, [later]);
    expect(readHighlights(text, noteBlocks).map((b) => b.comment)).toEqual([
      'Mary, of all people.',
    ]);
    expect(written).toBe(1);
  });

  it("adds a later note after the person's own comment, keeping its bytes", () => {
    const synced = write(EMPTY, [VANITY]).text;
    const [block] = readHighlights(synced, noteBlocks);
    const own = synced.replace(
      /(atlas:highlight [^\n]*-->\n)/,
      '$1> My **own** thought,\n> on two lines.\n',
    );
    expect(readHighlights(own, noteBlocks)[0]?.comment).toBe('My **own** thought,\non two lines.');
    const { text } = write(own, [typedOn(VANITY, 'Typed on the Kindle later.')]);
    const comment = readHighlights(text, noteBlocks)[0]?.comment;
    expect(comment).toBe('My **own** thought,\non two lines.\n\nTyped on the Kindle later.');
    // The person's lines are kept as they are; the format's blank separator may join them.
    expect(text).toContain('> My **own** thought,\n> on two lines.\n');
    expect(readHighlights(text, noteBlocks).map((b) => b.id)).toEqual([block?.id]);
  });

  it('adds Kindle words again, once, after a typed note the person edited, never in its place', () => {
    const typed = typedOn(VANITY, 'Mary of all people');
    const synced = write(EMPTY, [VANITY, typed]).text;
    const edited = synced.replace('> Mary of all people', '> Mary, of all people!');
    expect(freshIn(edited, [VANITY, typed])).toEqual([typed]);
    const again = write(edited, [typed]).text;
    expect(readHighlights(again, noteBlocks)[0]?.comment).toBe(
      'Mary, of all people!\n\nMary of all people',
    );
    expect(freshIn(again, [VANITY, typed])).toEqual([]);
  });

  it('records a note typed in paragraphs as one entry', () => {
    const typed = typedOn(VANITY, 'First thought.\n\nSecond thought.');
    const { text } = write(EMPTY, [VANITY, typed]);
    expect(freshIn(text, [VANITY, typed])).toEqual([]);
  });

  it('writes a note at a place with no passage as its own block, and records it', () => {
    const note = noteOnly('A4', 'Reread this chapter.');
    const { text } = write(EMPTY, [note]);
    const [block] = readHighlights(text, noteBlocks);
    expect(block?.quote).toBe('Note at location 2400');
    expect(block?.comment).toBe('Reread this chapter.');
    expect(freshIn(text, [note])).toEqual([]);
  });

  it('records a note with no passage and no annotation id by its words', () => {
    const note = noteOnly(null, 'No id on this one.');
    expect(freshIn(write(EMPTY, [note]).text, [note])).toEqual([]);
  });

  it("adds Kindle's edit of a note with no passage after the note synced before", () => {
    const first = write(EMPTY, [noteOnly('A4', 'Reread this chapter.')]).text;
    const edit = noteOnly('A4', 'Reread this chapter twice.');
    expect(freshIn(first, [edit])).toEqual([edit]);
    const { text } = write(first, [edit]);
    const blocks = readHighlights(text, noteBlocks);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.comment).toBe('Reread this chapter.\n\nReread this chapter twice.');
    expect(freshIn(text, [edit])).toEqual([]);
  });

  it('draws underlines as underlines and keeps the colour of a highlight', () => {
    const underline = passage({
      id: 'A3',
      quote: 'Underlined words.',
      style: 'underline',
      colour: null,
    });
    const orange = passage({ id: 'A6', quote: 'Orange words.', location: 5120, colour: 'orange' });
    const blocks = readHighlights(write(EMPTY, [underline, orange]).text, noteBlocks);
    expect(blocks.map((b) => b.style)).toEqual([
      { mark: 'underline', color: 'yellow' },
      { mark: 'highlight', color: 'orange' },
    ]);
  });

  it('places a passage with no location by its page in figures', () => {
    const paged = passage({ id: 'A7', quote: 'On a page.', location: null, page: '12' });
    const [block] = readHighlights(write(EMPTY, [paged]).text, noteBlocks);
    expect(block?.anchor).toMatchObject({ location: null, page: 12 });
  });

  it('refuses a book with a highlight it cannot place, writing nothing', () => {
    const roman = passage({ id: 'A8', quote: 'In the preface.', location: null, page: 'xiv' });
    expect(() => write(EMPTY, [VANITY, roman])).toThrow(KindleHighlightUnplaceableError);
  });

  it('refuses a note whose passage left the note since it was read', () => {
    expect(() => write(EMPTY, [typedOn(VANITY, 'Orphaned.')])).toThrow(KindlePassageGoneError);
  });

  it('puts a note after a passage synced before Amazon gave it an id', () => {
    const noId = passage({ id: null, quote: 'Vanity and pride are different things.' });
    const synced = write(EMPTY, [noId]).text;
    const typed = typedOn(VANITY, 'Now with an id.');
    const { text, written } = write(synced, [VANITY, typed]);
    const blocks = readHighlights(text, noteBlocks);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.comment).toBe('Now with an id.');
    expect(written).toBe(1);
  });

  it('leaves blocks of another source alone and records none of them', () => {
    const pdf = `${EMPTY}> A PDF quote.\n> <!-- atlas:highlight {"v":1,"mark":"highlight","color":"yellow","kind":"pdf","page":3,"exact":"A PDF quote.","rects":[]} -->\n\n^pdf001\n`;
    expect(recordedKindleKeys(pdf, ASIN, noteBlocks).size).toBe(0);
    const { text } = write(pdf, [VANITY]);
    expect(text.startsWith(pdf)).toBe(true);
  });
});
