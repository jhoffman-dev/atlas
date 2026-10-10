import { describe, expect, it } from 'vitest';
import { createVaultPath, type ObjectType, type VaultEntry } from '@atlas/domain';
import { fakeMarkdown, fakeVaultFs } from '../testing/fake-ports.ts';
import { createNoteOfType } from './new-note-of-type.ts';

const BOOK: ObjectType = { name: 'book', label: 'Book', properties: [] };
const file = (name: string): VaultEntry => ({
  kind: 'file',
  name: `${name}.md`,
  path: createVaultPath(`.atlas/templates/${name}.md`),
});

function recordingVault(templateText: string, templates: readonly string[]) {
  const created: { path: string; contents: string }[] = [];
  const fs = fakeVaultFs({
    listDirectory: async (path) => (path === '.atlas/templates' ? templates.map(file) : []),
    readTextFile: async (path) => {
      if (path !== '.atlas/templates/Book.md') throw new Error(`read ${path}`);
      return { text: templateText, modified: 1 };
    },
    createNote: async (args) => {
      created.push(args);
    },
  });
  return { fs, created };
}

describe('a new note of a type', () => {
  it('starts from the type’s template, its type said even where the template forgot', async () => {
    const vault = recordingVault('---\nauthor: \n---\n## Notes\n', ['Book']);
    const path = await createNoteOfType({
      fs: vault.fs,
      markdown: fakeMarkdown(),
      type: BOOK,
      notePaths: [],
      today: '2026-10-08',
    });
    expect(path).toBe('New Book.md');
    expect(vault.created).toEqual([
      { path: 'New Book.md', contents: '---\nauthor: \ntype: book\n---\n## Notes\n' },
    ]);
  });

  it('is an empty note of the type when the type has no template', async () => {
    const vault = recordingVault('unread', ['Meeting']);
    await createNoteOfType({
      fs: vault.fs,
      markdown: fakeMarkdown(),
      type: BOOK,
      notePaths: ['New Book.md'],
      today: '2026-10-08',
    });
    expect(vault.created).toEqual([{ path: 'New Book 2.md', contents: '---\ntype: book\n---\n' }]);
  });
});
