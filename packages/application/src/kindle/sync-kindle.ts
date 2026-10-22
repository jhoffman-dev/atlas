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
 * gap since the last fetch finished (the first waits for nothing), and never
 * more than the gap, whatever the clock does: one set back mid-sync would
 * otherwise read as the last fetch being in the future.
 */
function pacer({ clock, delay }: Pick<KindleSyncPorts, 'clock' | 'delay'>) {
  let lastFinishedAt: number | null = null;
  return {
    async before(): Promise<void> {
      if (lastFinishedAt === null) return;
      const elapsed = clock.now() - lastFinishedAt;
      const remaining = Math.min(KINDLE_MIN_FETCH_GAP_MS, KINDLE_MIN_FETCH_GAP_MS - elapsed);
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

/**
 * A book read whole, why the sync stops, why the book alone was not read, or
 * the host no longer reaching Amazon: every further book would time out too,
 * so the sync stops there.
 */
type BookRead =
  | { readonly highlights: readonly KindleHighlight[] }
  | { readonly stop: KindleStopReason }
  | { readonly problem: BookProblem }
  | { readonly lost: string };

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
    if ('unavailable' in answer) return { lost: answer.unavailable };
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
): Promise<KindleBookOutcome | { readonly stop: KindleStopReason } | { readonly lost: string }> {
  const read = await readBook(ports.source, fetchPage, book);
  if ('highlights' in read) return writeBook(ports, book, read.highlights);
  if ('stop' in read || 'lost' in read) return read;
  return { asin: book.asin, title: book.title, ...read.problem };
}

/** The library's books, or the report that ends the sync before any book is read. */
async function readLibrary(
  source: KindleNotebookSource,
  fetchPage: FetchPage,
): Promise<{ readonly books: readonly KindleBook[] } | { readonly ended: KindleSyncReport }> {
  const answer = await fetchPage(() => source.fetchLibrary());
  if ('stop' in answer) return { ended: stopped(answer.stop, []) };
  if ('unavailable' in answer) return { ended: lostAmazon(answer.unavailable, []) };
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
      return { ended: lostAmazon(amazonAnswered(library.status), []) };
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

/** A sync Amazon could not be reached for, with the books it had done until then. */
function lostAmazon(message: string, outcomes: readonly KindleBookOutcome[]): KindleSyncReport {
  return { kind: 'unavailable', message, books: outcomes, added: addedBy(outcomes) };
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
    if ('lost' in outcome) return lostAmazon(outcome.lost, outcomes);
    outcomes.push(outcome);
  }
  const [first] = outcomes.filter(isUnrecognised);
  if (first !== undefined && outcomes.every(isUnrecognised)) {
    return { kind: 'unrecognised', reason: first.reason };
  }
  return { kind: 'synced', books: outcomes, added: addedBy(outcomes) };
}

/**
 * How long a call that joins a running sync waits for it, from when it
 * started: past this the running sync is taken as stuck (a host that never
 * answers), reported as failed to the call that joined, and its slot freed so
 * the next call runs afresh.
 */
export const KINDLE_SYNC_JOIN_DEADLINE_MS = 10 * 60 * 1000;

/** What a call that joined a stuck sync is told, once the deadline has passed. */
export class KindleSyncStuckError extends Error {
  constructor() {
    super(
      `The Kindle sync already running did not finish within ${KINDLE_SYNC_JOIN_DEADLINE_MS / 60_000} minutes, and was given up on.`,
    );
    this.name = 'KindleSyncStuckError';
  }
}

export interface KindleSyncOptions {
  /** How a call that joined waits out what is left of {@link KINDLE_SYNC_JOIN_DEADLINE_MS}. */
  readonly deadline: KindleDelay;
}

/** One sync of the Kindle notebook into its notes; see {@link createKindleSync}. */
export type KindleSync = (ports: KindleSyncPorts) => Promise<KindleSyncReport>;

interface InFlight {
  readonly startedAt: number;
  readonly report: Promise<KindleSyncReport>;
}

/** What is left of the deadline at `now`: never less than none, nor more than all of it. */
function deadlineLeft(slot: InFlight, now: number): number {
  const left = KINDLE_SYNC_JOIN_DEADLINE_MS - (now - slot.startedAt);
  return Math.max(0, Math.min(KINDLE_SYNC_JOIN_DEADLINE_MS, left));
}

/**
 * Brings the Kindle notebook's highlights and typed notes into their books'
 * source notes (#508). Each book is read whole before anything of it is
 * written, so a page that cannot be read leaves the book's note as it was;
 * only highlights the note has not recorded are added, and a note typed on
 * one later arrives as its own entry after it. Fetches are a gap apart
 * ({@link KINDLE_MIN_FETCH_GAP_MS}).
 *
 * A sign-in, a robot check, a lost session, a Mac that cannot keep one,
 * another store's notebook, and a host that can no longer reach Amazon each
 * stop the sync where it is, with what it had added until then; a library,
 * or every book, the parser does not know is the page having changed, said
 * as that rather than as nothing new.
 *
 * One sync is in flight per factory: a call made while one is running joins
 * it, and both get its report. Two at once would each read the note before
 * either wrote it, and add everything twice. So the composition root creates
 * **one** `createKindleSync` per app and every caller (launch, schedule, ⌘K)
 * uses it. A join waits at most until {@link KINDLE_SYNC_JOIN_DEADLINE_MS}
 * after the running sync started.
 */
export function createKindleSync({ deadline }: KindleSyncOptions): KindleSync {
  let inFlight: InFlight | null = null;
  const free = (slot: InFlight) => {
    if (inFlight === slot) inFlight = null;
  };

  async function join(slot: InFlight, now: number): Promise<KindleSyncReport> {
    const left = deadlineLeft(slot, now);
    const passed = left === 0 ? Promise.resolve() : deadline.wait(left);
    const settled = await Promise.race([
      slot.report.then((report) => ({ report })),
      passed.then(() => null),
    ]);
    if (settled !== null) return settled.report;
    free(slot);
    throw new KindleSyncStuckError();
  }

  return (ports) => {
    if (inFlight !== null) return join(inFlight, ports.clock.now());
    const slot: InFlight = {
      startedAt: ports.clock.now(),
      report: run(ports).finally(() => free(slot)),
    };
    inFlight = slot;
    return slot.report;
  };
}
