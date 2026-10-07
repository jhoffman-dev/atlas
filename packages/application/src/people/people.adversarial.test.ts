import { describe, expect, it } from 'vitest';
import {
  createVaultPath,
  isPersonType,
  resolveWikiLinkTarget,
  splitWikiLinks,
  type ObjectType,
  type VaultPath,
} from '@atlas/domain';
import { fakeIndexPort, fakeMarkdown, fakeVaultFs } from '../testing/fake-ports.ts';
import { deleteEntry } from '../vault/delete-entry.ts';
import { renameEntry } from '../vault/relocate-entry.ts';
import type { OpenEditorsPort } from '../vault/ports.ts';
import { createPerson, loadPeople } from './people.ts';

/**
 * Attacks on people (P21-01, P21-02) at the use-case level: who counts as a
 * person, what a new person's link is written as, what making one does to the
 * links already in the vault, and what protects the Person type.
 */

const path = (value: string) => createVaultPath(value);
const PERSON: ObjectType = { name: 'person', label: 'Person', properties: [] };

function creatingFs() {
  const created: string[] = [];
  const fs = fakeVaultFs({
    createNote: async ({ path: at }) => {
      created.push(at);
    },
  });
  return { fs, created };
}

/** The note a `[[target]]` opens once written into a file and read back. */
function opens(target: string, notes: readonly VaultPath[]): VaultPath | null {
  const [piece] = splitWikiLinks(`[[${target}]]`);
  if (piece?.kind !== 'wikiLink') return null;
  return resolveWikiLinkTarget(piece.target, notes);
}

describe('who @ knows as a person', () => {
  // `type:` is matched exactly, as the index's SQL does, and a page says
  // "Mentioned in" for the same notes — never for one @ does not offer (A21-02).
  it.each(['person', 'Person', 'PERSON'])(
    'is exactly who gets a person’s page: `type: %s`',
    async (declaredType) => {
      const index = fakeIndexPort({
        notesOfType: async (type) =>
          type === declaredType ? [{ path: 'People/Julie.md', title: 'Julie' }] : [],
        manifest: async () => [],
      });
      const offered = (await loadPeople({ index })).length > 0;
      expect(offered).toBe(isPersonType(declaredType));
    },
  );
});

describe('a person made from @', () => {
  // `#` is read as a heading and `^` as a block by a link, in the name and in
  // any path holding it: no link written to the file could open such a person,
  // so none is made (A21-02).
  it.each(['C# Guild', 'F# Study Group'])(
    'is refused, with the reason, when no link to them could open them: %s',
    async (name) => {
      const { fs, created } = creatingFs();
      await expect(
        createPerson({
          fs,
          markdown: fakeMarkdown(),
          name,
          types: [PERSON],
          templates: [],
          notePaths: [],
        }),
      ).rejects.toThrow(/cannot be linked/);
      expect(created).toEqual([]);
    },
  );

  it('does not take over the links already written to another note of that name', async () => {
    const notePaths = [path('Clients/Sam.md'), path('Standup.md')];
    // Standup.md has said [[Sam]] for months, meaning the client.
    expect(resolveWikiLinkTarget('Sam', notePaths)).toBe('Clients/Sam.md');
    const { fs } = creatingFs();
    const made = await createPerson({
      fs,
      markdown: fakeMarkdown(),
      name: 'Sam',
      types: [PERSON],
      templates: [],
      notePaths,
    });
    expect(resolveWikiLinkTarget('Sam', [...notePaths, made.path])).toBe('Clients/Sam.md');
    // And the link written for the new person opens them, not the client.
    expect(opens(made.target, [...notePaths, made.path])).toBe(made.path);
  });
});

describe('the Person type’s own file', () => {
  it('cannot be deleted under a file name other than the type’s name', async () => {
    // Hand-written or synced from elsewhere: the type is its `name:`, not its file name.
    const file = path('.atlas/types/People.md');
    const trashed: string[] = [];
    const fs = fakeVaultFs({
      readTextFile: async () => ({ text: '---\nname: person\nlabel: Person\n---\n', modified: 1 }),
      trashEntry: async ({ path: at }) => {
        trashed.push(at);
      },
    });
    const editors: OpenEditorsPort = {
      state: () => 'closed',
      flush: async () => {},
      follow: () => {},
      abandon: () => {},
    };
    await deleteEntry({
      fs,
      index: fakeIndexPort(),
      editors,
      entry: { path: file, kind: 'file' },
      notePaths: [],
    }).catch(() => undefined);
    expect(trashed).toEqual([]);
  });

  it('cannot be renamed under a file name other than the type’s name', async () => {
    const file = path('.atlas/types/People.md');
    const moved: string[] = [];
    const fs = fakeVaultFs({
      readTextFile: async () => ({ text: '---\nname: person\nlabel: Person\n---\n', modified: 1 }),
      moveEntry: async ({ from }) => {
        moved.push(from);
      },
    });
    const editors: OpenEditorsPort = {
      state: () => 'closed',
      flush: async () => {},
      follow: () => {},
      abandon: () => {},
    };
    await expect(
      renameEntry({
        ports: { fs, index: fakeIndexPort(), editors },
        entry: { path: file, kind: 'file' },
        name: 'Folks',
        notePaths: [],
      }),
    ).rejects.toThrow(/built-in types stay/);
    expect(moved).toEqual([]);
  });
});
