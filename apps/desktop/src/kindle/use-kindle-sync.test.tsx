// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import {
  KINDLE_AUTO_SYNC_INTERVAL_MS,
  KINDLE_SIGN_IN_MESSAGE,
  NO_KINDLE_SYNC_RECORD,
  type KindleSyncRecord,
  type KindleSyncReport,
} from '@dfai/domain';
import { fakeIndexPort, fakeVaultFs, type KindleSync } from '@dfai/application';
import { useKindleSync, type KindleHost, type KindleWindowOptions } from './use-kindle-sync.ts';

const START = Date.UTC(2026, 9, 22, 9, 0);

function memoryRecords(start: KindleSyncRecord = NO_KINDLE_SYNC_RECORD) {
  let kept = start;
  return {
    read: () => kept,
    write: (record: KindleSyncRecord) => {
      kept = record;
    },
  };
}

/** A host whose sync answers `report` and counts its runs, and whose session records its calls. */
function host(report: KindleSyncReport, start?: KindleSyncRecord) {
  const calls: string[] = [];
  const sync: KindleSync = async () => {
    calls.push('sync');
    return report;
  };
  const kindle: KindleHost = {
    notebook: {
      fetchLibrary: () => Promise.reject(new Error('not here')),
      fetchAnnotations: () => Promise.reject(new Error('not here')),
    },
    session: {
      connect: async () => void calls.push('connect'),
      disconnect: async () => void calls.push('disconnect'),
    },
    sync,
    delay: { wait: async () => {} },
    records: memoryRecords(start),
  };
  return { kindle, calls };
}

const SYNCED: KindleSyncReport = { kind: 'synced', books: [], added: 0 };
const CONNECTED: KindleSyncRecord = { connected: true, lastHoldAt: null, last: null };

/** The window's options over `kindle`: a vault open and its index ready, unless overridden. */
function optionsFor(
  kindle: KindleHost,
  overrides: Partial<KindleWindowOptions> = {},
): KindleWindowOptions {
  return {
    kindle,
    fs: fakeVaultFs(),
    markdown: {
      frontmatterProperties: () => ({}),
      noteBlocks: () => ({ quotes: [], hidden: [] }),
    },
    index: fakeIndexPort(),
    openNotes: { state: () => 'closed', reload: () => {} },
    rng: { next: () => 0.5 },
    clock: { now: () => Date.now(), today: () => '2026-10-22' },
    vaultKey: '/Users/mara/Vault',
    indexReady: true,
    onWrote: () => {},
    ...overrides,
  };
}

function render(kindle: KindleHost, overrides: Partial<KindleWindowOptions> = {}) {
  return renderHook((props: KindleWindowOptions) => useKindleSync(props), {
    initialProps: optionsFor(kindle, overrides),
  });
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
  vi.setSystemTime(START);
});
afterEach(() => vi.useRealTimers());

const settle = () => act(async () => {});

describe('useKindleSync', () => {
  it('syncs nothing by itself before Kindle is connected', async () => {
    const { kindle, calls } = host(SYNCED);
    const { result } = render(kindle);
    await settle();
    expect(calls).toEqual([]);
    expect(result.current.view).toMatchObject({ connected: false, last: null });
  });

  it('once connected, syncs when the index is ready and again every four hours', async () => {
    const { kindle, calls } = host(SYNCED, CONNECTED);
    const { rerender, result } = render(kindle, { indexReady: false });
    await settle();
    expect(calls).toEqual([]);
    rerender(optionsFor(kindle));
    await settle();
    expect(calls).toEqual(['sync']);
    await act(async () => {
      vi.advanceTimersByTime(KINDLE_AUTO_SYNC_INTERVAL_MS);
    });
    expect(calls).toEqual(['sync', 'sync']);
    expect(result.current.toast).toBeNull();
  });

  it('says what a Sync now found, plainly, on the card and in a toast', async () => {
    const { kindle } = host({ kind: 'sign_in_required', books: [], added: 0 }, CONNECTED);
    const { result } = render(kindle, { vaultKey: null });
    act(() => result.current.syncNow());
    expect(result.current.view.busy).toBe('syncing');
    await settle();
    expect(result.current.view.busy).toBeNull();
    expect(result.current.toast).toBe(KINDLE_SIGN_IN_MESSAGE);
    expect(result.current.view.last).toMatchObject({ message: KINDLE_SIGN_IN_MESSAGE, ok: false });
    act(() => result.current.dismissToast(result.current.toastShown));
    expect(result.current.toast).toBeNull();
  });

  it('connects, then syncs, and disconnects', async () => {
    const { kindle, calls } = host(SYNCED);
    const { result } = render(kindle, { vaultKey: null });
    act(() => result.current.connect());
    await settle();
    expect(calls).toEqual(['connect', 'sync']);
    expect(result.current.view.connected).toBe(true);
    act(() => result.current.disconnect());
    await settle();
    expect(calls).toEqual(['connect', 'sync', 'disconnect']);
    expect(result.current.view).toMatchObject({ connected: false, last: null });
  });

  it('shows why Connect did not go through', async () => {
    const { kindle } = host(SYNCED);
    const refusing: KindleHost = {
      ...kindle,
      session: { ...kindle.session, connect: () => Promise.reject(new Error('Not on this Mac.')) },
    };
    const { result } = render(refusing, { vaultKey: null });
    act(() => result.current.connect());
    await settle();
    expect(result.current.view).toMatchObject({ connected: false, problem: 'Not on this Mac.' });
  });

  it('refreshes the vault after a sync added highlights', async () => {
    const onWrote = vi.fn();
    const { kindle } = host({ kind: 'synced', books: [], added: 3 }, CONNECTED);
    render(kindle, { onWrote });
    await settle();
    expect(onWrote).toHaveBeenCalledOnce();
  });
});
