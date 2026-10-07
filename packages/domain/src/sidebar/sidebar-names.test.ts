import { describe, expect, it } from 'vitest';
import { createVaultPath } from '../vault/vault-path.ts';
import type { VaultEntry } from '../vault/vault-entry.ts';
import { treeEntryLabel, vaultInitial } from './sidebar-names.ts';

const entry = (kind: VaultEntry['kind'], path: string): VaultEntry =>
  ({ kind, name: path.split('/').at(-1) ?? path, path: createVaultPath(path) }) as VaultEntry;

describe('treeEntryLabel', () => {
  it('shows a note without its extension', () => {
    expect(treeEntryLabel(entry('file', 'Notes/today.md'))).toBe('today');
    expect(treeEntryLabel(entry('file', 'Long.markdown'))).toBe('Long');
  });

  it('keeps an attachment’s extension, which is part of what it is', () => {
    expect(treeEntryLabel(entry('file', 'photo.png'))).toBe('photo.png');
  });

  it('shows a folder by its own name, dots and all', () => {
    expect(treeEntryLabel(entry('directory', 'v1.md'))).toBe('v1.md');
  });

  it('calls the vault’s .atlas folder System', () => {
    expect(treeEntryLabel(entry('directory', '.atlas'))).toBe('System');
  });

  it('leaves a .atlas folder further down alone', () => {
    expect(treeEntryLabel(entry('directory', 'Notes/.atlas'))).toBe('.atlas');
  });
});

describe('vaultInitial', () => {
  it('is the first letter, upper-cased', () => {
    expect(vaultInitial('atlas')).toBe('A');
    expect(vaultInitial('Work notes')).toBe('W');
  });

  it('skips leading punctuation, the way a temp folder is named', () => {
    expect(vaultInitial('.vault')).toBe('V');
    expect(vaultInitial('_2026 plans')).toBe('2');
  });

  it('takes a letter from any script', () => {
    expect(vaultInitial('été')).toBe('É');
  });

  it('has a neutral mark for a name with nothing to take', () => {
    expect(vaultInitial('')).toBe('·');
    expect(vaultInitial('---')).toBe('·');
  });
});
