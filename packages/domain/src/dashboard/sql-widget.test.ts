import { describe, expect, it } from 'vitest';
import { parseDashboard } from './dashboard.ts';
import { sqlGroups, sqlNumber, sqlShowProblem } from './sql-widget.ts';
import { draftFromEntry, entryFromDraft, sqlWidgetDraft, widgetProblems } from './widget-draft.ts';

const board = (widgets: unknown[]) => ({ atlas: 'dashboard', widgets });

describe('a sql widget in a dashboard', () => {
  it('reads its statement and how it draws, without a type', () => {
    const [widget] = parseDashboard(
      board([
        { kind: 'sql', sql: 'SELECT status, COUNT(*) FROM v_task GROUP BY status;', show: 'bar' },
      ]),
    );
    expect(widget?.kind).toBe('sql');
    expect(widget?.query).toBeNull();
    expect(widget?.sql).toEqual({
      statement: 'SELECT status, COUNT(*) FROM v_task GROUP BY status',
      show: 'bar',
    });
    expect(widget?.title).toBe('Query');
  });

  it('draws a table when it does not say, or says something else', () => {
    const shows = parseDashboard(
      board([
        { kind: 'sql', sql: 'SELECT 1' },
        { kind: 'sql', sql: 'SELECT 1', show: 'pie' },
      ]),
    ).map((widget) => widget.sql?.show);
    expect(shows).toEqual(['table', 'table']);
  });

  it('is dropped without a statement, and the rest still draw', () => {
    const widgets = parseDashboard(
      board([
        { kind: 'sql', sql: '  ;  ' },
        { kind: 'number', type: 'task' },
      ]),
    );
    expect(widgets.map((widget) => widget.kind)).toEqual(['number']);
  });
});

describe('a sql widget draft', () => {
  it('writes the statement and the shape, and no type or filters', () => {
    const draft = { ...sqlWidgetDraft({ sql: 'SELECT 1;', show: 'number', title: 'One' }) };
    const entry = entryFromDraft({
      ...draft,
      type: 'task',
      filters: [{ key: 'a', operator: 'isEmpty' }],
    });
    expect(entry).toEqual({ title: 'One', kind: 'sql', sql: 'SELECT 1', show: 'number' });
  });

  it('reads back what it wrote', () => {
    const draft = draftFromEntry({ kind: 'sql', sql: 'SELECT 2', show: 'bar' });
    expect(draft).toMatchObject({ kind: 'sql', sql: 'SELECT 2', show: 'bar' });
  });

  it('takes the statement and shape out when it becomes another kind', () => {
    const draft = draftFromEntry({ kind: 'sql', sql: 'SELECT 2', show: 'bar' });
    const entry = entryFromDraft(
      { ...draft, kind: 'number', type: 'task' },
      { kind: 'sql', sql: 'SELECT 2', show: 'bar' },
    );
    expect(entry).not.toHaveProperty('sql');
    expect(entry).not.toHaveProperty('show');
    expect(entry['type']).toBe('task');
  });

  it('asks for a statement rather than a type', () => {
    expect(widgetProblems(sqlWidgetDraft({ sql: ' ', show: 'table', title: '' }))).toEqual([
      'Write the query this widget runs.',
    ]);
    expect(widgetProblems(sqlWidgetDraft({ sql: 'SELECT 1', show: 'table', title: '' }))).toEqual(
      [],
    );
  });
});

describe('reading a sql widget’s result', () => {
  it('shows the first cell as the number', () => {
    expect(sqlNumber({ columns: ['n', 'm'], rows: [[12.5, 3]] })).toBe('12.5');
    expect(sqlNumber({ columns: ['n'], rows: [] })).toBe('—');
    expect(sqlNumber({ columns: ['word'], rows: [['open']] })).toBe('open');
  });

  it('charts the first column as labels and the second as values, in the order they came', () => {
    const groups = sqlGroups({
      columns: ['status', 'n', 'ignored'],
      rows: [
        ['doing', 3, 'x'],
        ['backlog', '7', 'y'],
        [null, 'many', 'z'],
      ],
    });
    expect(groups).toEqual([
      { label: 'doing', count: 3 },
      { label: 'backlog', count: 7 },
      { label: '', count: 0 },
    ]);
  });

  it('refuses to chart a single column', () => {
    expect(() => sqlGroups({ columns: ['n'], rows: [[1]] })).toThrow(/label and a value/);
  });

  it('says which shapes a result can take', () => {
    expect(sqlShowProblem('bar', ['a'])).toMatch(/label and a value/);
    expect(sqlShowProblem('bar', ['a', 'b'])).toBeNull();
    expect(sqlShowProblem('number', ['a'])).toBeNull();
    expect(sqlShowProblem('table', [])).toMatch(/no columns/);
  });
});

describe('sqlNumber — adversarial', () => {
  const one = (value: unknown) => sqlNumber({ columns: ['n'], rows: [[value]] });

  // `toFixed(2)` then stripping zeros leaves "2." for 2.004 and "-0." for -0.001.
  it('never shows a number ending in a bare decimal point', () => {
    expect(one(2.004)).toBe('2');
    expect(one(-0.001)).toBe('0');
  });

  it('shows a dash for an empty result', () => {
    expect(sqlNumber({ columns: ['n'], rows: [] })).toBe('—');
  });
});
