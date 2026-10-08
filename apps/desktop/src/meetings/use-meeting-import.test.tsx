// @vitest-environment jsdom
/**
 * The window's meeting import: one importer, fed by the change feed, writing
 * only on the Mac that runs the automations, and catching up there once the
 * index is ready.
 */
import { describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { createVaultPath, digestOf, type NoteChange } from '@atlas/domain';
import {
  createNoteChanges,
  fakeIndexPort,
  fakeVaultFs,
  recordingActivity,
  type MeetingImportPorts,
} from '@atlas/application';
import { remarkMarkdown } from '@atlas/adapters';
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

function render(initial: { active: boolean; indexReady: boolean; vaultKey?: string | null }) {
  const changes = createNoteChanges({ onError: () => undefined });
  const activity = recordingActivity();
  const written: string[] = [];
  const onWritten = vi.fn();
  const clock = { today: () => '2026-10-08' };
  const hook = renderHook(
    ({ ports, active, indexReady, vaultKey }) =>
      useMeetingImport({
        changes,
        ports,
        clock,
        activity,
        vaultKey,
        active,
        indexReady,
        onWritten,
      }),
    {
      initialProps: {
        ports: portsOver(written),
        vaultKey: VAULT as string | null,
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

    rerender({ ports: portsOver(later), active: true, indexReady: false, vaultKey: VAULT });
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
    expect(written).toEqual([]);

    rerender({ ports: portsOver(written), active: true, indexReady: true, vaultKey: VAULT });
    await waitFor(() => expect(written).toEqual([BROKEN]));
    rerender({ ports: portsOver(written), active: true, indexReady: false, vaultKey: VAULT });
    rerender({ ports: portsOver(written), active: true, indexReady: true, vaultKey: VAULT });
    rerender({ ports: portsOver(written), active: false, indexReady: true, vaultKey: VAULT });
    rerender({ ports: portsOver(written), active: true, indexReady: true, vaultKey: VAULT });

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

/** Lets every queued import run: each step of one over these ports is a promise already settled. */
async function settled(): Promise<void> {
  for (let turn = 0; turn < 20; turn += 1) await Promise.resolve();
}
