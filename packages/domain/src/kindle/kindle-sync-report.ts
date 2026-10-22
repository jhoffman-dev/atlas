/**
 * What a Kindle sync did, and how it is told (#508): plainly, and never as
 * a success when it was not one.
 */

interface BookNamed {
  readonly asin: string;
  readonly title: string;
}

export type KindleBookOutcome =
  /**
   * Read whole and written; `added` is how many entries the note took, and
   * `unplaced` where each highlight the note could not hold was (`page xiv`):
   * skipped, and tried again by the next sync.
   */
  | (BookNamed & {
      readonly kind: 'added';
      readonly added: number;
      readonly unplaced: readonly string[];
    })
  /** A page of it was not the shape the parser knows: nothing of it was written. */
  | (BookNamed & { readonly kind: 'unrecognised'; readonly reason: string })
  /** Amazon could not be reached for it, or answered with an error: nothing of it was written. */
  | (BookNamed & { readonly kind: 'unavailable'; readonly message: string })
  /** Read whole, but writing it failed. */
  | (BookNamed & { readonly kind: 'not_written'; readonly message: string })
  /**
   * Read whole, and left for the next sync: a pane holds unsaved typing in
   * its note, which a write would go behind. Nothing of it was written.
   */
  | (BookNamed & { readonly kind: 'unsaved_typing' });

/** What a sync that was stopped had done before it stopped: books are never lost to the stop. */
export interface KindleSyncProgress {
  readonly books: readonly KindleBookOutcome[];
  /** New highlights written, across every book. */
  readonly added: number;
}

/** Why a sync stops where it is, rather than go on to the next book. */
export type KindleStopReason =
  | { readonly kind: 'sign_in_required' }
  /** Amazon wants proof the person is one; no automatic sync for a day (`kindle-backoff.ts`). */
  | { readonly kind: 'robot_check' }
  /** Amazon answered 403 or 429, asked too often; no automatic sync for a day (`kindle-backoff.ts`). */
  | { readonly kind: 'rate_limited'; readonly status: number }
  /** There is no Kindle session on this Mac. */
  | { readonly kind: 'not_connected' }
  /** This Mac cannot keep the session apart (macOS before 14); the host's words. */
  | { readonly kind: 'unsupported'; readonly message: string }
  /** Amazon sent the notebook to another store's, which DFAI does not read. */
  | { readonly kind: 'unsupported_store'; readonly store: string };

/** A stopped sync, with what it had done before it stopped. */
export type KindleSyncStop = KindleSyncProgress & KindleStopReason;

export type KindleSyncReport =
  | KindleSyncStop
  /** The library, or every book in it, is not the shape the parser knows. */
  | { readonly kind: 'unrecognised'; readonly reason: string }
  /**
   * Amazon could not be reached, or answered the library with an error. A host
   * that stops answering mid-sync stops it there, with the books done before.
   */
  | ({ readonly kind: 'unavailable'; readonly message: string } & KindleSyncProgress)
  | ({ readonly kind: 'synced' } & KindleSyncProgress);

export const KINDLE_SIGN_IN_MESSAGE = 'Kindle sync needs you to sign in again.';
export const KINDLE_ROBOT_CHECK_MESSAGE =
  'Amazon is asking you to prove you are not a robot. Open Connect Kindle and answer it; Kindle sync will not run on its own for 24 hours.';
export const KINDLE_RATE_LIMITED_MESSAGE =
  'Amazon says Kindle sync is asking too often. Kindle sync will not run on its own for 24 hours.';
export const KINDLE_NOT_CONNECTED_MESSAGE =
  "Kindle isn't connected on this Mac. Connect it in Settings to sync.";
export const KINDLE_UNRECOGNISED_MESSAGE =
  "Couldn't read Amazon's page. Kindle sync is stopped until DFAI can read it again.";

function plural(count: number, one: string): string {
  return `${count} ${one}${count === 1 ? '' : 's'}`;
}

/** The books left for the next sync because their note has unsaved typing, by title. */
function waitingMessage(books: readonly KindleBookOutcome[]): string {
  const waiting = books.filter((book) => book.kind === 'unsaved_typing');
  if (waiting.length === 0) return '';
  const titles = waiting.map((book) => book.title).join(', ');
  return ` Skipped ${titles}: ${waiting.length === 1 ? 'its note has' : 'their notes have'} unsaved typing. Kindle sync adds ${waiting.length === 1 ? 'it' : 'them'} next time.`;
}

/** The highlights the notes could not hold, by where each was; empty when there are none. */
function unplacedMessage(books: readonly KindleBookOutcome[]): string {
  const places = books.flatMap((book) => (book.kind === 'added' ? book.unplaced : []));
  if (places.length === 0) return '';
  return ` ${plural(places.length, 'highlight')} couldn't be placed (${places.join(', ')}).`;
}

function syncedMessage(books: readonly KindleBookOutcome[], added: number): string {
  const missed = books.filter(
    (book) => book.kind !== 'added' && book.kind !== 'unsaved_typing',
  ).length;
  const from = books.filter((book) => book.kind === 'added' && book.added > 0).length;
  const said =
    added === 0
      ? 'Nothing new from Kindle.'
      : `Added ${plural(added, 'highlight')} from ${plural(from, 'book')}.`;
  const couldNot = missed === 0 ? '' : ` Couldn't sync ${plural(missed, 'book')}.`;
  return `${said}${couldNot}${unplacedMessage(books)}${waitingMessage(books)}`;
}

/** What a stopped sync had added before it stopped, in words; empty when it added nothing. */
function beforeStopping({ books, added }: KindleSyncProgress): string {
  if (added === 0) return '';
  const from = books.filter((book) => book.kind === 'added' && book.added > 0).length;
  return ` Before it stopped, ${plural(added, 'highlight')} ${added === 1 ? 'was' : 'were'} added from ${plural(from, 'book')}.`;
}

function stoppedMessage(report: KindleSyncStop): string {
  switch (report.kind) {
    case 'sign_in_required':
      return KINDLE_SIGN_IN_MESSAGE;
    case 'robot_check':
      return KINDLE_ROBOT_CHECK_MESSAGE;
    case 'rate_limited':
      return KINDLE_RATE_LIMITED_MESSAGE;
    case 'not_connected':
      return KINDLE_NOT_CONNECTED_MESSAGE;
    case 'unsupported':
      return `Kindle sync can't run on this Mac: ${report.message}.`;
    case 'unsupported_store':
      return `Kindle sync reads read.amazon.com only, and Amazon sent the notebook to ${report.store}, which DFAI doesn't read yet.`;
  }
}

/** The sync in the person's words, and whether it needs them to do something. */
export function describeKindleSync(report: KindleSyncReport): {
  readonly message: string;
  readonly ok: boolean;
} {
  switch (report.kind) {
    case 'sign_in_required':
    case 'robot_check':
    case 'rate_limited':
    case 'not_connected':
    case 'unsupported':
    case 'unsupported_store':
      return { message: `${stoppedMessage(report)}${beforeStopping(report)}`, ok: false };
    case 'unrecognised':
      return { message: KINDLE_UNRECOGNISED_MESSAGE, ok: false };
    case 'unavailable':
      return {
        message: `Couldn't reach Amazon's Kindle notebook (${report.message}). Kindle sync will try again later.${beforeStopping(report)}`,
        ok: false,
      };
    case 'synced':
      return {
        message: syncedMessage(report.books, report.added),
        ok: report.books.every((book) => book.kind === 'added'),
      };
  }
}
