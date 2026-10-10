import { describe, expect, it } from 'vitest';
import { checkAtlasQuery, comparisonsFor } from './check.ts';
import { directFields, fieldsThrough } from './fields.ts';
import { parseAtlasQuery } from './parse.ts';
import { QUERY_TEST_TYPES } from './query-fixtures.ts';
import { QueryTextError } from './query-text-error.ts';

function problem(text: string): { message: string; at: string } | null {
  try {
    checkAtlasQuery(parseAtlasQuery(text), QUERY_TEST_TYPES);
    return null;
  } catch (error) {
    if (!(error instanceof QueryTextError)) throw error;
    return { message: error.message, at: text.slice(error.span.start, error.span.end) };
  }
}

describe('checkAtlasQuery: what passes', () => {
  it.each([
    'FROM task, project WHERE status != done AND project.owner = [[Julie]] AND tag = #q3 SORT BY due GROUP BY project THEN status',
    'FROM task WHERE due < @today AND estimate >= 2 AND flagged = true AND labels = red',
    'FROM task WHERE title CONTAINS plan AND path STARTS WITH tasks AND type = task',
    'FROM task WHERE project = Atlas AND project CONTAINS atl AND project.due > 2026-09-01',
    'FROM task WHERE modified >= @weekAgo AND project.tag = #q3 AND tag != q3',
    'FROM task WHERE estimate IS EMPTY OR NOT (notes = 12)',
    'FROM task SHOW tag, project.owner, project.title SORT BY project.due DESC',
    'FROM person WHERE role = lead',
    'FROM task WHERE due > @-30d AND due <= @+2w AND modified >= @startOfWeek',
    'FROM task WHERE due < @+1m OR due > @-1y OR due = @+0d',
    'FROM task WHERE due < @+1000y AND due > @-1000y AND due > @-9999d AND due < @+9999m',
  ])('%s', (text) => {
    expect(problem(text)).toBeNull();
  });
});

describe('checkAtlasQuery: problems point at what caused them', () => {
  it.each([
    ['FROM tsk', 'There is no type called tsk.', 'tsk'],
    ['FROM task, task', 'task is listed twice.', 'task'],
    ['FROM task WHERE stauts = done', 'A task has no field called stauts.', 'stauts'],
    ['FROM task, project WHERE role = x', 'A task or project has no field called role.', 'role'],
    [
      'FROM task WHERE status.owner = x',
      'status is not a relation, so it has no fields to reach through.',
      'status',
    ],
    ['FROM project WHERE lead.x = 1', 'lead points at nowhere, which is not a type here.', 'lead'],
    ['FROM task WHERE project.role = x', 'A project has no field called role.', 'role'],
    [
      'FROM task WHERE status < done',
      'status is a select; it can be compared with =, !=, CONTAINS, STARTS WITH.',
      'status < done',
    ],
    [
      'FROM task WHERE flagged CONTAINS x',
      'flagged is a checkbox; it can be compared with =, !=.',
      'flagged CONTAINS x',
    ],
    ['FROM task WHERE tag < #q3', 'tag is a tag; it can be compared with =, !=.', 'tag < #q3'],
    [
      'FROM task WHERE estimate CONTAINS 3',
      'estimate is a number; it can be compared with =, !=, <, <=, >, >=.',
      'estimate CONTAINS 3',
    ],
    [
      'FROM task WHERE title > x',
      'title is text; it can be compared with =, !=, CONTAINS, STARTS WITH.',
      'title > x',
    ],
    [
      'FROM task WHERE estimate = three',
      'estimate is a number: compare it with a number.',
      'three',
    ],
    [
      'FROM task WHERE due = tomorrow',
      'due is a date: compare it with a date like 2026-09-30, or @today.',
      'tomorrow',
    ],
    [
      'FROM task WHERE due = 2026-02-30',
      'due is a date: compare it with a date like 2026-09-30, or @today.',
      '2026-02-30',
    ],
    [
      'FROM task WHERE modified = 7',
      'modified is a date: compare it with a date like 2026-09-30, or @today.',
      '7',
    ],
    [
      'FROM task WHERE flagged = yes',
      'flagged is a checkbox: compare it with true or false.',
      'yes',
    ],
    [
      'FROM task WHERE project = #q3',
      'project points at a note: compare it with a link like [[Julie]].',
      '#q3',
    ],
    [
      'FROM task WHERE project = true',
      'project points at a note: compare it with a link like [[Julie]].',
      'true',
    ],
    ['FROM task WHERE tag = [[q3]]', 'tag is compared with a tag, like #q3.', '[[q3]]'],
    ['FROM task WHERE tag = 2026', 'tag is compared with a tag, like #q3.', '2026'],
    ['FROM task WHERE status = #q3', '#q3 is a tag; compare it with tag.', '#q3'],
    [
      'FROM task WHERE status = [[Julie]]',
      '[[Julie]] is a link, and status is not a relation.',
      '[[Julie]]',
    ],
    ['FROM task WHERE notes = true', 'notes holds text, not true or false.', 'true'],
    ['FROM task WHERE status = @today', '@today is a date, and status is not.', '@today'],
    [
      'FROM task WHERE due < @someday',
      'There is no date called @someday. Try @today, @yesterday, @tomorrow, @weekAgo, @weekAhead, @monthAhead, @startOfWeek, or a count from today like @-30d, @+2w, @+1m or @-1y.',
      '@someday',
    ],
    ['FROM task WHERE status = @-30d', '@-30d is a date, and status is not.', '@-30d'],
    ...['@+1001y', '@-1001y', '@+9999y'].map((date) => [
      `FROM task WHERE due < ${date}`,
      `${date} is too far away: a count from today reaches 1000 years at most.`,
      date,
    ]),
    ...['@30d', '@-30x', '@-12345d', '@startofweek'].map((date) => [
      `FROM task WHERE due < ${date}`,
      `There is no date called ${date}. Try @today, @yesterday, @tomorrow, @weekAgo, @weekAhead, @monthAhead, @startOfWeek, or a count from today like @-30d, @+2w, @+1m or @-1y.`,
      date,
    ]),
    ['FROM task WHERE title CONTAINS [[x]]', 'CONTAINS takes text.', '[[x]]'],
    ['FROM task WHERE project STARTS WITH #x', 'STARTS WITH takes text.', '#x'],
    [
      'FROM task WHERE owner IS EMPTY AND nope IS EMPTY',
      'A task has no field called nope.',
      'nope',
    ],
    ['FROM task WHERE NOT nope = 1', 'A task has no field called nope.', 'nope'],
    ['FROM task SORT BY tag', 'A note can have many tags, so it cannot be sorted by one.', 'tag'],
    [
      'FROM task GROUP BY status THEN tag',
      'A note can have several tags, so it cannot be grouped by it.',
      'tag',
    ],
    ['FROM task SHOW due, nope', 'A task has no field called nope.', 'nope'],
    ['FROM task SORT BY nope', 'A task has no field called nope.', 'nope'],
  ])('%j', (text, message, at) => {
    expect(problem(text)).toEqual({ message, at });
  });
});

describe('comparisonsFor', () => {
  it('offers each kind the comparisons that mean something for it', () => {
    expect(comparisonsFor('select')).toEqual(['=', '!=', 'contains', 'startsWith']);
    expect(comparisonsFor('number')).toEqual(['=', '!=', '<', '<=', '>', '>=']);
    expect(comparisonsFor('date')).toEqual(['=', '!=', '<', '<=', '>', '>=']);
    expect(comparisonsFor('checkbox')).toEqual(['=', '!=']);
    expect(comparisonsFor('tag')).toEqual(['=', '!=']);
    expect(comparisonsFor('thumbnail')).toEqual(['=', '!=']);
  });
});

describe('directFields and fieldsThrough', () => {
  it('lists the built-ins, then each listed type’s properties, a shared key once', () => {
    const fields = directFields(QUERY_TEST_TYPES, ['project', 'task']).map((field) => field.text);
    expect(fields).toEqual([
      'title',
      'type',
      'tag',
      'modified',
      'path',
      'status',
      'owner',
      'due',
      'lead',
      'estimate',
      'project',
      'flagged',
      'labels',
      'notes',
    ]);
  });

  it('takes a shared key as the first listed type declares it', () => {
    const status = directFields(QUERY_TEST_TYPES, ['project', 'task']).find(
      (field) => field.key === 'status',
    );
    expect(status?.options).toEqual(['active', 'paused']);
  });

  it('offers the type names as the values of type', () => {
    const type = directFields(QUERY_TEST_TYPES, ['task']).find((field) => field.key === 'type');
    expect(type?.options).toEqual(['task', 'project', 'person']);
  });

  it('reaches through a relation to the fields of the type it points at', () => {
    const project = directFields(QUERY_TEST_TYPES, ['task']).find(
      (field) => field.key === 'project',
    );
    if (project === undefined) throw new Error('no project field');
    const through = fieldsThrough(project, QUERY_TEST_TYPES);
    expect(through.map((field) => field.text)).toContain('project.owner');
    expect(through.map((field) => field.text)).not.toContain('project.path');
    expect(through.find((field) => field.text === 'project.owner')).toMatchObject({
      label: 'Project · Owner',
      via: 'project',
      key: 'owner',
      kind: 'relation',
      target: 'person',
    });
  });

  it('reaches nowhere through a relation to a type the vault lacks', () => {
    const lead = directFields(QUERY_TEST_TYPES, ['project']).find((field) => field.key === 'lead');
    if (lead === undefined) throw new Error('no lead field');
    expect(fieldsThrough(lead, QUERY_TEST_TYPES)).toEqual([]);
  });
});

describe('checkAtlasQuery: how many conditions a query may hold', () => {
  const chain = (count: number) =>
    `FROM task WHERE ${Array.from({ length: count }, (_, at) => `notes = v${at}`).join(' OR ')}`;

  it('lets through as many as the index can bind', () => {
    expect(problem(chain(2000))).toBeNull();
  });

  it('refuses one more, pointing at the first condition past the limit', () => {
    expect(problem(chain(2001))).toEqual({
      message: 'A query holds 2000 conditions at most.',
      at: 'notes = v2000',
    });
  });
});

describe('checkAtlasQuery: this, and LINKS TO', () => {
  const NOTE = 'people/Mara Quill.md';

  function problemOn(
    text: string,
    thisNote: string | null,
  ): { message: string; at: string } | null {
    try {
      checkAtlasQuery(parseAtlasQuery(text), QUERY_TEST_TYPES, thisNote);
      return null;
    } catch (error) {
      if (!(error instanceof QueryTextError)) throw error;
      return { message: error.message, at: text.slice(error.span.start, error.span.end) };
    }
  }

  it.each([
    'FROM task WHERE owner = this',
    'FROM task WHERE owner != this AND project.owner = this',
    'FROM task WHERE LINKS TO this OR NOT LINKS TO this',
  ])('passes on a note: %s', (text) => {
    expect(problemOn(text, NOTE)).toBeNull();
  });

  const NOT_ON_A_NOTE = 'this is the note a query is shown on, and this query is not shown on one.';

  it.each([
    ['FROM task WHERE owner = this', 'this'],
    ['FROM task WHERE status = done AND NOT (LINKS TO this)', 'this'],
    ['FROM task WHERE project.owner != THIS', 'THIS'],
  ])('refuses this on no note, pointing at it: %s', (text, at) => {
    expect(problemOn(text, null)).toEqual({ message: NOT_ON_A_NOTE, at });
  });

  it('finds what else is wrong first, even with no note', () => {
    expect(problemOn('FROM task WHERE stauts = this', null)?.message).toBe(
      'A task has no field called stauts.',
    );
  });

  const NOT_A_RELATION =
    "this is a note: compare a relation with it using = or !=, like people = this. To mean the word, quote it: 'this'.";

  it.each([
    ['FROM task WHERE status = this', 'this'],
    ['FROM task WHERE title = this', 'this'],
    ['FROM task WHERE owner CONTAINS this', 'this'],
    ['FROM task WHERE due < this', 'this'],
  ])('compares this with a relation only: %s', (text, at) => {
    expect(problemOn(text, NOTE)).toEqual({ message: NOT_A_RELATION, at });
  });

  it.each([
    ['FROM task WHERE LINKS TO [[Mara Quill]]', '[[Mara Quill]]'],
    ["FROM task WHERE LINKS TO 'this'", "'this'"],
  ])('takes nothing but this after LINKS TO: %s', (text, at) => {
    expect(problemOn(text, NOTE)).toEqual({
      message: 'LINKS TO takes this: the note the query is shown on.',
      at,
    });
  });
});
