import { describe, expect, it, vi } from 'vitest';
import type { ObjectType } from '@atlas/domain';
import { fakeIndexPort } from '../testing/fake-ports.ts';
import { countNotesByType } from './count-notes-by-type.ts';

const type = (name: string): ObjectType => ({ name, label: name, properties: [] });

describe('countNotesByType', () => {
  it('counts the notes the index holds for each type', async () => {
    const index = fakeIndexPort({
      notesOfType: async (name) =>
        name === 'task'
          ? [
              { path: 'a.md', title: 'a' },
              { path: 'b.md', title: 'b' },
            ]
          : [{ path: 'c.md', title: 'c' }],
    });

    const counts = await countNotesByType({ index, types: [type('task'), type('person')] });

    expect(counts.get('task')).toBe(2);
    expect(counts.get('person')).toBe(1);
  });

  it('does not count the templates and definitions Atlas keeps in .atlas', async () => {
    const index = fakeIndexPort({
      notesOfType: async () => [
        { path: 'tasks/P16-04.md', title: 'Views' },
        { path: '.atlas/templates/Task.md', title: 'Task' },
        { path: '.atlas-notes/Mine.md', title: 'Mine' },
      ],
    });

    const counts = await countNotesByType({ index, types: [type('task')] });

    expect(counts.get('task')).toBe(2);
  });

  it('does not count archived notes', async () => {
    const index = fakeIndexPort({
      notesOfType: async () => [
        { path: 'tasks/Live.md', title: 'Live' },
        { path: 'Archive/tasks/Old.md', title: 'Old' },
        { path: 'tasks/Archive/Kept.md', title: 'Kept' },
      ],
    });

    const counts = await countNotesByType({ index, types: [type('task')] });

    expect(counts.get('task')).toBe(2);
  });

  it('counts a type with no notes as none, not as missing', async () => {
    const counts = await countNotesByType({ index: fakeIndexPort(), types: [type('task')] });
    expect(counts.get('task')).toBe(0);
  });

  it('counts a type the index cannot answer for as none', async () => {
    const index = fakeIndexPort({
      notesOfType: async (name) => {
        if (name === 'task') throw new Error('no such view: v_task');
        return [{ path: 'c.md', title: 'c' }];
      },
    });

    const counts = await countNotesByType({ index, types: [type('task'), type('person')] });

    expect(counts.get('task')).toBe(0);
    expect(counts.get('person')).toBe(1);
  });

  it('asks nothing of the index when the vault has no types', async () => {
    const notesOfType = vi.fn(async () => []);
    const counts = await countNotesByType({ index: fakeIndexPort({ notesOfType }), types: [] });
    expect(counts.size).toBe(0);
    expect(notesOfType).not.toHaveBeenCalled();
  });
});
