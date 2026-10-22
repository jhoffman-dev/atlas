/**
 * Kindle books and highlights as DFAI holds them, read from Amazon's Kindle
 * notebook page (`read.amazon.com/notebook`, #508). Plain values: what a
 * source note (#503) is written from.
 */

/** A book in the notebook's library: one that has highlights or notes. */
export interface KindleBook {
  /** Amazon's id for the book, as the notebook names it. */
  readonly asin: string;
  readonly title: string;
  /** As the library shows it, without its "By:"; null when it shows none. */
  readonly author: string | null;
  /** An https address of the cover picture; null when there is none. */
  readonly coverUrl: string | null;
}

export const KINDLE_HIGHLIGHT_COLOURS = ['yellow', 'blue', 'pink', 'orange'] as const;
export type KindleHighlightColour = (typeof KINDLE_HIGHLIGHT_COLOURS)[number];

/**
 * How the passage was marked: a coloured highlight, an underline (Kindle
 * Scribe), or a typed note: either at a place with no passage marked, or on
 * a passage, where it is an entry of its own (see `commentOn`).
 */
export type KindleHighlightStyle = 'highlight' | 'underline' | 'note';

/**
 * Who a highlight is, across syncs: Amazon's annotation id when the page has
 * one, else the book, the location and a hash of the words (#508). A typed
 * note on a passage is keyed on the passage's key and a hash of the note. A
 * string so that a sink can keep it as it is.
 */
export type KindleHighlightKey = string & { readonly __brand: 'KindleHighlightKey' };

export interface KindleHighlight {
  readonly key: KindleHighlightKey;
  /** The book's ASIN. */
  readonly asin: string;
  /** Amazon's annotation id, when the page gave a usable one. */
  readonly annotationId: string | null;
  readonly style: KindleHighlightStyle;
  /** The highlight's colour; null for an underline, a note, or a colour the page does not name. */
  readonly colour: KindleHighlightColour | null;
  /** The passage, as the notebook shows it; empty for a note with no passage. */
  readonly quote: string;
  /**
   * What was typed: the words of a note entry, null on a passage. A note
   * typed on a passage is not on the passage's entry but an entry of its own
   * (`commentOn`), so that one typed or edited after the passage was synced
   * still arrives, and what the note already holds is never rewritten.
   */
  readonly note: string | null;
  /** The Kindle location; null when the page gives none. */
  readonly location: number | null;
  /** The printed page, as the page writes it ("12", "xiv"); null when it gives none. */
  readonly page: string | null;
  /**
   * For a note typed on a passage: the key of that passage, after which the
   * note is added as a follow-up comment. Null for a passage and for a note
   * at a place with no passage.
   */
  readonly commentOn: KindleHighlightKey | null;
}

/** Where the next page of a book's annotations starts, as the notebook says. */
export interface KindlePageCursor {
  readonly token: string;
  readonly contentLimitState: string;
}

/** One page as the host fetched it: the HTML, raw, and where a redirect pointed off the notebook. */
export interface KindleRawPage {
  readonly status: number;
  readonly html: string;
  /** A redirect's target that is not a notebook page, as origin + path only; null when none. */
  readonly redirectedTo: string | null;
}

/** Why a page could not be read: different things to tell the person. */
export type KindlePageProblem =
  | { readonly kind: 'sign_in_required' }
  /** Amazon is asking the person to prove they are one. Not a sign-in, and retrying makes it worse. */
  | { readonly kind: 'robot_check' }
  /** Amazon sent the notebook to another store's (`read.amazon.co.uk`), which DFAI does not read. */
  | { readonly kind: 'unsupported_store'; readonly store: string }
  /** The page is not the shape this parser knows: Amazon changed it, or sent something else. */
  | { readonly kind: 'unrecognised'; readonly reason: string }
  /** Amazon answered with an error status. */
  | { readonly kind: 'unavailable'; readonly status: number };

export type KindleLibraryReading =
  { readonly kind: 'library'; readonly books: readonly KindleBook[] } | KindlePageProblem;

export type KindleAnnotationsReading =
  | {
      readonly kind: 'annotations';
      readonly highlights: readonly KindleHighlight[];
      /** The next page; null on the last. */
      readonly next: KindlePageCursor | null;
    }
  | KindlePageProblem;
