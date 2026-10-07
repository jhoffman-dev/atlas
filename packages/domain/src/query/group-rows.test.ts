import { describe, expect, it } from 'vitest';
import { groupRows, toBoardRows, UNGROUPED_LABEL, type BoardRow } from './group-rows.ts';

const row = (path: string, title: string, status: unknown): BoardRow => ({
  path,
  title,
  values: { path, title, status },
});

const labels = (columns: { label: string }[]) => columns.map((column) => column.label);

describe('toBoardRows', () => {
  it('reads the path and title out of the result', () => {
    const rows = toBoardRows({
      columns: ['path', 'title', 'status'],
      rows: [['a.md', 'First', 'doing']],
    });
    expect(rows).toEqual([
      { path: 'a.md', title: 'First', values: { path: 'a.md', title: 'First', status: 'doing' } },
    ]);
  });

  it('copes with a result that has no title column', () => {
    const rows = toBoardRows({ columns: ['path'], rows: [['a.md']] });
    expect(rows[0]).toMatchObject({ path: 'a.md', title: '' });
  });

  it('falls back to the row number when there is no path', () => {
    expect(toBoardRows({ columns: ['title'], rows: [['A']] })[0]?.path).toBe('0');
  });

  it('handles no rows', () => {
    expect(toBoardRows({ columns: ['path'], rows: [] })).toEqual([]);
  });
});

describe('groupRows', () => {
  const options = ['backlog', 'doing', 'done'];

  it('makes a column per declared option, in the declared order', () => {
    const columns = groupRows({ rows: [], groupBy: 'status', options });
    expect(labels(columns)).toEqual(['backlog', 'doing', 'done']);
  });

  it('puts each row in the column for its value', () => {
    const columns = groupRows({
      rows: [row('a.md', 'A', 'doing'), row('b.md', 'B', 'backlog')],
      groupBy: 'status',
      options,
    });
    expect(columns[0]?.rows.map((r) => r.title)).toEqual(['B']);
    expect(columns[1]?.rows.map((r) => r.title)).toEqual(['A']);
  });

  it('keeps the order rows arrived in within a column', () => {
    const columns = groupRows({
      rows: [row('a.md', 'A', 'doing'), row('b.md', 'B', 'doing')],
      groupBy: 'status',
      options,
    });
    expect(columns[1]?.rows.map((r) => r.title)).toEqual(['A', 'B']);
  });

  it('keeps an empty declared column, so there is somewhere to drop a card', () => {
    const columns = groupRows({ rows: [row('a.md', 'A', 'doing')], groupBy: 'status', options });
    expect(columns[0]?.rows).toEqual([]);
    expect(labels(columns)).toHaveLength(3);
  });

  it('gives an undeclared value its own column rather than hiding the card', () => {
    const columns = groupRows({
      rows: [row('a.md', 'A', 'blocked')],
      groupBy: 'status',
      options,
    });
    expect(labels(columns)).toEqual(['backlog', 'doing', 'done', 'blocked']);
  });

  it('sorts undeclared values so the board does not reshuffle between runs', () => {
    const columns = groupRows({
      rows: [row('a.md', 'A', 'zeta'), row('b.md', 'B', 'alpha')],
      groupBy: 'status',
      options,
    });
    expect(labels(columns).slice(3)).toEqual(['alpha', 'zeta']);
  });

  it.each([null, undefined, '', '   '])('collects rows whose value is %j', (value) => {
    const columns = groupRows({
      rows: [row('a.md', 'A', value)],
      groupBy: 'status',
      options,
    });
    expect(labels(columns).at(-1)).toBe(UNGROUPED_LABEL);
    expect(columns.at(-1)?.rows.map((r) => r.title)).toEqual(['A']);
  });

  it('leaves out the no-value column when every card has one', () => {
    const columns = groupRows({ rows: [row('a.md', 'A', 'doing')], groupBy: 'status', options });
    expect(labels(columns)).not.toContain(UNGROUPED_LABEL);
  });

  it('trims a value before grouping, so a stray space does not split a column', () => {
    const columns = groupRows({
      rows: [row('a.md', 'A', 'doing'), row('b.md', 'B', ' doing ')],
      groupBy: 'status',
      options,
    });
    expect(columns[1]?.rows).toHaveLength(2);
  });

  it('groups everything under no-value when the property is not in the rows', () => {
    const columns = groupRows({ rows: [row('a.md', 'A', 'doing')], groupBy: 'missing', options });
    expect(columns.at(-1)?.label).toBe(UNGROUPED_LABEL);
    expect(columns.at(-1)?.rows).toHaveLength(1);
  });

  it('makes a column per value found when the type declares none', () => {
    const columns = groupRows({
      rows: [row('a.md', 'A', 'doing'), row('b.md', 'B', 'backlog')],
      groupBy: 'status',
      options: [],
    });
    expect(labels(columns)).toEqual(['backlog', 'doing']);
  });
});
