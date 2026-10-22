import type { KindleBook, KindleHighlight, KindlePageCursor, KindleRawPage } from '@dfai/domain';
import {
  KindleFetchError,
  type KindleDelay,
  type KindleHighlightSink,
  type KindleWritten,
  type KindleNotebookSource,
} from '../kindle/ports.ts';

/** What the fake notebook answers one request with: a page, or the host failing to bring one. */
export type KindleScriptedAnswer = KindleRawPage | KindleFetchError;

/** The pages of a book, in order: the first request gets the first, and so on; the last repeats. */
export interface FakeKindleNotebookScript {
  readonly library: KindleScriptedAnswer;
  readonly books?: Readonly<Record<string, readonly KindleScriptedAnswer[]>>;
}

/** A request the fake notebook was asked, as a test reads them back. */
export type KindleNotebookCall =
  | { readonly call: 'library' }
  | {
      readonly call: 'annotations';
      readonly asin: string;
      readonly cursor: KindlePageCursor | null;
    };

/** A 200 page of `html`, as the host hands one back. */
export const kindlePage = (html: string): KindleRawPage => ({
  status: 200,
  html,
  redirectedTo: null,
});

function answered(answer: KindleScriptedAnswer | undefined): KindleRawPage {
  if (answer === undefined) throw new KindleFetchError('unreachable', 'nothing scripted');
  if (answer instanceof KindleFetchError) throw answer;
  return answer;
}

/** A Kindle notebook that answers from a script and records what it was asked. */
export function fakeKindleNotebook(script: FakeKindleNotebookScript): KindleNotebookSource & {
  readonly calls: KindleNotebookCall[];
} {
  const calls: KindleNotebookCall[] = [];
  const served = new Map<string, number>();
  return {
    calls,
    fetchLibrary() {
      calls.push({ call: 'library' });
      return Promise.resolve().then(() => answered(script.library));
    },
    fetchAnnotations({ asin, cursor }) {
      calls.push({ call: 'annotations', asin, cursor });
      const pages = script.books?.[asin] ?? [];
      const at = served.get(asin) ?? 0;
      served.set(asin, at + 1);
      return Promise.resolve().then(() => answered(pages[Math.min(at, pages.length - 1)]));
    },
  };
}

/** One write the fake sink took. */
export interface KindleSinkWrite {
  readonly book: KindleBook;
  readonly highlights: readonly KindleHighlight[];
  readonly syncedAt: number;
}

/**
 * Stands in for the source notes #503 will write: keeps each book's
 * recorded keys in memory, and can be told to fail a book's write.
 */
export function fakeKindleSink(
  options: {
    readonly recorded?: Readonly<Record<string, readonly string[]>>;
    readonly failWrite?: ReadonlySet<string>;
    readonly failRead?: ReadonlySet<string>;
    /** What a write says it wrote and could not place, by book; by default all of it, placed. */
    readonly answers?: Readonly<Record<string, KindleWritten>>;
  } = {},
): KindleHighlightSink & {
  readonly writes: KindleSinkWrite[];
  readonly recorded: Map<string, Set<string>>;
  /** How many syncs began. */
  readonly began: { count: number };
} {
  const recorded = new Map<string, Set<string>>(
    Object.entries(options.recorded ?? {}).map(([asin, keys]) => [asin, new Set(keys)]),
  );
  const writes: KindleSinkWrite[] = [];
  const began = { count: 0 };
  return {
    writes,
    recorded,
    began,
    beginSync() {
      began.count += 1;
    },
    recordedKeys(book) {
      if (options.failRead?.has(book.asin)) {
        return Promise.reject(new Error(`cannot read the note of ${book.title}`));
      }
      return Promise.resolve(new Set(recorded.get(book.asin) ?? []));
    },
    addHighlights(write) {
      if (options.failWrite?.has(write.book.asin)) {
        return Promise.reject(new Error(`cannot write the note of ${write.book.title}`));
      }
      writes.push(write);
      const keys = recorded.get(write.book.asin) ?? new Set<string>();
      for (const highlight of write.highlights) keys.add(highlight.key);
      recorded.set(write.book.asin, keys);
      const answer = options.answers?.[write.book.asin];
      return Promise.resolve(answer ?? { written: write.highlights.length, unplaced: [] });
    },
  };
}

/**
 * A delay that does not wait: it records what it was asked for, and lets a
 * test move its clock on by that much, as a real wait would.
 */
export function fakeKindleDelay(
  options: { readonly onWait?: (milliseconds: number) => void } = {},
): KindleDelay & { readonly waits: number[] } {
  const waits: number[] = [];
  return {
    waits,
    wait(milliseconds) {
      waits.push(milliseconds);
      options.onWait?.(milliseconds);
      return Promise.resolve();
    },
  };
}

/**
 * A delay that waits until the test says: each wait is recorded, and all of
 * them end together when `elapse` is called. Stands in for a timer the test
 * moves on by hand, with no real time passing.
 */
export function heldKindleDelay(): KindleDelay & {
  readonly waits: number[];
  elapse(): void;
} {
  const waits: number[] = [];
  const pending: (() => void)[] = [];
  return {
    waits,
    wait(milliseconds) {
      waits.push(milliseconds);
      return new Promise((resolve) => pending.push(resolve));
    },
    elapse() {
      for (const resolve of pending.splice(0)) resolve();
    },
  };
}
