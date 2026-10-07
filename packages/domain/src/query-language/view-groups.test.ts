import { describe, expect, it } from 'vitest';
import type { BoardRow } from '../query/group-rows.ts';
import { parseObjectType } from '../types/property-def.ts';
import { groupResultRows, type RowGroup } from './result-groups.ts';
import {
  boardGroups,
  columnSummary,
  drawnLevels,
  groupChoices,
  groupColumnOptions,
  groupLines,
  groupPrefill,
  groupValueProperty,
  movedValue,
  viewGroupKeys,
  viewGroupLevels,
} from './view-groups.ts';

const TASK = parseObjectType({
  name: 'task',
  label: 'Task',
  properties: {
    status: {
      kind: 'select',
      options: ['backlog', 'doing', 'done'],
      colors: { doing: 'review' },
    },
    phase: 'number',
    due: 'date',
    project: { kind: 'relation', target: 'project' },
    projects: { kind: 'relation', target: 'project', many: true },
    flagged: 'checkbox',
    labels: { kind: 'multiSelect', options: ['red'] },
    cover: 'thumbnail',
  },
});

const row = (title: string, values: Record<string, unknown>): BoardRow => ({
  path: `tasks/${title}.md`,
  title,
  values: { title, ...values },
});

const ROWS = [
  row('A', { status: 'doing', phase: 2, flagged: 'true' }),
  row('B', { status: 'backlog', phase: '10', flagged: 'false' }),
  row('C', { status: 'doing', phase: 1 }),
  row('D', { status: null, phase: '' }),
];

describe('groupChoices', () => {
  it('offers each property in declared order, but never a picture', () => {
    expect(groupChoices(TASK).map((choice) => choice.key)).toEqual([
      'status',
      'phase',
      'due',
      'project',
      'projects',
      'flagged',
      'labels',
    ]);
  });

  it('refuses a field holding several values, saying why', () => {
    const reasons = Object.fromEntries(
      groupChoices(TASK).map((choice) => [choice.key, choice.reason]),
    );
    expect(reasons['status']).toBeNull();
    expect(reasons['project']).toBeNull();
    expect(reasons['projects']).toBe(
      'A note can have several of projects, so it cannot be grouped by it.',
    );
    expect(reasons['labels']).toBe(
      'A note can have several of labels, so it cannot be grouped by it.',
    );
  });

  it('offers nothing without a type', () => {
    expect(groupChoices(null)).toEqual([]);
  });
});

describe('viewGroupLevels', () => {
  const levels = (args: Partial<Parameters<typeof viewGroupLevels>[0]>) =>
    viewGroupLevels({ type: TASK, groupBy: 'status', subGroupBy: null, sorts: [], ...args });

  it('is nothing without a grouping, even with a sub-grouping', () => {
    expect(levels({ groupBy: null, subGroupBy: 'phase' })).toEqual([]);
  });

  it('groups, then sub-groups', () => {
    expect(levels({ subGroupBy: 'phase' }).map((level) => level.text)).toEqual(['status', 'phase']);
  });

  it('does not sub-group by the grouping again', () => {
    expect(levels({ subGroupBy: 'status' })).toHaveLength(1);
  });

  it('drops a sub-grouping that holds several values', () => {
    expect(levels({ subGroupBy: 'labels' }).map((level) => level.text)).toEqual(['status']);
    expect(levels({ subGroupBy: 'projects' }).map((level) => level.text)).toEqual(['status']);
  });

  it('carries the type’s colours and the view’s sort direction', () => {
    const [first] = levels({ sorts: [{ key: 'status', direction: 'desc' }] });
    expect(first?.colors).toEqual({ doing: 'review' });
    expect(first?.direction).toBe('desc');
    expect(levels({})[0]?.direction).toBeUndefined();
  });

  it('offers a relation’s notes as its groups', () => {
    const [first] = levels({ groupBy: 'project', related: { project: ['[[Atlas]]'] } });
    expect(first?.options).toEqual(['[[Atlas]]']);
    expect(levels({ groupBy: 'project' })[0]?.options).toEqual([]);
  });

  it('groups a key the type does not declare as written text', () => {
    const [first] = levels({ groupBy: 'mood' });
    expect(first).toMatchObject({ text: 'mood', kind: 'text', options: [], many: false });
  });

  it('orders groups by option, then by kind, honouring the sort', () => {
    const groups = (sorts: Parameters<typeof viewGroupLevels>[0]['sorts']) =>
      groupResultRows({
        rows: ROWS,
        groups: viewGroupLevels({ type: TASK, groupBy: 'phase', subGroupBy: null, sorts }),
      }).map((group) => group.label);
    // Numbers by size — 2 before 10 — and the row with none last.
    expect(groups([])).toEqual(['1', '2', '10', 'No value']);
    expect(groups([{ key: 'phase', direction: 'desc' }])).toEqual(['10', '2', '1', 'No value']);
  });

  it('draws a select’s groups in the type’s order and colours', () => {
    const groups = groupResultRows({ rows: ROWS, groups: levels({}) });
    expect(groups.map((group) => [group.label, group.tone])).toEqual([
      ['backlog', 'backlog'],
      ['doing', 'review'],
      ['No value', null],
    ]);
  });
});

describe('boardGroups', () => {
  const board = (subGroupBy: string | null) =>
    boardGroups({
      rows: ROWS,
      levels: viewGroupLevels({ type: TASK, groupBy: 'status', subGroupBy, sorts: [] }),
    });

  it('keeps a column nothing is in yet: it is where a card goes next', () => {
    const { columns, lanes } = board(null);
    expect(columns.map((column) => [column.label, column.rows.length])).toEqual([
      ['backlog', 1],
      ['doing', 2],
      ['done', 0],
      ['No value', 1],
    ]);
    expect(lanes).toEqual([]);
  });

  it('crosses every column with every lane', () => {
    const { lanes } = board('flagged');
    expect(
      lanes.map((lane) => [
        lane.group.label,
        lane.cells.map((cell) => [cell.column.label, cell.rows.map((found) => found.title)]),
      ]),
    ).toEqual([
      [
        'true',
        [
          ['backlog', []],
          ['doing', ['A']],
          ['done', []],
          ['No value', []],
        ],
      ],
      [
        'false',
        [
          ['backlog', ['B']],
          ['doing', ['C']],
          ['done', []],
          ['No value', ['D']],
        ],
      ],
    ]);
  });

  it('is empty without a grouping', () => {
    expect(boardGroups({ rows: ROWS, levels: [] })).toEqual({ columns: [], lanes: [] });
  });
});

describe('columnSummary', () => {
  it('adds up a number column, ignoring blanks and words', () => {
    const rows = [...ROWS, row('E', { phase: 'soon' })];
    expect(columnSummary({ rows, key: 'phase', kind: 'number' })).toBe('Sum 13');
  });

  it('says nothing for a number column with no numbers', () => {
    expect(columnSummary({ rows: [ROWS[3] as BoardRow], key: 'phase', kind: 'number' })).toBeNull();
  });

  it('counts a checkbox’s ticked rows', () => {
    expect(columnSummary({ rows: ROWS, key: 'flagged', kind: 'checkbox' })).toBe('1 checked');
  });

  it('says nothing for a kind with nothing to add up', () => {
    expect(columnSummary({ rows: ROWS, key: 'status', kind: 'select' })).toBeNull();
    expect(columnSummary({ rows: ROWS, key: 'status', kind: undefined })).toBeNull();
  });
});

describe('groupPrefill', () => {
  const group = (
    field: string,
    value: string | null,
    kind: RowGroup['kind'] = 'select',
  ): RowGroup => ({
    id: `/${field}`,
    field,
    kind,
    label: value ?? 'No value',
    value,
    tone: null,
    rows: [],
    subgroups: [],
  });

  it('gives a note each level’s value', () => {
    expect(groupPrefill([group('status', 'doing'), group('project', '[[Atlas]]')])).toEqual({
      status: 'doing',
      project: '[[Atlas]]',
    });
  });

  it('gives nothing for "No value", nor for a field reached through a relation', () => {
    expect(groupPrefill([group('status', null), group('project.owner', '[[Ann]]')])).toEqual({});
  });

  it('gives a number group a number and a ticked group a tick, as the field is written', () => {
    expect(
      groupPrefill([group('phase', '3', 'number'), group('flagged', 'true', 'checkbox')]),
    ).toEqual({
      phase: 3,
      flagged: true,
    });
  });

  it('gives the unticked group nothing: a note without the box is already in it', () => {
    expect(groupPrefill([group('flagged', 'false', 'checkbox')])).toEqual({});
  });
});

describe('groupLines', () => {
  const groups = groupResultRows({
    rows: ROWS.slice(0, 3),
    groups: viewGroupLevels({ type: TASK, groupBy: 'status', subGroupBy: 'flagged', sorts: [] }),
  });
  const lines = (collapsed: readonly string[]) =>
    groupLines({ groups, collapsed: new Set(collapsed) }).map((line) =>
      line.kind === 'group'
        ? `${'  '.repeat(line.depth)}[${line.group.label}${line.collapsed ? ' shut' : ''}]`
        : line.kind === 'row'
          ? `${'  '.repeat(line.depth)}${line.row.title}`
          : `${'  '.repeat(line.depth)}+ ${line.chain.map((found) => found.label).join('/')}`,
    );

  it('lays out headers, rows and a "+ New" under each innermost group', () => {
    expect(lines([])).toEqual([
      '[backlog]',
      '  [false]',
      '    B',
      '    + backlog/false',
      '[doing]',
      '  [true]',
      '    A',
      '    + doing/true',
      '  [false]',
      '    C',
      '    + doing/false',
    ]);
  });

  it('draws only the header of a folded group', () => {
    const doing = groups[1]?.id ?? '';
    const doingFalse = groups[1]?.subgroups[1]?.id ?? '';
    expect(lines([doing])).toEqual([
      '[backlog]',
      '  [false]',
      '    B',
      '    + backlog/false',
      '[doing shut]',
    ]);
    expect(lines([doingFalse]).slice(4)).toEqual([
      '[doing]',
      '  [true]',
      '    A',
      '    + doing/true',
      '  [false shut]',
    ]);
  });

  it('has a "+ New" under a group that is not sub-grouped', () => {
    const flat = groupResultRows({
      rows: ROWS.slice(0, 1),
      groups: viewGroupLevels({ type: TASK, groupBy: 'status', subGroupBy: null, sorts: [] }),
    });
    expect(groupLines({ groups: flat, collapsed: new Set() }).map((line) => line.kind)).toEqual([
      'group',
      'row',
      'new',
    ]);
  });
});

describe('viewGroupKeys', () => {
  it('reads only what the type declares: the index has no column for anything else', () => {
    expect(viewGroupKeys({ type: TASK, groupBy: 'status', subGroupBy: 'estimate' })).toEqual([
      'status',
    ]);
    expect(viewGroupKeys({ type: TASK, groupBy: 'status', subGroupBy: 'phase' })).toEqual([
      'status',
      'phase',
    ]);
    expect(viewGroupKeys({ type: TASK, groupBy: null, subGroupBy: null })).toEqual([]);
  });
});

describe('groupValueProperty', () => {
  it("gives a note added to a group that group's value, typed by its property's kind", () => {
    expect(groupValueProperty({ type: TASK, key: 'phase', value: '2' })).toEqual({ phase: 2 });
    expect(groupValueProperty({ type: TASK, key: 'flagged', value: 'true' })).toEqual({
      flagged: true,
    });
    expect(groupValueProperty({ type: TASK, key: 'status', value: 'doing' })).toEqual({
      status: 'doing',
    });
  });

  it('writes a key the type does not declare as the text it was grouped by', () => {
    expect(groupValueProperty({ type: TASK, key: 'mood', value: '2' })).toEqual({ mood: '2' });
  });

  it('gives nothing for "No value", the unticked group, no grouping, or no group asked', () => {
    expect(groupValueProperty({ type: TASK, key: 'status', value: null })).toEqual({});
    expect(groupValueProperty({ type: TASK, key: 'flagged', value: 'false' })).toEqual({});
    expect(groupValueProperty({ type: TASK, key: null, value: 'doing' })).toEqual({});
    expect(groupValueProperty({ type: TASK, key: 'status', value: undefined })).toEqual({});
  });
});

describe('groupColumnOptions', () => {
  it("lists a select's options in the type's workflow order", () => {
    expect(groupColumnOptions(TASK, 'status')).toEqual(['backlog', 'doing', 'done']);
  });

  it('lists none for a relation, an undeclared key, no grouping or no type', () => {
    expect(groupColumnOptions(TASK, 'project')).toEqual([]);
    expect(groupColumnOptions(TASK, 'mood')).toEqual([]);
    expect(groupColumnOptions(TASK, null)).toEqual([]);
    expect(groupColumnOptions(null, 'status')).toEqual([]);
  });
});

describe('drawnLevels', () => {
  const display = (layout: 'table' | 'board' | 'gallery' | 'list') => ({
    layout,
    groupBy: 'status',
    subGroupBy: 'flagged',
  });

  it('draws both levels on a table and a board: a board’s second is its lanes', () => {
    for (const layout of ['table', 'board'] as const) {
      const levels = drawnLevels({ display: display(layout), type: TASK, sorts: [] });
      expect(levels.map((level) => level.key)).toEqual(['status', 'flagged']);
    }
  });

  it('draws only the first level on a gallery, whose groups are its columns', () => {
    const levels = drawnLevels({ display: display('gallery'), type: TASK, sorts: [] });
    expect(levels.map((level) => level.key)).toEqual(['status']);
  });

  it('draws none on a layout that does not group', () => {
    expect(drawnLevels({ display: display('list'), type: TASK, sorts: [] })).toEqual([]);
  });

  it('gives a relation level the notes it can point at', () => {
    const [level] = drawnLevels({
      display: { layout: 'board', groupBy: 'project', subGroupBy: null },
      type: TASK,
      sorts: [],
      related: { project: ['[[Atlas]]'] },
    });
    expect(level?.options).toEqual(['[[Atlas]]']);
  });
});

describe('movedValue', () => {
  it('writes a number group as a number and a checkbox group as a tick or none', () => {
    expect(movedValue('number', '3')).toBe(3);
    expect(movedValue('checkbox', 'true')).toBe(true);
    expect(movedValue('checkbox', 'false')).toBe(false);
  });

  it('writes any other group as its value, and "No value" as nothing', () => {
    expect(movedValue('select', 'done')).toBe('done');
    expect(movedValue('relation', '[[Atlas]]')).toBe('[[Atlas]]');
    expect(movedValue('select', null)).toBeNull();
    expect(movedValue(undefined, 'x')).toBe('x');
  });
});
