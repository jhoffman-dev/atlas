import { describe, expect, it } from 'vitest';
import {
  createVaultPath,
  isArchivedPath,
  resolveWikiLinkTarget,
  splitWikiLinks,
  type ObjectType,
  type VaultPath,
} from '@atlas/domain';
import { fakeMarkdown, fakeVaultFs } from '../testing/fake-ports.ts';
import { createRelatedNote, RelatedNoteRefusedError } from './create-related-note.ts';

const COMPANY: ObjectType = { name: 'company', label: 'Company', properties: [] };
const PERSON: ObjectType = { name: 'person', label: 'Person', properties: [] };

/** A vault of files by path, refusing to create over one, as the host does. */
function memoryFs(files: Record<string, string>) {
  const store = new Map(Object.entries(files));
  const fs = fakeVaultFs({
    readTextFile: async (path) => {
      const text = store.get(path);
      if (text === undefined) throw new Error(`no file at ${path}`);
      return { text, modified: 0 };
    },
    createNote: async ({ path, contents }) => {
      if (store.has(path)) throw new Error(`${path} exists`);
      store.set(path, contents);
    },
  });
  const notePaths = () => [...store.keys()].map(createVaultPath) as VaultPath[];
  return { fs, store, notePaths };
}

const make = (type: ObjectType, name: string, vault = memoryFs({ 'Home.md': '' })) =>
  createRelatedNote({
    fs: vault.fs,
    markdown: fakeMarkdown(),
    type,
    name,
    beside: createVaultPath('Home.md'),
    notePaths: vault.notePaths(),
  });

/** The note `[[target]]` opens, read as the editor reads it. */
function opened(target: string, notes: readonly VaultPath[]): VaultPath | null {
  const [piece] = splitWikiLinks(`[[${target}]]`);
  if (piece?.kind !== 'wikiLink' || piece.heading !== null || piece.alias !== null) return null;
  return resolveWikiLinkTarget(piece.target, notes);
}

describe('createRelatedNote — attacks (issue #15)', () => {
  it.each(['Q3 #launch', 'Acme [EU]', 'Plan ^2', 'Acme]] [[Other'])(
    'never writes a link that misses the note it made, for a name like %j',
    async (name) => {
      const vault = memoryFs({ 'Home.md': '' });
      const before = vault.store.size;
      const made = await make(COMPANY, name, vault).catch((error: unknown) => error);
      if (made instanceof Error) {
        // Refusing the name is a fine answer, as long as nothing was made.
        expect(made).toBeInstanceOf(RelatedNoteRefusedError);
        expect(vault.store.size).toBe(before);
        return;
      }
      const { path, target } = made as Awaited<ReturnType<typeof createRelatedNote>>;
      expect(opened(target, vault.notePaths())).toBe(path);
    },
  );

  it('refuses a new person a link cannot reach, as @-mention and the People page do', async () => {
    await expect(make(PERSON, 'Ann #2')).rejects.toBeInstanceOf(RelatedNoteRefusedError);
  });

  it('never makes the new task inside the Archive when the note it is beside is archived', async () => {
    const archived = createVaultPath('Archive/Projects/Old launch.md');
    const vault = memoryFs({ [archived]: '---\ntype: project\n---\n' });
    const made = await createRelatedNote({
      fs: vault.fs,
      markdown: fakeMarkdown(),
      type: { name: 'task', label: 'Task', properties: [] },
      name: 'Write the retro',
      beside: archived,
      notePaths: vault.notePaths(),
    });
    expect(isArchivedPath(made.path)).toBe(false);
  });

  it('refuses a name that cleans to nothing rather than making an "Untitled" note', async () => {
    const vault = memoryFs({ 'Home.md': '' });
    await expect(make(COMPANY, '???', vault)).rejects.toBeInstanceOf(RelatedNoteRefusedError);
    expect([...vault.store.keys()]).toEqual(['Home.md']);
  });
});
