import { describe, expect, it } from 'vitest';
import { isMarkdownFile, noteTitle, type VaultEntry } from './vault-entry.ts';
import { createVaultPath } from './vault-path.ts';

const file = (path: string): VaultEntry => ({
  kind: 'file',
  name: path.split('/').at(-1) ?? '',
  path: createVaultPath(path),
});

describe('isMarkdownFile', () => {
  it.each(['a.md', 'a.markdown', 'A.MD', 'Notes/deep/a.Md'])('accepts %j', (path) => {
    expect(isMarkdownFile(file(path))).toBe(true);
  });

  it.each(['a.txt', 'a.mdx', 'a.md.png', 'README'])('rejects %j', (path) => {
    expect(isMarkdownFile(file(path))).toBe(false);
  });

  it('is false for a directory even when it is named like a note', () => {
    const directory: VaultEntry = {
      kind: 'directory',
      name: 'archive.md',
      path: createVaultPath('archive.md'),
    };
    expect(isMarkdownFile(directory)).toBe(false);
  });
});

describe('noteTitle', () => {
  it('drops the markdown extension', () => {
    expect(noteTitle(createVaultPath('Notes/Weekly review.md'))).toBe('Weekly review');
  });

  it('drops a .markdown extension', () => {
    expect(noteTitle(createVaultPath('a.markdown'))).toBe('a');
  });

  it('keeps dots that are part of the name', () => {
    expect(noteTitle(createVaultPath('2026-09-20.draft.md'))).toBe('2026-09-20.draft');
  });

  it('leaves a non-markdown name alone', () => {
    expect(noteTitle(createVaultPath('diagram.png'))).toBe('diagram.png');
  });
});
