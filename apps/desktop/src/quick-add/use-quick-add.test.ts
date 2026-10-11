// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { createVaultPath, type FabAnchor, type ObjectType } from '@atlas/domain';
import { fakeVaultFs, type NoteTemplate } from '@atlas/application';
import { remarkMarkdown } from '@atlas/adapters';
import type { FabAnchorStore } from '@atlas/ui';
import { useQuickAdd } from './use-quick-add.ts';
import type { QuickAddSetting } from './use-quick-add-setting.ts';

const TASK: ObjectType = {
  name: 'task',
  label: 'Task',
  properties: [
    {
      key: 'status',
      kind: 'select',
      label: 'Status',
      required: true,
      options: ['backlog', 'doing'],
      target: null,
      many: false,
    },
    {
      key: 'project',
      kind: 'relation',
      label: 'Project',
      required: false,
      options: [],
      target: 'project',
      many: false,
    },
  ],
};
const PROJECT: ObjectType = { name: 'project', label: 'Project', properties: [] };
const TASK_TEMPLATE: NoteTemplate = {
  path: createVaultPath('.atlas/templates/Task.md'),
  name: 'Task',
};

function setup({
  configured = null,
  stored = null,
}: { configured?: readonly string[] | null; stored?: FabAnchor | null } = {}) {
  const created: { path: string; contents: string }[] = [];
  const written: FabAnchor[] = [];
  const store: FabAnchorStore = { read: () => stored, write: (anchor) => written.push(anchor) };
  const fs = fakeVaultFs({
    createNote: async ({ path, contents }) => {
      created.push({ path, contents });
    },
  });
  const show = vi.fn();
  const hide = vi.fn();
  const onCreated = vi.fn();
  const notesOfType = vi.fn(async () => [{ path: 'Garden.md', title: 'Garden' }]);
  const setting: QuickAddSetting = { configured, save: () => {}, problem: null };
  // Held still across renders, as the app memoises them.
  const args = {
    ports: { fs, markdown: remarkMarkdown, index: { notesOfType }, store },
    setting,
    types: [TASK, PROJECT],
    templates: [TASK_TEMPLATE],
    contentsOf: async () => '---\ntype: task\nstatus: backlog\n---\n\n',
    notePaths: [],
    beside: null,
    overlay: { show, hide },
    onCreated,
  };
  const hook = renderHook(() => useQuickAdd(args));
  return { hook, created, written, show, hide, onCreated, notesOfType };
}

describe('useQuickAdd', () => {
  it('offers Task by default, and its shortcut asks for a task at once', () => {
    const { hook, show } = setup();
    expect(hook.result.current.offered.map((type) => type.name)).toEqual(['task']);

    act(() => hook.result.current.start());

    expect(show).toHaveBeenCalledWith('quick-add');
    expect(hook.result.current.chosen?.name).toBe('task');
    expect(hook.result.current.fields.map((field) => field.key)).toEqual(['status', 'project']);
  });

  it('opens the dial instead when several types are offered', () => {
    const { hook, show } = setup({ configured: ['task', 'project'] });
    act(() => hook.result.current.start());
    expect(show).toHaveBeenCalledWith('quick-add-menu');
    expect(hook.result.current.chosen).toBeNull();
  });

  it('reads the notes a relation can point at when its type is chosen', async () => {
    const { hook, notesOfType } = setup();
    act(() => hook.result.current.pick('task'));
    await waitFor(() =>
      expect(hook.result.current.choices).toEqual({
        project: [{ path: 'Garden.md', title: 'Garden', type: 'project' }],
      }),
    );
    expect(notesOfType).toHaveBeenCalledWith('project');
  });

  it('adds a task from its template, closes, and offers to open it', async () => {
    const { hook, created, hide, onCreated } = setup();
    act(() => hook.result.current.pick('task'));

    await act(() =>
      hook.result.current.add({
        name: 'Plant bulbs',
        values: { status: 'doing', project: '' },
        open: false,
      }),
    );

    expect(created[0]?.path).toBe('Plant bulbs.md');
    expect(created[0]?.contents).toContain('status: doing');
    expect(hide).toHaveBeenCalledWith('quick-add');
    expect(onCreated).toHaveBeenCalledWith({ path: 'Plant bulbs.md', open: false });
    expect(hook.result.current.added).toEqual({ label: 'Task', path: 'Plant bulbs.md' });
  });

  it('offers no toast when the note is opened instead', async () => {
    const { hook, onCreated } = setup();
    act(() => hook.result.current.pick('task'));
    await act(() => hook.result.current.add({ name: 'X', values: {}, open: true }));
    expect(onCreated).toHaveBeenCalledWith({ path: 'X.md', open: true });
    expect(hook.result.current.added).toBeNull();
  });

  it('rests where it was left last time, and remembers a move', () => {
    const { hook, written } = setup({ stored: 'top-left' });
    expect(hook.result.current.anchor).toBe('top-left');

    act(() => hook.result.current.move('bottom-middle'));

    expect(hook.result.current.anchor).toBe('bottom-middle');
    expect(written).toEqual(['bottom-middle']);
  });

  it('starts bottom-right on a first run', () => {
    expect(setup().hook.result.current.anchor).toBe('bottom-right');
  });
});
