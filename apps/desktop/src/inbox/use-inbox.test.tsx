// @vitest-environment jsdom
/**
 * The Inbox page's hook (#112, #55): it lists what the open vault's index
 * answered and nothing else, clarifies a row through the use-case, shows a
 * refusal on that row, and takes the last clarification back.
 */
import { describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import {
  fakeIndexPort,
  fakeMarkdown,
  fakeVaultFs,
  memoryVault,
  recordingActivity,
  type ArchivePorts,
} from '@atlas/application';
import {
  createVaultPath,
  INBOX_QUERY_COLUMNS,
  TASK_TYPE_FILE,
  type ObjectType,
} from '@atlas/domain';
import { useInbox, type InboxOptions } from './use-inbox.ts';

const CALL = createVaultPath('Inbox/Call the bank.md');
const CAPTURED = '---\ntype: task\nstatus: inbox\n---\n\nAbout the loan.\n';
const FILES = {
  'Projects/Atlas.md': '---\ntype: project\n---\n',
  'People/Mara Quill.md': '---\ntype: person\n---\n',
  [CALL]: CAPTURED,
};

/** An index that lists `titles` as tasks in the Inbox, and says what it was asked. */
function listingIndex(titles: readonly string[], asked: string[] = []) {
  return fakeIndexPort({
    query: async (sql) => {
      asked.push(sql);
      return {
        columns: [...INBOX_QUERY_COLUMNS],
        rows: titles.map((title) => [`Inbox/${title}.md`, title, 'task', 0, null, null, 'inbox']),
        truncated: false,
      };
    },
    notesOfType: async (type) =>
      type === 'person'
        ? [
            { path: 'People/Mara Quill.md', title: 'Mara Quill' },
            { path: 'Archive/People/Tobias Fenn.md', title: 'Tobias Fenn' },
          ]
        : [],
  });
}

function inbox(overrides: Partial<InboxOptions> = {}, files: Record<string, string> = FILES) {
  const memory = memoryVault(files);
  const ports: ArchivePorts = {
    fs: fakeVaultFs(memory.fs),
    markdown: fakeMarkdown(),
    index: listingIndex(['Call the bank']),
    editors: {
      state: () => 'closed',
      flush: async () => {},
      follow: () => {},
      abandon: () => {},
      reload: () => {},
    },
  };
  const onSettled = vi.fn();
  const initial: InboxOptions = {
    ports,
    notePaths: [...memory.files.keys()].map(createVaultPath),
    vaultKey: '/vaults/a',
    types: [TASK_TYPE_FILE.type],
    clock: { today: () => '2026-10-11' },
    indexKey: 'ready:1',
    open: true,
    onSettled,
    activity: recordingActivity(),
    ...overrides,
  };
  const hook = renderHook((options: InboxOptions) => useInbox(options), { initialProps: initial });
  const listed = () => hook.result.current.contents?.items.map((item) => item.title) ?? null;
  return { hook, initial, files: memory.files, onSettled, listed };
}

describe('useInbox — what it lists', () => {
  it('lists what the index answers, each task with what it says', async () => {
    const { hook, listed } = inbox();
    await waitFor(() => expect(listed()).toEqual(['Call the bank']));
    expect(hook.result.current.contents?.items[0]?.task?.status).toBe('inbox');
  });

  it('asks for clarified tasks to be left out only once the vault’s tasks start in the Inbox', async () => {
    const legacy: ObjectType = { name: 'task', label: 'Task', properties: [] };
    for (const [types, leavesClarifiedOut] of [
      [[TASK_TYPE_FILE.type], true],
      [[legacy], false],
    ] as const) {
      const asked: string[] = [];
      const index = listingIndex([], asked);
      const { hook, initial } = inbox({ types });
      hook.rerender({ ...initial, ports: { ...initial.ports, index }, indexKey: 'ready:2' });
      await waitFor(() => expect(asked.length).toBeGreaterThan(0));
      expect(asked.at(-1)?.includes("IN ('backlog'")).toBe(leavesClarifiedOut);
    }
  });

  it('offers the people a task can wait on, never an archived one', async () => {
    const { hook } = inbox();
    await waitFor(() => expect(hook.result.current.people.length).toBeGreaterThan(0));
    expect(hook.result.current.people.map((person) => person.path)).toEqual([
      'People/Mara Quill.md',
    ]);
  });
});

describe('useInbox — while the same vault re-indexes', () => {
  it('keeps what it last listed up, so a row keeps what was picked on it, and asks nothing', async () => {
    const asked: string[] = [];
    const { hook, initial, listed } = inbox();
    await waitFor(() => expect(listed()).toEqual(['Call the bank']));
    const working = { ...initial.ports, index: listingIndex(['Later'], asked) };

    hook.rerender({ ...initial, ports: working, indexKey: 'working', indexReady: false });
    await act(async () => {});

    expect(listed()).toEqual(['Call the bank']);
    expect(asked).toEqual([]);
  });
});

/** #55: after a vault switch the last vault's rows, and their actions, are gone at once. */
describe('useInbox — a vault switch', () => {
  it('shows nothing of the last vault while the index still holds its rows', async () => {
    const { hook, initial, listed } = inbox();
    await waitFor(() => expect(listed()).toEqual(['Call the bank']));

    // The vault changed; the index has not started on it, and still says ready.
    hook.rerender({ ...initial, vaultKey: '/vaults/b' });

    expect(listed()).toBeNull();
    expect(hook.result.current.filing).toEqual([]);
    expect(hook.result.current.people).toEqual([]);
  });

  it('does not ask the index, nor show a late answer, until it has read the new vault', async () => {
    const asked: string[] = [];
    const { hook, initial, listed } = inbox();
    await waitFor(() => expect(listed()).toEqual(['Call the bank']));
    const stale = { ...initial.ports, index: listingIndex(['Call the bank'], asked) };

    hook.rerender({ ...initial, ports: stale, vaultKey: '/vaults/b' });
    hook.rerender({ ...initial, ports: stale, vaultKey: '/vaults/b', indexReady: false });
    await act(async () => {});
    expect(asked).toEqual([]);
    expect(listed()).toBeNull();

    const fresh = { ...initial.ports, index: listingIndex(['Order seeds'], asked) };
    hook.rerender({ ...initial, ports: fresh, vaultKey: '/vaults/b', indexKey: 'ready:2' });
    await waitFor(() => expect(listed()).toEqual(['Order seeds']));
  });

  it('clarifies nothing in the window before the new vault is read', async () => {
    const { hook, initial, files, listed } = inbox();
    await waitFor(() => expect(listed()).toEqual(['Call the bank']));
    hook.rerender({ ...initial, vaultKey: '/vaults/b' });

    let done = true;
    await act(async () => {
      done = await hook.result.current.clarify({
        path: CALL,
        clarification: { status: 'next-action' },
      });
    });

    expect(done).toBe(false);
    expect(files.get(CALL)).toBe(CAPTURED);
  });

  it('forgets the last vault’s refusal and its undo', async () => {
    const { hook, initial } = inbox();
    await act(() =>
      hook.result.current.clarify({ path: CALL, clarification: { status: 'backlog' } }),
    );
    await act(() =>
      hook.result.current.clarify({ path: CALL, clarification: { due: '2026-13-45' } }),
    );
    expect(hook.result.current.lastAction).toEqual({ title: 'Call the bank' });
    expect(hook.result.current.refusal).not.toBeNull();

    hook.rerender({ ...initial, vaultKey: '/vaults/b' });

    expect(hook.result.current.lastAction).toBeNull();
    expect(hook.result.current.refusal).toBeNull();
  });
});

describe('useInbox — clarifying a row', () => {
  it('writes the row in one go, settles, and offers to take it back', async () => {
    const { hook, files, onSettled } = inbox();
    let done = false;
    await act(async () => {
      done = await hook.result.current.clarify({
        path: CALL,
        clarification: {
          status: 'waiting',
          waitingOn: createVaultPath('People/Mara Quill.md'),
          project: createVaultPath('Projects/Atlas.md'),
        },
      });
    });

    expect(done).toBe(true);
    expect(files.get('Projects/Atlas/Call the bank.md')).toBe(
      '---\ntype: task\nstatus: waiting\nwaiting_on: [[Mara Quill]]\nproject: [[Atlas]]\n---\n\nAbout the loan.\n',
    );
    expect(onSettled).toHaveBeenCalledOnce();
    expect(hook.result.current.refusal).toBeNull();
    expect(hook.result.current.lastAction).toEqual({ title: 'Call the bank' });
  });

  it('shows a refusal on its row, writes nothing, and keeps the undo of the action before', async () => {
    const { hook, files, onSettled } = inbox();
    await act(() =>
      hook.result.current.clarify({ path: CALL, clarification: { due: '2026-10-20' } }),
    );
    const before = files.get(CALL);

    let done = true;
    await act(async () => {
      done = await hook.result.current.clarify({
        path: CALL,
        clarification: { due: '2026-13-45' },
      });
    });

    expect(done).toBe(false);
    expect(hook.result.current.refusal).toEqual({
      path: CALL,
      reason: '“2026-13-45” is not a day (YYYY-MM-DD).',
    });
    expect(files.get(CALL)).toBe(before);
    expect(onSettled).toHaveBeenCalledOnce();
    expect(hook.result.current.lastAction).toEqual({ title: 'Call the bank' });
  });

  it('clarifies a row to Waiting with nobody to wait on, asking for no one (#202)', async () => {
    const { hook, files } = inbox();
    let done = false;
    await act(async () => {
      done = await hook.result.current.clarify({
        path: CALL,
        clarification: { status: 'waiting' },
      });
    });
    expect(done).toBe(true);
    expect(hook.result.current.refusal).toBeNull();
    expect(files.get(CALL)).toBe('---\ntype: task\nstatus: waiting\n---\n\nAbout the loan.\n');
  });

  it('dates a task finished from the row by the injected clock', async () => {
    const { hook, files } = inbox({ clock: { today: () => '2026-12-24' } });
    await act(() =>
      hook.result.current.clarify({ path: CALL, clarification: { status: 'archive' } }),
    );
    expect(files.get(CALL)).toContain('completed: 2026-12-24');
  });
});

describe('useInbox — undo', () => {
  it('moves the note back and puts back what it said', async () => {
    const { hook, files, onSettled } = inbox();
    await act(() =>
      hook.result.current.clarify({
        path: CALL,
        clarification: { status: 'next-action', project: createVaultPath('Projects/Atlas.md') },
      }),
    );
    expect(files.has(CALL)).toBe(false);

    await act(() => hook.result.current.undo());

    expect(files.get(CALL)).toBe(CAPTURED);
    expect(files.has('Projects/Atlas/Call the bank.md')).toBe(false);
    expect(hook.result.current.lastAction).toBeNull();
    expect(onSettled).toHaveBeenCalledTimes(2);
  });

  it('says why above the list when the note was changed since, and leaves it', async () => {
    const { hook, files } = inbox();
    await act(() =>
      hook.result.current.clarify({ path: CALL, clarification: { status: 'backlog' } }),
    );
    files.set(CALL, `${files.get(CALL) ?? ''}Edited since.\n`);

    await act(() => hook.result.current.undo());

    expect(hook.result.current.problem).toBe('It was changed since, so it was left as it is.');
    expect(files.get(CALL)).toContain('Edited since.');
  });
});
