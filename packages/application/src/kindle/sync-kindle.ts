import {
  findKindleKeyClash,
  KINDLE_MAX_PAGES_PER_BOOK,
  newKindleHighlights,
  readKindleAnnotations,
  readKindleLibrary,
  type KindleBook,
  type KindleBookOutcome,
  type KindleHighlight,
  type KindlePageCursor,
  type KindleRawPage,
  type KindleStopReason,
  type KindleSyncProgress,
  type KindleSyncReport,
} from '@dfai/domain';
import type { Clock } from '../ports.ts';
import {
  KindleFetchError,
  type KindleDelay,
  type KindleHighlightSink,
  type KindleNotebookSource,
} from './ports.ts';

export interface KindleSyncPorts {
  readonly source: KindleNotebookSource;
  readonly sink: KindleHighlightSink;
  readonly clock: Pick<Clock, 'now'>;
  /** How a sync waits between fetches; see {@link KINDLE_MIN_FETCH_GAP_MS}. */
  readonly delay: KindleDelay;
}

/**
 * The least time between two fetches of one sync: a person turning pages,
 * not a crawler. A library of fifty books is a minute and a half.
 */
export const KINDLE_MIN_FETCH_GAP_MS = 1500;

/**
 * Keeps a sync's fetches a gap apart: `before` waits out what is left of the
 * gap since the last fetch finished (the first waits for nothing).
 */
function pacer({ clock, delay }: Pick<KindleSyncPorts, 'clock' | 'delay'>) {
  let lastFinishedAt: number | null = null;
  return {
    async before(): Promise<void> {
      if (lastFinishedAt === null) return;
      const remaining = KINDLE_MIN_FETCH_GAP_MS - (clock.now() - lastFinishedAt);
      if (remaining > 0) await delay.wait(remaining);
    },
    after(): void {
      lastFinishedAt = clock.now();
    },
  };
}

/** What one page of the notebook came to. */
type Fetched =
  | { readonly page: KindleRawPage }
  /** The sync cannot go on: the session is gone, or the Mac cannot keep one. */
  | { readonly stop: KindleStopReason }
  /** Nothing of Amazon's came back: it could not be reached. */
  | { readonly unavailable: string }
  /** The host could not use the request, or what came back could not be read. */
  | { readonly unreadable: string };

/** The fetch the sync makes, paced: one page, or why none came back. */
type FetchPage = (fetch: () => Promise<KindleRawPage>) => Promise<Fetched>;

function paced(pace: ReturnType<typeof pacer>): FetchPage {
  return async (fetch) => {
    await pace.before();
    try {
      return { page: await fetch() };
    } catch (error) {
      if (error instanceof KindleFetchError) return failedFetch(error);
      throw error;
    } finally {
      pace.after();
    }
  };
}

function failedFetch(error: KindleFetchError): Fetched {
  switch (error.kind) {
    case 'not_connected':
      return { stop: { kind: 'not_connected' } };
    case 'unsupported':
      return { stop: { kind: 'unsupported', message: error.message } };
    case 'unreachable':
    case 'timeout':
      return { unavailable: error.message };
    case 'refused':
    case 'too_large':
    case 'malformed':
      return { unreadable: error.message };
  }
}

const amazonAnswered = (status: number) => `Amazon answered ${status}`;

/** Why one book was not read: nothing of it is written, and the sync goes on to the next. */
type BookProblem =
  | { readonly kind: 'unrecognised'; readonly reason: string }
  | { readonly kind: 'unavailable'; readonly message: string };

/** A book read whole, why the sync stops, or why the book alone was not read. */
type BookRead =
  | { readonly highlights: readonly KindleHighlight[] }
  | { readonly stop: KindleStopReason }
  | { readonly problem: BookProblem };

const unrecognised = (reason: string): BookRead => ({ problem: { kind: 'unrecognised', reason } });
const unavailable = (message: string): BookRead => ({ problem: { kind: 'unavailable', message } });

/** The book's highlights, unless a later page gave a different passage an id an earlier one used. */
function whole(highlights: readonly KindleHighlight[]): BookRead {
  if (findKindleKeyClash(highlights) !== null) {
    return unrecognised('two different annotations share one id');
  }
  return { highlights };
}

/** Reads every page of `book`'s annotations, following the cursor until the last. */
async function readBook(
  source: KindleNotebookSource,
  fetchPage: FetchPage,
  book: KindleBook,
): Promise<BookRead> {
  const highlights: KindleHighlight[] = [];
  const seen = new Set<string>();
  let cursor: KindlePageCursor | null = null;
  for (let pages = 0; pages < KINDLE_MAX_PAGES_PER_BOOK; pages += 1) {
    const answer = await fetchPage(() => source.fetchAnnotations({ asin: book.asin, cursor }));
    if ('stop' in answer) return answer;
    if ('unavailable' in answer) return unavailable(answer.unavailable);
    if ('unreadable' in answer) return unrecognised(answer.unreadable);
    const reading = readKindleAnnotations(answer.page, book.asin);
    switch (reading.kind) {
      case 'annotations':
        break;
      case 'sign_in_required':
      case 'robot_check':
      case 'unsupported_store':
        return { stop: reading };
      case 'unrecognised':
        return unrecognised(reading.reason);
      case 'unavailable':
        return unavailable(amazonAnswered(reading.status));
    }
    highlights.push(...reading.highlights);
    if (reading.next === null) return whole(highlights);
    if (seen.has(reading.next.token)) {
      return unrecognised('the pages of the book go round in a circle');
    }
    seen.add(reading.next.token);
    cursor = reading.next;
  }
  return unrecognised(`the book has more than ${KINDLE_MAX_PAGES_PER_BOOK} pages`);
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

/** One book: read whole, then written; or why the sync stops. */
async function syncBook(
  ports: KindleSyncPorts,
  fetchPage: FetchPage,
  book: KindleBook,
): Promise<KindleBookOutcome | { readonly stop: KindleStopReason }> {
  const read = await readBook(ports.source, fetchPage, book);
  if ('highlights' in read) return writeBook(ports, book, read.highlights);
  if ('stop' in read) return read;
  return { asin: book.asin, title: book.title, ...read.problem };
}

/** The library's books, or the report that ends the sync before any book is read. */
async function readLibrary(
  source: KindleNotebookSource,
  fetchPage: FetchPage,
): Promise<{ readonly books: readonly KindleBook[] } | { readonly ended: KindleSyncReport }> {
  const answer = await fetchPage(() => source.fetchLibrary());
  if ('stop' in answer) return { ended: stopped(answer.stop, []) };
  if ('unavailable' in answer) {
    return { ended: { kind: 'unavailable', message: answer.unavailable } };
  }
  if ('unreadable' in answer) return { ended: { kind: 'unrecognised', reason: answer.unreadable } };
  const library = readKindleLibrary(answer.page);
  switch (library.kind) {
    case 'library':
      return { books: library.books };
    case 'sign_in_required':
    case 'robot_check':
    case 'unsupported_store':
      return { ended: stopped(library, []) };
    case 'unavailable':
      return { ended: { kind: 'unavailable', message: amazonAnswered(library.status) } };
    case 'unrecognised':
      return { ended: library };
  }
}

function addedBy(outcomes: readonly KindleBookOutcome[]): number {
  return outcomes.reduce((sum, outcome) => sum + (outcome.kind === 'added' ? outcome.added : 0), 0);
}

/** A stopped sync's report, with the books it had done before it stopped. */
function stopped(
  reason: KindleStopReason,
  outcomes: readonly KindleBookOutcome[],
): KindleSyncReport {
  const progress: KindleSyncProgress = { books: outcomes, added: addedBy(outcomes) };
  return { ...reason, ...progress };
}

type Unrecognised = Extract<KindleBookOutcome, { kind: 'unrecognised' }>;

const isUnrecognised = (outcome: KindleBookOutcome): outcome is Unrecognised =>
  outcome.kind === 'unrecognised';

async function run(ports: KindleSyncPorts): Promise<KindleSyncReport> {
  const fetchPage = paced(pacer(ports));
  const library = await readLibrary(ports.source, fetchPage);
  if ('ended' in library) return library.ended;
  const outcomes: KindleBookOutcome[] = [];
  for (const book of library.books) {
    const outcome = await syncBook(ports, fetchPage, book);
    if ('stop' in outcome) return stopped(outcome.stop, outcomes);
    outcomes.push(outcome);
  }
  const [first] = outcomes.filter(isUnrecognised);
  if (first !== undefined && outcomes.every(isUnrecognised)) {
    return { kind: 'unrecognised', reason: first.reason };
  }
  return { kind: 'synced', books: outcomes, added: addedBy(outcomes) };
}

/** The sync running into each sink, so a second asked for meanwhile joins it. */
const running = new WeakMap<KindleHighlightSink, Promise<KindleSyncReport>>();

/**
 * Brings the Kindle notebook's highlights and typed notes into their books'
 * source notes (#508). Each book is read whole before anything of it is
 * written, so a page that cannot be read leaves the book's note as it was;
 * only highlights the note has not recorded are added, and a note typed on
 * one later arrives as its own entry after it. Fetches are a gap apart
 * ({@link KINDLE_MIN_FETCH_GAP_MS}).
 *
 * A sign-in, a robot check, a lost session, a Mac that cannot keep one, and
 * another store's notebook each stop the sync where it is, with what it had
 * added until then; a library, or every book, the parser does not know is the
 * page having changed, said as that rather than as nothing new.
 *
 * One sync runs into a sink at a time: a call made while another is running
 * joins it, and both get its report. Two at once would each read the note
 * before either wrote it, and add everything twice.
 */
export function syncKindle(ports: KindleSyncPorts): Promise<KindleSyncReport> {
  const joined = running.get(ports.sink);
  if (joined !== undefined) return joined;
  const started = run(ports).finally(() => running.delete(ports.sink));
  running.set(ports.sink, started);
  return started;
}
