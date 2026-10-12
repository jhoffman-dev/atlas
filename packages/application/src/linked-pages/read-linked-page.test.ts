import { describe, expect, it } from 'vitest';
import {
  PARA_TYPE_FILES,
  parseObjectType,
  TASK_TYPE_FILE,
  type LinkedSectionId,
  type ObjectType,
} from '@atlas/domain';
import type { IndexPort } from '../index/ports.ts';
import { fakeIndexPort } from '../testing/fake-ports.ts';
import { jsonMarkdown } from '../testing/json-markdown.ts';
import { atlasQueryIndex } from '../testing/query-index.ts';
import { readLinkedPage, type LinkedSection } from './read-linked-page.ts';

/**
 * Linked pages read for real: every section's query compiled and run against
 * SQLite over a small vault. The index's "today" is pinned, so "the last 30
 * days" has known edges and waiting-fors have known ages.
 */
const TODAY = '2999-03-13';
const INDEX_TODAY = "date('now', 'localtime'";

const TYPES: readonly ObjectType[] = [
  parseObjectType({
    name: 'person',
    label: 'Person',
    properties: { role: 'text', company: { kind: 'relation', target: 'company' } },
  }),
  parseObjectType({ name: 'company', label: 'Company', properties: {} }),
  parseObjectType({
    name: 'meeting',
    label: 'Meeting',
    properties: {
      date: 'date',
      people: { kind: 'relation', target: 'person', many: true },
      companies: { kind: 'relation', target: 'company', many: true },
      project: { kind: 'relation', target: ['project', 'area'] },
    },
  }),
  parseObjectType({
    name: 'decision',
    label: 'Decision',
    properties: {
      date: 'date',
      meeting: { kind: 'relation', target: 'meeting' },
      project: { kind: 'relation', target: 'project' },
      people: { kind: 'relation', target: 'person', many: true },
    },
  }),
  TASK_TYPE_FILE.type,
  ...PARA_TYPE_FILES.map((file) => file.type),
];

/** TODAY, that many days back, as `YYYY-MM-DD`. */
function daysAgo(days: number): string {
  return new Date(Date.UTC(2999, 2, 13 - days, 12)).toISOString().slice(0, 10);
}

/** Noon that day, so the day is the same wherever the test runs. */
const changed = (days: number): number => Date.UTC(2999, 2, 13 - days, 12);

const note = (frontmatter: Record<string, unknown>, body = ''): string =>
  `---\n${JSON.stringify(frontmatter)}\n---\n\n${body}\n`;

const MARA = 'People/Mara Quill.md';
const LARKSPUR = 'Companies/Larkspur Payroll.md';
const MIGRATION = 'Projects/Payroll Migration.md';
const OPERATIONS = 'Areas/Operations.md';
const KICKOFF = 'Meetings/Kickoff.md';

const FILES: Readonly<Record<string, string>> = {
  [MARA]: note({ type: 'person', role: 'Controller', company: '[[Larkspur Payroll]]' }),
  'People/Tobias Fenn.md': note({ type: 'person', company: '[[Larkspur Payroll]]' }),
  'People/Ines Okafor.md': note({ type: 'person', company: '[[Fenwick Freight]]' }),
  [LARKSPUR]: note({ type: 'company' }),
  'Companies/Fenwick Freight.md': note({ type: 'company' }),
  [OPERATIONS]: note({ type: 'area' }),
  [MIGRATION]: note(
    { type: 'project', status: 'active', area: '[[Operations]]' },
    'For [[Larkspur Payroll]].',
  ),
  'Projects/Idle.md': note({ type: 'project', status: 'active', area: '[[Operations]]' }),
  [KICKOFF]: note({
    type: 'meeting',
    date: daysAgo(5),
    people: ['[[Mara Quill]]', '[[Tobias Fenn]]'],
    companies: ['[[Larkspur Payroll]]'],
    project: '[[Payroll Migration]]',
    // As the meeting-extraction change (PR #102) will hold what came of it.
    tasks: ['[[Call the vendor]]'],
  }),
  'Meetings/Old sync.md': note({ type: 'meeting', date: daysAgo(45), people: ['[[Mara Quill]]'] }),
  'Meetings/Thirty days ago.md': note({
    type: 'meeting',
    date: daysAgo(30),
    people: ['[[Mara Quill]]'],
  }),
  'Meetings/Fenwick intro.md': note({
    type: 'meeting',
    date: daysAgo(2),
    people: ['[[Ines Okafor]]'],
    companies: ['[[Fenwick Freight]]'],
  }),
  // A waiting-for as an accepted proposal writes it today: its `source` cites the meeting's turn.
  'Tasks/Send the contract.md': note({
    type: 'task',
    status: 'waiting',
    waiting_on: '[[Mara Quill]]',
    project: '[[Payroll Migration]]',
    source: '[[Kickoff#^t0003]]',
  }),
  'Tasks/Chase the invoice.md': note({
    type: 'task',
    status: 'waiting',
    waiting_on: '[[Tobias Fenn]]',
  }),
  'Tasks/Waiting on Ines.md': note({
    type: 'task',
    status: 'waiting',
    waiting_on: '[[Ines Okafor]]',
  }),
  'Tasks/Draft the plan.md': note(
    { type: 'task', status: 'next-action', project: '[[Payroll Migration]]', due: daysAgo(-3) },
    'Ask [[Mara Quill]] about the cut-over.',
  ),
  'Tasks/Book a room.md': note({
    type: 'task',
    status: 'inbox',
    project: '[[Payroll Migration]]',
    source: '[[Kickoff#^t0007]]',
  }),
  'Tasks/Call the vendor.md': note({ type: 'task', status: 'backlog' }),
  'Tasks/Finished.md': note(
    { type: 'task', status: 'archive', project: '[[Payroll Migration]]' },
    'With [[Mara Quill]].',
  ),
  'Tasks/Tidy the backlog.md': note({ type: 'task', status: 'backlog', project: '[[Idle]]' }),
  'Tasks/Renew the licence.md': note({ type: 'task', status: 'someday' }, '[[Larkspur Payroll]]'),
  'Decisions/Two-step approval.md': note({
    type: 'decision',
    date: daysAgo(5),
    meeting: '[[Kickoff]]',
    project: '[[Payroll Migration]]',
    people: ['[[Mara Quill]]'],
  }),
  'Resources/Payroll runbook.md': note(
    { type: 'resource', project: '[[Payroll Migration]]' },
    'Written with [[Mara Quill]].',
  ),
};

const MODIFIED: Readonly<Record<string, number>> = {
  'Tasks/Send the contract.md': changed(12),
  'Tasks/Chase the invoice.md': changed(1),
  'Tasks/Waiting on Ines.md': changed(0),
  'Resources/Payroll runbook.md': changed(3),
  [LARKSPUR]: changed(90),
};

function pinnedIndex(): { index: IndexPort; asked: string[] } {
  const run = atlasQueryIndex({ files: FILES, markdown: jsonMarkdown(), modified: MODIFIED });
  const asked: string[] = [];
  const index = fakeIndexPort({
    query: (sql, parameters) => {
      asked.push(sql);
      return run(sql.replaceAll(INDEX_TODAY, `date('${TODAY}'`), parameters);
    },
  });
  return { index, asked };
}

const clock = { today: () => TODAY };

async function page(
  notePath: string,
  typeName: string,
  ranges: Partial<Record<LinkedSectionId, 'recent' | 'all'>> = {},
) {
  const { index, asked } = pinnedIndex();
  const sections = await readLinkedPage({
    index,
    clock,
    types: TYPES,
    notePaths: Object.keys(FILES),
    notePath,
    typeName,
    ranges,
  });
  const section = (id: LinkedSectionId): LinkedSection => {
    const found = sections.find((one) => one.id === id);
    if (found === undefined) throw new Error(`no ${id} section`);
    return found;
  };
  const titles = (id: LinkedSectionId) => section(id).rows.map((row) => row.title);
  return { sections, section, titles, asked };
}

describe('readLinkedPage: a person', () => {
  it('lists the meetings they were in over the last 30 days, newest first, with each one’s day', async () => {
    const mara = await page(MARA, 'person');
    expect(mara.titles('meetings')).toEqual(['Kickoff', 'Thirty days ago']);
    expect(mara.section('meetings')).toMatchObject({
      range: 'recent',
      truncated: false,
      problem: null,
      fields: [{ key: 'date', label: 'Date' }],
    });
    expect(mara.section('meetings').rows[0]?.values['date']).toBe(daysAgo(5));
  });

  it('lists every meeting once the section is left on all', async () => {
    const mara = await page(MARA, 'person', { meetings: 'all' });
    expect(mara.titles('meetings')).toEqual(['Kickoff', 'Thirty days ago', 'Old sync']);
    expect(mara.section('meetings').range).toBe('all');
    // The other sections keep to recent.
    expect(mara.section('decisions').range).toBe('recent');
  });

  it('lists what they are waited on for, with how long each has waited', async () => {
    const mara = await page(MARA, 'person');
    const waiting = mara.section('waiting');
    expect(waiting.rows.map((row) => [row.title, row.values['waited']])).toEqual([
      ['Send the contract', 'waiting 12 days'],
    ]);
    expect(waiting.range).toBeNull();
    expect(waiting.fields.map((field) => field.key)).toEqual(['project', 'waited']);
  });

  it('lists their other open tasks under their statuses, never a finished one or a waiting-for twice', async () => {
    const mara = await page(MARA, 'person');
    expect(mara.titles('tasks')).toEqual(['Draft the plan']);
    expect(mara.section('tasks').groups.map((group) => group.value)).toEqual(['next-action']);
    // Grouped by status, so the status is the heading, not a column.
    expect(mara.section('tasks').fields.map((field) => field.key)).toEqual(['due']);
    expect(mara.section('tasks').hint).toBeNull();
  });

  it('lists their decisions, and the other notes linked with them by their type’s label', async () => {
    const mara = await page(MARA, 'person', { notes: 'all' });
    expect(mara.titles('decisions')).toEqual(['Two-step approval']);
    expect(mara.titles('notes')).toEqual(['Payroll runbook', 'Larkspur Payroll']);
    expect(mara.section('notes').rows.map((row) => row.values['type'])).toEqual([
      'Resource',
      'Company',
    ]);
    expect(mara.section('notes').fields.map((field) => field.key)).toEqual(['type']);
  });

  it('keeps Linked notes to those changed in the last 30 days until asked for all', async () => {
    const mara = await page(MARA, 'person');
    expect(mara.titles('notes')).toEqual(['Payroll runbook']);
  });

  it('asks the index once a section, however many rows come back', async () => {
    const mara = await page(MARA, 'person');
    expect(mara.sections).toHaveLength(5);
    expect(mara.asked).toHaveLength(5);
  });
});

describe('readLinkedPage: a company', () => {
  it('lists its people, its meetings, and what is waited on from its people, longest first', async () => {
    const larkspur = await page(LARKSPUR, 'company');
    expect(larkspur.titles('people')).toEqual(['Mara Quill', 'Tobias Fenn']);
    expect(larkspur.section('people').rows[0]?.values['role']).toBe('Controller');
    expect(larkspur.titles('meetings')).toEqual(['Kickoff']);
    expect(
      larkspur.section('waiting').rows.map((row) => [row.title, row.values['waited']]),
    ).toEqual([
      ['Send the contract', 'waiting 12 days'],
      ['Chase the invoice', 'waiting 1 day'],
    ]);
  });

  it('lists the open tasks and projects linked with it', async () => {
    const larkspur = await page(LARKSPUR, 'company');
    expect(larkspur.titles('tasks')).toEqual(['Renew the licence']);
    expect(larkspur.titles('projects')).toEqual(['Payroll Migration']);
    expect(larkspur.section('projects').rows[0]?.values['status']).toBe('active');
  });
});

describe('readLinkedPage: a project and an area', () => {
  it('lists a project’s open tasks with what to do next first, and its waiting-fors apart', async () => {
    const project = await page(MIGRATION, 'project');
    expect(
      project.section('tasks').groups.map((group) => [group.value, group.rows.length]),
    ).toEqual([
      ['next-action', 1],
      ['inbox', 1],
    ]);
    expect(project.titles('tasks')).toEqual(['Draft the plan', 'Book a room']);
    expect(project.titles('waiting')).toEqual(['Send the contract']);
    expect(project.section('waiting').rows[0]?.values).toMatchObject({
      waiting_on: '[[Mara Quill]]',
      waited: 'waiting 12 days',
    });
    expect(project.section('tasks').hint).toBeNull();
  });

  it('lists a project’s meetings, decisions and linked notes', async () => {
    const project = await page(MIGRATION, 'project');
    expect(project.titles('meetings')).toEqual(['Kickoff']);
    expect(project.titles('decisions')).toEqual(['Two-step approval']);
    expect(project.titles('notes')).toEqual(['Payroll runbook']);
  });

  it('says a project with open tasks and nothing moving has no next action', async () => {
    const idle = await page('Projects/Idle.md', 'project');
    expect(idle.titles('tasks')).toEqual(['Tidy the backlog']);
    expect(idle.section('tasks').hint).toBe(
      'No next action: its one open task is not Next Action or In Progress.',
    );
    expect(idle.section('waiting').hint).toBeNull();
  });

  it('lists an area’s projects', async () => {
    const area = await page(OPERATIONS, 'area');
    expect(area.titles('projects')).toEqual(['Idle', 'Payroll Migration']);
    // Nothing is filed straight under the area, so there is no open work to be missing a next action.
    expect(area.section('tasks')).toMatchObject({ rows: [], hint: null });
  });
});

describe('readLinkedPage: a meeting, and what came from it', () => {
  it('lists its people with their company, and its companies', async () => {
    const kickoff = await page(KICKOFF, 'meeting');
    expect(kickoff.titles('people')).toEqual(['Mara Quill', 'Tobias Fenn']);
    expect(kickoff.section('people').rows[0]?.values).toMatchObject({
      company: '[[Larkspur Payroll]]',
      role: 'Controller',
    });
    expect(kickoff.titles('companies')).toEqual(['Larkspur Payroll']);
  });

  it('lists the tasks and decisions that came from it, whichever of the two holds the link', async () => {
    const kickoff = await page(KICKOFF, 'meeting');
    // Two cite a turn of it in `source`; one is named by the meeting's own `tasks`.
    expect(kickoff.titles('tasks')).toEqual([
      'Book a room',
      'Call the vendor',
      'Send the contract',
    ]);
    expect(kickoff.section('tasks').fields.map((field) => field.key)).toEqual([
      'status',
      'waiting_on',
      'due',
    ]);
    expect(kickoff.titles('decisions')).toEqual(['Two-step approval']);
  });

  it.each([
    ['Tasks/Send the contract.md', 'task'],
    ['Tasks/Call the vendor.md', 'task'],
    ['Decisions/Two-step approval.md', 'decision'],
  ])('shows the meeting on what came from it: %s', async (path, typeName) => {
    const made = await page(path, typeName);
    expect(made.sections.map((section) => section.title)).toEqual(['From meeting']);
    expect(made.titles('meetings')).toEqual(['Kickoff']);
    expect(made.section('meetings').range).toBeNull();
  });

  it('shows no meeting on a task that came from none', async () => {
    expect((await page('Tasks/Tidy the backlog.md', 'task')).titles('meetings')).toEqual([]);
  });
});

describe('readLinkedPage: what it does not do', () => {
  it('gives a page of another type no sections, and asks nothing', async () => {
    const runbook = await page('Resources/Payroll runbook.md', 'resource');
    expect(runbook.sections).toEqual([]);
    expect(runbook.asked).toEqual([]);
    expect((await page('Notes/Loose.md', 'person')).sections).toHaveLength(5);
  });

  it('says a section the index could not answer, and still answers the rest', async () => {
    const run = atlasQueryIndex({ files: FILES, markdown: jsonMarkdown() });
    const index = fakeIndexPort({
      query: (sql, parameters) => {
        if (sql.includes('waiting')) throw new Error('database is locked');
        return run(sql, parameters);
      },
    });
    const sections = await readLinkedPage({
      index,
      clock,
      types: TYPES,
      notePaths: Object.keys(FILES),
      notePath: MIGRATION,
      typeName: 'project',
    });
    const waiting = sections.find((section) => section.id === 'waiting');
    expect(waiting).toMatchObject({ rows: [], problem: 'database is locked' });
    expect(sections.find((section) => section.id === 'meetings')?.problem).toBeNull();
  });

  it('holds its hint back when the list was cut off, since a next action may be past the cut', async () => {
    const run = atlasQueryIndex({ files: FILES, markdown: jsonMarkdown() });
    const index = fakeIndexPort({
      query: async (sql, parameters) => ({ ...(await run(sql, parameters)), truncated: true }),
    });
    const sections = await readLinkedPage({
      index,
      clock,
      types: TYPES,
      notePaths: Object.keys(FILES),
      notePath: 'Projects/Idle.md',
      typeName: 'project',
    });
    const tasks = sections.find((section) => section.id === 'tasks');
    expect(tasks).toMatchObject({ truncated: true, hint: null });
    expect(tasks?.rows).toHaveLength(1);
  });
});
