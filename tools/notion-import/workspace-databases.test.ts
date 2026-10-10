import { describe, expect, it } from 'vitest';
import type { RelationEntry } from './notion-relations.ts';
import { DEFAULT_TASK_STATUSES } from './task-status.ts';
import {
  columnsLeftOut,
  databaseKind,
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
      'Due date "10/06/2026" cannot be read (cannot read "10/06/2026" as a date or a time), so the note keeps its due: set the column\'s format to Full date',
      'People: "Someone Else" is not in the export; linked by its name',
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
