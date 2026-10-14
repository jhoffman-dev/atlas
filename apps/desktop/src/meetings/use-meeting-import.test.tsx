// @vitest-environment jsdom
/**
 * The window's meeting import: one importer, fed by the change feed, writing
 * only on the Mac that runs the automations, and catching up there once the
 * index is ready.
 */
import { describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { createVaultPath, digestOf, type NoteChange, type PullStanding } from '@atlas/domain';
import {
  createNoteChanges,
  fakeIndexPort,
  fakeVaultFs,
  recordingActivity,
  type MeetingImportPorts,
} from '@atlas/application';
import { remarkMarkdown } from '@atlas/adapters';
import { useIndex } from '../index/use-index.ts';
import { useMeetingImport } from './use-meeting-import.ts';

const VAULT = '/Users/j/Vault';
const BROKEN = 'Inbox/Meetings/2026-10-06 Standup.md';
const BROKEN_TEXT = '---\ntype: meeting\natlas_import: meeting/v1\n---\n\nNotes.\n';
const ARRIVED: NoteChange = {
  kind: 'added',
  path: BROKEN,
  type: 'meeting',
  digest: digestOf(BROKEN_TEXT),
};

/** The gates of ADR-0035 part 4, as a vault that does not sync has them: always open. */
const NOT_SYNCED: Gate = { standing: { kind: 'not-synced' }, acts: async () => true };

type Gate = { standing: PullStanding | null; acts: (vault: string) => Promise<boolean> };

/** A pull that completed, which the gates judge by: a new one each time, as each pull leaves. */
const pulled = (): PullStanding => ({
  kind: 'pulled',
  startedAsleepMs: 0,
  finishedAt: 1,
  namedAfter: true,
});

const folder = (path: string, name: string) => ({
  kind: 'directory' as const,
  name,
  path: createVaultPath(path),
});

/**
 * Ports over one broken meeting file that each write is remembered against,
 * though the file reads the same after it — so a second look at it would
 * write again. Each call makes a new object, as a tree re-read does.
 */
const portsOver = (written: string[]): MeetingImportPorts => ({
  fs: fakeVaultFs({
    listDirectory: async (path) =>
      path === ''
        ? [folder('Inbox', 'Inbox')]
        : path === 'Inbox'
          ? [folder('Inbox/Meetings', 'Meetings')]
          : [{ kind: 'file', name: '2026-10-06 Standup.md', path: createVaultPath(BROKEN) }],
    readTextFile: async () => ({ text: BROKEN_TEXT, modified: 1 }),
    writeTextFile: async ({ path }) => {
      written.push(path);
      return 2;
    },
  }),
  index: fakeIndexPort(),
  markdown: remarkMarkdown,
  editors: {
    state: () => 'closed',
    flush: async () => undefined,
    follow: () => undefined,
    abandon: () => undefined,
    reload: () => undefined,
  },
});

function render(initial: {
  active: boolean;
  indexReady: boolean;
  vaultKey?: string | null;
  pulledFiles?: Gate;
}) {
  const changes = createNoteChanges({ onError: () => undefined });
  const activity = recordingActivity();
  const written: string[] = [];
  const onWritten = vi.fn();
  const clock = { today: () => '2026-10-08' };
  const hook = renderHook(
    ({ ports, active, indexReady, vaultKey, pulledFiles }) =>
      useMeetingImport({
        changes,
        ports,
        clock,
        activity,
        vaultKey,
        selfName: null,
        active,
        indexReady,
        pulledFiles,
        onWritten,
      }),
    {
      initialProps: {
        ports: portsOver(written),
        vaultKey: VAULT as string | null,
        pulledFiles: NOT_SYNCED,
        ...initial,
      },
    },
  );
  return { ...hook, changes, activity, written, onWritten };
}

describe('useMeetingImport', () => {
  it('runs each import through the ports the window has now', async () => {
    const { rerender, changes, written } = render({ active: true, indexReady: false });
    const later: string[] = [];

    rerender({
      ports: portsOver(later),
      active: true,
      indexReady: false,
      vaultKey: VAULT,
      pulledFiles: NOT_SYNCED,
    });
    changes.publish({ vault: VAULT, changes: [ARRIVED] });

    await waitFor(() => expect(later).toEqual([BROKEN]));
    expect(written).toEqual([]);
  });

  it('writes nothing on a Mac that does not run the automations', async () => {
    const { changes, activity, written } = render({ active: false, indexReady: true });

    changes.publish({ vault: VAULT, changes: [ARRIVED] });
    await settled();

    expect(written).toEqual([]);
    expect(activity.reports).toEqual([]);
  });

  it('catches up once the index is ready, and again when this Mac takes the automations over', async () => {
    const { rerender, written } = render({ active: true, indexReady: false });
    const props = { ports: portsOver(written), vaultKey: VAULT, pulledFiles: NOT_SYNCED };
    expect(written).toEqual([]);

    rerender({ ...props, active: true, indexReady: true });
    await waitFor(() => expect(written).toEqual([BROKEN]));
    rerender({ ...props, active: true, indexReady: false });
    rerender({ ...props, active: true, indexReady: true });
    rerender({ ...props, active: false, indexReady: true });
    rerender({ ...props, active: true, indexReady: true });

    await waitFor(() => expect(written).toEqual([BROKEN, BROKEN]));
  });

  it('imports nothing while no vault is open', async () => {
    const { changes, activity, written } = render({
      active: true,
      indexReady: true,
      vaultKey: null,
    });

    changes.publish({ vault: VAULT, changes: [ARRIVED] });
    await settled();

    expect(written).toEqual([]);
    expect(activity.reports).toEqual([]);
  });
});

describe('useMeetingImport: only on fresh sync state (ADR-0035 part 4)', () => {
  it('imports nothing before a pull has completed, and catches up once one has', async () => {
    const shut = { standing: null, acts: vi.fn(async () => false) };
    const { rerender, changes, written } = render({
      active: true,
      indexReady: false,
      pulledFiles: shut,
    });
    const props = { ports: portsOver(written), vaultKey: VAULT, active: true, indexReady: true };
    rerender({ ...props, pulledFiles: shut });
    await settled();
    // No catch-up is started with no pull to judge it by.
    expect(shut.acts).not.toHaveBeenCalled();
    changes.publish({ vault: VAULT, changes: [ARRIVED] });
    await settled();
    expect(shut.acts).toHaveBeenCalledOnce();
    expect(written).toEqual([]);

    const pulling = { standing: { kind: 'pulling' } as const, acts: vi.fn(async () => false) };
    rerender({ ...props, pulledFiles: pulling });
    await settled();
    expect(pulling.acts).not.toHaveBeenCalled();

    rerender({ ...props, pulledFiles: { standing: pulled(), acts: async () => true } });
    await waitFor(() => expect(written).toEqual([BROKEN]));
  });

  it('drops what it hears while the gates are shut, and settles it in the catch-up after the next pull', async () => {
    const first: Gate = { standing: pulled(), acts: async () => true };
    const { rerender, changes, written } = render({
      active: true,
      indexReady: false,
      pulledFiles: first,
    });
    const props = { ports: portsOver(written), vaultKey: VAULT, active: true, indexReady: true };
    rerender({ ...props, pulledFiles: first });
    await waitFor(() => expect(written).toEqual([BROKEN]));

    // The Mac slept: the same pull no longer counts.
    rerender({ ...props, pulledFiles: { ...first, acts: async () => false } });
    changes.publish({ vault: VAULT, changes: [ARRIVED] });
    await settled();
    expect(written).toEqual([BROKEN]);

    rerender({ ...props, pulledFiles: { standing: pulled(), acts: async () => true } });
    await waitFor(() => expect(written).toEqual([BROKEN, BROKEN]));
  });

  it('asks the gates about the vault the news is from', async () => {
    const asked: string[] = [];
    const { changes, written } = render({
      active: true,
      indexReady: false,
      pulledFiles: {
        standing: pulled(),
        acts: async (vault) => {
          asked.push(vault);
          return false;
        },
      },
    });
    changes.publish({ vault: VAULT, changes: [ARRIVED] });
    await settled();
    expect(asked).toEqual([VAULT]);
    expect(written).toEqual([]);
  });

  it('does not ask the gates on a Mac that does not run the automations', async () => {
    const acts = vi.fn(async () => true);
    const { changes, written } = render({
      active: false,
      indexReady: true,
      pulledFiles: { standing: pulled(), acts },
    });
    changes.publish({ vault: VAULT, changes: [ARRIVED] });
    await settled();
    expect(acts).not.toHaveBeenCalled();
    expect(written).toEqual([]);
  });

  it('catches up in each vault opened, though neither syncs', async () => {
    const { rerender, written } = render({ active: true, indexReady: false });
    const props = { ports: portsOver(written), active: true, pulledFiles: NOT_SYNCED };
    rerender({ ...props, vaultKey: VAULT, indexReady: true });
    await waitFor(() => expect(written).toEqual([BROKEN]));
    const other = '/Users/j/Second Vault';
    rerender({ ...props, vaultKey: other, indexReady: false });
    rerender({ ...props, vaultKey: other, indexReady: true });
    await waitFor(() => expect(written).toEqual([BROKEN, BROKEN]));
  });
});

describe('useMeetingImport: adversarial, round 3', () => {
  /**
   * The window passes `indexReady: indexStatus.kind === 'ready'`, and the
   * index's status is the last vault's until its effect starts the new
   * vault's sync. So in the render that opens another vault, the import sees
   * a ready index and catches up there at once — over an index that has not
   * read that vault yet (a first open has none), so no holder is found and
   * every copy is let in as an original. The catch-up is then spent: it does
   * not run again once that vault's index is ready.
   */
  it('waits for the index of a newly opened vault before catching up there', async () => {
    const written: string[] = [];
    let building: Promise<never> | null = null;
    const indexPorts = {
      fs: fakeVaultFs(),
      index: fakeIndexPort({
        open: async () => {
          if (building !== null) await building;
          return { fresh: false };
        },
      }),
      markdown: remarkMarkdown,
    };
    const changes = createNoteChanges({ onError: () => undefined });
    const activity = recordingActivity();
    const ports = portsOver(written);
    const clock = { today: () => '2026-10-08' };
    const { rerender } = renderHook(
      ({ vaultKey }: { vaultKey: string }) => {
        const { status } = useIndex({ ports: indexPorts, vaultKey, activity, changes });
        useMeetingImport({
          changes,
          ports,
          clock,
          activity,
          vaultKey,
          selfName: null,
          active: true,
          indexReady: status.kind === 'ready',
          pulledFiles: NOT_SYNCED,
          onWritten: () => undefined,
        });
      },
      { initialProps: { vaultKey: VAULT } },
    );
    await waitFor(() => expect(written).toEqual([BROKEN]));

    // The next vault's index takes its time: a first open walks the whole vault.
    building = new Promise<never>(() => undefined);
    rerender({ vaultKey: '/Users/j/Second Vault' });
    await settled();
    await settled();

    expect(written).toEqual([BROKEN]);
  });
});

/** Lets every queued import run: each step of one over these ports is a promise already settled. */
async function settled(): Promise<void> {
  for (let turn = 0; turn < 20; turn += 1) await Promise.resolve();
}
