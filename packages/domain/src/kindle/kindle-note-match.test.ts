import { describe, expect, it } from 'vitest';
import type { LiteratureNote } from '../highlights/literature-note.ts';
import { kindleLiteratureNote, kindleNoteMatch, kindleNoteOf } from './kindle-note-match.ts';
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
