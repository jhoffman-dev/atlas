import { describe, expect, it } from 'vitest';
import type { ObjectType, PropertyDef } from '../types/property-def.ts';
import {
  layoutLabel,
  newViewNote,
  newViewProblems,
  viewNameProblem,
  viewPathFor,
} from './new-view.ts';
import { parseSavedView, parseViewDisplay } from './saved-view.ts';

const property = (key: string, kind: PropertyDef['kind']): PropertyDef => ({
  key,
  kind,
  label: key,
  required: false,
  options: kind === 'select' ? ['backlog', 'done'] : [],
  target: null,
  many: false,
});

const TASK: ObjectType = {
  name: 'task',
  label: 'Task',
  properties: [
    property('status', 'select'),
    property('start', 'date'),
    property('due', 'date'),
    property('estimate', 'number'),
  ],
};
const NOTE: ObjectType = { name: 'note', label: 'Note', properties: [property('words', 'text')] };
const TYPES = [TASK, NOTE];
const TAKEN = ['.atlas/views/Board.md'];

describe('naming a view', () => {
  it('writes it in .atlas/views under its name', () => {
    expect(viewPathFor('  Open work ')).toBe('.atlas/views/Open work.md');
  });

  it('refuses a blank name, a path, a hidden name and a taken one in any case', () => {
    expect(viewNameProblem('   ', TAKEN)).toBe('Name the view.');
    expect(viewNameProblem('a/b', TAKEN)).toMatch(/cannot hold/);
    expect(viewNameProblem('.hidden', TAKEN)).toMatch(/start with a dot/);
    expect(viewNameProblem('board', TAKEN)).toBe('There is already a view called “board”.');
    // A file name holds 255 bytes of UTF-8, `.md` included: 252 of them are the name's.
    expect(viewNameProblem('é'.repeat(126), [])).toBeNull();
    expect(viewNameProblem('é'.repeat(127), [])).toMatch(/too long/);
    expect(viewNameProblem('Boards', TAKEN)).toBeNull();
  });

  it('refuses a name taken in another Unicode normalisation, as APFS looks it up', () => {
    const decomposed = '.atlas/views/Cafe\u0301 table.md';

    expect(viewNameProblem('Caf\u00e9 table', [decomposed])).toMatch(/already a view/);
    expect(viewNameProblem('CAF\u00c9 TABLE', [decomposed])).toMatch(/already a view/);
  });
});

describe('what stops a new view', () => {
  it('passes a table of a known type', () => {
    expect(
      newViewProblems(
        { name: 'All', type: 'task', layout: 'table' },
        { types: TYPES, takenPaths: TAKEN },
      ),
    ).toEqual([]);
  });

  it('asks for a type, and for one that exists', () => {
    const ask = (type: string) =>
      newViewProblems({ name: 'x', type, layout: 'table' }, { types: TYPES, takenPaths: [] });
    expect(ask('')).toEqual(['Choose a type.']);
    expect(ask('book')).toEqual(['That type no longer exists.']);
  });

  it('refuses a board with nothing to group by, and a calendar or timeline with no date', () => {
    const ask = (layout: 'board' | 'calendar' | 'timeline') =>
      newViewProblems({ name: 'x', type: 'note', layout }, { types: TYPES, takenPaths: [] });
    expect(ask('board')).toEqual(['A board needs a property to group by, and Note has none.']);
    expect(ask('calendar')).toEqual(['A calendar needs a date, and Note has no date property.']);
    expect(ask('timeline')).toEqual(['A timeline needs a date, and Note has no date property.']);
  });

  it('lists a name problem and a layout problem together', () => {
    expect(
      newViewProblems(
        { name: '', type: 'note', layout: 'board' },
        { types: TYPES, takenPaths: [] },
      ),
    ).toHaveLength(2);
  });
});

describe('the note a new view is written as', () => {
  const made = (layout: 'table' | 'board' | 'calendar' | 'timeline' | 'list') =>
    newViewNote({ name: 'Mine', type: 'task', layout }, TASK).frontmatter;

  it('is a view of the type, showing every property', () => {
    const query = parseSavedView(made('table'));
    expect(query).toEqual({
      type: 'task',
      columns: ['status', 'start', 'due', 'estimate'],
      filters: [],
      sorts: [],
      limit: 500,
    });
  });

  it('gives each layout what it needs to draw as asked, not as a table', () => {
    expect(parseViewDisplay(made('board'))).toMatchObject({ layout: 'board', groupBy: 'status' });
    expect(parseViewDisplay(made('calendar'))).toMatchObject({
      layout: 'calendar',
      dateKey: 'start',
    });
    expect(parseViewDisplay(made('timeline'))).toMatchObject({
      layout: 'timeline',
      startKey: 'start',
      endKey: 'due',
    });
    expect(parseViewDisplay(made('list'))).toMatchObject({ layout: 'list', groupBy: null });
  });

  it('calls each layout by its name', () => {
    expect(layoutLabel('gallery')).toBe('Gallery');
  });
});
