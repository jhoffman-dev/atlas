import { describe, expect, it } from 'vitest';
import type { KindleBook, KindleRawPage } from '@dfai/domain';
import {
  fakeKindleDelay,
  fakeKindleNotebook,
  fakeKindleSink,
  heldKindleDelay,
  kindlePage,
} from '../testing/fake-kindle.ts';
import type { KindleHighlightSink } from './ports.ts';
import {
  createKindleSync,
  KINDLE_SYNC_JOIN_DEADLINE_MS,
  KindleSyncStuckError,
} from './sync-kindle.ts';

/*
 * One sync at a time per app (ADR-0044): the in-flight slot belongs to the
 * factory, and a call that joins a sync gives up on it after a deadline. The
 * books are invented; no real time passes.
 */

const NOW = Date.UTC(2026, 9, 21, 9, 0);
const MINUTE = 60 * 1000;
const clock = { now: () => NOW };
const delay = fakeKindleDelay();
/** The one vault these calls write into: a call for it joins the sync running for it. */
const VAULT = '/Users/mara/Vault';

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

/** A library whose fetch answers when the test says: a sync held on its first fetch. */
function heldLibrary(asins: readonly string[] = []) {
  let answer: () => void = () => {};
  const source = fakeKindleNotebook({ library: libraryOf(...asins) });
  const held = {
    ...source,
    fetchLibrary: () =>
      new Promise<KindleRawPage>((resolve) => {
        answer = () => resolve(source.fetchLibrary());
      }),
  };
  return { source: held, calls: source.calls, answer: () => answer() };
}

/** A notebook whose library never comes back: a sync stuck on its first fetch. */
const stuckNotebook = () => ({
  fetchLibrary: () => new Promise<KindleRawPage>(() => {}),
  fetchAnnotations: () => new Promise<KindleRawPage>(() => {}),
});

describe('createKindleSync: one sync in flight per factory', () => {
  it('joins a call to the sync already running for the same vault, whatever sink it names', async () => {
    const syncKindle = createKindleSync({ deadline: heldKindleDelay() });
    const source = fakeKindleNotebook({ library: libraryOf() });
    const other = fakeKindleNotebook({ library: libraryOf() });
    const [first, second] = await Promise.all([
      syncKindle({ source, sink: fakeKindleSink(), vault: VAULT, clock, delay }),
      syncKindle({ source: other, sink: fakeKindleSink(), vault: VAULT, clock, delay }),
    ]);
    expect(second).toBe(first);
    expect(other.calls).toEqual([]);
  });

  it('joins a call that names the sink of the sync running, when neither names a vault', async () => {
    const syncKindle = createKindleSync({ deadline: heldKindleDelay() });
    const sink = fakeKindleSink();
    const [first, second] = await Promise.all([
      syncKindle({ source: fakeKindleNotebook({ library: libraryOf() }), sink, clock, delay }),
      syncKindle({ source: fakeKindleNotebook({ library: libraryOf() }), sink, clock, delay }),
    ]);
    expect(second).toBe(first);
  });

  it('runs a call for another vault after the sync running, with its own report', async () => {
    const syncKindle = createKindleSync({ deadline: heldKindleDelay() });
    const first = fakeKindleNotebook({ library: libraryOf() });
    const second = fakeKindleNotebook({ library: libraryOf() });
    const [one, two] = await Promise.all([
      syncKindle({ source: first, sink: fakeKindleSink(), vault: '/Vault A', clock, delay }),
      syncKindle({ source: second, sink: fakeKindleSink(), vault: '/Vault B', clock, delay }),
    ]);
    expect(two).not.toBe(one);
    expect([first.calls.length, second.calls.length]).toEqual([1, 1]);
  });

  it('never runs the syncs of two vaults beside each other', async () => {
    const syncKindle = createKindleSync({ deadline: heldKindleDelay() });
    const order: string[] = [];
    const notebook = (name: string) => {
      const source = fakeKindleNotebook({ library: libraryOf() });
      return {
        ...source,
        fetchLibrary: async () => {
          order.push(`${name} starts`);
          await Promise.resolve();
          await Promise.resolve();
          order.push(`${name} ends`);
          return source.fetchLibrary();
        },
      };
    };
    await Promise.all([
      syncKindle({ source: notebook('A'), sink: fakeKindleSink(), vault: '/A', clock, delay }),
      syncKindle({ source: notebook('B'), sink: fakeKindleSink(), vault: '/B', clock, delay }),
    ]);
    expect(order).toEqual(['A starts', 'A ends', 'B starts', 'B ends']);
  });

  it('lets two factories run their syncs side by side', async () => {
    const source = () => fakeKindleNotebook({ library: libraryOf() });
    const [one, two] = [source(), source()];
    await Promise.all([
      createKindleSync({ deadline: heldKindleDelay() })({
        source: one,
        sink: fakeKindleSink(),
        vault: VAULT,
        clock,
        delay,
      }),
      createKindleSync({ deadline: heldKindleDelay() })({
        source: two,
        sink: fakeKindleSink(),
        vault: VAULT,
        clock,
        delay,
      }),
    ]);
    expect([one.calls.length, two.calls.length]).toEqual([1, 1]);
  });
});

describe('createKindleSync: a join gives up on a stuck sync at the deadline', () => {
  it('waits out what is left of the deadline, then reports the stuck sync failed and gives it up', async () => {
    const deadline = heldKindleDelay();
    const syncKindle = createKindleSync({ deadline });
    const sink = fakeKindleSink();
    const stuck = heldLibrary(['B0EXAMPLE1']);
    const given = syncKindle({ source: stuck.source, sink, clock, delay });
    const later = { now: () => NOW + 4 * MINUTE };
    const joined = syncKindle({ source: stuckNotebook(), sink, clock: later, delay });
    expect(deadline.waits).toEqual([KINDLE_SYNC_JOIN_DEADLINE_MS - 4 * MINUTE]);
    deadline.elapse();
    await expect(joined).rejects.toBeInstanceOf(KindleSyncStuckError);
    // The sync given up on fetches nothing more once its fetch comes back, and says it was given up.
    stuck.answer();
    await expect(given).rejects.toBeInstanceOf(KindleSyncStuckError);
    expect(stuck.calls).toEqual([{ call: 'library' }]);
    // Settled, it leaves the slot to the next call, which runs afresh.
    const fresh = fakeKindleNotebook({ library: libraryOf() });
    expect(await syncKindle({ source: fresh, sink, clock: later, delay })).toMatchObject({
      kind: 'synced',
    });
    expect(fresh.calls).toEqual([{ call: 'library' }]);
  });

  it('runs a call made while a given-up sync winds down after it has settled, never beside it', async () => {
    const deadline = heldKindleDelay();
    const syncKindle = createKindleSync({ deadline });
    const stuck = heldLibrary(['B0EXAMPLE1']);
    const given = syncKindle({
      source: stuck.source,
      sink: fakeKindleSink(),
      vault: VAULT,
      clock,
      delay,
    });
    const past = { now: () => NOW + KINDLE_SYNC_JOIN_DEADLINE_MS + 1 };
    await expect(
      syncKindle({
        source: stuckNotebook(),
        sink: fakeKindleSink(),
        vault: VAULT,
        clock: past,
        delay,
      }),
    ).rejects.toBeInstanceOf(KindleSyncStuckError);
    const next = fakeKindleNotebook({ library: libraryOf() });
    const after = syncKindle({
      source: next,
      sink: fakeKindleSink(),
      vault: VAULT,
      clock: past,
      delay,
    });
    // Another call meanwhile joins the one waiting to run, rather than queue one more.
    const other = fakeKindleNotebook({ library: libraryOf() });
    const joined = syncKindle({
      source: other,
      sink: fakeKindleSink(),
      vault: VAULT,
      clock: past,
      delay,
    });
    await new Promise((settle) => setImmediate(settle));
    expect(next.calls).toEqual([]);
    stuck.answer();
    await expect(given).rejects.toBeInstanceOf(KindleSyncStuckError);
    expect(await after).toMatchObject({ kind: 'synced' });
    expect(await joined).toBe(await after);
    expect([next.calls, other.calls]).toEqual([[{ call: 'library' }], []]);
  });

  it('stops a given-up sync before it writes, failing its own call, before the next run starts', async () => {
    const deadline = heldKindleDelay();
    const syncKindle = createKindleSync({ deadline });
    const sink = fakeKindleSink();
    let readNote: () => void = () => {};
    const slowSink: KindleHighlightSink = {
      ...sink,
      recordedKeys: async (book: KindleBook) => {
        await new Promise<void>((resolve) => {
          readNote = resolve;
        });
        return sink.recordedKeys(book);
      },
    };
    const source = fakeKindleNotebook({
      library: libraryOf('B0EXAMPLE1'),
      books: {
        B0EXAMPLE1: [bookPage('B0EXAMPLE1', highlightRow('IDGIVENUP001', 'Call me Ishmael.'))],
      },
    });
    const given = syncKindle({ source, sink: slowSink, vault: VAULT, clock, delay });
    given.catch(() => {});
    // Let it reach reading the note, past its last fetch: only the check before writing is left.
    await new Promise((settle) => setImmediate(settle));
    const past = { now: () => NOW + KINDLE_SYNC_JOIN_DEADLINE_MS + 1 };
    await expect(
      syncKindle({ source: stuckNotebook(), sink, vault: VAULT, clock: past, delay }),
    ).rejects.toBeInstanceOf(KindleSyncStuckError);
    const idle = fakeKindleNotebook({ library: libraryOf() });
    let writesWhenNextStarted = -1;
    const next = {
      ...idle,
      fetchLibrary: () => {
        writesWhenNextStarted = sink.writes.length;
        return idle.fetchLibrary();
      },
    };
    const after = syncKindle({ source: next, sink, vault: VAULT, clock: past, delay });
    readNote();
    await expect(given).rejects.toBeInstanceOf(KindleSyncStuckError);
    expect(sink.writes).toEqual([]);
    expect(await after).toMatchObject({ kind: 'synced' });
    expect(writesWhenNextStarted).toBe(0);
  });

  it('gives up on a call waiting for a given-up sync that never settles, at its own deadline', async () => {
    const deadline = heldKindleDelay();
    const syncKindle = createKindleSync({ deadline });
    void syncKindle({
      source: stuckNotebook(),
      sink: fakeKindleSink(),
      vault: VAULT,
      clock,
      delay,
    }).catch(
      // Never settles here: its fetch never comes back. The catch only keeps the test tidy.
      () => {},
    );
    const past = { now: () => NOW + KINDLE_SYNC_JOIN_DEADLINE_MS + 1 };
    await expect(
      syncKindle({
        source: stuckNotebook(),
        sink: fakeKindleSink(),
        vault: VAULT,
        clock: past,
        delay,
      }),
    ).rejects.toBeInstanceOf(KindleSyncStuckError);
    const next = fakeKindleNotebook({ library: libraryOf() });
    const waiting = syncKindle({
      source: next,
      sink: fakeKindleSink(),
      vault: VAULT,
      clock: past,
      delay,
    });
    expect(deadline.waits).toEqual([KINDLE_SYNC_JOIN_DEADLINE_MS]);
    deadline.elapse();
    await expect(waiting).rejects.toBeInstanceOf(KindleSyncStuckError);
    expect(next.calls).toEqual([]);
  });

  it('is ten minutes', () => {
    expect(KINDLE_SYNC_JOIN_DEADLINE_MS).toBe(10 * MINUTE);
  });

  it('gives up at once on a sync the clock says has run past the deadline', async () => {
    const deadline = heldKindleDelay();
    const syncKindle = createKindleSync({ deadline });
    void syncKindle({
      source: stuckNotebook(),
      sink: fakeKindleSink(),
      vault: VAULT,
      clock,
      delay,
    });
    const past = { now: () => NOW + KINDLE_SYNC_JOIN_DEADLINE_MS + 1 };
    await expect(
      syncKindle({
        source: stuckNotebook(),
        sink: fakeKindleSink(),
        vault: VAULT,
        clock: past,
        delay,
      }),
    ).rejects.toBeInstanceOf(KindleSyncStuckError);
    expect(deadline.waits).toEqual([]);
  });

  it('never waits longer than the deadline when the clock is set back', () => {
    const deadline = heldKindleDelay();
    const syncKindle = createKindleSync({ deadline });
    void syncKindle({
      source: stuckNotebook(),
      sink: fakeKindleSink(),
      vault: VAULT,
      clock,
      delay,
    });
    const back = { now: () => NOW - 60 * MINUTE };
    void syncKindle({
      source: stuckNotebook(),
      sink: fakeKindleSink(),
      vault: VAULT,
      clock: back,
      delay,
    }).catch(
      // Never settles here: the deadline is not elapsed. The catch only keeps the test tidy.
      () => {},
    );
    expect(deadline.waits).toEqual([KINDLE_SYNC_JOIN_DEADLINE_MS]);
  });

  it('hands a join the report when the sync finishes before the deadline', async () => {
    const deadline = heldKindleDelay();
    const syncKindle = createKindleSync({ deadline });
    const source = fakeKindleNotebook({ library: libraryOf() });
    const first = syncKindle({ source, sink: fakeKindleSink(), vault: VAULT, clock, delay });
    const joined = syncKindle({ source, sink: fakeKindleSink(), vault: VAULT, clock, delay });
    expect(await joined).toBe(await first);
    deadline.elapse();
    // The deadline passing afterwards frees nothing: the next call runs its own sync.
    const next = fakeKindleNotebook({ library: libraryOf() });
    await syncKindle({ source: next, sink: fakeKindleSink(), vault: VAULT, clock, delay });
    expect(next.calls).toEqual([{ call: 'library' }]);
  });

  it('keeps the slot of the sync after a stuck one when the stuck one ends late', async () => {
    const deadline = heldKindleDelay();
    const syncKindle = createKindleSync({ deadline });
    let finishStuck: (page: KindleRawPage) => void = () => {};
    const slow = {
      fetchLibrary: () =>
        new Promise<KindleRawPage>((resolve) => {
          finishStuck = resolve;
        }),
      fetchAnnotations: () => new Promise<KindleRawPage>(() => {}),
    };
    const stuck = syncKindle({ source: slow, sink: fakeKindleSink(), vault: VAULT, clock, delay });
    const joined = syncKindle({
      source: stuckNotebook(),
      sink: fakeKindleSink(),
      vault: VAULT,
      clock,
      delay,
    });
    deadline.elapse();
    await expect(joined).rejects.toBeInstanceOf(KindleSyncStuckError);
    void syncKindle({
      source: stuckNotebook(),
      sink: fakeKindleSink(),
      vault: VAULT,
      clock,
      delay,
    });
    finishStuck(libraryOf());
    await stuck;
    const meanwhile = fakeKindleNotebook({ library: libraryOf() });
    void syncKindle({
      source: meanwhile,
      sink: fakeKindleSink(),
      vault: VAULT,
      clock,
      delay,
    }).catch(
      // Joins the sync still in flight, which never settles here.
      () => {},
    );
    expect(meanwhile.calls).toEqual([]);
  });
});

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

/*
 * Second verification of PR #511 (after the fix round at b4e81c01): the single flight past its
 * join deadline.
 */
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
