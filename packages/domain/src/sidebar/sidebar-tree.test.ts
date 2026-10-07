import { describe, expect, it } from 'vitest';
import { createVaultPath } from '../vault/vault-path.ts';
import type { VaultEntry } from '../vault/vault-entry.ts';
import type { VaultTreeRow } from '../vault/vault-tree.ts';
import { sidebarTreeRows } from './sidebar-tree.ts';

const row = (kind: VaultEntry['kind'], path: string): VaultTreeRow => ({
  entry: { kind, name: path.split('/').at(-1) ?? path, path: createVaultPath(path) } as VaultEntry,
  depth: path.split('/').length - 1,
  isExpanded: false,
  isLoaded: true,
});

describe('sidebarTreeRows', () => {
  it('names and draws each row, keeping everything the tree knew', () => {
    const rows = sidebarTreeRows([
      row('directory', 'Notes'),
      row('file', 'Notes/today.md'),
      row('directory', '.atlas'),
    ]);

    expect(rows.map((each) => [each.label, each.icon, each.depth])).toEqual([
      ['Notes', 'folder', 0],
      ['today', 'doc', 1],
      ['System', 'system', 0],
    ]);
    expect(rows[1]?.entry.path).toBe('Notes/today.md');
  });
});

describe('the Archive row', () => {
  it('is called Archive, wears its own icon and opens the Archive', () => {
    const [archive, notes] = sidebarTreeRows([
      row('directory', 'archive'),
      row('directory', 'Notes'),
    ]);
    expect([archive?.label, archive?.icon, archive?.opensArchive]).toEqual([
      'Archive',
      'archive',
      true,
    ]);
    expect(notes?.opensArchive).toBe(false);
  });

  it('is only the folder at the root', () => {
    const [nested] = sidebarTreeRows([row('directory', 'Projects/Archive')]);
    expect([nested?.label, nested?.icon, nested?.opensArchive]).toEqual([
      'Archive',
      'folder',
      false,
    ]);
  });
});
