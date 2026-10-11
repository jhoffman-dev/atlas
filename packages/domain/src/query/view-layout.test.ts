import { describe, expect, it } from 'vitest';
import type { ObjectType, PropertyDef, PropertyKind } from '../types/property-def.ts';
import { parseViewDisplay, VIEW_LAYOUTS } from './saved-view.ts';
import {
  drawsGroups,
  layoutChange,
  layoutChoices,
  MODIFIED_COLUMN,
  queryForLayout,
} from './view-layout.ts';
import type { ViewQuery } from './view-query.ts';

const property = (
  key: string,
  kind: PropertyKind,
  extra: Partial<PropertyDef> = {},
): PropertyDef => ({
  key,
  kind,
  label: key,
  required: false,
  options: [],
  target: null,
  many: kind === 'multiSelect',
  ...extra,
});

const display = (frontmatter: Record<string, unknown> = {}) => parseViewDisplay(frontmatter);

const typeOf = (properties: readonly PropertyDef[]): ObjectType => ({
  name: 'task',
  label: 'Task',
  properties,
});

const available = (properties: readonly PropertyDef[]) =>
  Object.fromEntries(
    layoutChoices(typeOf(properties)).map((choice) => [choice.layout, choice.available]),
  );

describe('layoutChoices', () => {
  it('lists every layout, feed among them, in menu order', () => {
    expect(layoutChoices(typeOf([])).map((choice) => choice.layout)).toEqual([...VIEW_LAYOUTS]);
    expect(VIEW_LAYOUTS).toContain('feed');
  });

  it('offers the layouts that need nothing to any type', () => {
    expect(available([])).toMatchObject({
      table: true,
      list: true,
      gallery: true,
      feed: true,
      board: false,
      calendar: false,
      timeline: false,
    });
  });

  it('says why one cannot be chosen, in the New view dialog’s words', () => {
    const choices = layoutChoices(typeOf([]));
    expect(choices.find((choice) => choice.layout === 'board')?.reason).toMatch(/group by/);
    expect(choices.find((choice) => choice.layout === 'calendar')?.reason).toMatch(/date/);
    expect(choices.find((choice) => choice.layout === 'feed')?.reason).toBeNull();
  });

  it('offers a board for anything a board can group by, and not for a multi-select', () => {
    expect(available([property('status', 'select')]).board).toBe(true);
    expect(available([property('project', 'relation', { target: 'p' })]).board).toBe(true);
    expect(available([property('tags', 'multiSelect')]).board).toBe(false);
  });

  it('offers a calendar and a timeline for a date', () => {
    expect(available([property('due', 'date')])).toMatchObject({ calendar: true, timeline: true });
  });
});

describe('layoutChange', () => {
  const type = typeOf([
    property('priority', 'select'),
    property('status', 'select'),
    property('due', 'date'),
    property('start', 'date'),
  ]);

  it('is only the layout for one that needs nothing', () => {
    for (const layout of ['table', 'list', 'gallery', 'feed'] as const) {
      expect(layoutChange({ layout, display: display(), type })).toEqual({ layout });
    }
  });

  it('keeps the property the view already names when it still fits', () => {
    expect(
      layoutChange({
        layout: 'board',
        display: display({ groupBy: 'priority' }),
        type,
        statusKey: 'status',
      }),
    ).toEqual({ layout: 'board', groupBy: 'priority' });
    expect(
      layoutChange({ layout: 'timeline', display: display({ startKey: 'start' }), type }),
    ).toEqual({ layout: 'timeline', startKey: 'start' });
  });

  it('groups a new board by the status, else by the first property that can group', () => {
    expect(
      layoutChange({ layout: 'board', display: display(), type, statusKey: 'status' }),
    ).toEqual({ layout: 'board', groupBy: 'status' });
    expect(layoutChange({ layout: 'board', display: display(), type })).toEqual({
      layout: 'board',
      groupBy: 'priority',
    });
  });

  it('replaces a named property that no longer fits', () => {
    expect(
      layoutChange({ layout: 'calendar', display: display({ dateKey: 'gone' }), type }),
    ).toEqual({ layout: 'calendar', dateKey: 'due' });
  });

  it('is null for a layout the type cannot draw', () => {
    expect(layoutChange({ layout: 'calendar', display: display(), type: typeOf([]) })).toBeNull();
    expect(layoutChange({ layout: 'board', display: display(), type: typeOf([]) })).toBeNull();
  });
});

describe('queryForLayout for a calendar', () => {
  const query = { type: 'task', columns: ['due'], filters: [], sorts: [], limit: 50 };

  it('reads the end a calendar spans notes to, hidden', () => {
    const run = queryForLayout({ query, layout: 'calendar', statusKey: null, endKey: 'end' });
    expect(run.query.columns).toEqual(['due', 'end']);
    expect(run.hidden).toEqual(['end']);
  });

  it('reads no end for another layout, or one already shown, and never twice', () => {
    expect(
      queryForLayout({ query, layout: 'table', statusKey: null, endKey: 'end' }).hidden,
    ).toEqual([]);
    expect(
      queryForLayout({ query, layout: 'calendar', statusKey: 'due', endKey: 'due' }).query.columns,
    ).toEqual(['due']);
    expect(
      queryForLayout({ query, layout: 'calendar', statusKey: 'end', endKey: 'end' }).hidden,
    ).toEqual(['end']);
  });
});

describe('queryForLayout', () => {
  const query: ViewQuery = { type: 'task', columns: ['phase'], filters: [], sorts: [], limit: 50 };

  it('asks for the status a done box reads, and says it is hidden', () => {
    const run = queryForLayout({ query, layout: 'table', statusKey: 'status' });
    expect(run.query.columns).toEqual(['phase', 'status']);
    expect(run.hidden).toEqual(['status']);
  });

  it('adds nothing when the view already shows the status, or there is none', () => {
    const shown = { ...query, columns: ['status'] };
    expect(queryForLayout({ query: shown, layout: 'table', statusKey: 'status' })).toEqual({
      query: shown,
      hidden: [],
    });
    expect(queryForLayout({ query, layout: 'list', statusKey: null }).query).toEqual(query);
  });

  it('reads a feed newest first when the view does not sort', () => {
    expect(queryForLayout({ query, layout: 'feed', statusKey: null }).query.sorts).toEqual([
      { key: MODIFIED_COLUMN, direction: 'desc' },
    ]);
  });

  it('keeps a feed in the order the view sorts by — a date, say', () => {
    const byDate = { ...query, sorts: [{ key: 'due', direction: 'asc' as const }] };
    expect(queryForLayout({ query: byDate, layout: 'feed', statusKey: null }).query.sorts).toEqual(
      byDate.sorts,
    );
  });

  it.each(['feed', 'gallery'] as const)(
    'asks a %s for when each note changed, hidden, so it can tell a note that did',
    (layout) => {
      const run = queryForLayout({ query, layout, statusKey: null });
      expect(run.query.columns).toEqual(['phase', MODIFIED_COLUMN]);
      expect(run.hidden).toEqual([MODIFIED_COLUMN]);
    },
  );

  it('leaves every other layout in the order the view asks for', () => {
    expect(queryForLayout({ query, layout: 'list', statusKey: null }).query.sorts).toEqual([]);
  });
});

describe('queryForLayout for a grouped layout (issue #6)', () => {
  const query: ViewQuery = { type: 'task', columns: ['phase'], filters: [], sorts: [], limit: 50 };

  it.each(['table', 'board', 'gallery'] as const)('reads what a %s groups by, hidden', (layout) => {
    const run = queryForLayout({ query, layout, statusKey: null, groupKeys: ['status', 'phase'] });
    // Shown already, phase is not asked for twice; a gallery also reads when notes changed.
    expect(run.query.columns.slice(0, 2)).toEqual(['phase', 'status']);
    expect(run.hidden).toContain('status');
    expect(run.hidden).not.toContain('phase');
  });

  it('reads no grouping for a layout that draws none', () => {
    expect(
      queryForLayout({ query, layout: 'list', statusKey: null, groupKeys: ['status'] }).hidden,
    ).toEqual([]);
  });
});

describe('queryForLayout and a checklist’s progress (P30-03)', () => {
  const query: ViewQuery = { type: 'task', columns: ['phase'], filters: [], sorts: [], limit: 50 };

  it.each(['board', 'list', 'table'] as const)('reads progress for a %s, hidden', (layout) => {
    const run = queryForLayout({ query, layout, statusKey: null, progressKey: 'progress' });
    expect(run.query.columns).toContain('progress');
    expect(run.hidden).toContain('progress');
  });

  it.each(['gallery', 'feed', 'calendar', 'timeline'] as const)(
    'reads none for a %s, which draws no bar',
    (layout) => {
      const run = queryForLayout({ query, layout, statusKey: null, progressKey: 'progress' });
      expect(run.query.columns).not.toContain('progress');
    },
  );

  it('reads none for a type whose view holds none', () => {
    expect(queryForLayout({ query, layout: 'board', statusKey: null }).query).toEqual(query);
  });
});

describe('drawsGroups', () => {
  it('is true for a table, a board and a gallery, and false for every other layout', () => {
    expect(VIEW_LAYOUTS.filter(drawsGroups)).toEqual(['table', 'board', 'gallery']);
  });
});
