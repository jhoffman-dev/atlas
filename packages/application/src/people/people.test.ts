import { describe, expect, it } from 'vitest';
import { createVaultPath, type ObjectType } from '@atlas/domain';
import { fakeIndexPort, fakeMarkdown, fakeVaultFs } from '../testing/fake-ports.ts';
import { createPerson, loadPeople } from './people.ts';

const path = (value: string) => createVaultPath(value);

describe('loadPeople', () => {
  it('reads every person with when their note last changed', async () => {
    const index = fakeIndexPort({
      notesOfType: async (type) =>
        type === 'person'
          ? [
              { path: 'People/Julie.md', title: 'Julie' },
              { path: 'Bob.md', title: 'Bob' },
            ]
          : [{ path: 'Plan.md', title: 'Plan' }],
      manifest: async () => [
        { path: 'People/Julie.md', modified: 42, size: 1 },
        { path: 'Plan.md', modified: 7, size: 1 },
      ],
    });
    expect(await loadPeople({ index })).toEqual([
      { path: 'People/Julie.md', modified: 42 },
      // Not in the manifest yet: known, but the least recent.
      { path: 'Bob.md', modified: 0 },
    ]);
  });

  it('fails when the index cannot be read, rather than offering nobody', async () => {
    const index = fakeIndexPort({
      notesOfType: async () => {
        throw new Error('index closed');
      },
    });
    await expect(loadPeople({ index })).rejects.toThrow('index closed');
  });
});

function recordingFs(
  files: Readonly<Record<string, string>> = {},
  top: readonly { name: string; kind: 'file' | 'directory' }[] = [],
) {
  const created: { path: string; contents: string }[] = [];
  const folders: string[] = [];
  const fs = fakeVaultFs({
    listDirectory: async () => top.map((entry) => ({ ...entry, path: path(entry.name) })),
    createFolder: async ({ path: at }) => {
      folders.push(at);
    },
    createNote: async ({ path: at, contents }) => {
      created.push({ path: at, contents });
    },
    readTextFile: async (at) => {
      const text = files[at];
      if (text === undefined) throw new Error(`no file ${at}`);
      return { text, modified: 1 };
    },
  });
  return { fs, created, folders };
}

const PERSON: ObjectType = { name: 'person', label: 'Person', properties: [] };
const TEMPLATE = { path: path('.atlas/templates/Person.md'), name: 'Person' };

const make = (
  fs: ReturnType<typeof recordingFs>['fs'],
  { name, notePaths = [] }: { name: string; notePaths?: readonly string[] },
) =>
  createPerson({
    fs,
    markdown: fakeMarkdown(),
    name,
    types: [PERSON],
    templates: [],
    notePaths: notePaths.map(path),
  });

describe('createPerson', () => {
  it('makes the person from the Person template in People/ and links them by name', async () => {
    const { fs, created, folders } = recordingFs({
      '.atlas/templates/Person.md': '---\ntype: person\nrole:\n---\n\nMet at:\n',
    });
    const made = await createPerson({
      fs,
      markdown: fakeMarkdown(),
      name: 'Julie Brandt',
      types: [PERSON],
      templates: [TEMPLATE],
      notePaths: [path('Projects/Plan.md')],
    });

    expect(made).toEqual({ path: 'People/Julie Brandt.md', target: 'Julie Brandt' });
    // The folder is made first, as the vault had none.
    expect(folders).toEqual(['People']);
    expect(created).toHaveLength(1);
    expect(created[0]?.path).toBe('People/Julie Brandt.md');
    expect(created[0]?.contents).toContain('type: person');
    expect(created[0]?.contents).toContain('Met at:');
  });

  it('files the person in the people folder the vault already has, as it is spelled', async () => {
    const { fs, folders } = recordingFs({}, [{ name: 'people', kind: 'directory' }]);
    const made = await make(fs, { name: 'Ann' });
    expect(made.path).toBe('people/Ann.md');
    expect(folders).toEqual([]);
  });

  it('refuses when a file called People is where the folder would go', async () => {
    const { fs, created } = recordingFs({}, [{ name: 'People', kind: 'file' }]);
    await expect(make(fs, { name: 'Ann' })).rejects.toThrow(/People is a file/);
    expect(created).toEqual([]);
  });

  it('numbers a name taken in People/, and links to the note that was made', async () => {
    const { fs } = recordingFs({}, [{ name: 'People', kind: 'directory' }]);
    const made = await make(fs, { name: 'Bob', notePaths: ['People/Bob.md'] });
    expect(made).toEqual({ path: 'People/Bob 2.md', target: 'Bob 2' });
  });

  it('links by path a new person who shares a name with a note that keeps its links', async () => {
    const { fs } = recordingFs();
    // Clients/Sam.md still wins `[[Sam]]` — same depth, first alphabetically —
    // so the new person is written by the path that opens only them.
    const made = await make(fs, { name: 'Sam', notePaths: ['Clients/Sam.md'] });
    expect(made).toEqual({ path: 'People/Sam.md', target: 'People/Sam' });
  });

  it('refuses, saying why, a person whose note would take over another note’s links', async () => {
    const { fs, created } = recordingFs();
    // People/Sam.md would sort before Zeta/Sam.md, so `[[Sam]]` would open it instead.
    await expect(make(fs, { name: 'Sam', notePaths: ['Zeta/Sam.md'] })).rejects.toThrow(
      /\[\[Sam\]\] already opens Zeta\/Sam\.md/,
    );
    expect(created).toEqual([]);
  });

  it('refuses a name a link could not hold, and makes nothing', async () => {
    const { fs, created } = recordingFs();
    await expect(make(fs, { name: 'Up^Down' })).rejects.toThrow(/cannot be linked/);
    expect(created).toEqual([]);
  });

  it('still makes a person in a vault that does not define the type', async () => {
    const { fs, created } = recordingFs();
    await createPerson({
      fs,
      markdown: fakeMarkdown(),
      name: 'Ann',
      types: [],
      templates: [],
      notePaths: [],
    });
    expect(created[0]?.contents).toContain('type: person');
  });

  it('writes nothing when the template cannot be read', async () => {
    const { fs, created } = recordingFs();
    await expect(
      createPerson({
        fs,
        markdown: fakeMarkdown(),
        name: 'Ann',
        types: [PERSON],
        templates: [TEMPLATE],
        notePaths: [],
      }),
    ).rejects.toThrow('no file');
    expect(created).toEqual([]);
  });
});
