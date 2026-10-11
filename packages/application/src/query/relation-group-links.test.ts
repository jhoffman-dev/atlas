import { describe, expect, it } from 'vitest';
import { createVaultPath, noteNames } from '@atlas/domain';
import { relationGroupLinks } from './relation-group-links.ts';

/* What a board grouped by a relation has a column (or lane) for: every note it can point at. */

const NOTES = [
  { path: 'Projects/Atlas.md', title: 'Atlas' },
  { path: 'Archive/Projects/Old.md', title: 'Old' },
  { path: '.atlas/templates/Project.md', title: 'Project' },
];

describe('relationGroupLinks', () => {
  it('links every note of the target type, leaving out archived notes and templates', async () => {
    const asked: string[] = [];
    const links = await relationGroupLinks({
      index: {
        notesOfType: async (type) => {
          asked.push(type);
          return NOTES;
        },
      },
      targets: ['project'],
      names: noteNames([{ path: createVaultPath('Projects/Atlas.md'), title: 'Atlas' }]),
    });

    expect(asked).toEqual(['project']);
    expect(links).toEqual(['[[Atlas]]']);
  });

  it('links the notes of every type a relation points at, a type at a time (P30-01)', async () => {
    const links = await relationGroupLinks({
      index: {
        notesOfType: async (type) =>
          type === 'area'
            ? [{ path: 'Areas/Garden.md', title: 'Garden' }]
            : [{ path: 'Projects/Atlas.md', title: 'Atlas' }],
      },
      targets: ['project', 'area'],
      names: noteNames(null),
    });
    expect(links).toEqual(['[[Projects/Atlas]]', '[[Areas/Garden]]']);
  });

  it('fails as the index fails, rather than offering no columns as if there were none', async () => {
    await expect(
      relationGroupLinks({
        index: { notesOfType: () => Promise.reject(new Error('index not ready')) },
        targets: ['project'],
        names: noteNames(null),
      }),
    ).rejects.toThrow('index not ready');
  });
});
