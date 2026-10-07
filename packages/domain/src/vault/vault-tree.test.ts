import { describe, expect, it } from 'vitest';
import { flattenVaultTree, sortVaultEntries, type VaultTreeState } from './vault-tree.ts';
import { createVaultPath, type VaultPath } from './vault-path.ts';
import type { VaultEntry } from './vault-entry.ts';

const dir = (path: string): VaultEntry => ({
  kind: 'directory',
  name: path.split('/').at(-1) ?? '',
  path: createVaultPath(path),
});
const file = (path: string): VaultEntry => ({
  kind: 'file',
  name: path.split('/').at(-1) ?? '',
  path: createVaultPath(path),
});

const state = (
  children: Record<string, VaultEntry[]>,
  expanded: string[] = [],
): VaultTreeState => ({
  children: new Map(
    Object.entries(children).map(([path, entries]) => [path as VaultPath, entries]),
  ),
  expanded: new Set(expanded.map((path) => createVaultPath(path))),
});

describe('sortVaultEntries', () => {
  it('puts directories above files', () => {
    const sorted = sortVaultEntries([file('a.md'), dir('z-folder')]);
    expect(sorted.map((entry) => entry.name)).toEqual(['z-folder', 'a.md']);
  });

  it('sorts case-insensitively', () => {
    const sorted = sortVaultEntries([file('banana.md'), file('Apple.md'), file('cherry.md')]);
    expect(sorted.map((entry) => entry.name)).toEqual(['Apple.md', 'banana.md', 'cherry.md']);
  });

  it('orders digit runs numerically, the way Finder does', () => {
    const sorted = sortVaultEntries([file('note10.md'), file('note9.md'), file('note1.md')]);
    expect(sorted.map((entry) => entry.name)).toEqual(['note1.md', 'note9.md', 'note10.md']);
  });

  it('puts the vault’s .atlas folder after everything else, files included', () => {
    const sorted = sortVaultEntries([file('a.md'), dir('.atlas'), dir('Notes')]);
    expect(sorted.map((entry) => entry.name)).toEqual(['Notes', 'a.md', '.atlas']);
  });

  it('puts the root attachments folder after the notes, just before .atlas', () => {
    const sorted = sortVaultEntries([
      dir('.atlas'),
      file('b.md'),
      dir('attachments'),
      dir('Zebra'),
      dir('Apple'),
    ]);
    expect(sorted.map((entry) => entry.name)).toEqual([
      'Apple',
      'Zebra',
      'b.md',
      'attachments',
      '.atlas',
    ]);
  });

  it('sorts an attachments folder deeper down, or a file of that name, like any other', () => {
    const nested = sortVaultEntries([dir('Notes/attachments'), dir('Notes/Zebra')]);
    expect(nested.map((entry) => entry.name)).toEqual(['attachments', 'Zebra']);
    const named = sortVaultEntries([file('attachments'), file('b.md')]);
    expect(named.map((entry) => entry.name)).toEqual(['attachments', 'b.md']);
  });

  it('sorts a nested .atlas folder like any other folder', () => {
    const sorted = sortVaultEntries([file('Notes/a.md'), dir('Notes/.atlas')]);
    expect(sorted.map((entry) => entry.path)).toEqual(['Notes/.atlas', 'Notes/a.md']);
  });

  it('does not mutate the input', () => {
    const input = [file('b.md'), file('a.md')];
    sortVaultEntries(input);
    expect(input.map((entry) => entry.name)).toEqual(['b.md', 'a.md']);
  });
});

describe('the Archive in the tree', () => {
  it('sits after attachments and before .atlas', () => {
    const sorted = sortVaultEntries([dir('.atlas'), dir('Archive'), dir('attachments'), dir('A')]);
    expect(sorted.map((entry) => entry.name)).toEqual(['A', 'attachments', 'Archive', '.atlas']);
  });

  it('is one row that never opens, however it is asked to, so its notes are never walked', () => {
    const rows = flattenVaultTree(
      state({ '': [dir('Archive'), dir('Notes')], Archive: [file('Archive/old.md')], Notes: [] }, [
        'Archive',
        'Notes',
      ]),
    );
    expect(rows.map((row) => [row.entry.name, row.isExpanded])).toEqual([
      ['Notes', true],
      ['Archive', false],
    ]);
  });
});

describe('flattenVaultTree', () => {
  it('is empty when the root has not been read yet', () => {
    expect(flattenVaultTree(state({}))).toEqual([]);
  });

  it('lists the root children, sorted, at depth zero', () => {
    const rows = flattenVaultTree(state({ '': [file('b.md'), dir('Notes')] }));
    expect(rows.map((row) => [row.entry.name, row.depth])).toEqual([
      ['Notes', 0],
      ['b.md', 0],
    ]);
  });

  it('hides the children of a collapsed directory', () => {
    const rows = flattenVaultTree(
      state({ '': [dir('Notes')], Notes: [file('Notes/today.md')] }, []),
    );
    expect(rows.map((row) => row.entry.name)).toEqual(['Notes']);
  });

  it('includes the children of an expanded directory, one level deeper', () => {
    const rows = flattenVaultTree(
      state({ '': [dir('Notes')], Notes: [file('Notes/today.md')] }, ['Notes']),
    );
    expect(rows.map((row) => [row.entry.name, row.depth])).toEqual([
      ['Notes', 0],
      ['today.md', 1],
    ]);
  });

  it('nests to arbitrary depth', () => {
    const rows = flattenVaultTree(
      state(
        {
          '': [dir('a')],
          a: [dir('a/b')],
          'a/b': [file('a/b/c.md')],
        },
        ['a', 'a/b'],
      ),
    );
    expect(rows.map((row) => row.depth)).toEqual([0, 1, 2]);
  });

  it('marks an expanded directory whose children have not arrived as not loaded', () => {
    const [row] = flattenVaultTree(state({ '': [dir('Notes')] }, ['Notes']));
    expect(row).toMatchObject({ isExpanded: true, isLoaded: false });
  });

  it('marks a directory as loaded once its children are known', () => {
    const [row] = flattenVaultTree(state({ '': [dir('Notes')], Notes: [] }, ['Notes']));
    expect(row).toMatchObject({ isExpanded: true, isLoaded: true });
  });

  it('treats files as loaded and never expanded', () => {
    const [row] = flattenVaultTree(state({ '': [file('a.md')] }));
    expect(row).toMatchObject({ isExpanded: false, isLoaded: true });
  });

  it('omits hidden entries and does not descend into them', () => {
    const rows = flattenVaultTree(
      state({ '': [dir('.git'), dir('Notes')], '.git': [file('.git/config')] }, ['.git', 'Notes']),
    );
    expect(rows.map((row) => row.entry.name)).toEqual(['Notes']);
  });

  it("leaves out an artifact's saved copy, and keeps its note and other folders", () => {
    const rows = flattenVaultTree(
      state(
        {
          '': [dir('artifacts')],
          artifacts: [
            dir('artifacts/sales-deck'),
            file('artifacts/Sales deck.md'),
            dir('artifacts/Drafts'),
          ],
        },
        ['artifacts'],
      ),
    );
    expect(rows.map((row) => row.entry.path)).toEqual([
      'artifacts',
      'artifacts/Drafts',
      'artifacts/Sales deck.md',
    ]);
  });

  it('ignores an expanded path that is not in the tree', () => {
    const rows = flattenVaultTree(state({ '': [file('a.md')] }, ['ghost']));
    expect(rows).toHaveLength(1);
  });
});
