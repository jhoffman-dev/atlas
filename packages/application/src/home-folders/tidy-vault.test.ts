import { describe, expect, it } from 'vitest';
import { createVaultPath } from '@atlas/domain';
import { fakeVaultFs } from '../testing/fake-ports.ts';
import { memoryVault } from '../testing/fake-git.ts';
import { previewVaultTidy } from './tidy-vault.ts';

const TODAY = '2026-10-18';

/** The notes here have no frontmatter: each is read as a plain note. */
const markdown = { frontmatterProperties: () => ({}), frontmatterProblem: () => null };

/** Ports over a vault holding only `Loose idea.md` at its root, counting each walk of it. */
function looseIdeaVault() {
  const memory = memoryVault({ 'Loose idea.md': 'A thought.\n' });
  let walks = 0;
  const fs = fakeVaultFs({
    ...memory.fs,
    listNotes: async () => {
      walks += 1;
      return [...memory.files.entries()].map(([path, text]) => ({
        name: path.split('/').at(-1) ?? path,
        path: createVaultPath(path),
        modified: 0,
        size: text.length,
      }));
    },
    readNotes: async (paths) =>
      paths.flatMap((path) => {
        const text = memory.files.get(path);
        return text === undefined ? [] : [{ path, text, modified: 0, size: text.length }];
      }),
  });
  return { ports: { fs, markdown }, walks: () => walks };
}

describe('previewVaultTidy with the notes already known (#130)', () => {
  it('plans from the list it is given, without walking the vault', async () => {
    const { ports, walks } = looseIdeaVault();
    const known = [
      'Loose idea.md',
      // Listed, but gone from the disk since: nothing to read, so nothing to plan.
      'Gone.md',
      // A namesake already at the loose note's home, as the index lists it.
      'Notes/2026/Loose idea.md',
    ].map(createVaultPath);

    const plan = await previewVaultTidy(ports, TODAY, known);

    expect(walks()).toBe(0);
    expect(plan.moves).toEqual([]);
    expect(plan.refused).toEqual([
      {
        path: 'Loose idea.md',
        to: 'Notes/2026/Loose idea.md',
        reason: 'Notes/2026/Loose idea.md is already a note there: rename one of them first.',
      },
    ]);
  });

  it('walks the vault when it is given none', async () => {
    const { ports, walks } = looseIdeaVault();
    const plan = await previewVaultTidy(ports, TODAY);
    expect(walks()).toBe(1);
    expect(plan.moves).toEqual([{ from: 'Loose idea.md', to: 'Notes/2026/Loose idea.md' }]);
  });
});
