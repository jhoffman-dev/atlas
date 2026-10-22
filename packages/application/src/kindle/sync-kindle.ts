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
 * The most time a sync can plausibly spend between one fetch ending and the
 * next being asked for (reading a page, writing a note). A clock that says
 * more has been set forward, not run: what it says has passed did not.
 */
const KINDLE_CLOCK_JUMP_MS = 60 * 1000;

/**
 * What is left of the gap `elapsed` after the last fetch finished: the gap
 * less what has passed, read off the clock only while the clock can be
 * believed. Set back (elapsed below none) or forward (elapsed past
 * {@link KINDLE_CLOCK_JUMP_MS}), it says nothing of how long it has been, so
 * the whole gap is waited: never less than the gap is kept, never more is waited.
 */
function gapLeft(elapsed: number): number {
  if (elapsed < 0 || elapsed > KINDLE_CLOCK_JUMP_MS) return KINDLE_MIN_FETCH_GAP_MS;
  return Math.max(0, KINDLE_MIN_FETCH_GAP_MS - elapsed);
}

/**
 * Keeps a sync's fetches a gap apart: `before` waits out what is left of the
 * gap since the last fetch finished ({@link gapLeft}); the first waits for nothing.
 */
function pacer({ clock, delay }: Pick<KindleSyncPorts, 'clock' | 'delay'>) {
  let lastFinishedAt: number | null = null;
  return {
    async before(): Promise<void> {
      if (lastFinishedAt === null) return;
      const remaining = gapLeft(clock.now() - lastFinishedAt);
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

function paced(pace: ReturnType<typeof pacer>, givenUp: AbortSignal): FetchPage {
  return async (fetch) => {
    await pace.before();
    stopIfGivenUp(givenUp);
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

/**
 * Ends a sync that has been given up on (see {@link createKindleSync}) before
 * it fetches or writes anything more: the call that gave up on it has said it
 * failed, and the next sync may already be waiting on it to settle.
 */
function stopIfGivenUp(givenUp: AbortSignal): void {
  if (givenUp.aborted) throw new KindleSyncStuckError();
}

/**
 * Books in a row Amazon answers with a server error (5xx) before the sync
 * takes Amazon as down and stops, rather than ask for every other book.
 */
export const KINDLE_MAX_SERVER_ERRORS_IN_A_ROW = 3;

/** Why one book was not read: nothing of it is written, and the sync goes on to the next. */
type BookProblem =
  | { readonly kind: 'unrecognised'; readonly reason: string }
  | { readonly kind: 'unavailable'; readonly message: string; readonly serverError: boolean };

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
const unavailable = (status: number): BookRead => ({
  problem: { kind: 'unavailable', message: amazonAnswered(status), serverError: status >= 500 },
});

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
      case 'rate_limited':
      case 'unsupported_store':
        return { stop: reading };
      case 'unrecognised':
        return unrecognised(reading.reason);
      case 'unavailable':
        return unavailable(reading.status);
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

interface SyncRun extends KindleSyncPorts {
  readonly givenUp: AbortSignal;
}

/** Writes the book's highlights the sink has not recorded; how that went. */
async function writeBook(
  ports: SyncRun,
  book: KindleBook,
  highlights: readonly KindleHighlight[],
): Promise<KindleBookOutcome> {
  const named = { asin: book.asin, title: book.title };
  const notWritten = (error: unknown): KindleBookOutcome => ({
    ...named,
    kind: 'not_written',
    message: error instanceof Error ? error.message : String(error),
  });
  let fresh: readonly KindleHighlight[];
  try {
    fresh = newKindleHighlights(highlights, await ports.sink.recordedKeys(book));
  } catch (error) {
    return notWritten(error);
  }
  if (fresh.length > 0) {
    // Read before a give-up, the note may be written since by the sync that waited on this one.
    stopIfGivenUp(ports.givenUp);
    try {
      await ports.sink.addHighlights({ book, highlights: fresh, syncedAt: ports.clock.now() });
    } catch (error) {
      return notWritten(error);
    }
  }
  return { ...named, kind: 'added', added: fresh.length };
}

/** A book done, and whether Amazon answered it with a server error. */
interface BookDone {
  readonly outcome: KindleBookOutcome;
  readonly serverError: boolean;
}

/** One book: read whole, then written; or why the sync stops. */
async function syncBook(
  ports: SyncRun,
  fetchPage: FetchPage,
  book: KindleBook,
): Promise<BookDone | { readonly stop: KindleStopReason } | { readonly lost: string }> {
  const read = await readBook(ports.source, fetchPage, book);
  if ('highlights' in read) {
    return { outcome: await writeBook(ports, book, read.highlights), serverError: false };
  }
  if ('stop' in read || 'lost' in read) return read;
  const named = { asin: book.asin, title: book.title };
  if (read.problem.kind === 'unrecognised') {
    return { outcome: { ...named, ...read.problem }, serverError: false };
  }
  const { message, serverError } = read.problem;
  return { outcome: { ...named, kind: 'unavailable', message }, serverError };
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
    case 'rate_limited':
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

async function run(ports: SyncRun): Promise<KindleSyncReport> {
  const fetchPage = paced(pacer(ports), ports.givenUp);
  const library = await readLibrary(ports.source, fetchPage);
  if ('ended' in library) return library.ended;
  const outcomes: KindleBookOutcome[] = [];
  let serverErrors = 0;
  for (const book of library.books) {
    const done = await syncBook(ports, fetchPage, book);
    if ('stop' in done) return stopped(done.stop, outcomes);
    if ('lost' in done) return lostAmazon(done.lost, outcomes);
    outcomes.push(done.outcome);
    serverErrors = done.serverError ? serverErrors + 1 : 0;
    if (serverErrors === KINDLE_MAX_SERVER_ERRORS_IN_A_ROW && done.outcome.kind === 'unavailable') {
      return lostAmazon(done.outcome.message, outcomes);
    }
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
 * answers), reported as failed to the call that joined, and given up on: it
 * fetches and writes nothing more, and the next call runs once it has settled.
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
  /** Aborted when a join gives the sync up; the sync stops at its next fetch or write. */
  readonly giveUp: AbortController;
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
 * after the running sync started; then it gives that sync up and fails with
 * {@link KindleSyncStuckError}, as does the sync's own call when it next
 * would fetch or write (one with nothing left to do reports what it did). The slot is held
 * until the given-up sync settles, never freed while it may still write: a
 * call made meanwhile runs after it has (or joins the one that will), within
 * a deadline of its own.
 */
export function createKindleSync({ deadline }: KindleSyncOptions): KindleSync {
  let inFlight: InFlight | null = null;

  /** Takes the slot for a sync of `ports`, run once `before` (a given-up sync) has settled. */
  function start(ports: KindleSyncPorts, before: InFlight | null): InFlight {
    const giveUp = new AbortController();
    const go = () => run({ ...ports, givenUp: giveUp.signal });
    // The given-up sync's own call has its failure; here it only has to have ended.
    const after = before?.report.then(go, go);
    const slot: InFlight = {
      startedAt: ports.clock.now(),
      giveUp,
      report: (after ?? go()).finally(() => {
        if (inFlight === slot) inFlight = null;
      }),
    };
    inFlight = slot;
    return slot;
  }

  async function join(slot: InFlight, now: number): Promise<KindleSyncReport> {
    const left = deadlineLeft(slot, now);
    const passed = left === 0 ? Promise.resolve() : deadline.wait(left);
    const settled = await Promise.race([
      slot.report.then((report) => ({ report })),
      passed.then(() => null),
    ]);
    if (settled !== null) return settled.report;
    slot.giveUp.abort();
    throw new KindleSyncStuckError();
  }

  return (ports) => {
    const running = inFlight;
    if (running === null) return start(ports, null).report;
    if (!running.giveUp.signal.aborted) return join(running, ports.clock.now());
    return join(start(ports, running), ports.clock.now());
  };
}
