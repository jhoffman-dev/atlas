import { withoutInvisibles } from '../highlights/passage-words.ts';
import type { LiteratureNote } from '../highlights/literature-note.ts';
import { fitFileNameStem } from '../vault/file-name-bytes.ts';
import { linkableEntryName, NUMBERED_NOTE_ENDING } from '../vault/new-note.ts';
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

/** The curly and modifier forms of the apostrophe and the quotation mark a title may spell either way. */
const SINGLE_QUOTES = /[\u2018\u2019\u201a\u201b\u2032\u02bc\u02b9\uff07]/g;
const DOUBLE_QUOTES = /[\u201c\u201d\u201e\u201f\u2033\uff02]/g;

/**
 * Words compared as a person reads them: one composition, one case, spaces
 * collapsed, nothing that shows nothing (a zero-width space, a soft hyphen,
 * a direction mark) and one kind of apostrophe and quotation mark — Amazon
 * writes `Keeper’s` where a person types `Keeper's`.
 */
const folded = (words: string): string =>
  withoutInvisibles(words)
    .normalize('NFC')
    .replace(SINGLE_QUOTES, "'")
    .replace(DOUBLE_QUOTES, '"')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();

const nameOf = (title: string, author: string): string => `${folded(title)}\u0000${folded(author)}`;

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
  return nameOf(note.title, note.author) === nameOf(book.title, book.author)
    ? 'title_and_author'
    : null;
}

/** The notes of a vault looked through once, to find each book's by ASIN or by title and author. */
export interface KindleNoteIndex<Path> {
  /** The path of `book`'s note: the one with its ASIN, else the first with its title and author. */
  find(book: KindleBook): Path | null;
}

/**
 * `notes` looked through once. Finds what {@link kindleNoteMatch} would, the
 * first match in `notes` by ASIN, else the first by title and author, without
 * reading every note again for every book. The caller orders `notes`, so the
 * same vault always gives the same note.
 */
export function kindleNoteIndex<Path>(
  notes: readonly { readonly path: Path; readonly note: LiteratureNote | null }[],
): KindleNoteIndex<Path> {
  const byAsin = new Map<string, Path>();
  const byName = new Map<string, Path>();
  for (const { path, note } of notes) {
    if (note === null || note.kind !== 'kindle') continue;
    const asin = note.asin ?? null;
    if (asin !== null) {
      if (!byAsin.has(folded(asin))) byAsin.set(folded(asin), path);
    } else if (note.author !== null && !byName.has(nameOf(note.title, note.author))) {
      byName.set(nameOf(note.title, note.author), path);
    }
  }
  return {
    find: (book) =>
      byAsin.get(folded(book.asin)) ??
      (book.author === null ? undefined : byName.get(nameOf(book.title, book.author))) ??
      null,
  };
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
  return kindleNoteIndex(notes).find(book);
}

/**
 * The name a new note for `book` is given, without its extension: the title
 * as a file and a wiki link can both hold it (no `#`, `^`, `[`, `]`, `|`, so
 * `![[Book#^id]]` reaches its highlights), nothing that shows nothing, and
 * cut by whole characters so that a number and `.md` after it still fit what
 * a disk takes. The title in the note's properties is left as Amazon gave it.
 */
export function kindleNoteName(book: KindleBook): string {
  return fitFileNameStem(linkableEntryName(withoutInvisibles(book.title)), NUMBERED_NOTE_ENDING);
}
