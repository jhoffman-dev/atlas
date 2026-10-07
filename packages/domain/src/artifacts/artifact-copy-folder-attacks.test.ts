import { describe, expect, it } from 'vitest';
import { flattenVaultTree } from '../vault/vault-tree.ts';
import { createVaultPath, type VaultPath } from '../vault/vault-path.ts';
import type { VaultEntry } from '../vault/vault-entry.ts';

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

const paths = (children: Record<string, VaultEntry[]>, expanded: string[]) =>
  flattenVaultTree({
    children: new Map(
      Object.entries(children).map(([path, entries]) => [path as VaultPath, entries]),
    ),
    expanded: new Set(expanded.map((path) => createVaultPath(path))),
  }).map((row) => row.entry.path);

describe('the Pages hiding rule — adversarial', () => {
  it('never hides a note: one in a folder that merely shares a note’s slug stays in Pages', () => {
    // A person's own folder of notes in artifacts/, beside a plain note of the
    // same name. The rule judges by name alone, so the whole folder vanishes.
    const shown = paths(
      {
        '': [dir('artifacts')],
        artifacts: [file('artifacts/Research.md'), dir('artifacts/research')],
        'artifacts/research': [file('artifacts/research/Interview notes.md')],
      },
      ['artifacts', 'artifacts/research'],
    );
    expect(shown).toContain('artifacts/research/Interview notes.md');
  });
});
