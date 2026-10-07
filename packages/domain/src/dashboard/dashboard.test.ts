import { describe, expect, it } from 'vitest';
import { isDashboard, MAX_WIDGETS, parseDashboard } from './dashboard.ts';

const board = (widgets: unknown): Record<string, unknown> => ({ atlas: 'dashboard', widgets });

describe('isDashboard', () => {
  it('recognises a dashboard', () => {
    expect(isDashboard({ atlas: 'dashboard' })).toBe(true);
  });

  it('ignores surrounding space', () => {
    expect(isDashboard({ atlas: ' dashboard ' })).toBe(true);
  });

  it('does not mistake a view for one', () => {
    expect(isDashboard({ atlas: 'view' })).toBe(false);
  });

  it('does not mistake a plain note for one', () => {
    expect(isDashboard({ title: 'Notes' })).toBe(false);
  });
});

describe('parseDashboard', () => {
  it('reads nothing from a note that is not a dashboard', () => {
    expect(parseDashboard({ widgets: [{ kind: 'number', type: 'task' }] })).toEqual([]);
  });

  it('reads nothing when widgets is not a list', () => {
    expect(parseDashboard(board('lots'))).toEqual([]);
  });

  it('reads a widget of each kind', () => {
    const widgets = parseDashboard(
      board([
        { kind: 'number', type: 'task' },
        { kind: 'list', type: 'task' },
        { kind: 'table', type: 'task' },
        { kind: 'bar', type: 'task', groupBy: 'status' },
      ]),
    );
    expect(widgets.map((widget) => widget.kind)).toEqual(['number', 'list', 'table', 'bar']);
  });

  it('carries the query through', () => {
    const [widget] = parseDashboard(
      board([
        {
          kind: 'table',
          type: 'task',
          columns: ['status', 'due'],
          filters: [{ key: 'status', operator: 'isNot', value: 'done' }],
          sorts: [{ key: 'due', direction: 'desc' }],
          limit: 5,
        },
      ]),
    );
    expect(widget?.query).toEqual({
      type: 'task',
      columns: ['status', 'due'],
      filters: [{ key: 'status', operator: 'isNot', value: 'done' }],
      sorts: [{ key: 'due', direction: 'desc' }],
      limit: 5,
    });
  });

  it('drops a widget with no type rather than the whole dashboard', () => {
    const widgets = parseDashboard(
      board([{ kind: 'number' }, { kind: 'number', type: 'task', title: 'Kept' }]),
    );
    expect(widgets.map((widget) => widget.title)).toEqual(['Kept']);
  });

  it('drops a widget of an unknown kind', () => {
    expect(parseDashboard(board([{ kind: 'sparkline', type: 'task' }]))).toEqual([]);
  });

  it('drops a widget that is not a mapping', () => {
    expect(parseDashboard(board(['a number of tasks']))).toEqual([]);
  });

  it('drops a bar chart with nothing to count by, which would have no bars', () => {
    expect(parseDashboard(board([{ kind: 'bar', type: 'task' }]))).toEqual([]);
  });

  it('gives each widget an id that survives a re-read', () => {
    const once = parseDashboard(board([{ kind: 'number', type: 'task' }]));
    const twice = parseDashboard(board([{ kind: 'number', type: 'task' }]));
    expect(once[0]?.id).toBe(twice[0]?.id);
  });

  it('gives two widgets of the same shape different ids', () => {
    const widgets = parseDashboard(
      board([
        { kind: 'number', type: 'task' },
        { kind: 'number', type: 'task' },
      ]),
    );
    expect(widgets[0]?.id).not.toBe(widgets[1]?.id);
  });

  it('names a widget after its type when it is untitled', () => {
    const [number, table] = parseDashboard(
      board([
        { kind: 'number', type: 'task' },
        { kind: 'table', type: 'person' },
      ]),
    );
    expect(number?.title).toBe('task count');
    expect(table?.title).toBe('person');
  });

  it('counts when no aggregate is named', () => {
    const [widget] = parseDashboard(board([{ kind: 'number', type: 'task' }]));
    expect(widget?.aggregate).toEqual({ kind: 'count', column: null });
  });

  it('reads the aggregate and the column it works over', () => {
    const [widget] = parseDashboard(
      board([{ kind: 'number', type: 'task', aggregate: 'sum', of: 'estimate' }]),
    );
    expect(widget?.aggregate).toEqual({ kind: 'sum', column: 'estimate' });
  });

  it('falls back to counting when a sum has nothing to sum', () => {
    const [widget] = parseDashboard(board([{ kind: 'number', type: 'task', aggregate: 'sum' }]));
    expect(widget?.aggregate).toEqual({ kind: 'count', column: null });
  });

  it('falls back to counting when the aggregate is not one it knows', () => {
    const [widget] = parseDashboard(
      board([{ kind: 'number', type: 'task', aggregate: 'median', of: 'estimate' }]),
    );
    expect(widget?.aggregate).toEqual({ kind: 'count', column: 'estimate' });
  });

  it('leaves the aggregate off every other kind', () => {
    const [widget] = parseDashboard(
      board([{ kind: 'list', type: 'task', aggregate: 'sum', of: 'estimate' }]),
    );
    expect(widget?.aggregate).toBeNull();
  });

  it('leaves groupBy off every kind but the chart', () => {
    const [widget] = parseDashboard(board([{ kind: 'list', type: 'task', groupBy: 'status' }]));
    expect(widget?.groupBy).toBeNull();
  });

  it('gives a number a quarter of the grid, a hero or ranking a third, a chart half', () => {
    const spans = parseDashboard(
      board([
        { kind: 'number', type: 'task' },
        { kind: 'hero', type: 'task' },
        { kind: 'rank', type: 'task', groupBy: 'phase' },
        { kind: 'table', type: 'task' },
      ]),
    ).map((widget) => widget.span);
    expect(spans).toEqual([3, 4, 4, 6]);
  });

  it('honours a declared span of grid columns', () => {
    const [widget] = parseDashboard(board([{ kind: 'bar', type: 'task', groupBy: 's', span: 8 }]));
    expect(widget?.span).toBe(8);
  });

  it('reads the older width as thirds of the grid', () => {
    const spans = parseDashboard(
      board([1, 2, 3].map((width) => ({ kind: 'number', type: 'task', width }))),
    ).map((widget) => widget.span);
    expect(spans).toEqual([4, 8, 12]);
  });

  it('prefers span to width when a widget has both', () => {
    const [widget] = parseDashboard(board([{ kind: 'number', type: 'task', span: 5, width: 3 }]));
    expect(widget?.span).toBe(5);
  });

  it('ignores a span or width outside the grid', () => {
    const spans = parseDashboard(
      board([
        { kind: 'table', type: 'task', span: 13 },
        { kind: 'table', type: 'task', span: 0 },
        { kind: 'table', type: 'task', span: 2.5 },
        { kind: 'table', type: 'task', width: 9 },
        { kind: 'table', type: 'task', width: -1 },
      ]),
    ).map((widget) => widget.span);
    expect(spans).toEqual([6, 6, 6, 6, 6]);
  });

  it('ignores a span or width that is not a number at all', () => {
    // `Number([8])` is 8 and `Number(true)` is 1: a list or a flag must not
    // pass for a column count.
    const spans = parseDashboard(
      board([
        { kind: 'table', type: 'task', span: [8] },
        { kind: 'table', type: 'task', span: true },
        { kind: 'table', type: 'task', width: [2] },
        { kind: 'table', type: 'task', span: ' ' },
      ]),
    ).map((widget) => widget.span);
    expect(spans).toEqual([6, 6, 6, 6]);
  });

  it('stops reading past the widget limit', () => {
    const many = Array.from({ length: MAX_WIDGETS + 10 }, () => ({ kind: 'number', type: 'task' }));
    expect(parseDashboard(board(many))).toHaveLength(MAX_WIDGETS);
  });
});

describe('a hero widget', () => {
  const done = [{ key: 'status', operator: 'is', value: 'done' }];

  it('reads its progress filters and names the part after the value it asks for', () => {
    const [hero] = parseDashboard(
      board([{ kind: 'hero', type: 'task', groupBy: 'phase', progress: { filters: done } }]),
    );
    expect(hero?.progress).toEqual({ label: 'done', filters: done });
    expect(hero?.groupBy).toBe('phase');
  });

  it('keeps a declared progress label', () => {
    const [hero] = parseDashboard(
      board([{ kind: 'hero', type: 'task', progress: { label: 'shipped', filters: done } }]),
    );
    expect(hero?.progress?.label).toBe('shipped');
  });

  it('calls a part it cannot name in one word "matching"', () => {
    const [hero] = parseDashboard(
      board([
        {
          kind: 'hero',
          type: 'task',
          progress: { filters: [{ key: 'status', operator: 'isNot', value: 'done' }] },
        },
      ]),
    );
    expect(hero?.progress?.label).toBe('matching');
  });

  it('has no ring when its progress has nothing to narrow by', () => {
    const heroes = parseDashboard(
      board([
        { kind: 'hero', type: 'task', progress: { label: 'done' } },
        { kind: 'hero', type: 'task', progress: 'done' },
        { kind: 'hero', type: 'task' },
      ]),
    );
    expect(heroes.map((hero) => hero.progress)).toEqual([null, null, null]);
  });

  it('does not need something to group by, unlike a chart', () => {
    const [hero] = parseDashboard(board([{ kind: 'hero', type: 'task' }]));
    expect(hero?.kind).toBe('hero');
    expect(hero?.groupBy).toBeNull();
  });

  it('leaves progress off every other kind', () => {
    const [number] = parseDashboard(
      board([{ kind: 'number', type: 'task', progress: { filters: done } }]),
    );
    expect(number?.progress).toBeNull();
  });
});

describe('widget options', () => {
  it('reads a highlight rule on the kinds that call a group out', () => {
    const widgets = parseDashboard(
      board([
        { kind: 'bar', type: 'task', groupBy: 'phase', highlight: 'max' },
        { kind: 'rank', type: 'task', groupBy: 'phase', highlight: 12 },
        { kind: 'hero', type: 'task', highlight: 'none' },
        { kind: 'donut', type: 'task', groupBy: 'phase', highlight: 'max' },
      ]),
    );
    expect(widgets.map((widget) => widget.highlight)).toEqual([
      { kind: 'max' },
      { kind: 'key', key: '12' },
      { kind: 'none' },
      null,
    ]);
  });

  it('reads a known icon on a number tile and drops an unknown one', () => {
    const [bolt, unknown, bar] = parseDashboard(
      board([
        { kind: 'number', type: 'task', icon: 'bolt' },
        { kind: 'number', type: 'task', icon: 'rocket' },
        { kind: 'bar', type: 'task', groupBy: 'status', icon: 'bolt' },
      ]),
    );
    expect(bolt?.icon).toBe('bolt');
    expect(unknown?.icon).toBeNull();
    expect(bar?.icon).toBeNull();
  });

  it('shows five ranked rows unless told, and never more than twenty', () => {
    const tops = parseDashboard(
      board([
        { kind: 'rank', type: 'task', groupBy: 'phase' },
        { kind: 'rank', type: 'task', groupBy: 'phase', limit: 4 },
        { kind: 'rank', type: 'task', groupBy: 'phase', limit: 400 },
        { kind: 'rank', type: 'task', groupBy: 'phase', limit: 0 },
      ]),
    ).map((widget) => widget.top);
    expect(tops).toEqual([5, 4, 20, 5]);
  });

  it('reads a ranking size from a number or its text, and nothing else', () => {
    const tops = parseDashboard(
      board([
        { kind: 'rank', type: 'task', groupBy: 'phase', limit: '3' },
        { kind: 'rank', type: 'task', groupBy: 'phase', limit: [3] },
        { kind: 'rank', type: 'task', groupBy: 'phase', limit: true },
      ]),
    ).map((widget) => widget.top);
    expect(tops).toEqual([3, 5, 5]);
  });

  it('asks a ranking for every group, so it can say how much of the whole it shows', () => {
    const [rank] = parseDashboard(board([{ kind: 'rank', type: 'task', groupBy: 'p', limit: 4 }]));
    expect(rank?.query?.limit).toBeGreaterThan(4);
  });

  it('drops a ranking with nothing to rank by', () => {
    expect(parseDashboard(board([{ kind: 'rank', type: 'task' }]))).toEqual([]);
  });
});

describe('a widget’s entry', () => {
  it('is its place in the file, counting the entries that could not be read', () => {
    const widgets = parseDashboard(
      board([
        { kind: 'number', type: 'task' },
        { kind: 'bar', type: 'task' },
        { kind: 'list', type: 'task' },
      ]),
    );
    expect(widgets.map((widget) => widget.entry)).toEqual([0, 2]);
  });
});
