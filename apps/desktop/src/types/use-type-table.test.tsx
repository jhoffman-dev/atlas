// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import type { ObjectType, VaultPath } from '@atlas/domain';
import { fakeIndexPort, fakeVaultFs } from '@atlas/application';
import { remarkMarkdown } from '@atlas/adapters';
import { useTypeTable } from './use-type-table.ts';
import type { OpenEditors } from '../panes/open-editors.ts';

/** R13-03: editing a cell in a type's table writes a note a pane may hold. */

const TASK_PATH = 'first.md';
const TASK = ['---', 'type: task', 'status: backlog', '---', '', '# First', ''].join('\n');

const TYPES: readonly ObjectType[] = [
  {
    name: 'task',
    label: 'Task',
    properties: [
      {
        key: 'status',
        kind: 'select',
        label: 'status',
        required: false,
        options: ['backlog', 'doing', 'done'],
        target: null,
        many: false,
      },
    ],
  },
];

/** Built once: a new port on every render would re-run the table for ever. */
const INDEX = fakeIndexPort();

function fakeEditors(holdsTheNote: boolean) {
  const asked: { path: VaultPath; values: unknown }[] = [];
  const registry: OpenEditors = {
    register: () => {},
    setPropertiesIfOpen: async (args) => {
      asked.push({ path: args.path, values: args.values });
      return holdsTheNote;
    },
    savePane: () => {},
    reloadOthers: () => {},
  };
  return { registry, asked };
}

function fakeVault() {
  const files: Record<string, string> = { [TASK_PATH]: TASK };
  const written: { path: string; contents: string }[] = [];
  const fs = fakeVaultFs({
    readTextFile: async (path) => {
      const text = files[path];
      if (text === undefined) throw new Error(`no such file: ${path}`);
      return { text, modified: 1 };
    },
    writeTextFile: async ({ path, contents }) => {
      written.push({ path, contents });
      files[path] = contents;
      return 2;
    },
  });
  return { fs, written };
}

const settle = () => act(async () => new Promise<void>((resolve) => setTimeout(resolve, 0)));

const showTable = (vault: ReturnType<typeof fakeVault>, editors: OpenEditors) =>
  renderHook(() =>
    useTypeTable({
      fs: vault.fs,
      markdown: remarkMarkdown,
      index: INDEX,
      types: TYPES,
      typeName: 'task',
      indexKey: 'ready:1',
      onChanged: () => {},
      editors,
    }),
  );

describe('a type table writing a note', () => {
  it('edits a cell through the pane that holds the note', async () => {
    const vault = fakeVault();
    const { registry, asked } = fakeEditors(true);
    const table = showTable(vault, registry);

    act(() => table.result.current.editCell({ path: TASK_PATH, column: 'status', value: 'doing' }));
    await settle();

    expect(asked).toEqual([{ path: TASK_PATH, values: { status: 'doing' } }]);
    expect(vault.written).toEqual([]);
  });

  it('writes the file itself when no pane holds the note', async () => {
    const vault = fakeVault();
    const { registry, asked } = fakeEditors(false);
    const table = showTable(vault, registry);

    act(() => table.result.current.editCell({ path: TASK_PATH, column: 'status', value: 'doing' }));
    await settle();

    expect(asked).toHaveLength(1);
    expect(vault.written[0]?.contents).toContain('status: doing');
  });
});
