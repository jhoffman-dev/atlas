// @vitest-environment jsdom
/**
 * The Inbox's Proposals section as the app drives it, over a vault in memory and the
 * real markdown adapter: what is listed, what an answer writes and moves, and
 * what the page is told afterwards.
 */
import { describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import {
  createVaultPath,
  parentVaultPath,
  vaultPathName,
  type VaultEntry,
  type VaultPath,
} from '@atlas/domain';
import { fakeIndexPort, fakeVaultFs, type ProposalPorts } from '@atlas/application';
import { remarkMarkdown } from '@atlas/adapters';
import { useProposals } from './use-proposals.ts';

const path = (raw: string): VaultPath => createVaultPath(raw);
const PROPOSAL = 'Inbox/Proposals/Send the file.md';
const TASK = 'Send Mara the payroll file.md';

const PROPOSAL_TEXT = `---
type: proposal
kind: task
source: "[[2026-10-01 Standup#^t0003]]"
payload:
  title: Send Mara the payroll file
  properties:
    meeting: "[[2026-10-01 Standup]]"
---
`;

/** A vault in memory: a note's modified time moves on with every write, and the Trash takes notes away. */
function vault(notes: Record<string, string>) {
  let clock = 10;
  const files = new Map(Object.entries(notes).map(([at, text]) => [at, { text, modified: clock }]));
  const dirs = new Set<string>();
  const parents = () => [
    ...dirs,
    ...[...files.keys()].flatMap((at) => {
      const segments = at.split('/').slice(0, -1);
      return segments.map((_, depth) => segments.slice(0, depth + 1).join('/'));
    }),
  ];
  const entry = (at: string, kind: VaultEntry['kind']) =>
    ({ kind, name: vaultPathName(path(at)), path: path(at) }) as VaultEntry;
  const read = (at: string) => {
    const file = files.get(at);
    if (file === undefined) throw new Error('no such entry');
    return file;
  };
  const fs = fakeVaultFs({
    listDirectory: async (parent) =>
      [...new Set(parents().filter((at) => parentVaultPath(path(at)) === parent))]
        .map((at) => entry(at, 'directory'))
        .concat(
          [...files.keys()]
            .filter((at) => parentVaultPath(path(at)) === parent)
            .map((at) => entry(at, 'file')),
        ),
    listNotes: async () =>
      [...files].map(([at, file]) => ({
        name: vaultPathName(path(at)),
        path: path(at),
        modified: file.modified,
        size: file.text.length,
      })),
    createFolder: async ({ path: at }) => void dirs.add(at),
    createNote: async ({ path: at, contents }) => {
      if (files.has(at)) throw new Error('already exists');
      files.set(at, { text: contents, modified: (clock += 1) });
    },
    moveEntry: async ({ from, to }) => {
      const file = read(from);
      if (files.has(to)) throw new Error('already exists');
      files.delete(from);
      files.set(to, { ...file, modified: (clock += 1) });
    },
    readTextFile: async (at) => ({ ...read(at) }),
    readNotes: async (paths) =>
      paths.flatMap((at) => {
        const file = files.get(at);
        return file === undefined ? [] : [{ path: at, ...file, size: file.text.length }];
      }),
    writeTextFile: async ({ path: at, contents, expectedModified }) => {
      if (expectedModified !== null && read(at).modified !== expectedModified) {
        throw new Error('changed on disk');
      }
      files.set(at, { text: contents, modified: (clock += 1) });
      return clock;
    },
    trashEntry: async ({ path: at }) => {
      if (!files.delete(at)) throw new Error('no such entry');
    },
  });
  const ports: ProposalPorts = {
    fs,
    index: fakeIndexPort(),
    markdown: remarkMarkdown,
    editors: {
      state: () => 'closed',
      flush: async () => {},
      follow: () => {},
      abandon: () => {},
      reload: () => {},
    },
  };
  return { files, ports };
}

function render(notes: Record<string, string> = { [PROPOSAL]: PROPOSAL_TEXT }) {
  const setup = vault(notes);
  const onSettled = vi.fn();
  const hook = renderHook(() =>
    useProposals({
      ports: setup.ports,
      clock: { today: () => '2026-10-08' },
      indexKey: 'v1',
      onSettled,
    }),
  );
  return { ...setup, hook, onSettled };
}

describe('useProposals', () => {
  it('lists the open proposals and counts them for the sidebar', async () => {
    const { hook } = render();
    await waitFor(() => expect(hook.result.current.count).toBe(1));
    expect(hook.result.current.section.contents?.open[0]?.path).toBe(PROPOSAL);
  });

  it('accepts one: the task is made, the proposal archived, and the page offers to open it', async () => {
    const { hook, files, onSettled } = render();
    await waitFor(() => expect(hook.result.current.count).toBe(1));

    act(() => hook.result.current.section.onAccept(path(PROPOSAL)));
    await waitFor(() => expect(hook.result.current.count).toBe(0));

    expect(files.get(TASK)?.text).toContain('source: "[[2026-10-01 Standup#^t0003]]"');
    expect(files.get(`Archive/${PROPOSAL}`)?.text).toContain('state: accepted');
    expect(hook.result.current.section.notice).toEqual({
      text: 'Accepted: Send Mara the payroll file.',
      opens: { path: TASK, title: 'Send Mara the payroll file' },
      undoable: true,
    });
    expect(onSettled).toHaveBeenCalled();
  });

  it('undoes the accept: the task goes and the proposal is back, open', async () => {
    const { hook, files } = render();
    await waitFor(() => expect(hook.result.current.count).toBe(1));
    act(() => hook.result.current.section.onAccept(path(PROPOSAL)));
    await waitFor(() => expect(hook.result.current.section.notice?.undoable).toBe(true));

    act(() => hook.result.current.section.onUndo());
    await waitFor(() => expect(hook.result.current.count).toBe(1));

    expect(files.has(TASK)).toBe(false);
    expect(files.get(PROPOSAL)?.text).toContain('state: open');
    expect(hook.result.current.section.notice).toMatchObject({
      text: 'Undone: Send Mara the payroll file is back in the Inbox.',
      undoable: false,
    });
  });

  it('says on the proposal why an accept was refused, and writes nothing', async () => {
    const { hook, files } = render({ [PROPOSAL]: PROPOSAL_TEXT, [TASK]: 'Made by hand.\n' });
    await waitFor(() => expect(hook.result.current.count).toBe(1));

    act(() => hook.result.current.section.onAccept(path(PROPOSAL)));
    await waitFor(() => expect(hook.result.current.section.problems.size).toBe(1));

    expect(hook.result.current.section.problems.get(path(PROPOSAL))).toMatch(/already a note at/);
    expect(hook.result.current.section.busy).toBeNull();
    expect(files.get(TASK)?.text).toBe('Made by hand.\n');
  });

  it('rejects one, archiving it, with nothing to undo', async () => {
    const { hook, files } = render();
    await waitFor(() => expect(hook.result.current.count).toBe(1));

    act(() => hook.result.current.section.onReject(path(PROPOSAL)));
    await waitFor(() => expect(hook.result.current.count).toBe(0));

    expect(files.get(`Archive/${PROPOSAL}`)?.text).toContain('state: rejected');
    expect(files.has(TASK)).toBe(false);
    expect(hook.result.current.section.notice).toEqual({
      text: 'Rejected: Send the file.',
      opens: null,
      undoable: false,
    });
  });

  it('answers one proposal at a time, so a second press does nothing', async () => {
    const { hook, files } = render();
    await waitFor(() => expect(hook.result.current.count).toBe(1));

    act(() => {
      hook.result.current.section.onAccept(path(PROPOSAL));
      hook.result.current.section.onReject(path(PROPOSAL));
    });
    await waitFor(() => expect(hook.result.current.count).toBe(0));

    expect(files.get(`Archive/${PROPOSAL}`)?.text).toContain('state: accepted');
    expect(hook.result.current.section.problems.size).toBe(0);
  });
});

describe('useProposals — adversarial: another vault opened after an accept', () => {
  // The hook holds the last accept for its Undo, and the notice offering it,
  // across a change of `ports` — which is what opening another vault is. The
  // page then offers "Undo" in vault B for what was accepted in vault A, and
  // pressing it runs A's paths against B's files.
  it('no longer offers Undo once the ports are another vault’s', async () => {
    const first = vault({ [PROPOSAL]: PROPOSAL_TEXT });
    const second = vault({ 'Elsewhere.md': 'Another vault.\n' });
    const hook = renderHook(
      ({ ports }: { ports: ProposalPorts }) =>
        useProposals({
          ports,
          clock: { today: () => '2026-10-08' },
          indexKey: 'v1',
          onSettled: () => {},
        }),
      { initialProps: { ports: first.ports } },
    );
    await waitFor(() => expect(hook.result.current.count).toBe(1));
    act(() => hook.result.current.section.onAccept(path(PROPOSAL)));
    await waitFor(() => expect(hook.result.current.section.notice?.undoable).toBe(true));

    hook.rerender({ ports: second.ports });
    await waitFor(() => expect(hook.result.current.count).toBe(0));

    expect(hook.result.current.section.notice?.undoable ?? false).toBe(false);
  });
});
