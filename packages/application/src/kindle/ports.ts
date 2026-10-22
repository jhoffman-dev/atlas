import type { KindleBook, KindleHighlight, KindlePageCursor, KindleRawPage } from '@dfai/domain';

/** Why the host could not bring a notebook page back at all. */
export const KINDLE_FETCH_FAILURE_KINDS = [
  /** No Kindle session on this Mac: Connect Kindle was never done, or was undone. */
  'not_connected',
  /** This Mac cannot keep a Kindle session apart from the rest of DFAI: macOS before 14, or not a Mac. */
  'unsupported',
  /** The host would not fetch it: an address off the notebook, or the host out of reach. */
  'refused',
  'unreachable',
  'timeout',
  /** The page is larger than the host will read. */
  'too_large',
  /** The host answered in a shape DFAI cannot read. */
  'malformed',
] as const;

export type KindleFetchFailureKind = (typeof KINDLE_FETCH_FAILURE_KINDS)[number];

export function isKindleFetchFailureKind(value: unknown): value is KindleFetchFailureKind {
  return (KINDLE_FETCH_FAILURE_KINDS as readonly unknown[]).includes(value);
}

export class KindleFetchError extends Error {
  readonly kind: KindleFetchFailureKind;

  constructor(kind: KindleFetchFailureKind, message: string) {
    super(message);
    this.name = 'KindleFetchError';
    this.kind = kind;
  }
}

/**
 * Amazon's Kindle notebook, through the host (#508). The host holds the
 * Amazon session in a webview data store of its own and answers with the
 * page's HTML, raw, never a cookie; what the page means is the domain's.
 * A failure to bring any page back is a {@link KindleFetchError}; an answer
 * of any status is a page.
 */
export interface KindleNotebookSource {
  /** The library: the books with highlights or notes. */
  fetchLibrary(): Promise<KindleRawPage>;
  /** A page of one book's annotations: the first, or the one `cursor` starts. */
  fetchAnnotations(args: {
    readonly asin: string;
    readonly cursor: KindlePageCursor | null;
  }): Promise<KindleRawPage>;
}

/**
 * Where a book's highlights are kept: its source note (#503 writes the
 * format; this is the seam it implements — a highlight maps to #503's
 * `NewHighlight`: `quote`, `style`, `note` as its comment, and a `kindle`
 * anchor of `location` and `annotationId`; the ASIN stays on the book until
 * source notes have a field for it). The sink is told only highlights
 * it has not recorded, and only once a book has been read whole, so it never
 * holds part of a page; it adds them after what is there and never rewrites
 * or removes what it already holds (ADR-0003, #508). A note typed on a passage
 * arrives as its own entry (`style: 'note'`, `commentOn` the passage's key):
 * a follow-up comment on the passage's entry, which may have been synced long
 * before.
 */
export interface KindleHighlightSink {
  /** The keys of the book's highlights already recorded; empty when the book has no note yet. */
  recordedKeys(book: KindleBook): Promise<ReadonlySet<string>>;
  /**
   * Adds `highlights` to the book's note, making the note when there is none.
   * All or nothing: a failure leaves the note as it was.
   */
  addHighlights(args: {
    readonly book: KindleBook;
    readonly highlights: readonly KindleHighlight[];
    /** When the sync ran, by the injected clock. */
    readonly syncedAt: number;
  }): Promise<void>;
}

/**
 * Waiting, as a port so that a sync's pacing is tested without sleeping and
 * the app can wait however it likes. Resolves after about `milliseconds`.
 */
export interface KindleDelay {
  wait(milliseconds: number): Promise<void>;
}

/**
 * The Amazon session itself, through the host. Connecting opens DFAI's own
 * sign-in window on Amazon, in the session's own data store; it resolves
 * when the person closes the window, whether or not they signed in — the
 * next sync is what finds out. Disconnecting deletes the data store.
 */
export interface KindleSession {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
}
