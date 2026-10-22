import {
  KINDLE_MAX_PAGES_PER_BOOK,
  newKindleHighlights,
  readKindleAnnotations,
  readKindleLibrary,
  type KindleBook,
  type KindleBookOutcome,
  type KindleHighlight,
  type KindlePageCursor,
  type KindlePageProblem,
  type KindleRawPage,
  type KindleSyncReport,
} from '@dfai/domain';
import type { Clock } from '../ports.ts';
import { KindleFetchError, type KindleHighlightSink, type KindleNotebookSource } from './ports.ts';

export interface KindleSyncPorts {
  readonly source: KindleNotebookSource;
  readonly sink: KindleHighlightSink;
  readonly clock: Pick<Clock, 'now'>;
}

/** A page fetched, or why none came back: a host failure is Amazon being unreachable. */
type Fetched = { readonly page: KindleRawPage } | { readonly failed: string };

async function fetched(fetch: Promise<KindleRawPage>): Promise<Fetched> {
  try {
    return { page: await fetch };
  } catch (error) {
    if (error instanceof KindleFetchError) return { failed: error.message };
    throw error;
  }
}

function unavailableWords(problem: { readonly status: number }): string {
  return `Amazon answered ${problem.status}`;
}

/** A book read whole, or why it was not. */
type BookRead =
  | { readonly highlights: readonly KindleHighlight[] }
  | KindlePageProblem
  | { readonly kind: 'fetch_failed'; readonly message: string };

/** Reads every page of `book`'s annotations, following the cursor until the last. */
async function readBook(source: KindleNotebookSource, book: KindleBook): Promise<BookRead> {
  const highlights: KindleHighlight[] = [];
  const seen = new Set<string>();
  let cursor: KindlePageCursor | null = null;
  for (let pages = 0; pages < KINDLE_MAX_PAGES_PER_BOOK; pages += 1) {
    const answer = await fetched(source.fetchAnnotations({ asin: book.asin, cursor }));
    if ('failed' in answer) return { kind: 'fetch_failed', message: answer.failed };
    const reading = readKindleAnnotations(answer.page, book.asin);
    if (reading.kind !== 'annotations') return reading;
    highlights.push(...reading.highlights);
    if (reading.next === null) return { highlights };
    if (seen.has(reading.next.token)) {
      return { kind: 'unrecognised', reason: 'the pages of the book go round in a circle' };
    }
    seen.add(reading.next.token);
    cursor = reading.next;
  }
  return {
    kind: 'unrecognised',
    reason: `the book has more than ${KINDLE_MAX_PAGES_PER_BOOK} pages`,
  };
}

/** Writes the book's highlights the sink has not recorded; how that went. */
async function writeBook(
  ports: KindleSyncPorts,
  book: KindleBook,
  highlights: readonly KindleHighlight[],
): Promise<KindleBookOutcome> {
  const named = { asin: book.asin, title: book.title };
  try {
    const fresh = newKindleHighlights(highlights, await ports.sink.recordedKeys(book));
    if (fresh.length > 0) {
      await ports.sink.addHighlights({ book, highlights: fresh, syncedAt: ports.clock.now() });
    }
    return { ...named, kind: 'added', added: fresh.length };
  } catch (error) {
    return {
      ...named,
      kind: 'not_written',
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

/** One book: read whole, then written; a sign-in stops the whole sync. */
async function syncBook(
  ports: KindleSyncPorts,
  book: KindleBook,
): Promise<KindleBookOutcome | 'sign_in_required'> {
  const read = await readBook(ports.source, book);
  const named = { asin: book.asin, title: book.title };
  if ('highlights' in read) return writeBook(ports, book, read.highlights);
  switch (read.kind) {
    case 'sign_in_required':
      return 'sign_in_required';
    case 'unrecognised':
      return { ...named, kind: 'unrecognised', reason: read.reason };
    case 'unavailable':
      return { ...named, kind: 'unavailable', message: unavailableWords(read) };
    case 'fetch_failed':
      return { ...named, kind: 'unavailable', message: read.message };
  }
}

/** The library's books, or the report that ends the sync before any book is read. */
async function readLibrary(
  source: KindleNotebookSource,
): Promise<{ readonly books: readonly KindleBook[] } | { readonly ended: KindleSyncReport }> {
  const answer = await fetched(source.fetchLibrary());
  if ('failed' in answer) return { ended: { kind: 'unavailable', message: answer.failed } };
  const library = readKindleLibrary(answer.page);
  switch (library.kind) {
    case 'library':
      return { books: library.books };
    case 'unavailable':
      return { ended: { kind: 'unavailable', message: unavailableWords(library) } };
    default:
      return { ended: library };
  }
}

type Unrecognised = Extract<KindleBookOutcome, { kind: 'unrecognised' }>;

const isUnrecognised = (outcome: KindleBookOutcome): outcome is Unrecognised =>
  outcome.kind === 'unrecognised';

/**
 * Brings the Kindle notebook's highlights and typed notes into their books'
 * source notes (#508). Each book is read whole before anything of it is
 * written, so a page that cannot be read leaves the book's note as it was;
 * only highlights the note has not recorded are added. A sign-in stops the
 * sync where it is; a library, or every book, the parser does not know is
 * the page having changed, said as that rather than as nothing new.
 */
export async function syncKindle(ports: KindleSyncPorts): Promise<KindleSyncReport> {
  const library = await readLibrary(ports.source);
  if ('ended' in library) return library.ended;
  const outcomes: KindleBookOutcome[] = [];
  for (const book of library.books) {
    const outcome = await syncBook(ports, book);
    if (outcome === 'sign_in_required') return { kind: 'sign_in_required' };
    outcomes.push(outcome);
  }
  const unrecognised = outcomes.filter(isUnrecognised);
  const [first] = unrecognised;
  if (first !== undefined && unrecognised.length === outcomes.length) {
    return { kind: 'unrecognised', reason: first.reason };
  }
  const added = outcomes.reduce(
    (sum, outcome) => sum + (outcome.kind === 'added' ? outcome.added : 0),
    0,
  );
  return { kind: 'synced', books: outcomes, added };
}
