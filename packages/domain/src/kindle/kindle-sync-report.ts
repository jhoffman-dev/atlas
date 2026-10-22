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

export type KindleSyncReport =
  | { readonly kind: 'sign_in_required' }
  /** The library, or every book in it, is not the shape the parser knows. */
  | { readonly kind: 'unrecognised'; readonly reason: string }
  /** The library could not be fetched. */
  | { readonly kind: 'unavailable'; readonly message: string }
  | {
      readonly kind: 'synced';
      readonly books: readonly KindleBookOutcome[];
      /** New highlights written, across every book. */
      readonly added: number;
    };

export const KINDLE_SIGN_IN_MESSAGE = 'Kindle sync needs you to sign in again.';
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

/** The sync in the person's words, and whether it needs them to do something. */
export function describeKindleSync(report: KindleSyncReport): {
  readonly message: string;
  readonly ok: boolean;
} {
  switch (report.kind) {
    case 'sign_in_required':
      return { message: KINDLE_SIGN_IN_MESSAGE, ok: false };
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
