import { describe, expect, it } from 'vitest';
import {
  editedFrontmatter,
  editView,
  groupingEdit,
  hasViewEdits,
  moveColumn,
  remainingEdits,
  toggleColumn,
  toggledSorts,
  viewCopyFrontmatter,
  viewEditChanges,
  viewSettingsOf,
  type ViewSettings,
} from './view-edits.ts';
import { parseSavedView, parseViewDisplay } from './saved-view.ts';

const NOTE = {
  atlas: 'view',
  type: 'task',
  layout: 'board',
  groupBy: 'status',
  columns: ['status', 'phase'],
  filters: [{ key: 'status', operator: 'isNot', value: 'done' }],
  sorts: [],
  limit: 500,
  favorite: true,
  description: 'Every task.',
};
const SAVED = viewSettingsOf(NOTE) as ViewSettings;
const DOING = { key: 'status', operator: 'is', value: 'doing' } as const;

describe('the settings a view note declares', () => {
  it('reads columns, filters, sorts and grouping', () => {
    expect(SAVED).toEqual({
      columns: ['status', 'phase'],
      filters: [{ key: 'status', operator: 'isNot', value: 'done' }],
      sorts: [],
      groupBy: 'status',
      subGroupBy: null,
      layout: 'board',
      dateKey: null,
      startKey: null,
      calendarRange: 'month',
    });
  });

  it('has none for a note that is not a view, or is a SQL view', () => {
    expect(viewSettingsOf({ type: 'task' })).toBeNull();
    expect(viewSettingsOf({ atlas: 'view', type: 'task', sql: 'SELECT 1' })).toBeNull();
  });
});

describe('editing a view', () => {
  it('keeps what differs from the note', () => {
    const edits = editView(SAVED, {}, { filters: [DOING] });
    expect(edits).toEqual({ filters: [DOING] });
    expect(hasViewEdits(edits)).toBe(true);
  });

  it('forgets a change put back the way the note has it', () => {
    const changed = editView(
      SAVED,
      {},
      { groupBy: 'phase', sorts: [{ key: 'title', direction: 'asc' }] },
    );
    const back = editView(SAVED, changed, { groupBy: 'status' });
    expect(back).toEqual({ sorts: [{ key: 'title', direction: 'asc' }] });
    expect(hasViewEdits(editView(SAVED, back, { sorts: [] }))).toBe(false);
  });

  it('drops edits the note has since caught up with — after a save', () => {
    const edits = { filters: [DOING], columns: ['phase'] };
    const savedNow = { ...SAVED, filters: [DOING] };
    expect(remainingEdits(savedNow, edits)).toEqual({ columns: ['phase'] });
  });

  it('draws the note with the edits over it, through the same parsers', () => {
    const shown = editedFrontmatter(NOTE, { filters: [DOING], groupBy: 'phase' });
    expect(parseSavedView(shown)?.filters).toEqual([DOING]);
    expect(parseViewDisplay(shown).groupBy).toBe('phase');
    // The note itself is not touched.
    expect(NOTE.groupBy).toBe('status');
  });
});

describe('saving a view', () => {
  it('writes only the keys that changed, as the parser reads them', () => {
    expect(viewEditChanges({ sorts: [{ key: 'due', direction: 'desc' }] })).toEqual({
      sorts: [{ key: 'due', direction: 'desc' }],
    });
    expect(
      viewEditChanges({ filters: [{ key: 'status', operator: 'isEmpty' }], groupBy: null }),
    ).toEqual({
      filters: [{ key: 'status', operator: 'isEmpty' }],
      groupBy: null,
    });
    expect(viewEditChanges({})).toEqual({});
  });

  it('copies the view with its edits into a new one, without its star or description', () => {
    const copy = viewCopyFrontmatter(NOTE, { filters: [DOING] });
    expect(copy).toMatchObject({ atlas: 'view', type: 'task', layout: 'board', groupBy: 'status' });
    expect(parseSavedView(copy)?.filters).toEqual([DOING]);
    expect(copy).not.toHaveProperty('favorite');
    expect(copy).not.toHaveProperty('description');
  });

  it('copies nothing from a note that is not a view', () => {
    expect(viewCopyFrontmatter({ type: 'task' }, {})).toEqual({});
  });
});

describe('a layout chosen from the toolbar', () => {
  it('is an edit, drawn at once and written with what it needs on save', () => {
    const edits = editView(SAVED, {}, { layout: 'calendar', dateKey: 'due' });
    expect(hasViewEdits(edits)).toBe(true);
    expect(parseViewDisplay(editedFrontmatter(NOTE, edits))).toMatchObject({
      layout: 'calendar',
      dateKey: 'due',
    });
    expect(viewEditChanges(edits)).toEqual({ layout: 'calendar', dateKey: 'due' });
  });

  it('is no edit when it is the layout the note already has', () => {
    expect(hasViewEdits(editView(SAVED, {}, { layout: 'board' }))).toBe(false);
  });

  it('reads a note with no layout, or an unknown one, as a table', () => {
    expect(viewSettingsOf({ atlas: 'view', type: 'task' })?.layout).toBe('table');
    expect(viewSettingsOf({ atlas: 'view', type: 'task', layout: 'mosaic' })?.layout).toBe('table');
    const none = viewSettingsOf({ atlas: 'view', type: 'task' }) as ViewSettings;
    expect(hasViewEdits(editView(none, {}, { layout: 'table' }))).toBe(false);
  });

  it('goes into a copy saved as a new view', () => {
    expect(viewCopyFrontmatter(NOTE, { layout: 'feed' })).toMatchObject({ layout: 'feed' });
  });
});

describe('a calendar range chosen from the toolbar', () => {
  it('is an edit, drawn at once and saved as calendarRange', () => {
    const edits = editView(SAVED, {}, { calendarRange: 'week' });
    expect(hasViewEdits(edits)).toBe(true);
    expect(parseViewDisplay(editedFrontmatter(NOTE, edits))).toMatchObject({
      calendarRange: 'week',
    });
    expect(viewEditChanges(edits)).toEqual({ calendarRange: 'week' });
  });

  it('is no edit when it is a month and the note names no range', () => {
    expect(hasViewEdits(editView(SAVED, {}, { calendarRange: 'month' }))).toBe(false);
  });

  it('is done once the note says the same', () => {
    const saved = viewSettingsOf({ ...NOTE, calendarRange: 'agenda' }) as ViewSettings;
    expect(remainingEdits(saved, { calendarRange: 'agenda' })).toEqual({});
  });
});

describe('the properties a view shows', () => {
  it('shows a hidden one at the end and hides a shown one', () => {
    expect(toggleColumn(['a', 'b'], 'c')).toEqual(['a', 'b', 'c']);
    expect(toggleColumn(['a', 'b'], 'a')).toEqual(['b']);
  });

  it('moves one earlier or later, and not past either end', () => {
    expect(moveColumn(['a', 'b', 'c'], 'c', -1)).toEqual(['a', 'c', 'b']);
    expect(moveColumn(['a', 'b', 'c'], 'a', 1)).toEqual(['b', 'a', 'c']);
    expect(moveColumn(['a', 'b'], 'a', -1)).toEqual(['a', 'b']);
    expect(moveColumn(['a', 'b'], 'b', 1)).toEqual(['a', 'b']);
    expect(moveColumn(['a'], 'z', 1)).toEqual(['a']);
  });
});

describe('a heading clicked', () => {
  it('sorts by it, then the other way, then not at all', () => {
    const first = toggledSorts([], 'due');
    expect(first).toEqual([{ key: 'due', direction: 'asc' }]);
    const second = toggledSorts(first, 'due');
    expect(second).toEqual([{ key: 'due', direction: 'desc' }]);
    expect(toggledSorts(second, 'due')).toEqual([]);
    expect(toggledSorts(second, 'title')).toEqual([{ key: 'title', direction: 'asc' }]);
  });
});

describe('a sub-grouping chosen from the toolbar (issue #6)', () => {
  it('is an edit like any other, drawn at once and written on save', () => {
    const edits = editView(SAVED, {}, { subGroupBy: 'phase' });
    expect(hasViewEdits(edits)).toBe(true);
    expect(parseViewDisplay(editedFrontmatter(NOTE, edits)).subGroupBy).toBe('phase');
    expect(viewEditChanges(edits)).toEqual({ subGroupBy: 'phase' });
  });

  it('is no edit once taken away from a view that had none', () => {
    expect(hasViewEdits(editView(SAVED, { subGroupBy: 'phase' }, { subGroupBy: null }))).toBe(
      false,
    );
  });

  it('is removed from the note when taken away, and left out of a copy', () => {
    const withLanes = { ...NOTE, subGroupBy: 'phase' };
    const saved = viewSettingsOf(withLanes) as ViewSettings;
    expect(saved.subGroupBy).toBe('phase');
    const edits = editView(saved, {}, { subGroupBy: null });
    expect(viewEditChanges(edits)).toEqual({ subGroupBy: null });
    expect(viewCopyFrontmatter(withLanes, edits)).not.toHaveProperty('subGroupBy');
    expect(viewCopyFrontmatter(withLanes, {})).toMatchObject({ subGroupBy: 'phase' });
  });
});

describe('groupingEdit', () => {
  it('changes the grouping and keeps the sub-grouping', () => {
    expect(groupingEdit('phase', 'project')).toEqual({ groupBy: 'project' });
  });

  it('takes the sub-grouping away with the grouping', () => {
    expect(groupingEdit('phase', null)).toEqual({ groupBy: null, subGroupBy: null });
  });

  it('drops a sub-grouping the grouping now repeats', () => {
    expect(groupingEdit('phase', 'phase')).toEqual({ groupBy: 'phase', subGroupBy: null });
  });

  it('clears any sub-grouping the view names but does not draw, so regrouping cannot reveal it', () => {
    expect(groupingEdit(null, 'phase')).toEqual({ groupBy: 'phase', subGroupBy: null });
  });
});
