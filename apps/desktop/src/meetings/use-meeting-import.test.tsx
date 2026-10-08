// @vitest-environment jsdom
/**
 * The window's meeting import: one importer per vault, fed by the change
 * feed, whatever new ports the window hands it as the tree is re-read.
 */
import { describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { digestOf, type NoteChange } from '@atlas/domain';
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

/** Ports over one broken meeting file; each call makes a new object, as a tree re-read does. */
const portsOver = (written: string[]): MeetingImportPorts => ({
  fs: fakeVaultFs({
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

describe('useMeetingImport', () => {
  it('keeps one importer while the ports change, so a change heard again is not acted on twice', async () => {
    const changes = createNoteChanges({ onError: () => undefined });
    const activity = recordingActivity();
    const written: string[] = [];
    const onWritten = vi.fn();
    const clock = { today: () => '2026-10-08' };
    const { rerender } = renderHook(
      ({ ports }) =>
        useMeetingImport({ changes, ports, clock, activity, vaultKey: VAULT, onWritten }),
      { initialProps: { ports: portsOver(written) } },
    );

    changes.publish({ vault: VAULT, changes: [ARRIVED] });
    await waitFor(() => expect(activity.reports).toHaveLength(1));
    rerender({ ports: portsOver(written) });
    changes.publish({ vault: VAULT, changes: [ARRIVED] });
    changes.publish({ vault: VAULT, changes: [] });
    await waitFor(() => expect(onWritten).toHaveBeenCalledTimes(1));

    expect(activity.reports).toHaveLength(1);
    expect(written).toEqual([BROKEN]);
  });

  it('imports nothing while no vault is open', async () => {
    const changes = createNoteChanges({ onError: () => undefined });
    const activity = recordingActivity();
    const written: string[] = [];
    renderHook(() =>
      useMeetingImport({
        changes,
        ports: portsOver(written),
        clock: { today: () => '2026-10-08' },
        activity,
        vaultKey: null,
        onWritten: () => undefined,
      }),
    );

    changes.publish({ vault: VAULT, changes: [ARRIVED] });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(activity.reports).toEqual([]);
    expect(written).toEqual([]);
  });
});
