/**
 * What a Kindle sync did, and how it is told (#508): plainly, and never as
 * a success when it was not one.
 */

interface BookNamed {
  readonly asin: string;
  readonly title: string;
}

export type KindleBookOutcome =
  /** Read whole and written; `added` is how many highlights were new. */
  | (BookNamed & { readonly kind: 'added'; readonly added: number })
  /** A page of it was not the shape the parser knows: nothing of it was written. */
  | (BookNamed & { readonly kind: 'unrecognised'; readonly reason: string })
  /** Amazon could not be reached for it, or answered with an error: nothing of it was written. */
  | (BookNamed & { readonly kind: 'unavailable'; readonly message: string })
  /** Read whole, but writing it failed. */
  | (BookNamed & { readonly kind: 'not_written'; readonly message: string });

/** What a sync that was stopped had done before it stopped: books are never lost to the stop. */
export interface KindleSyncProgress {
  readonly books: readonly KindleBookOutcome[];
  /** New highlights written, across every book. */
  readonly added: number;
}

/** The ways a sync stops where it is, each with what it had already done. */
export type KindleSyncStop = KindleSyncProgress &
  (
    | { readonly kind: 'sign_in_required' }
    /** Amazon wants proof the person is one; no automatic sync for a day (`kindle-backoff.ts`). */
    | { readonly kind: 'robot_check' }
    /** There is no Kindle session on this Mac. */
    | { readonly kind: 'not_connected' }
    /** This Mac cannot keep the session apart (macOS before 14); the host's words. */
    | { readonly kind: 'unsupported'; readonly message: string }
    /** Amazon sent the notebook to another store's, which DFAI does not read. */
    | { readonly kind: 'unsupported_store'; readonly store: string }
  );

export type KindleSyncReport =
  | KindleSyncStop
  /** The library, or every book in it, is not the shape the parser knows. */
  | { readonly kind: 'unrecognised'; readonly reason: string }
  /** Amazon could not be reached for the library, or answered it with an error. */
  | { readonly kind: 'unavailable'; readonly message: string }
  | ({ readonly kind: 'synced' } & KindleSyncProgress);

export const KINDLE_SIGN_IN_MESSAGE = 'Kindle sync needs you to sign in again.';
export const KINDLE_ROBOT_CHECK_MESSAGE =
  'Amazon is asking you to prove you are not a robot. Open Connect Kindle and answer it; Kindle sync will not run on its own for 24 hours.';
export const KINDLE_NOT_CONNECTED_MESSAGE =
  "Kindle isn't connected on this Mac. Connect it in Settings to sync.";
export const KINDLE_UNRECOGNISED_MESSAGE =
  "Couldn't read Amazon's page. Kindle sync is stopped until DFAI can read it again.";

function plural(count: number, one: string): string {
  return `${count} ${one}${count === 1 ? '' : 's'}`;
}

function syncedMessage(books: readonly KindleBookOutcome[], added: number): string {
  const missed = books.filter((book) => book.kind !== 'added').length;
  const from = books.filter((book) => book.kind === 'added' && book.added > 0).length;
  const said =
    added === 0
      ? 'Nothing new from Kindle.'
      : `Added ${plural(added, 'highlight')} from ${plural(from, 'book')}.`;
  return missed === 0 ? said : `${said} Couldn't sync ${plural(missed, 'book')}.`;
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
    case 'not_connected':
    case 'unsupported':
    case 'unsupported_store':
      return { message: `${stoppedMessage(report)}${beforeStopping(report)}`, ok: false };
    case 'unrecognised':
      return { message: KINDLE_UNRECOGNISED_MESSAGE, ok: false };
    case 'unavailable':
      return {
        message: `Couldn't reach Amazon's Kindle notebook (${report.message}). Kindle sync will try again later.`,
        ok: false,
      };
    case 'synced':
      return {
        message: syncedMessage(report.books, report.added),
        ok: report.books.every((book) => book.kind === 'added'),
      };
  }
}
