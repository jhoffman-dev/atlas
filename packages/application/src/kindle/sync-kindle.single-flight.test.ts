import { describe, expect, it } from 'vitest';
import type { KindleRawPage } from '@dfai/domain';
import {
  fakeKindleDelay,
  fakeKindleNotebook,
  fakeKindleSink,
  heldKindleDelay,
  kindlePage,
} from '../testing/fake-kindle.ts';
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

const libraryOf = (...asins: string[]) =>
  kindlePage(
    `<div id="kp-notebook-library">${asins
      .map(
        (asin) =>
          `<div id="${asin}" class="kp-notebook-library-each-book"><h2 class="kp-notebook-searchable">Book ${asin}</h2></div>`,
      )
      .join('')}</div>`,
  );

/** A notebook whose library never comes back: a sync stuck on its first fetch. */
const stuckNotebook = () => ({
  fetchLibrary: () => new Promise<KindleRawPage>(() => {}),
  fetchAnnotations: () => new Promise<KindleRawPage>(() => {}),
});

describe('createKindleSync: one sync in flight per factory', () => {
  it('joins a call to the sync already running, whatever sink it names', async () => {
    const syncKindle = createKindleSync({ deadline: heldKindleDelay() });
    const source = fakeKindleNotebook({ library: libraryOf() });
    const other = fakeKindleNotebook({ library: libraryOf() });
    const [first, second] = await Promise.all([
      syncKindle({ source, sink: fakeKindleSink(), clock, delay }),
      syncKindle({ source: other, sink: fakeKindleSink(), clock, delay }),
    ]);
    expect(second).toBe(first);
    expect(other.calls).toEqual([]);
  });

  it('lets two factories run their syncs side by side', async () => {
    const source = () => fakeKindleNotebook({ library: libraryOf() });
    const [one, two] = [source(), source()];
    await Promise.all([
      createKindleSync({ deadline: heldKindleDelay() })({
        source: one,
        sink: fakeKindleSink(),
        clock,
        delay,
      }),
      createKindleSync({ deadline: heldKindleDelay() })({
        source: two,
        sink: fakeKindleSink(),
        clock,
        delay,
      }),
    ]);
    expect([one.calls.length, two.calls.length]).toEqual([1, 1]);
  });
});

describe('createKindleSync: a join gives up on a stuck sync at the deadline', () => {
  it('waits out what is left of the deadline, then reports the stuck sync failed and frees the slot', async () => {
    const deadline = heldKindleDelay();
    const syncKindle = createKindleSync({ deadline });
    const sink = fakeKindleSink();
    void syncKindle({ source: stuckNotebook(), sink, clock, delay });
    const later = { now: () => NOW + 4 * MINUTE };
    const joined = syncKindle({ source: stuckNotebook(), sink, clock: later, delay });
    expect(deadline.waits).toEqual([KINDLE_SYNC_JOIN_DEADLINE_MS - 4 * MINUTE]);
    deadline.elapse();
    await expect(joined).rejects.toBeInstanceOf(KindleSyncStuckError);
    const fresh = fakeKindleNotebook({ library: libraryOf() });
    expect(await syncKindle({ source: fresh, sink, clock: later, delay })).toMatchObject({
      kind: 'synced',
    });
    expect(fresh.calls).toEqual([{ call: 'library' }]);
  });

  it('is ten minutes', () => {
    expect(KINDLE_SYNC_JOIN_DEADLINE_MS).toBe(10 * MINUTE);
  });

  it('gives up at once on a sync the clock says has run past the deadline', async () => {
    const deadline = heldKindleDelay();
    const syncKindle = createKindleSync({ deadline });
    void syncKindle({ source: stuckNotebook(), sink: fakeKindleSink(), clock, delay });
    const past = { now: () => NOW + KINDLE_SYNC_JOIN_DEADLINE_MS + 1 };
    await expect(
      syncKindle({ source: stuckNotebook(), sink: fakeKindleSink(), clock: past, delay }),
    ).rejects.toBeInstanceOf(KindleSyncStuckError);
    expect(deadline.waits).toEqual([]);
  });

  it('never waits longer than the deadline when the clock is set back', () => {
    const deadline = heldKindleDelay();
    const syncKindle = createKindleSync({ deadline });
    void syncKindle({ source: stuckNotebook(), sink: fakeKindleSink(), clock, delay });
    const back = { now: () => NOW - 60 * MINUTE };
    void syncKindle({ source: stuckNotebook(), sink: fakeKindleSink(), clock: back, delay }).catch(
      // Never settles here: the deadline is not elapsed. The catch only keeps the test tidy.
      () => {},
    );
    expect(deadline.waits).toEqual([KINDLE_SYNC_JOIN_DEADLINE_MS]);
  });

  it('hands a join the report when the sync finishes before the deadline', async () => {
    const deadline = heldKindleDelay();
    const syncKindle = createKindleSync({ deadline });
    const source = fakeKindleNotebook({ library: libraryOf() });
    const first = syncKindle({ source, sink: fakeKindleSink(), clock, delay });
    const joined = syncKindle({ source, sink: fakeKindleSink(), clock, delay });
    expect(await joined).toBe(await first);
    deadline.elapse();
    // The deadline passing afterwards frees nothing: the next call runs its own sync.
    const next = fakeKindleNotebook({ library: libraryOf() });
    await syncKindle({ source: next, sink: fakeKindleSink(), clock, delay });
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
    const stuck = syncKindle({ source: slow, sink: fakeKindleSink(), clock, delay });
    const joined = syncKindle({ source: stuckNotebook(), sink: fakeKindleSink(), clock, delay });
    deadline.elapse();
    await expect(joined).rejects.toBeInstanceOf(KindleSyncStuckError);
    void syncKindle({ source: stuckNotebook(), sink: fakeKindleSink(), clock, delay });
    finishStuck(libraryOf());
    await stuck;
    const meanwhile = fakeKindleNotebook({ library: libraryOf() });
    void syncKindle({ source: meanwhile, sink: fakeKindleSink(), clock, delay }).catch(
      // Joins the sync still in flight, which never settles here.
      () => {},
    );
    expect(meanwhile.calls).toEqual([]);
  });
});
