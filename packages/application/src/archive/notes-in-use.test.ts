import { describe, expect, it } from 'vitest';
import { fakeIndexPort } from '../testing/fake-ports.ts';
import { notesInUseOfType, notesInUseOfTypes } from './notes-in-use.ts';

describe('notesInUseOfType', () => {
  it('offers a type’s notes, leaving out archived ones', async () => {
    const index = fakeIndexPort({
      notesOfType: async () => [
        { path: 'Acme.md', title: 'Acme' },
        { path: 'Archive/Old Co.md', title: 'Old Co' },
      ],
    });
    expect(await notesInUseOfType({ index, type: 'company' })).toEqual([
      { path: 'Acme.md', title: 'Acme' },
    ]);
  });

  it('never offers the type’s template, or anything else in .atlas (issue #15)', async () => {
    const index = fakeIndexPort({
      notesOfType: async () => [
        { path: '.atlas/templates/Company.md', title: 'Company' },
        { path: '.atlas/sources/Companies.md', title: 'Companies' },
        { path: 'Acme.md', title: 'Acme' },
      ],
    });
    expect(await notesInUseOfType({ index, type: 'company' })).toEqual([
      { path: 'Acme.md', title: 'Acme' },
    ]);
  });
});

describe('notesInUseOfTypes', () => {
  const index = fakeIndexPort({
    notesOfType: async (type) =>
      ({
        project: [{ path: 'Projects/Atlas.md', title: 'Atlas' }],
        area: [
          { path: 'Areas/Garden.md', title: 'Garden' },
          { path: 'Archive/Areas/Old.md', title: 'Old' },
        ],
        person: [{ path: 'People/Mara Quill.md', title: 'Mara Quill' }],
      })[type] ?? [],
  });

  it('offers the notes of every type asked for, in that order, each with its type', async () => {
    expect(await notesInUseOfTypes({ index, types: ['project', 'area'] })).toEqual([
      { path: 'Projects/Atlas.md', title: 'Atlas', type: 'project' },
      { path: 'Areas/Garden.md', title: 'Garden', type: 'area' },
    ]);
  });

  it('offers a note of no other type', async () => {
    const offered = await notesInUseOfTypes({ index, types: ['project', 'area'] });
    expect(offered.map((note) => note.type)).not.toContain('person');
  });

  it('offers a note listed under two types once, under the first', async () => {
    const twice = fakeIndexPort({
      notesOfType: async (type) => [{ path: 'Both.md', title: `Both as ${type}` }],
    });
    expect(await notesInUseOfTypes({ index: twice, types: ['area', 'project'] })).toEqual([
      { path: 'Both.md', title: 'Both as area', type: 'area' },
    ]);
  });
});
