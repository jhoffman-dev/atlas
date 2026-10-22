import type { LiteratureNote } from '../highlights/literature-note.ts';
import type { KindleBook } from './kindle-types.ts';

/*
 * Which literature note is a Kindle book's (#508, ADR-0043): the one whose
 * `asin` is the book's, else one with no `asin` whose title and author are
 * the book's. Never the title alone: two books share a title far more often
 * than a title and an author, and a sync writing one book's highlights into
 * another's note is worse than a second note.
 */

/** What a new literature note for `book` says about it. */
export function kindleLiteratureNote(book: KindleBook): LiteratureNote {
  return { kind: 'kindle', title: book.title, author: book.author, asin: book.asin, file: null };
}

/** How a note is the book's: by its ASIN, or by its title and author; null when it is not. */
export type KindleNoteMatch = 'asin' | 'title_and_author';

/** Words compared as a person reads them: one composition, one case, spaces collapsed. */
const folded = (words: string): string =>
  words.normalize('NFC').replace(/\s+/g, ' ').trim().toLowerCase();

/**
 * Whether `note` is `book`'s, and how. A note that names another ASIN is
 * another edition's, whatever its title says; a book or note with no author
 * is found by ASIN only.
 */
export function kindleNoteMatch(
  note: LiteratureNote | null,
  book: KindleBook,
): KindleNoteMatch | null {
  if (note === null || note.kind !== 'kindle') return null;
  const asin = note.asin ?? null;
  if (asin !== null) return folded(asin) === folded(book.asin) ? 'asin' : null;
  if (note.author === null || book.author === null) return null;
  return folded(note.title) === folded(book.title) && folded(note.author) === folded(book.author)
    ? 'title_and_author'
    : null;
}

/**
 * The path of `book`'s note among `notes`: the first that matches by ASIN,
 * else the first that matches by title and author; null when none does.
 * The caller orders `notes`, so the same vault always gives the same note.
 */
export function kindleNoteOf<Path>(
  notes: readonly { readonly path: Path; readonly note: LiteratureNote | null }[],
  book: KindleBook,
): Path | null {
  const byAsin = notes.find(({ note }) => kindleNoteMatch(note, book) === 'asin');
  if (byAsin !== undefined) return byAsin.path;
  const byName = notes.find(({ note }) => kindleNoteMatch(note, book) === 'title_and_author');
  return byName?.path ?? null;
}
