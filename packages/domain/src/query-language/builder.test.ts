import { describe, expect, it } from 'vitest';
import {
  blankBuilder,
  builderFromQuery,
  builderOperatorsFor,
  builderOperatorWords,
  MOVING_DATES,
  isComplete,
  queryFromBuilder,
  startingCondition,
  valueEditorFor,
  valueFromInput,
  valueInputText,
  type BuilderQuery,
} from './builder.ts';
import { queryableFields, type QueryField } from './fields.ts';
import { parseAtlasQuery } from './parse.ts';
import { printAtlasQuery } from './print.ts';
import { QUERY_TEST_TYPES } from './query-fixtures.ts';
import { RELATIVE_DATE_NAMES } from '../query/view-query.ts';
import { compileAtlasQuery, resultFields } from './compile.ts';
import { problemOf, QueryTextError } from './query-text-error.ts';

const FIELDS = queryableFields(QUERY_TEST_TYPES, ['task']);
const field = (text: string): QueryField => {
  const found = FIELDS.find((candidate) => candidate.text === text);
  if (found === undefined) throw new Error(`no field ${text}`);
  return found;
};

function builderOf(text: string): BuilderQuery {
  const reading = builderFromQuery(parseAtlasQuery(text));
  if (!reading.ok) throw new Error(reading.reason);
  return reading.builder;
}

/** Text → builder → text: what the toggle does both ways. */
const throughBuilder = (text: string) => printAtlasQuery(queryFromBuilder(builderOf(text)));

describe('builderFromQuery and queryFromBuilder', () => {
  it('round-trips the U-23 example through the builder unchanged', () => {
    const text =
      'FROM task, project WHERE status != done AND project.owner = [[Julie]] AND tag = #q3 SORT BY due GROUP BY project THEN status';
    expect(throughBuilder(text)).toBe(text);
  });

  it('holds every clause the builder has a control for', () => {
    expect(
      builderOf(
        'FROM task WHERE due IS EMPTY OR NOT flagged = true SORT BY due DESC GROUP BY status SHOW due INCLUDE ARCHIVED LIMIT 7',
      ),
    ).toEqual({
      types: ['task'],
      match: 'any',
      conditions: [
        { field: 'due', op: 'isEmpty', value: null, negated: false },
        {
          field: 'flagged',
          op: '=',
          value: expect.objectContaining({ value: true }),
          negated: true,
        },
      ],
      sort: [{ field: 'due', direction: 'desc' }],
      group: ['status'],
      show: ['due'],
      includeArchived: true,
      limit: 7,
    });
  });

  it('reads brackets around the same joiner as one list', () => {
    expect(builderOf('FROM task WHERE a = 1 AND (b = 2 AND (c = 3))').conditions).toHaveLength(3);
    expect(throughBuilder('FROM task WHERE a = 1 AND (b = 2 AND c = 3)')).toBe(
      'FROM task WHERE a = 1 AND b = 2 AND c = 3',
    );
  });

  it('says why a query that mixes AND and OR stays text, rather than flattening it', () => {
    for (const text of [
      'FROM task WHERE a = 1 AND (b = 2 OR c = 3)',
      'FROM task WHERE a = 1 OR b = 2 AND c = 3',
      'FROM task WHERE NOT (a = 1 AND b = 2)',
    ]) {
      const reading = builderFromQuery(parseAtlasQuery(text));
      expect(reading).toEqual({ ok: false, reason: expect.stringContaining('Edit it as text') });
    }
  });

  it('says a query with LINKS TO stays text, wherever in it LINKS TO is', () => {
    for (const text of [
      'FROM task WHERE LINKS TO this',
      'FROM task WHERE status = done AND NOT LINKS TO this',
    ]) {
      expect(builderFromQuery(parseAtlasQuery(text))).toEqual({
        ok: false,
        reason: 'This query says LINKS TO, which the builder has no control for. Edit it as text.',
      });
    }
  });

  it('carries this through the builder unchanged, and shows it as this', () => {
    expect(throughBuilder('FROM task WHERE owner = this')).toBe('FROM task WHERE owner = this');
    expect(
      valueInputText(builderOf('FROM task WHERE owner = this').conditions[0]?.value ?? null),
    ).toBe('this');
  });

  it('takes one condition, or none, as a list of one, or of none', () => {
    expect(builderOf('FROM task WHERE a IS NOT EMPTY').conditions).toEqual([
      { field: 'a', op: 'isNotEmpty', value: null, negated: false },
    ]);
    expect(builderOf('FROM task').conditions).toEqual([]);
    expect(throughBuilder('FROM task WHERE NOT a IS EMPTY')).toBe('FROM task WHERE NOT a IS EMPTY');
  });

  it('leaves a condition still waiting for its value out of the query', () => {
    const builder: BuilderQuery = {
      ...blankBuilder('task'),
      conditions: [
        { field: 'status', op: '=', value: null, negated: false },
        { field: 'due', op: 'isEmpty', value: null, negated: false },
      ],
    };
    expect(printAtlasQuery(queryFromBuilder(builder))).toBe('FROM task WHERE due IS EMPTY');
    expect(builder.conditions.map(isComplete)).toEqual([false, true]);
  });

  it('writes a match-any list with OR', () => {
    const builder: BuilderQuery = {
      ...blankBuilder('task'),
      match: 'any',
      conditions: [
        startingCondition(field('status')),
        {
          ...startingCondition(field('estimate')),
          value: valueFromInput(field('estimate'), '=', '3'),
        },
      ],
    };
    expect(printAtlasQuery(queryFromBuilder(builder))).toBe(
      'FROM task WHERE status = backlog OR estimate = 3',
    );
  });
});

describe('the builder’s controls', () => {
  it('offers the operators that fit the field, then emptiness', () => {
    expect(builderOperatorsFor(field('status'))).toEqual([
      '=',
      '!=',
      'contains',
      'startsWith',
      'isEmpty',
      'isNotEmpty',
    ]);
    expect(builderOperatorsFor(field('due'))).toEqual([
      '=',
      '!=',
      '<',
      '<=',
      '>',
      '>=',
      'isEmpty',
      'isNotEmpty',
    ]);
  });

  it('picks the control for a value by the field’s kind', () => {
    expect(
      [
        'status',
        'type',
        'project',
        'project.owner',
        'due',
        'modified',
        'flagged',
        'tag',
        'estimate',
        'title',
      ].map((text) => valueEditorFor(field(text), '=')),
    ).toEqual([
      'options',
      'options',
      'note',
      'note',
      'date',
      'date',
      'boolean',
      'tag',
      'number',
      'text',
    ]);
    expect(valueEditorFor(field('project'), 'contains')).toBe('text');
  });

  it('turns what was typed into the value the field compares with', () => {
    const value = (text: string, input: string, op: '=' | 'contains' = '=') => {
      const found = valueFromInput(field(text), op, input);
      if (found === null) return null;
      return Object.fromEntries(Object.entries(found).filter(([key]) => key !== 'span'));
    };
    expect(value('estimate', ' 3.5 ')).toEqual({ kind: 'number', number: 3.5, text: '3.5' });
    expect(value('estimate', 'three')).toEqual({ kind: 'text', text: 'three' });
    expect(value('flagged', 'TRUE')).toEqual({ kind: 'boolean', value: true });
    expect(value('flagged', 'false')).toEqual({ kind: 'boolean', value: false });
    expect(value('project', '[[Atlas]]')).toEqual({ kind: 'link', target: 'Atlas' });
    expect(value('project', 'Atlas')).toEqual({ kind: 'link', target: 'Atlas' });
    expect(value('project', 'atl', 'contains')).toEqual({ kind: 'text', text: 'atl' });
    expect(value('tag', '#q3')).toEqual({ kind: 'tag', name: 'q3' });
    expect(value('due', '@today')).toEqual({ kind: 'relativeDate', name: 'today' });
    expect(value('due', '2026-09-30')).toEqual({ kind: 'text', text: '2026-09-30' });
    expect(value('status', 'done')).toEqual({ kind: 'text', text: 'done' });
    expect(value('status', '   ')).toBeNull();
  });

  it('shows a value in its control the way it was typed', () => {
    const shown = (text: string, input: string) =>
      valueInputText(valueFromInput(field(text), '=', input));
    expect(shown('estimate', '3')).toBe('3');
    expect(shown('flagged', 'true')).toBe('true');
    expect(shown('project', '[[Atlas]]')).toBe('Atlas');
    expect(shown('tag', '#q3')).toBe('q3');
    expect(shown('due', '@today')).toBe('@today');
    expect(shown('status', 'done')).toBe('done');
    expect(valueInputText(null)).toBe('');
  });

  it('starts a new condition with the field’s first operator and an obvious value', () => {
    expect(startingCondition(field('status'))).toMatchObject({
      field: 'status',
      op: '=',
      value: { kind: 'text', text: 'backlog' },
    });
    expect(startingCondition(field('flagged')).value).toMatchObject({
      kind: 'boolean',
      value: true,
    });
    expect(startingCondition(field('due')).value).toBeNull();
  });
});

describe('the builder’s words', () => {
  it('says "before" and "after" of a date, and "less" and "more" of a number', () => {
    expect(builderOperatorWords('<', 'date')).toBe('is before');
    expect(builderOperatorWords('>=', 'modified')).toBe('is on or after');
    expect(builderOperatorWords('<', 'number')).toBe('is less than');
    expect(builderOperatorWords('=', 'date')).toBe('is');
    expect(builderOperatorWords('isNotEmpty', 'text')).toBe('is not empty');
  });

  it('offers exactly the moving dates a query can name', () => {
    expect(MOVING_DATES.map((date) => date.value)).toEqual(RELATIVE_DATE_NAMES);
  });

  it('never writes a row limit a query cannot read back', () => {
    const builder = { ...blankBuilder('task'), limit: 99999 };
    expect(printAtlasQuery(queryFromBuilder(builder))).toBe('FROM task LIMIT 5000');
    expect(printAtlasQuery(queryFromBuilder({ ...builder, limit: 0 }))).toBe('FROM task LIMIT 1');
  });
});

describe('a result’s columns and a problem as data', () => {
  it('draws each row’s type, then the fields the query shows, headed by their labels', () => {
    const compiled = compileAtlasQuery(parseAtlasQuery('FROM task SHOW due, project.owner'), {
      types: QUERY_TEST_TYPES,
      resolveLink: () => null,
    });
    expect(resultFields(compiled)).toEqual([
      { key: 'type', label: 'Type', kind: 'type' },
      { key: 'due', label: 'Due', kind: 'date' },
      { key: 'project.owner', label: 'Project · Owner', kind: 'relation' },
    ]);
  });

  it('hands a problem across as its message and its place', () => {
    const error = new QueryTextError('Nope.', { start: 2, end: 4 });
    expect(problemOf(error)).toEqual({ message: 'Nope.', span: { start: 2, end: 4 } });
    expect(error.name).toBe('QueryTextError');
  });
});
