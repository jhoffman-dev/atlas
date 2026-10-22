import { describe, expect, it } from 'vitest';
import type { LiteratureNote } from '../highlights/literature-note.ts';
import {
  kindleLiteratureNote,
  kindleNoteIndex,
  kindleNoteMatch,
  kindleNoteName,
  kindleNoteOf,
} from './kindle-note-match.ts';
import { MAX_NAME_BYTES, utf8Bytes } from '../vault/file-name-bytes.ts';
import type { KindleBook } from './kindle-types.ts';

const BOOK: KindleBook = {
  asin: 'B0EXAMPLE1',
  title: 'Pride and Prejudice',
  author: 'Jane Austen',
  coverUrl: null,
};

const note = (fields: Partial<LiteratureNote>): LiteratureNote => ({
  kind: 'kindle',
  title: 'Pride and Prejudice',
  author: 'Jane Austen',
  file: null,
  ...fields,
});

describe('kindleNoteMatch', () => {
  it('finds the note by its ASIN, whatever its title now says', () => {
    expect(kindleNoteMatch(note({ asin: 'b0example1', title: 'P&P (my copy)' }), BOOK)).toBe(
      'asin',
    );
  });

  it('takes a note naming another ASIN as another edition', () => {
    expect(kindleNoteMatch(note({ asin: 'B0OTHER' }), BOOK)).toBeNull();
  });

  it('finds a note with no ASIN by its title and author, in any case and spacing', () => {
    expect(
      kindleNoteMatch(note({ title: ' pride  and prejudice', author: 'JANE AUSTEN' }), BOOK),
    ).toBe('title_and_author');
  });

  it('never matches by the title alone', () => {
    expect(kindleNoteMatch(note({ author: 'Mara Quill' }), BOOK)).toBeNull();
    expect(kindleNoteMatch(note({ author: null }), BOOK)).toBeNull();
    expect(kindleNoteMatch(note({}), { ...BOOK, author: null })).toBeNull();
  });

  it('matches only Kindle literature notes', () => {
    expect(kindleNoteMatch(note({ kind: 'pdf', asin: 'B0EXAMPLE1' }), BOOK)).toBeNull();
    expect(kindleNoteMatch(null, BOOK)).toBeNull();
  });
});

describe('kindleNoteMatch, titles as a person reads them', () => {
  const keeper = { ...BOOK, title: 'The Keeper’s “Daughter”', author: 'Mara Quill' };

  it.each([
    ['a straight apostrophe', 'The Keeper\'s "Daughter"'],
    ['a modifier-letter apostrophe', 'The Keeperʼs “Daughter”'],
    ['a left single quote', 'The Keeper‘s “Daughter”'],
    ['a zero-width space', 'The Keeper​’s “Daughter”'],
    ['a soft hyphen and a direction mark', 'The Kee\u00adper\u200e’s “Daughter”'],
  ])('finds a note typed with %s', (_label, title) => {
    expect(kindleNoteMatch(note({ title, author: 'Mara Quill' }), keeper)).toBe('title_and_author');
  });

  it('still tells two different titles apart', () => {
    expect(
      kindleNoteMatch(note({ title: 'The Keepers Daughter', author: 'Mara Quill' }), keeper),
    ).toBeNull();
  });
});

describe('kindleNoteIndex', () => {
  const notes = [
    { path: 'a.md', note: note({}) },
    { path: 'b.md', note: note({ asin: 'B0EXAMPLE1', title: 'P&P' }) },
    { path: 'c.md', note: note({ asin: 'B0EXAMPLE1', title: 'P&P again' }) },
    { path: 'd.md', note: note({ kind: 'pdf', title: 'Emma', author: 'Jane Austen' }) },
    { path: 'e.md', note: null },
    { path: 'f.md', note: note({ title: 'Emma', author: 'Jane Austen' }) },
  ];

  it('finds what kindleNoteOf finds, for every book', () => {
    const index = kindleNoteIndex(notes);
    const emma = { ...BOOK, asin: 'B0EXAMPLE2', title: 'Emma' };
    const other = { ...BOOK, asin: 'B0OTHERONE', title: 'Persuasion' };
    for (const book of [BOOK, emma, other, { ...BOOK, author: null }]) {
      expect(index.find(book)).toBe(kindleNoteOf(notes, book));
    }
    expect(index.find(BOOK)).toBe('b.md');
    expect(index.find(emma)).toBe('f.md');
    expect(index.find(other)).toBeNull();
  });
});

describe('kindleNoteName', () => {
  it('is the title, without what a link would read as its own syntax', () => {
    expect(kindleNoteName({ ...BOOK, title: 'Field Notes in C# and F#' })).toBe(
      'Field Notes in C and F',
    );
    expect(kindleNoteName({ ...BOOK, title: 'Where [Rust] ^ meets | Go' })).toBe(
      'Where Rust meets Go',
    );
  });

  it('is without what shows nothing', () => {
    expect(kindleNoteName({ ...BOOK, title: 'Salt​water Hy\u00admns' })).toBe('Saltwater Hymns');
  });

  it('is cut by whole characters to leave room for a number and .md', () => {
    const name = kindleNoteName({ ...BOOK, title: '灯台守の物語'.repeat(30) });
    expect(utf8Bytes(`${name} 9999.md`)).toBeLessThanOrEqual(MAX_NAME_BYTES);
    expect(name.length).toBeGreaterThan(10);
  });
});

describe('kindleNoteOf', () => {
  it('prefers an ASIN match to an earlier title and author match', () => {
    const notes = [
      { path: 'Library/Pride and Prejudice.md', note: note({}) },
      { path: 'Reading/P&P.md', note: note({ asin: 'B0EXAMPLE1', title: 'P&P' }) },
    ];
    expect(kindleNoteOf(notes, BOOK)).toBe('Reading/P&P.md');
  });

  it('takes the first title and author match, and none when nothing matches', () => {
    const notes = [
      { path: 'a.md', note: null },
      { path: 'b.md', note: note({}) },
      { path: 'c.md', note: note({}) },
    ];
    expect(kindleNoteOf(notes, BOOK)).toBe('b.md');
    expect(kindleNoteOf([{ path: 'a.md', note: null }], BOOK)).toBeNull();
  });
});

describe('kindleLiteratureNote', () => {
  it("says the book's kind, title, author and ASIN, and has no file", () => {
    expect(kindleLiteratureNote(BOOK)).toEqual({
      kind: 'kindle',
      title: 'Pride and Prejudice',
      author: 'Jane Austen',
      asin: 'B0EXAMPLE1',
      file: null,
    });
  });
});
