/**
 * Adversarial pass on issue #6: a view's groups and sub-groups, pushed at the
 * edges — a many-valued grouping that arrives by hand rather than through the
 * Group control, a sub-grouping YAML gives as a list, sums that overflow, and
 * one value spelled two Unicode ways.
 *
 * Each test names an invariant the branch once broke, and was seen failing first.
 */
import { describe, expect, it } from 'vitest';
import type { BoardRow } from '../query/group-rows.ts';
import { parseSavedView, parseViewDisplay } from '../query/saved-view.ts';
import { groupingEdit, viewSettingsOf, editedFrontmatter } from '../query/view-edits.ts';
import { queryForLayout } from '../query/view-layout.ts';
import { compileViewQuery } from '../query/view-query.ts';
import { parseObjectType } from '../types/property-def.ts';
import { checkAtlasQuery, groupRefusal } from './check.ts';
import { parseAtlasQuery } from './parse.ts';
import { QUERY_TEST_TYPES } from './query-fixtures.ts';
import { QueryTextError } from './query-text-error.ts';
import { groupResultRows } from './result-groups.ts';
import { columnSummary, viewGroupLevels } from './view-groups.ts';

const TASK = parseObjectType({
  name: 'task',
  properties: {
    status: { kind: 'select', options: ['backlog', 'doing', 'done'] },
    area: { kind: 'select', options: ['Café', 'home'] },
    labels: { kind: 'multiSelect', options: ['red', 'blue'] },
    projects: { kind: 'relation', target: 'project', many: true },
    phase: 'number',
  },
});

const row = (path: string, values: Record<string, unknown>): BoardRow => ({
  path,
  title: path,
  values,
});

describe('a field holding several values never groups', () => {
  it('is refused as the grouping, not only as the sub-grouping (multi-select)', () => {
    const levels = viewGroupLevels({ type: TASK, groupBy: 'labels', subGroupBy: null, sorts: [] });
    expect(levels.filter((level) => groupRefusal(level) !== null)).toEqual([]);
  });

  it('is refused as the grouping, not only as the sub-grouping (many relation)', () => {
    const levels = viewGroupLevels({
      type: TASK,
      groupBy: 'projects',
      subGroupBy: 'status',
      sorts: [],
    });
    expect(levels.filter((level) => groupRefusal(level) !== null)).toEqual([]);
  });
});

describe('a hand-edited sub-grouping cannot stop the view from running', () => {
  it('a subGroupBy written as a YAML list still compiles to a query', () => {
    const frontmatter = {
      atlas: 'view',
      type: 'task',
      layout: 'board',
      groupBy: 'status',
      subGroupBy: ['area', 'phase'],
      columns: ['status'],
      limit: 50,
    };
    const query = parseSavedView(frontmatter);
    const display = parseViewDisplay(frontmatter);
    if (query === null) throw new Error('not a view');
    const run = queryForLayout({
      query,
      layout: display.layout,
      statusKey: 'status',
      groupKeys: [display.groupBy, display.subGroupBy].filter((key): key is string => key !== null),
    });
    expect(() => compileViewQuery(run.query)).not.toThrow();
  });
});

describe('a sub-grouping the view does not draw stays undrawn when the grouping changes', () => {
  it('regrouping a view whose subGroupBy equals its groupBy does not reveal a sub-grouping', () => {
    const frontmatter = {
      atlas: 'view',
      type: 'task',
      layout: 'table',
      groupBy: 'status',
      subGroupBy: 'status',
      columns: ['status'],
      limit: 50,
    };
    // Drawn without a sub-grouping: one equal to the grouping splits nothing.
    expect(parseViewDisplay(frontmatter).subGroupBy).toBeNull();
    const settings = viewSettingsOf(frontmatter);
    if (settings === null) throw new Error('not a view');
    const edit = groupingEdit(settings.subGroupBy, 'area');
    expect(parseViewDisplay(editedFrontmatter(frontmatter, edit)).subGroupBy).toBeNull();
  });
});

describe('a group header’s sum', () => {
  it('a single finite number sums to itself, not Infinity', () => {
    const summary = columnSummary({
      rows: [row('a.md', { phase: 1e307 })],
      key: 'phase',
      kind: 'number',
    });
    expect(summary).not.toContain('Infinity');
  });
});

describe('one value, however it is encoded, is one group', () => {
  it('a select value in NFD joins its declared NFC option rather than standing beside it', () => {
    const nfd = 'Café'.normalize('NFD');
    const groups = groupResultRows({
      rows: [row('a.md', { area: 'Café' }), row('b.md', { area: nfd })],
      groups: [
        {
          text: 'area',
          label: 'Area',
          via: null,
          key: 'area',
          kind: 'select',
          options: ['Café', 'home'],
          target: null,
          many: false,
        },
      ],
    });
    expect(groups.map((group) => group.rows.length)).toEqual([2]);
  });
});

describe('one grouping model for views and queries', () => {
  it('a query refuses to sub-group by the field it groups by, as a view does', () => {
    const query = parseAtlasQuery('FROM task GROUP BY status THEN status');
    expect(() => checkAtlasQuery(query, QUERY_TEST_TYPES)).toThrow(QueryTextError);
  });
});
