// @vitest-environment jsdom
// Adversarial probes for PR #156 (P28-12). Diagnose only: a red test here is a defect.
import { StrictMode, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { type GranolaNote } from '@atlas/domain';
import {
  fakeGranola,
  fakeIndexPort,
  fakeVaultFs,
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
const REFUSED: GranolaKeyStatus = { hasKey: true, lastRefusal: 401 };

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
  strict = false,
}: {
  key?: GranolaKeyStatus;
  settings?: string;
  synced?: readonly string[];
  catchUpIndex?: () => Promise<boolean>;
  notes?: readonly GranolaNote[];
  strict?: boolean;
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
    syncPulls: new Map(),
    catchUpIndex,
    clock: { now: () => Date.now() },
    activity,
    onWrote,
  };
  const hook = renderHook((props: GranolaPullOptions) => useGranolaPull(props), {
    initialProps: options,
    ...(strict && {
      wrapper: ({ children }: { children: ReactNode }) => <StrictMode>{children}</StrictMode>,
    }),
  });
  const lists = () => granola.count('list');
  return { hook, granola, status, gate, activity, records, options, lists, onWrote };
}

/** Lets fifteen minutes pass on the fake timers. */
const fifteenMinutes = () => act(async () => vi.advanceTimersByTime(GRANOLA_PULL_INTERVAL_MS));

beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }));
afterEach(() => vi.useRealTimers());

describe('useGranolaPull, attacked (PR #156)', () => {
  it('ATTACK: says it is pulling during a Sync now after the vault was closed and reopened mid-pull', async () => {
    const { hook, gate, options } = setUp({ synced: [VAULT, OTHER] });
    let asked = 0;
    const port = options.granola;
    const counting = {
      ...port,
      listNotes: (args: Parameters<typeof port.listNotes>[0]) => (
        (asked += 1),
        port.listNotes(args)
      ),
    };
    const first = held<void>();
    gate.current = first.promise;
    hook.rerender({ ...options, granola: counting });
    // The startup pull of VAULT is under way, its listing held.
    await waitFor(() => expect(hook.result.current.pulling).toBe(true));

    // Another vault is opened, and VAULT again, while that pull still runs.
    const both = new Set([VAULT, OTHER]);
    hook.rerender({ ...options, granola: counting, vaultKey: OTHER, syncedThisSession: both });
    await act(async () => undefined);
    hook.rerender({ ...options, granola: counting, syncedThisSession: both });
    await waitFor(() => expect(hook.result.current.key).toEqual(KEY_HELD));
    await act(async () => undefined);

    first.settle();
    await waitFor(() => expect(hook.result.current.report?.ended).toBe('pulled'));
    await waitFor(() => expect(hook.result.current.pulling).toBe(false));
    await act(async () => undefined);
    const before = asked;

    // Now a Sync now: the card must say it is pulling, and disable Sync now, until it ends.
    const second = held<void>();
    gate.current = second.promise;
    act(() => hook.result.current.syncNow());
    await waitFor(() => expect(asked).toBe(before + 1));
    expect(hook.result.current.pulling).toBe(true);
    second.settle();
    await waitFor(() => expect(hook.result.current.report?.mode).toBe('sync-now'));
  });

  it('ATTACK: React StrictMode (as main.tsx renders) lists Granola once on open', async () => {
    const { hook, lists } = setUp({ strict: true });
    await waitFor(() => expect(hook.result.current.report?.ended).toBe('pulled'));
    await act(async () => undefined);
    expect(lists()).toBe(1);
  });

  it('ATTACK: StrictMode keeps one 15-minute timer', async () => {
    const { lists } = setUp({ strict: true });
    await waitFor(() => expect(lists()).toBe(1));
    await fifteenMinutes();
    await waitFor(() => expect(lists()).toBe(2));
    await act(async () => undefined);
    expect(lists()).toBe(2);
  });

  it('ATTACK: timer + Sync now + key save at the same moment list at most twice', async () => {
    const { hook, gate, lists } = setUp();
    await waitFor(() => expect(lists()).toBe(1));
    await waitFor(() => expect(hook.result.current.pulling).toBe(false));
    const listing = held<void>();
    gate.current = listing.promise;
    await act(async () => {
      vi.advanceTimersByTime(GRANOLA_PULL_INTERVAL_MS);
      hook.result.current.syncNow();
      hook.result.current.syncNow();
      hook.result.current.knowKey({ hasKey: true, lastRefusal: null });
    });
    listing.settle();
    await waitFor(() => expect(hook.result.current.pulling).toBe(false));
    await act(async () => undefined);
    // The periodic pull, then the one Sync now queued behind it.
    expect(lists()).toBe(3);
  });

  it('ATTACK: no timer survives closing the vault', async () => {
    const { hook, lists, options } = setUp();
    await waitFor(() => expect(lists()).toBe(1));
    hook.rerender({ ...options, vaultKey: null });
    await fifteenMinutes();
    await fifteenMinutes();
    expect(lists()).toBe(1);
    hook.unmount();
    await fifteenMinutes();
    expect(lists()).toBe(1);
  });

  it('ATTACK: a vault reopened while its first catch-up is still out tries again when that one fails', async () => {
    const firstCatch = held<boolean>();
    let calls = 0;
    const catchUpIndex = vi.fn(() => {
      calls += 1;
      return calls === 1 ? firstCatch.promise : Promise.resolve(true);
    });
    const { hook, lists, options } = setUp({ catchUpIndex });
    await waitFor(() => expect(catchUpIndex).toHaveBeenCalledOnce());

    // Another vault, not yet synced, is opened; then this one again.
    hook.rerender({ ...options, vaultKey: OTHER, catchUpIndex });
    await act(async () => undefined);
    hook.rerender({ ...options, catchUpIndex: vi.fn(() => ((calls += 1), Promise.resolve(true))) });
    await act(async () => undefined);
    // The refresh asked for on the first open is dropped: the vault closed while it waited.
    firstCatch.settle(false);
    await act(async () => undefined);
    await fifteenMinutes();

    // "The vault opened again tries again" (useCaughtUp): it was opened again.
    await waitFor(() => expect(hook.result.current.ready).toBe(true));
    expect(lists()).toBeGreaterThan(0);
  });

  it('ATTACK: settings read out of order do not leave the 15-minute pull on after granola_periodic: false', async () => {
    const fixture = setUp({ settings: 'granola_periodic: true' });
    await waitFor(() => expect(fixture.hook.result.current.report?.ended).toBe('pulled'));
    let text = 'granola_periodic: true';
    const slow = held<void>();
    let slowOne = true;
    const fs = fakeVaultFs({
      readNotes: async (paths) => {
        if (!paths.includes('.atlas/settings.md')) return [];
        const said = text;
        if (slowOne) {
          slowOne = false;
          await slow.promise;
        }
        return [{ path: '.atlas/settings.md', text: `---\n${said}\n---\n`, modified: 1, size: 1 }];
      },
    });
    // The settings are read again (a change in the vault); that read is slow.
    fixture.hook.rerender({ ...fixture.options, fs, changeKey: 'ready:2' });
    await act(async () => undefined);
    // The person turns the 15-minute pull off; this read is quick.
    text = 'granola_periodic: false';
    fixture.hook.rerender({ ...fixture.options, fs, changeKey: 'ready:3' });
    await act(async () => undefined);
    // The slow, older read lands last.
    slow.settle();
    await act(async () => undefined);
    const after = fixture.lists();
    await fifteenMinutes();
    await act(async () => undefined);
    await fifteenMinutes();
    await act(async () => undefined);
    expect(fixture.lists()).toBe(after);
  });
  it('control: the same change read in order turns the 15-minute pull off', async () => {
    const fixture = setUp({ settings: 'granola_periodic: true' });
    await waitFor(() => expect(fixture.hook.result.current.report?.ended).toBe('pulled'));
    fixture.hook.rerender({
      ...fixture.options,
      fs: vaultWith('granola_periodic: false'),
      changeKey: 'ready:3',
    });
    await act(async () => undefined);
    const after = fixture.lists();
    await fifteenMinutes();
    await act(async () => undefined);
    expect(fixture.lists()).toBe(after);
  });
});
