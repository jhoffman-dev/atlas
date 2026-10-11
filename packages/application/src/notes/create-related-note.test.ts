import { describe, expect, it } from 'vitest';
import {
  createVaultPath,
  parentVaultPath,
  vaultPathName,
  type ObjectType,
  type VaultPath,
} from '@atlas/domain';
import { fakeMarkdown, fakeVaultFs } from '../testing/fake-ports.ts';
import { createRelatedNote } from './create-related-note.ts';

const COMPANY_TEMPLATE = '---\ntype: company\nstage:\nsite:\n---\n\n## About\n';

const COMPANY: ObjectType = { name: 'company', label: 'Company', properties: [] };

/** A vault of files by path, refusing to create over one, as the host does. */
function memoryFs(files: Record<string, string>) {
  const store = new Map(Object.entries(files));
  const fs = fakeVaultFs({
    // The files directly in `folder`, which is how the templates are found.
    listDirectory: async (folder) =>
      [...store.keys()]
        .map(createVaultPath)
        .filter((path) => parentVaultPath(path) === folder)
        .map((path) => ({ kind: 'file' as const, name: vaultPathName(path), path })),
    readTextFile: async (path) => {
      const text = store.get(path);
      if (text === undefined) throw new Error(`no file at ${path}`);
      return { text, modified: 0 };
    },
    createNote: async ({ path, contents }) => {
      if (store.has(path)) throw new Error(`${path} exists`);
      store.set(path, contents);
    },
    moveEntry: async ({ from }) => {
      throw new Error(`nothing may move ${from}`);
    },
    writeTextFile: async ({ path }) => {
      throw new Error(`nothing may write over ${path}`);
    },
  });
  const notePaths = () => [...store.keys()].map(createVaultPath) as VaultPath[];
  return { fs, store, notePaths };
}

describe('createRelatedNote — "New company" in a relation picker (issue #15)', () => {
  it('makes a new note of the type from its template, at the root, named as typed', async () => {
    const vault = memoryFs({
      '.atlas/templates/Company.md': COMPANY_TEMPLATE,
      'Sam Rivera.md': '---\ntype: person\n---\n',
    });

    const made = await createRelatedNote({
      today: '2026-10-08',
      fs: vault.fs,
      markdown: fakeMarkdown(),
      type: COMPANY,
      name: 'Larkspur Payroll',
      beside: createVaultPath('Sam Rivera.md'),
      notePaths: vault.notePaths(),
    });

    expect(made).toEqual({ path: 'Larkspur Payroll.md', target: 'Larkspur Payroll' });
    const contents = vault.store.get('Larkspur Payroll.md') ?? '';
    expect(contents).toContain('type: company');
    expect(contents).toContain('## About');
    // The template is where it was, as it was.
    expect(vault.store.get('.atlas/templates/Company.md')).toBe(COMPANY_TEMPLATE);
  });

  it('numbers a name that is taken, and links the note it made', async () => {
    const vault = memoryFs({
      '.atlas/templates/Company.md': COMPANY_TEMPLATE,
      'Acme.md': '---\ntype: company\n---\n',
    });

    const made = await createRelatedNote({
      today: '2026-10-08',
      fs: vault.fs,
      markdown: fakeMarkdown(),
      type: COMPANY,
      name: 'Acme',
      beside: null,
      notePaths: vault.notePaths(),
    });

    expect(made).toEqual({ path: 'Acme 2.md', target: 'Acme 2' });
    expect(vault.store.get('Acme.md')).toBe('---\ntype: company\n---\n');
  });

  it('makes the note at the root even when the note in view is a template', async () => {
    const vault = memoryFs({ '.atlas/templates/Person.md': '---\ntype: person\n---\n' });

    const made = await createRelatedNote({
      today: '2026-10-08',
      fs: vault.fs,
      markdown: fakeMarkdown(),
      type: COMPANY,
      name: 'Larkspur Payroll',
      beside: createVaultPath('.atlas/templates/Person.md'),
      notePaths: vault.notePaths(),
    });

    expect(made.path).toBe('Larkspur Payroll.md');
    expect(vault.store.get('Larkspur Payroll.md')).toContain('type: company');
  });

  it('refuses an empty name rather than making "Untitled"', async () => {
    const vault = memoryFs({});
    await expect(
      createRelatedNote({
        today: '2026-10-08',
        fs: vault.fs,
        markdown: fakeMarkdown(),
        type: COMPANY,
        name: '   ',
        beside: null,
        notePaths: [],
      }),
    ).rejects.toThrow(/name/i);
    expect(vault.store.size).toBe(0);
  });
});
