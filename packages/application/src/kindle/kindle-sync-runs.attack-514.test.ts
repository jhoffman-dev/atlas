import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { NO_KINDLE_SYNC_RECORD, type KindleSyncRecord, type KindleSyncReport } from '@dfai/domain';
import {
  fakeKindleDelay,
  fakeKindleNotebook,
  fakeKindleSink,
  heldKindleDelay,
  kindlePage,
} from '../testing/fake-kindle.ts';
import { disconnectKindle, runKindleSync } from './kindle-sync-runs.ts';
import type { KindleHighlightSink, KindleSession } from './ports.ts';
import { createKindleSync, type KindleSync } from './sync-kindle.ts';

/*
 * Attack on PR #514 (#508): the record and the one sync, when the person's
 * commands and the schedule overlap.
 */

const NOW = Date.UTC(2026, 9, 22, 9, 0);
const clock = { now: () => NOW };
const CONNECTED: KindleSyncRecord = { connected: true, lastHoldAt: null, last: null };
const SYNCED: KindleSyncReport = { kind: 'synced', books: [], added: 0 };

function records(start: KindleSyncRecord) {
  let kept = start;
  return { read: () => kept, write: (record: KindleSyncRecord) => void (kept = record) };
}

/** A promise and the hand that settles it, so a test decides when a sync ends. */
function gate() {
  let open = () => {};
  const opened = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { opened, open };
}

const session: KindleSession = { connect: async () => {}, disconnect: async () => {} };

const fixture = (name: string) =>
  readFileSync(new URL(`../../../domain/src/kindle/fixtures/${name}`, import.meta.url), 'utf8');

function notebook() {
  const empty = (asin: string) =>
    kindlePage(
      `<input class="kp-notebook-annotations-next-page-start" value=""><input id="kp-notebook-annotations-asin" value="${asin}"><div id="kp-notebook-annotations"></div>`,
    );
  return fakeKindleNotebook({
    library: kindlePage(fixture('library.html')),
    books: {
      B0EXAMPLE1: [
        kindlePage(fixture('annotations-page-1.html')),
        kindlePage(fixture('annotations-page-2.html')),
      ],
      B0EXAMPLE2: [empty('B0EXAMPLE2')],
      B0EXAMPLE3: [empty('B0EXAMPLE3')],
    },
  });
}

describe('Disconnect while a sync is running (attack 514)', () => {
  it('stays disconnected when a sync that was already under way then goes through', async () => {
    const kept = records(CONNECTED);
    const ends = gate();
    const sync: KindleSync = async () => {
      await ends.opened;
      return SYNCED;
    };
    const ports = { source: notebook(), sink: fakeKindleSink(), clock, delay: fakeKindleDelay() };
    // The schedule's sync: the card's Disconnect is enabled, as only Sync now sets `busy`.
    const automatic = runKindleSync({ sync, ports, records: kept }, 'automatic');
    await disconnectKindle({ session, records: kept });
    ends.open();
    await automatic;
    expect(kept.read().connected).toBe(false);
  });
});

describe('a sync of another vault started while one runs (attack 514)', () => {
  it("writes the second vault's notes, rather than answering with the first vault's sync", async () => {
    const sync = createKindleSync({ deadline: heldKindleDelay() });
    const kept = records({ ...NO_KINDLE_SYNC_RECORD, connected: true });
    const firstVault = fakeKindleSink();
    const writing = gate();
    const slowFirst: KindleHighlightSink = {
      recordedKeys: (book) => firstVault.recordedKeys(book),
      addHighlights: async (write) => {
        await writing.opened;
        return firstVault.addHighlights(write);
      },
    };
    const secondVault = fakeKindleSink();
    const delay = fakeKindleDelay();
    const before = runKindleSync(
      { sync, records: kept, ports: { source: notebook(), sink: slowFirst, clock, delay } },
      'automatic',
    );
    // The person opens another vault: its index is ready, and its window tries a sync.
    const after = runKindleSync(
      { sync, records: kept, ports: { source: notebook(), sink: secondVault, clock, delay } },
      'automatic',
    );
    writing.open();
    await Promise.all([before, after]);
    expect(firstVault.writes.length).toBeGreaterThan(0);
    expect(secondVault.writes.length).toBeGreaterThan(0);
  });
});
