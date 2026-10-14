// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { GranolaFailure, GranolaNote } from '@atlas/domain';
import {
  fakeGranola,
  fakeIndexPort,
  fakeVaultFs,
  granolaNote,
  GranolaError,
  recordingActivity,
  type GranolaKeyStatus,
  type GranolaPullRecord,
  type GranolaPullRecords,
} from '@atlas/application';
import { remarkMarkdown } from '@atlas/adapters';
import {
  GRANOLA_PULL_INTERVAL_MS,
  useGranolaPull,
  type GranolaPullOptions,
} from './use-granola-pull.ts';

const VAULT = '/Users/mara/Vault';
const OTHER = '/Users/mara/Other';

const KEY_HELD: GranolaKeyStatus = { hasKey: true, lastRefusal: null };
const NO_KEY: GranolaKeyStatus = { hasKey: false, lastRefusal: null };
const REFUSED: GranolaKeyStatus = { hasKey: true, lastRefusal: 401 };

const UNREACHABLE: GranolaFailure = { kind: 'unreachable', message: 'the network is down' };
const KEY_REFUSED: GranolaFailure = {
  kind: 'api_refused',
  status: 401,
  message: 'Granola answered 401',
};

/** A vault whose settings note says `frontmatter`. */
const vaultWith = (frontmatter = 'theme: dark') =>
  fakeVaultFs({
    readNotes: async (paths) =>
      paths.includes('.atlas/settings.md')
        ? [{ path: '.atlas/settings.md', text: `---\n${frontmatter}\n---\n`, modified: 1, size: 1 }]
        : [],
  });

function memoryRecords(): GranolaPullRecords & { kept: Map<string, GranolaPullRecord> } {
  const kept = new Map<string, GranolaPullRecord>();
  return {
    kept,
    read: (vault) => kept.get(vault) ?? { watermark: null, lastPullAt: null },
    write: (vault, record) => void kept.set(vault, record),
  };
}

/** A promise the test settles by hand. */
function held<T>() {
  let settle: (value: T) => void = () => {};
  const promise = new Promise<T>((resolve) => (settle = resolve));
  return { promise, settle };
}

function setUp({
  key = KEY_HELD,
  settings,
  synced = [VAULT],
  catchUpIndex = async () => true,
  notes = [],
}: {
  key?: GranolaKeyStatus;
  settings?: string;
  synced?: readonly string[];
  catchUpIndex?: () => Promise<boolean>;
  notes?: readonly GranolaNote[];
} = {}) {
  const granola = fakeGranola({ notes });
  const onWrote = vi.fn();
  const status = { current: key };
  // Each listing waits on this first, so a test can hold one.
  const gate = { current: Promise.resolve() };
  const activity = recordingActivity();
  const records = memoryRecords();
  const options: GranolaPullOptions = {
    granola: {
      ...granola.port,
      status: async () => status.current,
      // As the host does, Granola's answer is kept as the key's status: a 401 marks it refused.
      listNotes: async (args) => {
        await gate.current;
        try {
          return await granola.port.listNotes(args);
        } catch (error) {
          if (error instanceof GranolaError && error.failure.status === 401)
            status.current = REFUSED;
          throw error;
        }
      },
    },
    records,
    fs: vaultWith(settings),
    markdown: remarkMarkdown,
    index: fakeIndexPort(),
    vaultKey: VAULT,
    changeKey: 'ready:1',
    syncedThisSession: new Set(synced),
    catchUpIndex,
    clock: { now: () => Date.now() },
    activity,
    onWrote,
  };
  const hook = renderHook((props: GranolaPullOptions) => useGranolaPull(props), {
    initialProps: options,
  });
  const lists = () => granola.count('list');
  return { hook, granola, status, gate, activity, records, options, lists, onWrote };
}

/** Lets fifteen minutes pass on the fake timers. */
const fifteenMinutes = () => act(async () => vi.advanceTimersByTime(GRANOLA_PULL_INTERVAL_MS));

beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }));
afterEach(() => vi.useRealTimers());

describe('useGranolaPull', () => {
  it('pulls once as the vault opens, when it has synced and a key is held', async () => {
    const { hook, lists } = setUp();
    await waitFor(() => expect(hook.result.current.report?.ended).toBe('pulled'));
    expect(lists()).toBe(1);
    expect(hook.result.current.report?.mode).toBe('startup');
    expect(hook.result.current.ready).toBe(true);
  });

  it('waits for the first sync of the session, then for the index to catch up with it', async () => {
    const index = held<boolean>();
    const catchUpIndex = vi.fn(() => index.promise);
    const { hook, lists, options } = setUp({ synced: [], catchUpIndex });
    await act(async () => undefined);
    expect(catchUpIndex).not.toHaveBeenCalled();
    expect(lists()).toBe(0);

    // Sync has pulled: the index is refreshed, and nothing is pulled until it has caught up.
    hook.rerender({ ...options, syncedThisSession: new Set([VAULT]) });
    await waitFor(() => expect(catchUpIndex).toHaveBeenCalledOnce());
    await act(async () => undefined);
    expect(lists()).toBe(0);
    expect(hook.result.current.ready).toBe(false);

    index.settle(true);
    await waitFor(() => expect(lists()).toBe(1));
    expect(hook.result.current.ready).toBe(true);
  });

  it('does not pull while the index could not catch up', async () => {
    const { hook, lists } = setUp({ catchUpIndex: async () => false });
    await act(async () => undefined);
    await fifteenMinutes();
    expect(lists()).toBe(0);
    expect(hook.result.current.ready).toBe(false);
  });

  it('pulls nothing without a key, nor with one Granola refused', async () => {
    const none = setUp({ key: NO_KEY });
    await waitFor(() => expect(none.hook.result.current.key).toEqual(NO_KEY));
    await fifteenMinutes();
    expect(none.lists()).toBe(0);

    const refused = setUp({ key: REFUSED });
    await waitFor(() => expect(refused.hook.result.current.key).toEqual(REFUSED));
    await fifteenMinutes();
    expect(refused.lists()).toBe(0);
  });

  it('pulls every 15 minutes', async () => {
    const { hook, lists } = setUp();
    await waitFor(() => expect(lists()).toBe(1));
    await fifteenMinutes();
    await waitFor(() => expect(lists()).toBe(2));
    expect(hook.result.current.report?.mode).toBe('periodic');
    await fifteenMinutes();
    await waitFor(() => expect(lists()).toBe(3));
  });

  it('has no 15-minute pull when the vault’s settings say granola_periodic: false', async () => {
    const { lists } = setUp({ settings: 'granola_periodic: false' });
    await waitFor(() => expect(lists()).toBe(1));
    await fifteenMinutes();
    await fifteenMinutes();
    expect(lists()).toBe(1);
  });

  it('opening another vault and coming back pulls once per open, and keeps one timer', async () => {
    const { hook, lists, options } = setUp({ synced: [VAULT, OTHER] });
    await waitFor(() => expect(lists()).toBe(1));

    hook.rerender({ ...options, vaultKey: OTHER, syncedThisSession: new Set([VAULT, OTHER]) });
    await waitFor(() => expect(lists()).toBe(2));
    hook.rerender({ ...options, syncedThisSession: new Set([VAULT, OTHER]) });
    await waitFor(() => expect(lists()).toBe(3));
    await act(async () => undefined);
    expect(lists()).toBe(3);

    await fifteenMinutes();
    await waitFor(() => expect(lists()).toBe(4));
    await act(async () => undefined);
    expect(lists()).toBe(4);
  });

  it('says it is pulling while a Sync now runs', async () => {
    const { hook, gate, lists } = setUp();
    await waitFor(() => expect(lists()).toBe(1));
    await waitFor(() => expect(hook.result.current.pulling).toBe(false));
    const listing = held<void>();
    gate.current = listing.promise;
    act(() => hook.result.current.syncNow());
    await waitFor(() => expect(hook.result.current.pulling).toBe(true));
    listing.settle();
    await waitFor(() => expect(hook.result.current.pulling).toBe(false));
    expect(hook.result.current.report?.mode).toBe('sync-now');
  });

  it('has the tree and the index read again once a pull has written meetings, and not before', async () => {
    const none = setUp();
    await waitFor(() => expect(none.hook.result.current.report?.ended).toBe('pulled'));
    expect(none.onWrote).not.toHaveBeenCalled();

    const some = setUp({
      notes: [granolaNote('not_hook000000001', { updatedAt: '2026-10-13T15:00:00Z' })],
    });
    await waitFor(() => expect(some.hook.result.current.report?.written).toHaveLength(1));
    expect(some.onWrote).toHaveBeenCalledOnce();
  });

  it('keeps the last pull’s time from this Mac’s record', async () => {
    const { hook, records } = setUp();
    await waitFor(() => expect(hook.result.current.report?.ended).toBe('pulled'));
    expect(hook.result.current.lastPullAt).toBe(records.read(VAULT).lastPullAt);
    expect(hook.result.current.lastPullAt).not.toBeNull();
  });

  it('a startup pull that fails says so in Activity, not as a toast', async () => {
    const { hook, granola, activity } = setUpFailing(UNREACHABLE);
    await waitFor(() => expect(hook.result.current.report?.ended).toBe('failed'));
    expect(granola.count('list')).toBe(1);
    expect(hook.result.current.toast).toBeNull();
    expect(activity.reports.map((report) => report.message).join('\n')).toContain(
      'Granola could not be reached',
    );
  });

  it('a Sync now that fails says why as a toast, in the words the failure is explained in', async () => {
    const { hook, granola, lists } = setUp();
    await waitFor(() => expect(lists()).toBe(1));
    granola.fail('list', UNREACHABLE);
    act(() => hook.result.current.syncNow());
    await waitFor(() => expect(hook.result.current.toast).not.toBeNull());
    expect(hook.result.current.toast).toBe(hook.result.current.report?.problem);
    expect(hook.result.current.toast).toContain('Granola could not be reached');
    expect(hook.result.current.toast).toContain('Atlas tries again on the next pull.');

    act(() => hook.result.current.dismissToast());
    expect(hook.result.current.toast).toBeNull();
  });

  it('a key Granola refuses is said as a toast once, and then nothing is pulled by itself', async () => {
    const { hook, granola, lists } = setUp();
    granola.fail('list', KEY_REFUSED);
    await waitFor(() => expect(hook.result.current.report?.keyRefused).toBe(true));
    await waitFor(() => expect(hook.result.current.toast).toContain('Granola refused the API key'));
    act(() => hook.result.current.dismissToast());
    await waitFor(() => expect(hook.result.current.key).toEqual(REFUSED));

    await fifteenMinutes();
    await act(async () => undefined);
    expect(lists()).toBe(1);
    expect(hook.result.current.toast).toBeNull();
  });

  it('pulls once a key is set where there was none', async () => {
    const { hook, lists } = setUp({ key: NO_KEY });
    await waitFor(() => expect(hook.result.current.key).toEqual(NO_KEY));
    expect(lists()).toBe(0);
    act(() => hook.result.current.knowKey(KEY_HELD));
    await waitFor(() => expect(lists()).toBe(1));
  });
});

/** A vault whose first listing fails as `failure` says. */
function setUpFailing(failure: GranolaFailure) {
  const fixture = setUp({ synced: [] });
  fixture.granola.fail('list', failure);
  fixture.hook.rerender({ ...fixture.options, syncedThisSession: new Set([VAULT]) });
  return fixture;
}
