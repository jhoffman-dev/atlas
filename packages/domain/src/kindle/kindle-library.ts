import { findFirst, textOf, withClass, withId, withTag } from './html-tree.ts';
import type { HtmlElement } from './html-tree.ts';
import { allWithClass, checkKindlePage } from './kindle-notebook-page.ts';
import type { KindleBook, KindleLibraryReading, KindleRawPage } from './kindle-types.ts';

/**
 * The notebook's library: the books that have highlights or notes, each an
 * element whose id is its ASIN. A book this cannot read whole — no ASIN, no
 * title — means the page is not the shape it knows, and the whole page is
 * refused rather than read in part (#508: never write partial junk).
 */

/** What an ASIN may be: letters and digits, as Amazon writes them, sideloaded documents' longer ids included. */
export const KINDLE_ASIN = /^[A-Za-z0-9_-]{1,64}$/;

const LIBRARY_ID = 'kp-notebook-library';
const BOOK_CLASS = 'kp-notebook-library-each-book';
const SEARCHABLE_CLASS = 'kp-notebook-searchable';
const COVER_CLASS = 'kp-notebook-cover-image';

/** The library shows an author as "By: Mara Quill". */
const BY_PREFIX = /^by:?\s*/i;

function httpsOrNull(address: string | undefined): string | null {
  if (address === undefined) return null;
  try {
    return new URL(address).protocol === 'https:' ? address : null;
  } catch {
    // A cover the page names badly is a missing cover, not a broken book.
    return null;
  }
}

type BookReading = { readonly book: KindleBook } | { readonly problem: string };

function readBook(element: HtmlElement): BookReading {
  const asin = element.attributes.get('id') ?? '';
  if (!KINDLE_ASIN.test(asin)) return { problem: 'a book in the library has no ASIN' };
  const titleElement = findFirst(
    element,
    (candidate) => withTag('h2')(candidate) && withClass(SEARCHABLE_CLASS)(candidate),
  );
  const title = titleElement === null ? '' : textOf(titleElement);
  if (title === '') return { problem: `the book ${asin} has no title` };
  const authorElement = findFirst(
    element,
    (candidate) => withTag('p')(candidate) && withClass(SEARCHABLE_CLASS)(candidate),
  );
  const author = authorElement === null ? '' : textOf(authorElement).replace(BY_PREFIX, '');
  const cover = findFirst(element, withClass(COVER_CLASS));
  return {
    book: {
      asin,
      title,
      author: author === '' ? null : author,
      coverUrl: httpsOrNull(cover?.attributes.get('src')),
    },
  };
}

/** Reads the notebook's library page into its books, each once. */
export function readKindleLibrary(page: KindleRawPage): KindleLibraryReading {
  const checked = checkKindlePage(page);
  if (checked.kind !== 'page') return checked;
  const library = findFirst(checked.tree, withId(LIBRARY_ID));
  if (library === null) return { kind: 'unrecognised', reason: 'the page has no library' };
  const books: KindleBook[] = [];
  const seen = new Set<string>();
  for (const element of allWithClass(library, BOOK_CLASS)) {
    const reading = readBook(element);
    if ('problem' in reading) return { kind: 'unrecognised', reason: reading.problem };
    if (seen.has(reading.book.asin)) continue;
    seen.add(reading.book.asin);
    books.push(reading.book);
  }
  return { kind: 'library', books };
}
