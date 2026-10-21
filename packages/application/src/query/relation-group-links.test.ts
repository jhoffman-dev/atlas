import { describe, expect, it } from 'vitest';
import { createVaultPath, noteNames } from '@dfai/domain';
import { relationGroupLinks } from './relation-group-links.ts';

/* What a board grouped by a relation has a column (or lane) for: every note it can point at. */

const NOTES = [
  { path: 'Projects/DFAI.md', title: 'DFAI' },
  { path: 'Archive/Projects/Old.md', title: 'Old' },
  { path: '.atlas/templates/Project.md', title: 'Project' },
];

/** An index holding no PARA values (#213): every Project note reads as a project. */
const query = async () => ({ columns: [], rows: [], truncated: false });

describe('relationGroupLinks', () => {
  it('links every note of the target type, leaving out archived notes and templates', async () => {
    const asked: string[] = [];
    const links = await relationGroupLinks({
      index: {
        query,
        notesOfType: async (type) => {
          asked.push(type);
          return NOTES;
        },
      },
      targets: ['project'],
      names: noteNames([{ path: createVaultPath('Projects/DFAI.md'), title: 'DFAI' }]),
    });

    expect(asked).toEqual(['project']);
    expect(links).toEqual(['[[DFAI]]']);
  });

  it('links the notes of every type a relation points at, a type at a time (P30-01)', async () => {
    const links = await relationGroupLinks({
      index: {
        query,
        notesOfType: async (type) =>
          type === 'area'
            ? [{ path: 'Areas/Garden.md', title: 'Garden' }]
            : [{ path: 'Projects/DFAI.md', title: 'DFAI' }],
      },
      targets: ['project', 'area'],
      names: noteNames(null),
    });
    expect(links).toEqual(['[[Projects/DFAI]]', '[[Areas/Garden]]']);
  });

  it('fails as the index fails, rather than offering no columns as if there were none', async () => {
    await expect(
      relationGroupLinks({
        index: { query, notesOfType: () => Promise.reject(new Error('index not ready')) },
        targets: ['project'],
        names: noteNames(null),
      }),
    ).rejects.toThrow('index not ready');
  });
});
