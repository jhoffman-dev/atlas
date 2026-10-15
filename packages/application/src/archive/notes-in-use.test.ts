import { describe, expect, it } from 'vitest';
import { PARA_VALUES_QUERY_MARK } from '@atlas/domain';
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

/** #213: PARA is one Project type; pickers group its notes by their PARA value. */
describe('notesInUseOfTypes, over PARA', () => {
  /** Project notes and what the index holds for their `para`, and two Area notes from before. */
  const paraIndex = fakeIndexPort({
    notesOfType: async (type) =>
      ({
        project: [
          { path: 'Projects/Atlas.md', title: 'Atlas' },
          { path: 'Garden.md', title: 'Garden' },
          { path: 'Manual.md', title: 'Manual' },
          { path: 'Old Plan.md', title: 'Old Plan' },
          { path: 'Archive/Moved.md', title: 'Moved' },
          { path: 'Someday.md', title: 'Someday' },
        ],
        area: [{ path: 'Areas/Health.md', title: 'Health' }],
      })[type] ?? [],
    query: async (sql, parameters) => {
      expect(sql.startsWith(PARA_VALUES_QUERY_MARK)).toBe(true);
      expect(parameters).toEqual(['project']);
      return {
        columns: ['path', 'para'],
        rows: [
          ['Garden.md', 'Area'],
          ['Manual.md', 'resource'],
          ['Old Plan.md', 'archive'],
          ['Someday.md', 'someday'],
        ],
        truncated: false,
      };
    },
  });

  it('offers a task’s Project picker projects then areas: never a resource or an archived one', async () => {
    expect(await notesInUseOfTypes({ index: paraIndex, types: ['project', 'area'] })).toEqual([
      { path: 'Projects/Atlas.md', title: 'Atlas', type: 'project' },
      { path: 'Someday.md', title: 'Someday', type: 'project' },
      // Each group in the order its types are read: the Project type's notes, then the Area type's.
      { path: 'Garden.md', title: 'Garden', type: 'area' },
      { path: 'Areas/Health.md', title: 'Health', type: 'area' },
    ]);
  });

  it('offers a project’s Area picker only areas, a Project set to area among them', async () => {
    expect(await notesInUseOfTypes({ index: paraIndex, types: ['area'] })).toEqual([
      { path: 'Areas/Health.md', title: 'Health', type: 'area' },
      { path: 'Garden.md', title: 'Garden', type: 'area' },
    ]);
  });

  it('groups resources last where a relation points at them', async () => {
    const offered = await notesInUseOfTypes({
      index: paraIndex,
      types: ['resource', 'project'],
    });
    expect(offered.map((note) => [note.title, note.type])).toEqual([
      ['Atlas', 'project'],
      ['Someday', 'project'],
      ['Manual', 'resource'],
    ]);
  });

  it('keeps any other type it points at in its place beside PARA’s', async () => {
    const mixed = fakeIndexPort({
      notesOfType: async (type) =>
        type === 'person'
          ? [{ path: 'People/Mara Quill.md', title: 'Mara Quill' }]
          : type === 'project'
            ? [{ path: 'Projects/Atlas.md', title: 'Atlas' }]
            : [],
    });
    expect(await notesInUseOfTypes({ index: mixed, types: ['person', 'project'] })).toEqual([
      { path: 'People/Mara Quill.md', title: 'Mara Quill', type: 'person' },
      { path: 'Projects/Atlas.md', title: 'Atlas', type: 'project' },
    ]);
  });

  it('leaves a Project set to archive out of a plain Project list, as one moved to the Archive', async () => {
    const titles = (await notesInUseOfType({ index: paraIndex, type: 'project' })).map(
      (note) => note.title,
    );
    expect(titles).toEqual(['Atlas', 'Garden', 'Manual', 'Someday']);
  });
});
