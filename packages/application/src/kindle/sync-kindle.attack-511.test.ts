import { describe, expect, it } from 'vitest';
import type { KindleBook } from '@dfai/domain';
import {
  fakeKindleDelay,
  fakeKindleNotebook,
  fakeKindleSink,
  heldKindleDelay,
  kindlePage,
} from '../testing/fake-kindle.ts';
import type { KindleHighlightSink } from './ports.ts';
import {
  KINDLE_MIN_FETCH_GAP_MS,
  KINDLE_SYNC_JOIN_DEADLINE_MS,
  KindleSyncStuckError,
  createKindleSync,
} from './sync-kindle.ts';

/*
 * Second verification of PR #511 (after the fix round at b4e81c01): the single flight past its
 * join deadline, a book Amazon answers "too many requests" for, and the fetch gap when the
 * clock jumps forward. The books are invented; the quotes are public domain. No real time passes.
 */

const NOW = Date.UTC(2026, 9, 22, 9, 0);
const HOUR = 60 * 60 * 1000;
const clock = { now: () => NOW };

const libraryOf = (...asins: string[]) =>
  kindlePage(
    `<div id="kp-notebook-library">${asins
      .map(
        (asin) =>
          `<div id="${asin}" class="kp-notebook-library-each-book"><h2 class="kp-notebook-searchable">Book ${asin}</h2></div>`,
      )
      .join('')}</div>`,
  );

const bookPage = (asin: string, rows: string) =>
  kindlePage(
    `<input id="kp-notebook-annotations-asin" value="${asin}"><div id="kp-notebook-annotations">${rows}</div>`,
  );

const highlightRow = (id: string, quote: string) =>
  `<div id="${id}" class="a-row a-spacing-base"><span id="highlight">${quote}</span></div>`;

/**
 * A sink whose first read of a note is slow (a note on a disk that is busy, say): the read
 * takes what the note held when it was asked, and answers when the test says.
 */
function slowFirstRead(sink: ReturnType<typeof fakeKindleSink>) {
  let release: () => void = () => {};
  let reached: () => void = () => {};
  const asked = new Promise<void>((resolve) => {
    reached = resolve;
  });
  let reads = 0;
  const slow: KindleHighlightSink = {
    recordedKeys(book: KindleBook) {
      reads += 1;
      const held = sink.recordedKeys(book);
      if (reads > 1) return held;
      reached();
      return new Promise((resolve) => {
        release = () => resolve(held);
      });
    },
    addHighlights: (write) => sink.addHighlights(write),
  };
  return { slow, asked, release: () => release() };
}

describe('createKindleSync past its join deadline', () => {
  it('never runs a second sync beside one still running, so nothing is added twice', async () => {
    // A long library (400 books at 1.5 s a fetch is ten minutes) is still running, healthy,
    // when the schedule's sync joins it past the deadline; then the person's ⌘K sync starts.
    const syncKindle = createKindleSync({ deadline: heldKindleDelay() });
    const sink = fakeKindleSink();
    const { slow, asked, release } = slowFirstRead(sink);
    const source = () =>
      fakeKindleNotebook({
        library: libraryOf('B0EXAMPLE1'),
        books: {
          B0EXAMPLE1: [bookPage('B0EXAMPLE1', highlightRow('IDLONGSYNC01', 'Call me Ishmael.'))],
        },
      });
    const running = syncKindle({ source: source(), sink: slow, clock, delay: fakeKindleDelay() });
    await asked;
    const later = { now: () => NOW + KINDLE_SYNC_JOIN_DEADLINE_MS + 60_000 };
    await expect(
      syncKindle({ source: source(), sink: slow, clock: later, delay: fakeKindleDelay() }),
    ).rejects.toBeInstanceOf(KindleSyncStuckError);
    // However a fix has the third call go (run after, join, or refuse), it must not write twice.
    const third = syncKindle({
      source: source(),
      sink: slow,
      clock: later,
      delay: fakeKindleDelay(),
    });
    // Every fake answers at once: one turn of the event loop lets the third call run as far as it can.
    await new Promise((settle) => setImmediate(settle));
    release();
    await Promise.allSettled([running, third]);
    const written = sink.writes.flatMap((write) => write.highlights.map((h) => h.key));
    expect(written).toEqual(['amazon:IDLONGSYNC01']);
  });
});

describe('syncKindle when Amazon says it is asked too often', () => {
  it('stops asking for books after a 429, rather than asking for every other one', async () => {
    const asins = ['B0EXAMPLE1', 'B0EXAMPLE2', 'B0EXAMPLE3', 'B0EXAMPLE4', 'B0EXAMPLE5'];
    const tooMany = { status: 429, html: '<p>Too many requests</p>', redirectedTo: null };
    const source = fakeKindleNotebook({
      library: libraryOf(...asins),
      books: Object.fromEntries(asins.map((asin) => [asin, [tooMany]])),
    });
    const syncKindle = createKindleSync({ deadline: heldKindleDelay() });
    await syncKindle({ source, sink: fakeKindleSink(), clock, delay: fakeKindleDelay() });
    const asked = source.calls.filter((call) => call.call === 'annotations').length;
    expect(asked).toBe(1);
  });
});

describe('syncKindle pacing when the clock jumps forward', () => {
  it('still waits the fetch gap between two fetches when the clock is set forward mid-sync', async () => {
    // Readings: the slot's start, then the library fetch ending; after that the Mac's clock is
    // corrected forward an hour, though no time has passed between the two fetches.
    let readings = 0;
    const steppedForward = { now: () => (readings++ < 2 ? NOW : NOW + HOUR) };
    const pacing = fakeKindleDelay();
    const source = fakeKindleNotebook({
      library: libraryOf('B0EXAMPLE1'),
      books: {
        B0EXAMPLE1: [
          bookPage('B0EXAMPLE1', highlightRow('IDCLOCKFWD01', 'Reader, I married him.')),
        ],
      },
    });
    const syncKindle = createKindleSync({ deadline: heldKindleDelay() });
    await syncKindle({ source, sink: fakeKindleSink(), clock: steppedForward, delay: pacing });
    expect(pacing.waits).toEqual([KINDLE_MIN_FETCH_GAP_MS]);
  });
});
