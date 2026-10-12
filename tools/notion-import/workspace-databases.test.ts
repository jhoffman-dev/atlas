import { describe, expect, it } from 'vitest';
import { readCsv } from './notion-csv.ts';
import type { RelationEntry } from './notion-relations.ts';
import { DEFAULT_TASK_STATUSES } from './task-status.ts';
import {
  columnsLeftOut,
  databaseKind,
  mixedOrderColumns,
  wantedNote,
  type NoteKind,
  type RowContext,
} from './workspace-databases.ts';

const ID = 'a1000000000000000000000000000001';

/** Pages the resolver knows, by id or title. */
const KNOWN: Record<string, string> = {
  c3000000000000000000000000000001: '[[Mara Quill]]',
  c3000000000000000000000000000002: '[[Tobias Fenn]]',
  'Larkspur Payroll renewal': '[[Projects/Larkspur Payroll renewal]]',
};

const resolve = (entry: RelationEntry) => {
  const link = KNOWN[entry.id ?? ''] ?? KNOWN[entry.title];
  return link === undefined ? { link: `[[${entry.title}]]`, known: false } : { link, known: true };
};

function context(kind: NoteKind, cells: Record<string, string>): RowContext {
  const columns = ['Name', ...Object.keys(cells)];
  return {
    kind,
    columns,
    row: new Map([['Name', 'A page'], ...Object.entries(cells)]),
    resolve,
    statuses: DEFAULT_TASK_STATUSES,
    today: '2026-10-10',
    timeZone: 'America/Los_Angeles',
    dateOrder: null,
    mixedOrderColumns: new Set(),
  };
}

const MARA = `Mara Quill (https://www.notion.so/Mara-Quill-c3000000000000000000000000000001?pvs=21)`;
const TOBIAS = `Tobias Fenn (https://www.notion.so/c3000000000000000000000000000002)`;

describe('which database a CSV holds', () => {
  it.each([
    ['Tasks Tracker', 'tasks'],
    ['✅ Tasks', 'tasks'],
    ['Notes', 'notes'],
    ['Meeting Notes', 'meetings'],
    ['People', 'people'],
    ['PARA', 'para'],
    ['Teams', 'teams'],
    ['Daily Notes', 'daily'],
    ['Reading list', null],
  ])('%s is %s', (name, kind) => {
    expect(databaseKind(name)).toBe(kind);
  });
});

describe('a task row', () => {
  it('is a task in Tasks/, its status GTD, its relations links, its id kept', () => {
    const note = wantedNote(
      context('tasks', {
        Status: 'Ready',
        Priority: 'H',
        'Task type': 'Feature',
        Tags: 'payroll, contracts',
        'Due date': 'October 20, 2026',
        Project: 'Larkspur Payroll renewal',
        People: `${MARA}, ${TOBIAS}`,
        Note: '',
      }),
      ID,
    );
    expect(note.place).toEqual({ folder: 'Tasks', type: 'task' });
    expect(note.fields).toEqual({
      type: 'task',
      status: 'next-action',
      notion_status: 'Ready',
      priority: 'H',
      task_type: 'Feature',
      tags: ['payroll', 'contracts'],
      due: '2026-10-20',
      project: '[[Projects/Larkspur Payroll renewal]]',
      people: ['[[Mara Quill]]', '[[Tobias Fenn]]'],
      source: 'notion',
      notion_id: ID,
    });
    expect(note.fillOnly).toEqual({ scheduled: '2026-10-20' });
    expect(note.notes).toEqual([]);
  });

  it('Waiting waits on the first person in People', () => {
    const note = wantedNote(
      context('tasks', { Status: 'Waiting', People: `${TOBIAS}, ${MARA}` }),
      ID,
    );
    expect(note.fields).toMatchObject({ status: 'waiting', waiting_on: '[[Tobias Fenn]]' });
  });

  it('Done is Archive, with the day it was completed set once', () => {
    const note = wantedNote(context('tasks', { Status: 'Done' }), ID);
    expect(note.fields['status']).toBe('archive');
    expect(note.fillOnly).toEqual({ completed: '2026-10-10' });
  });

  it('says what it could not read: a date in another format, a page in neither export nor vault', () => {
    const note = wantedNote(
      context('tasks', { Status: '', 'Due date': '10/06/2026', People: 'Someone Else' }),
      ID,
    );
    expect(note.fields).not.toHaveProperty('due');
    expect(note.unread).toEqual(['due']);
    expect(note.fields).not.toHaveProperty('notion_status');
    expect(note.fields['people']).toEqual(['[[Someone Else]]']);
    expect(note.notes).toEqual([
      'Due date "10/06/2026" cannot be read (cannot read "10/06/2026" as a date or a time), so the note keeps its due: run with --date-order mdy (month first) or dmy (day first), or set the column\'s format to Full date',
      'People: "Someone Else" is not in the export; linked by its name',
    ]);
  });

  it('does not read an ambiguous date in a column that holds one only the other order reads', () => {
    const csv = readCsv(
      'Name,Status,Due date\nA,,13/06/2026\nB,,06/07/2026\nC,,"October 20, 2026"\n',
    );
    const mixed = mixedOrderColumns(csv, 'mdy');
    expect([...mixed]).toEqual(['Due date']);
    const due = (cell: string) =>
      wantedNote(
        {
          ...context('tasks', { Status: '', 'Due date': cell }),
          dateOrder: 'mdy',
          mixedOrderColumns: mixed,
        },
        ID,
      );
    const ambiguous = due('06/07/2026');
    expect(ambiguous.fields).not.toHaveProperty('due');
    expect(ambiguous.unread).toEqual(['due']);
    expect(ambiguous.notes[0]).toContain(
      'the column mixes orders: some of its dates can only be dmy',
    );
    expect(ambiguous.notes[0]).toContain('check --date-order');
    // A date that is no month under the order is still reported, and one written out in full still reads.
    expect(due('13/06/2026').unread).toEqual(['due']);
    expect(due('October 20, 2026').fields['due']).toBe('2026-10-20');
    expect(mixedOrderColumns(csv, null).size).toBe(0);
    expect(mixedOrderColumns(csv, 'dmy').size).toBe(0);
  });

  it('takes a column as written in the order its unambiguous dates can be read in', () => {
    const csv = readCsv('Name,Status,Due date\nA,,06/07/2026\nB,,25/12/2026\n');
    expect(mixedOrderColumns(csv, 'dmy').size).toBe(0);
    expect([...mixedOrderColumns(csv, 'mdy')]).toEqual(['Due date']);
  });

  it('reads a date written month first in the order given, and says plainly when that is no day', () => {
    const order = (dateOrder: 'mdy' | 'dmy', due: string) =>
      wantedNote({ ...context('tasks', { Status: '', 'Due date': due }), dateOrder }, ID);
    expect(order('mdy', '10/06/2026').fields['due']).toBe('2026-10-06');
    expect(order('dmy', '10/06/2026').fields['due']).toBe('2026-06-10');
    const unread = order('mdy', '13/01/2026');
    expect(unread.unread).toEqual(['due']);
    expect(unread.notes).toEqual([
      'Due date "13/01/2026" cannot be read (cannot read "13/01/2026" as a date or a time), so the note keeps its due: check --date-order (this one is not mdy), or set the column\'s format to Full date',
    ]);
  });

  it('reads Effort level as effort, and lists it beside an Effort column, which fills effort first', () => {
    expect(
      wantedNote(context('tasks', { Status: '', 'Effort level': 'M' }), ID).fields['effort'],
    ).toBe('M');
    const both = wantedNote(context('tasks', { Status: '', Effort: 'L', 'Effort level': 'M' }), ID);
    expect(both.fields['effort']).toBe('L');
    expect(columnsLeftOut('tasks', ['Name', 'Effort', 'Effort level'])).toEqual([
      '"Effort level": it maps to effort, which "Effort" fills: not imported',
    ]);
  });
});

describe('a PARA row', () => {
  it.each([
    ['Project', { folder: 'Projects', type: 'project' }],
    ['Area', { folder: 'Areas', type: 'area' }],
    ['Resource', { folder: 'Resources', type: 'resource' }],
    ['Archive', { folder: 'Archive/Projects', type: 'project' }],
  ])('of Type %s goes where its kind goes', (type, place) => {
    expect(wantedNote(context('para', { Type: type }), ID).place).toEqual(place);
  });

  it('in the Archive is a finished project; its dates are days', () => {
    const note = wantedNote(
      context('para', {
        Type: 'Archive',
        Priority: 'High',
        'Start date': 'January 5, 2026',
        'End date': 'June 30, 2026',
      }),
      ID,
    );
    expect(note.fields).toEqual({
      type: 'project',
      status: 'done',
      priority: 'High',
      start: '2026-01-05',
      end: '2026-06-30',
      source: 'notion',
      notion_id: ID,
    });
  });

  it("writes a Start date range's end into end, unless End date says otherwise", () => {
    const range = 'January 5, 2026 → June 30, 2026';
    expect(
      wantedNote(context('para', { Type: 'Project', 'Start date': range }), ID).fields,
    ).toMatchObject({
      start: '2026-01-05',
      end: '2026-06-30',
    });
    const both = wantedNote(
      context('para', { Type: 'Project', 'Start date': range, 'End date': 'July 31, 2026' }),
      ID,
    );
    expect(both.fields).toMatchObject({ start: '2026-01-05', end: '2026-07-31' });
    expect(both.notes).toEqual([]);
  });

  it('of no Type it knows is a project, and says so', () => {
    expect(wantedNote(context('para', { Type: 'Goal' }), ID).notes).toEqual([
      'Type "Goal", not Area, Project, Resource or Archive: imported as a project',
    ]);
    expect(wantedNote(context('para', {}), ID).notes).toEqual(['no Type: imported as a project']);
  });
});

describe('the other rows', () => {
  it('a person keeps their email, Slack, role and team, the team a link', () => {
    const note = wantedNote(
      context('people', {
        Email: 'mara.quill@example.com',
        Slack: '@mara',
        Role: 'Head of Payroll',
        Team: 'Platform',
      }),
      ID,
    );
    expect(note.place).toEqual({ folder: 'People', type: 'person' });
    expect(note.fields).toMatchObject({
      email: 'mara.quill@example.com',
      slack: '@mara',
      team: '[[Platform]]',
    });
  });

  it("a person's Aliases are their Also spelt, a list", () => {
    const note = wantedNote(context('people', { Aliases: 'Mara, M. Quill, Marra' }), ID);
    expect(note.fields['aliases']).toEqual(['Mara', 'M. Quill', 'Marra']);
    expect(columnsLeftOut('people', ['Name', 'Aliases'])).toEqual([]);
  });

  it('a daily note with no title is for the day its Date says, written year first or in the order given', () => {
    const daily = (cells: Record<string, string>, dateOrder: 'mdy' | null = null) =>
      wantedNote(
        {
          ...context('daily', cells),
          row: new Map([['Name', ''], ...Object.entries(cells)]),
          dateOrder,
        },
        ID,
      ).day;
    expect(daily({ Date: '2026/06/14' })).toBe('2026-06-14');
    expect(daily({ Date: '06/14/2026' }, 'mdy')).toBe('2026-06-14');
    expect(daily({ Date: '06/14/2026' })).toBeNull();
  });

  it('a note keeps its tags, date and links; a daily note is for its day; a team goes to Teams', () => {
    const note = wantedNote(
      context('notes', { Tags: 'inbox, 1on1', Date: 'October 2, 2026', Related: 'Pricing' }),
      ID,
    );
    expect(note.fields).toMatchObject({
      type: 'notes',
      tags: ['inbox', '1on1'],
      date: '2026-10-02',
      related: ['[[Pricing]]'],
    });
    const daily = wantedNote(context('daily', { Date: 'October 6, 2026' }), ID);
    expect(daily.place).toEqual({ folder: '', type: 'daily' });
    expect(daily.day).toBe('2026-10-06');
    expect(wantedNote(context('teams', {}), ID).place).toEqual({ folder: 'Teams', type: 'team' });
  });
});

describe('the columns not imported', () => {
  it('are listed with why: a link back, or a column the import does not map', () => {
    expect(columnsLeftOut('people', ['Name', 'Email', 'Tasks', 'Birthday'])).toEqual([
      '"Tasks": it links back here, and Atlas shows that as a backlink',
      '"Birthday": not a column this import maps',
    ]);
  });
});
