// @vitest-environment jsdom
/**
 * P30-02: the Inbox's move to GTD, through the real markdown writer — read
 * only while the Inbox shows, run only from the preview, and every run and
 * undo said in Activity.
 */
import { describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { createVaultPath } from '@atlas/domain';
import {
  fakeIndexPort,
  fakeVaultFs,
  memoryVault,
  recordingActivity,
  type ArchivePorts,
} from '@atlas/application';
import { remarkMarkdown } from '@atlas/adapters';
import { useTaskMigration } from './use-task-migration.ts';

const FILES: Record<string, string> = {
  '.atlas/types/task.md':
    '---\nname: task\nproperties:\n  status:\n    kind: select\n    options: [backlog, doing, done]\n---\n\n# Task\n',
  'tasks/Draft the memo.md': '---\ntype: task\nstatus: doing\n---\n\nWords.\n',
  'tasks/Ship it.md': '---\ntype: task\nstatus: done\n---\n',
};

function setup({ open = true }: { open?: boolean } = {}) {
  const memory = memoryVault(FILES);
  const fs = fakeVaultFs({
    ...memory.fs,
    readNotes: async (paths) =>
      paths.flatMap((path) => {
        const text = memory.files.get(path);
        return text === undefined ? [] : [{ path, text, modified: 0, size: text.length }];
      }),
  });
  const index = fakeIndexPort({
    notesOfType: async () =>
      ['tasks/Draft the memo.md', 'tasks/Ship it.md'].map((path) => ({ path, title: path })),
  });
  const ports = {
    fs,
    markdown: remarkMarkdown,
    index,
    editors: {
      state: () => 'closed',
      reload: () => {},
      flush: async () => {},
      follow: () => {},
      abandon: () => {},
    },
  } as unknown as ArchivePorts;
  const activity = recordingActivity();
  const onChanged = vi.fn();
  const hook = renderHook(
    (props: { open: boolean }) =>
      useTaskMigration({
        ports,
        vaultKey: '/vault',
        indexReady: true,
        open: props.open,
        activity,
        onChanged,
      }),
    { initialProps: { open } },
  );
  return { files: memory.files, hook, activity, onChanged };
}

describe('useTaskMigration', () => {
  it('reads nothing until the Inbox shows', async () => {
    const { hook } = setup({ open: false });
    await act(async () => {});
    expect(hook.result.current).toBeNull();
    hook.rerender({ open: true });
    await waitFor(() => expect(hook.result.current?.preview?.tasks).toHaveLength(2));
  });

  it('moves the tasks from the preview, says so in Activity, and undoes it byte for byte', async () => {
    const { hook, files, activity, onChanged } = setup();
    await waitFor(() => expect(hook.result.current?.preview?.tasks).toHaveLength(2));
    act(() => hook.result.current?.onOpen());
    act(() => hook.result.current?.onRun());
    await waitFor(() => expect(hook.result.current?.canUndo).toBe(true));
    expect(files.get('tasks/Ship it.md')).toContain('status: archive');
    expect(onChanged).toHaveBeenCalled();
    expect(activity.reports.at(-1)?.message).toMatch(/^Moved tasks to GTD statuses/);
    expect(hook.result.current?.result).toMatch(/^Moved tasks to GTD statuses/);

    act(() => hook.result.current?.onUndo());
    await waitFor(() => expect(hook.result.current?.canUndo).toBe(false));
    for (const [path, text] of Object.entries(FILES))
      expect(files.get(createVaultPath(path))).toBe(text);
    expect(activity.reports.at(-1)?.message).toMatch(/^Undid the move to GTD/);
  });

  it('runs with the person’s own choice for an old status', async () => {
    const { hook, files } = setup();
    await waitFor(() => expect(hook.result.current?.preview?.tasks).toHaveLength(2));
    act(() => hook.result.current?.onChoose({ from: 'doing', to: 'someday' }));
    await waitFor(() =>
      expect(hook.result.current?.preview?.tasks.find((task) => task.from === 'doing')?.to).toBe(
        'someday',
      ),
    );
    act(() => hook.result.current?.onRun());
    await waitFor(() => expect(hook.result.current?.canUndo).toBe(true));
    expect(files.get('tasks/Draft the memo.md')).toBe(
      '---\ntype: task\nstatus: someday\n---\n\nWords.\n',
    );
  });
});
