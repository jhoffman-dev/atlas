import { describe, expect, it } from 'vitest';
import { createVaultPath } from '../vault/vault-path.ts';
import type { VaultEntry } from '../vault/vault-entry.ts';
import { treeEntryIcon, typeIcon, viewIcon } from './sidebar-icon.ts';

const entry = (kind: VaultEntry['kind'], path: string): VaultEntry =>
  ({ kind, name: path.split('/').at(-1) ?? path, path: createVaultPath(path) }) as VaultEntry;

describe('typeIcon', () => {
  it.each([
    ['task', 'task'],
    ['Tasks', 'task'],
    ['todo', 'task'],
    ['person', 'person'],
    ['People', 'person'],
    ['contact', 'person'],
    ['company', 'company'],
    ['Companies', 'company'],
    ['organization', 'company'],
    ['event', 'event'],
    ['meetings', 'event'],
  ])('recognises %s', (name, icon) => {
    expect(typeIcon(name)).toBe(icon);
  });

  it('ignores surrounding space', () => {
    expect(typeIcon('  task ')).toBe('task');
  });

  it('draws a type it does not recognise as a plain document', () => {
    expect(typeIcon('recipe')).toBe('doc');
    expect(typeIcon('')).toBe('doc');
  });

  it('does not match on part of a word', () => {
    expect(typeIcon('taskforce')).toBe('doc');
  });
});

describe('viewIcon', () => {
  it.each([
    ['table', 'table'],
    ['board', 'board'],
    ['list', 'list'],
    ['gallery', 'grid'],
    ['calendar', 'calendar'],
    ['timeline', 'timeline'],
  ] as const)('draws a %s view as %s', (layout, icon) => {
    expect(viewIcon(layout)).toBe(icon);
  });
});

describe('treeEntryIcon', () => {
  it('draws a note as a document and a folder as a folder', () => {
    expect(treeEntryIcon(entry('file', 'Notes/today.md'))).toBe('doc');
    expect(treeEntryIcon(entry('directory', 'Notes'))).toBe('folder');
  });

  it('draws the vault’s own .atlas folder as the system folder', () => {
    expect(treeEntryIcon(entry('directory', '.atlas'))).toBe('system');
  });

  it('draws a nested folder that happens to be called .atlas as a folder', () => {
    expect(treeEntryIcon(entry('directory', 'Notes/.atlas'))).toBe('folder');
  });
});
