import { describe, expect, it } from 'vitest';
import { createVaultPath, type VaultEntry } from '@atlas/domain';
import { fakeMarkdown, fakeVaultFs } from '../testing/fake-ports.ts';
import { loadObjectTypes, noteTypeName } from './load-types.ts';

const file = (name: string): VaultEntry => ({
  kind: 'file',
  name,
  path: createVaultPath(`.atlas/types/${name}`),
});

describe('loadObjectTypes', () => {
  it('reads each type with the file it is written in, sorted by name', async () => {
    const texts: Record<string, string> = {
      '.atlas/types/Tasks.md': '---\nname: task\nlabel: Task\n---\n',
      '.atlas/types/book.md': '---\nname: book\n---\n',
    };
    const fs = fakeVaultFs({
      listDirectory: async () => [file('Tasks.md'), file('book.md'), file('notes.txt')],
      readNotes: async (paths) =>
        paths.map((path) => ({ path, text: texts[path] ?? '', modified: 1, size: 1 })),
    });
    const types = await loadObjectTypes({ fs, markdown: fakeMarkdown() });
    expect(types.map((type) => [type.name, type.path])).toEqual([
      ['book', '.atlas/types/book.md'],
      // The file need not be named after the type; an edit writes where it was found.
      ['task', '.atlas/types/Tasks.md'],
    ]);
  });

  it('skips a file that is not a type, and has none without a types folder', async () => {
    const fs = fakeVaultFs({
      listDirectory: async () => [file('broken.md')],
      readNotes: async (paths) =>
        paths.map((path) => ({ path, text: 'no name', modified: 1, size: 1 })),
    });
    expect(await loadObjectTypes({ fs, markdown: fakeMarkdown() })).toEqual([]);
    const missing = fakeVaultFs({
      listDirectory: async () => {
        throw new Error('no such folder');
      },
    });
    expect(await loadObjectTypes({ fs: missing, markdown: fakeMarkdown() })).toEqual([]);
  });
});

describe('noteTypeName', () => {
  it('is the declared type, or null when there is none', () => {
    expect(noteTypeName({ type: ' task ' })).toBe('task');
    expect(noteTypeName({ type: '' })).toBeNull();
    expect(noteTypeName({})).toBeNull();
  });
});
