import type { KindlePageCursor } from './kindle-types.ts';

/**
 * The notebook's addresses. The host fetches only under this one (it pins
 * the origin and path itself, ADR-0017's rule that where a session may go
 * is the host's to enforce); which page to ask for is decided here.
 */
export const KINDLE_NOTEBOOK_URL = 'https://read.amazon.com/notebook';

/**
 * A sync reads at most this many pages of one book. Amazon's pages hold
 * about a hundred annotations each; past this, the token is going round in
 * a circle and the book is refused rather than read for ever.
 */
export const KINDLE_MAX_PAGES_PER_BOOK = 200;

export function kindleLibraryUrl(): string {
  return KINDLE_NOTEBOOK_URL;
}

/** A page of the book `asin`'s annotations: its first, or the one `cursor` says starts next. */
export function kindleAnnotationsUrl(asin: string, cursor: KindlePageCursor | null): string {
  const query = new URLSearchParams({
    asin,
    contentLimitState: cursor?.contentLimitState ?? '',
    token: cursor?.token ?? '',
  });
  return `${KINDLE_NOTEBOOK_URL}?${query.toString()}`;
}
