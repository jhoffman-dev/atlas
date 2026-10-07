import { describe, expect, it } from 'vitest';
import {
  isSavedView,
  parseQueryView,
  queryViewFrontmatter,
  queryViewLayout,
  queryViewSaveProblem,
  parseSavedView,
  parseViewDisplay,
  savedViewFrontmatter,
} from './saved-view.ts';

const view = (extra: Record<string, unknown> = {}) => ({
  atlas: 'view',
  type: 'company',
  ...extra,
});

describe('isSavedView', () => {
  it('recognises a view', () => {
    expect(isSavedView(view())).toBe(true);
  });

  it.each([{}, { atlas: 'type' }, { atlas: '' }, { type: 'company' }])(
    'does not mistake %j for one',
    (frontmatter) => {
      expect(isSavedView(frontmatter)).toBe(false);
    },
  );
});

describe('parseSavedView', () => {
  it('reads the type', () => {
    expect(parseSavedView(view())?.type).toBe('company');
  });

  it('returns nothing for a note that is not a view', () => {
    expect(parseSavedView({ type: 'company' })).toBeNull();
  });

  it('returns nothing for a view with no type to list', () => {
    expect(parseSavedView({ atlas: 'view' })).toBeNull();
  });

  it('reads columns', () => {
    expect(parseSavedView(view({ columns: ['stage', 'arr'] }))?.columns).toEqual(['stage', 'arr']);
  });

  it('reads filters', () => {
    const parsed = parseSavedView(
      view({ filters: [{ key: 'stage', operator: 'is', value: 'seed' }] }),
    );
    expect(parsed?.filters).toEqual([{ key: 'stage', operator: 'is', value: 'seed' }]);
  });

  it('reads a filter that needs no value', () => {
    const parsed = parseSavedView(view({ filters: [{ key: 'arr', operator: 'isEmpty' }] }));
    expect(parsed?.filters).toEqual([{ key: 'arr', operator: 'isEmpty' }]);
  });

  it('drops a filter with an operator it does not know', () => {
    const parsed = parseSavedView(
      view({ filters: [{ key: 'stage', operator: 'sounds-like', value: 'x' }] }),
    );
    expect(parsed?.filters).toEqual([]);
  });

  it('drops a filter with no key rather than failing the view', () => {
    const parsed = parseSavedView(
      view({
        filters: [
          { operator: 'is', value: 'x' },
          { key: 'stage', operator: 'is', value: 'seed' },
        ],
      }),
    );
    expect(parsed?.filters).toHaveLength(1);
  });

  it('reads sorts and defaults the direction to ascending', () => {
    const parsed = parseSavedView(
      view({ sorts: [{ key: 'arr' }, { key: 'stage', direction: 'desc' }] }),
    );
    expect(parsed?.sorts).toEqual([
      { key: 'arr', direction: 'asc' },
      { key: 'stage', direction: 'desc' },
    ]);
  });

  it('reads a limit', () => {
    expect(parseSavedView(view({ limit: 25 }))?.limit).toBe(25);
  });

  it.each([undefined, 'lots', -5, 0])('falls back to a default limit for %j', (limit) => {
    expect(parseSavedView(view({ limit }))?.limit).toBe(500);
  });

  it('copes with columns, filters and sorts that are not lists', () => {
    const parsed = parseSavedView(view({ columns: 'stage', filters: 3, sorts: {} }));
    expect(parsed).toMatchObject({ columns: [], filters: [], sorts: [] });
  });
});

describe('savedViewFrontmatter', () => {
  it('writes a view back in the form it is read from', () => {
    const query = {
      type: 'company',
      columns: ['stage'],
      filters: [{ key: 'stage', operator: 'is' as const, value: 'seed' }],
      sorts: [{ key: 'arr', direction: 'desc' as const }],
      limit: 50,
    };
    const written = savedViewFrontmatter(query);
    expect(parseSavedView(written)).toEqual(query);
  });

  it('leaves out a value for an operator that takes none', () => {
    const written = savedViewFrontmatter({
      type: 'company',
      columns: [],
      filters: [{ key: 'arr', operator: 'isEmpty' }],
      sorts: [],
      limit: 10,
    });
    expect(written['filters']).toEqual([{ key: 'arr', operator: 'isEmpty' }]);
  });
});

describe('parseViewDisplay', () => {
  it('defaults to a table', () => {
    expect(parseViewDisplay({})).toEqual({
      layout: 'table',
      groupBy: null,
      subGroupBy: null,
      dateKey: null,
      startKey: null,
      endKey: null,
      calendarRange: 'month',
    });
  });

  it('reads a calendar and the date it places notes by', () => {
    expect(parseViewDisplay({ layout: 'calendar', dateKey: 'due' })).toEqual({
      layout: 'calendar',
      groupBy: null,
      subGroupBy: null,
      dateKey: 'due',
      startKey: null,
      endKey: null,
      calendarRange: 'month',
    });
  });

  it('reads the range a calendar shows, and shows a month when it names none it knows', () => {
    expect(
      parseViewDisplay({ layout: 'calendar', dateKey: 'due', calendarRange: 'week' }),
    ).toMatchObject({ calendarRange: 'week' });
    expect(
      parseViewDisplay({ layout: 'calendar', dateKey: 'due', calendarRange: 'year' }),
    ).toMatchObject({ calendarRange: 'month' });
  });

  it('falls back to a table when a calendar has no date to place notes on', () => {
    expect(parseViewDisplay({ layout: 'calendar' })).toMatchObject({ layout: 'table' });
  });

  it.each(['table', 'list', 'gallery'] as const)('reads the %s layout', (layout) => {
    expect(parseViewDisplay({ layout })).toEqual({
      layout,
      groupBy: null,
      subGroupBy: null,
      dateKey: null,
      startKey: null,
      endKey: null,
      calendarRange: 'month',
    });
  });

  it('reads a board and what it groups by', () => {
    expect(parseViewDisplay({ layout: 'board', groupBy: 'status' })).toEqual({
      layout: 'board',
      groupBy: 'status',
      subGroupBy: null,
      dateKey: null,
      startKey: null,
      endKey: null,
      calendarRange: 'month',
    });
  });

  it('falls back to a table when a board has nothing to group by', () => {
    expect(parseViewDisplay({ layout: 'board' })).toMatchObject({ layout: 'table' });
  });

  it('falls back to a table for a layout it does not know', () => {
    expect(parseViewDisplay({ layout: 'timeline' })).toMatchObject({ layout: 'table' });
  });

  it('keeps groupBy for a layout that ignores it, so switching back is lossless', () => {
    expect(parseViewDisplay({ layout: 'list', groupBy: 'status' })).toMatchObject({
      layout: 'list',
      groupBy: 'status',
    });
  });
});

describe('a timeline view', () => {
  it('reads the dates a bar runs between', () => {
    expect(
      parseViewDisplay({ layout: 'timeline', startKey: 'scheduled', endKey: 'due' }),
    ).toMatchObject({ layout: 'timeline', startKey: 'scheduled', endKey: 'due' });
  });

  it('ends a bar where it starts when only one date is named', () => {
    expect(parseViewDisplay({ layout: 'timeline', startKey: 'due' })).toMatchObject({
      layout: 'timeline',
      startKey: 'due',
      endKey: 'due',
    });
  });

  it('falls back to a table with nothing to start bars from', () => {
    expect(parseViewDisplay({ layout: 'timeline', endKey: 'due' })).toMatchObject({
      layout: 'table',
    });
  });
});

describe('query views (ADR-0019)', () => {
  const text = 'FROM task, project  WHERE status != done';

  it('reads the query exactly as written, spacing and all', () => {
    expect(parseQueryView({ atlas: 'view', layout: 'board', query: text })).toBe(text);
  });

  it('is not a query view without the mark, without a query, or with SQL', () => {
    expect(parseQueryView({ query: text })).toBeNull();
    expect(parseQueryView({ atlas: 'view', query: '   ' })).toBeNull();
    expect(parseQueryView({ atlas: 'view', query: 7 })).toBeNull();
    expect(parseQueryView({ atlas: 'view', query: text, sql: 'SELECT 1' })).toBeNull();
  });

  it('wins over a type, so a note that says both is read one way', () => {
    const both = { atlas: 'view', type: 'company', query: text };
    expect(parseQueryView(both)).toBe(text);
    expect(parseSavedView(both)).toBeNull();
  });

  it('is drawn as a table, a board or a list — the layouts that show groups', () => {
    expect(queryViewLayout({ layout: 'board' })).toBe('board');
    expect(queryViewLayout({ layout: 'list' })).toBe('list');
    expect(queryViewLayout({ layout: 'calendar' })).toBe('table');
    expect(queryViewLayout({})).toBe('table');
  });

  it('is written as the mark, its layout and its query', () => {
    expect(queryViewFrontmatter({ query: text, layout: 'list' })).toEqual({
      atlas: 'view',
      layout: 'list',
      query: text,
    });
  });
});

describe('queryViewSaveProblem', () => {
  it('refuses a blank query, which would leave the note no longer a query view', () => {
    expect(queryViewSaveProblem('')).toBe('Write a query before saving: FROM task.');
    expect(queryViewSaveProblem('  \n ')).toBe('Write a query before saving: FROM task.');
  });

  it('lets any other text be saved as typed, even text that does not read yet', () => {
    expect(queryViewSaveProblem('FROM task')).toBeNull();
    expect(queryViewSaveProblem('FROM')).toBeNull();
  });
});

describe('a sub-grouping (issue #6)', () => {
  it('reads what each group is split by in turn', () => {
    expect(
      parseViewDisplay({ layout: 'table', groupBy: 'status', subGroupBy: 'project' }),
    ).toMatchObject({ groupBy: 'status', subGroupBy: 'project' });
  });

  it('has none without a grouping to split, or when it repeats the grouping', () => {
    expect(parseViewDisplay({ layout: 'table', subGroupBy: 'project' }).subGroupBy).toBeNull();
    expect(
      parseViewDisplay({ layout: 'board', groupBy: 'status', subGroupBy: ' status ' }).subGroupBy,
    ).toBeNull();
  });

  it('is written beside the grouping, and left out when there is none', () => {
    const query = { type: 'task', columns: [], filters: [], sorts: [], limit: 50 };
    const display = parseViewDisplay({ layout: 'board', groupBy: 'status', subGroupBy: 'phase' });
    const written = savedViewFrontmatter(query, display);
    expect(written).toMatchObject({ layout: 'board', groupBy: 'status', subGroupBy: 'phase' });
    expect(parseViewDisplay(written)).toEqual(display);
    const flat = savedViewFrontmatter(
      query,
      parseViewDisplay({ layout: 'board', groupBy: 'status' }),
    );
    expect(flat).not.toHaveProperty('subGroupBy');
  });
});
