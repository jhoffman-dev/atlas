import { describe, expect, it } from 'vitest';
import {
  KINDLE_AUTO_SYNC_HOLD_MS,
  KINDLE_NOT_CONNECTED_MESSAGE,
  NO_KINDLE_SYNC_RECORD,
  type KindleSyncRecord,
  type KindleSyncReport,
} from '@dfai/domain';
import { fakeKindleDelay, fakeKindleNotebook, fakeKindleSink } from '../testing/fake-kindle.ts';
import { connectKindle, disconnectKindle, runKindleSync } from './kindle-sync-runs.ts';
import type { KindleSession } from './ports.ts';
import type { KindleSync } from './sync-kindle.ts';

const NOW = Date.UTC(2026, 9, 22, 9, 0);

function records(start: KindleSyncRecord = NO_KINDLE_SYNC_RECORD) {
  let kept = start;
  const written: KindleSyncRecord[] = [];
  return {
    written,
    now: () => kept,
    read: () => kept,
    write: (record: KindleSyncRecord) => {
      kept = record;
      written.push(record);
    },
  };
}

/** A sync that answers `report` and counts its runs. */
function syncAnswering(answer: KindleSyncReport | Error) {
  const runs = { count: 0 };
  const sync: KindleSync = async () => {
    runs.count += 1;
    if (answer instanceof Error) throw answer;
    return answer;
  };
  return { sync, runs };
}

const ports = {
  source: fakeKindleNotebook({ library: { status: 200, html: '', redirectedTo: null } }),
  sink: fakeKindleSink(),
  clock: { now: () => NOW },
  delay: fakeKindleDelay(),
};

const SYNCED: KindleSyncReport = { kind: 'synced', books: [], added: 0 };
const CONNECTED: KindleSyncRecord = { connected: true, lastHoldAt: null, last: null };

describe('runKindleSync', () => {
  it('does nothing by itself before Kindle is connected', async () => {
    const { sync, runs } = syncAnswering(SYNCED);
    const run = await runKindleSync({ sync, ports, records: records() }, 'automatic');
    expect(run).toEqual({ kind: 'skipped', reason: 'not_connected' });
    expect(runs.count).toBe(0);
  });

  it('runs by itself once connected, keeping what it said', async () => {
    const { sync, runs } = syncAnswering(SYNCED);
    const kept = records(CONNECTED);
    const run = await runKindleSync({ sync, ports, records: kept }, 'automatic');
    expect(runs.count).toBe(1);
    expect(run).toMatchObject({ kind: 'ran', report: SYNCED });
    expect(kept.now().last).toEqual({ at: NOW, message: 'Nothing new from Kindle.', ok: true });
  });

  it('holds automatic syncs for a day after a robot check, but runs one the person asks for', async () => {
    const { sync, runs } = syncAnswering({ kind: 'robot_check', books: [], added: 0 });
    const kept = records(CONNECTED);
    await runKindleSync({ sync, ports, records: kept }, 'automatic');
    expect(kept.now().lastHoldAt).toBe(NOW);
    const later = { ...ports, clock: { now: () => NOW + KINDLE_AUTO_SYNC_HOLD_MS - 1 } };
    expect(await runKindleSync({ sync, ports: later, records: kept }, 'automatic')).toEqual({
      kind: 'skipped',
      reason: 'held',
    });
    await runKindleSync({ sync, ports: later, records: kept }, 'asked');
    expect(runs.count).toBe(2);
  });

  it('asks the host when the person asks, even with no session recorded, and says what it said', async () => {
    const { sync } = syncAnswering({ kind: 'not_connected', books: [], added: 0 });
    const kept = records();
    const run = await runKindleSync({ sync, ports, records: kept }, 'asked');
    expect(run.kind).toBe('ran');
    expect(kept.now()).toMatchObject({
      connected: false,
      last: { message: KINDLE_NOT_CONNECTED_MESSAGE, ok: false },
    });
  });

  it('keeps a sync that threw as a failure in plain words', async () => {
    const { sync } = syncAnswering(new Error('the host stopped answering'));
    const kept = records(CONNECTED);
    const run = await runKindleSync({ sync, ports, records: kept }, 'asked');
    expect(run.kind).toBe('failed');
    expect(kept.now().last).toEqual({
      at: NOW,
      message: 'Kindle sync failed: the host stopped answering',
      ok: false,
    });
  });
});

function session(): KindleSession & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    connect: async () => void calls.push('connect'),
    disconnect: async () => void calls.push('disconnect'),
  };
}

describe('connectKindle', () => {
  it('opens the sign-in, records the connection, then syncs', async () => {
    const { sync, runs } = syncAnswering(SYNCED);
    const kept = records();
    const host = session();
    const run = await connectKindle({ sync, ports, records: kept, session: host });
    expect(host.calls).toEqual(['connect']);
    expect(runs.count).toBe(1);
    expect(run).toMatchObject({ kind: 'ran' });
    expect(kept.written[0]).toMatchObject({ connected: true, last: null });
  });

  it('records nothing when the sign-in window could not open', async () => {
    const { sync, runs } = syncAnswering(SYNCED);
    const kept = records();
    const failing: KindleSession = {
      connect: () => Promise.reject(new Error('This Mac cannot keep a Kindle session.')),
      disconnect: async () => {},
    };
    await expect(connectKindle({ sync, ports, records: kept, session: failing })).rejects.toThrow(
      'This Mac cannot keep',
    );
    expect(kept.written).toEqual([]);
    expect(runs.count).toBe(0);
  });
});

describe('disconnectKindle', () => {
  it('deletes the session and stops automatic syncs, keeping a hold Amazon set', async () => {
    const kept = records({
      connected: true,
      lastHoldAt: 7,
      last: { at: 1, message: 'x', ok: true },
    });
    const host = session();
    const record = await disconnectKindle({ session: host, records: kept });
    expect(host.calls).toEqual(['disconnect']);
    expect(record).toEqual({ connected: false, lastHoldAt: 7, last: null });
    expect(kept.now()).toEqual(record);
  });
});
