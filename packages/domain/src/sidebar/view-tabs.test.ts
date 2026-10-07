import { describe, expect, it } from 'vitest';
import { createVaultPath } from '../vault/vault-path.ts';
import {
  queryViewSummary,
  queryViewTabs,
  savedViewSummary,
  typePageTabs,
  viewTabs,
  type SavedViewSummary,
} from './index.ts';

const view = (
  name: string,
  type: string,
  layout: SavedViewSummary['layout'],
): SavedViewSummary => ({
  path: createVaultPath(`.atlas/views/${name}.md`),
  title: name,
  type,
  layout,
  query: { type, columns: [], filters: [], sorts: [], limit: 500 },
  order: null,
  titleSource: 'file',
});

const board = view('Board', 'task', 'board');
const allTasks = view('All tasks', 'task', 'table');
const calendar = view('Calendar', 'task', 'calendar');
const roadmap = view('Roadmap', 'task', 'timeline');
const inbox = view('Inbox', 'task', 'list');
const today = view('Today', 'task', 'list');
const milestones = view('Milestones', 'event', 'calendar');

describe('viewTabs', () => {
  it('lists the views over the same type, and only those', () => {
    const tabs = viewTabs({ views: [milestones, calendar, board, allTasks], current: board });
    expect(tabs.map((tab) => tab.title)).toEqual(['Board', 'All tasks', 'Calendar']);
  });

  it('orders by layout — board, table, lists, then time — and by name within one', () => {
    const tabs = viewTabs({
      views: [roadmap, today, calendar, inbox, allTasks, board],
      current: allTasks,
    });
    expect(tabs.map((tab) => tab.title)).toEqual([
      'Board',
      'All tasks',
      'Inbox',
      'Today',
      'Calendar',
      'Roadmap',
    ]);
  });

  it('lets a view’s tabs be moved once there are two, and each be deleted', () => {
    const tabs = viewTabs({ views: [board, allTasks], current: allTasks });
    expect(tabs.map((tab) => [tab.movable, tab.deletable])).toEqual([
      [true, true],
      [true, true],
    ]);
    expect(viewTabs({ views: [], current: board }).map((tab) => tab.movable)).toEqual([false]);
  });

  it('marks the page’s own view as selected, and draws each by its layout', () => {
    const tabs = viewTabs({ views: [board, allTasks, roadmap], current: allTasks });
    expect(tabs.filter((tab) => tab.selected).map((tab) => tab.title)).toEqual(['All tasks']);
    expect(tabs.map((tab) => tab.icon)).toEqual(['board', 'table', 'timeline']);
  });

  it('keeps the page’s own tab while the catalogue has not read it yet', () => {
    expect(viewTabs({ views: [], current: calendar })).toEqual([
      {
        path: calendar.path,
        title: 'Calendar',
        icon: 'calendar',
        selected: true,
        virtual: false,
        movable: false,
        deletable: true,
      },
    ]);
  });

  it('puts placed views first, by their order, and the unplaced after them as before', () => {
    const tabs = viewTabs({
      views: [{ ...calendar, order: 1 }, board, { ...roadmap, order: 0.5 }, allTasks],
      current: board,
    });
    expect(tabs.map((tab) => tab.title)).toEqual(['Roadmap', 'Calendar', 'Board', 'All tasks']);
  });

  it('takes the page’s own reading of itself over the catalogue’s older one', () => {
    const stale = { ...board, layout: 'table' as const };
    const tabs = viewTabs({ views: [stale], current: board });
    expect(tabs).toHaveLength(1);
    expect(tabs[0]?.icon).toBe('board');
  });
});

describe('typePageTabs', () => {
  const task = { name: 'task', label: 'Task' };

  it('is the default table alone, selected and not a file, for a type with no views', () => {
    const tabs = typePageTabs({ views: [milestones], type: task, takenPaths: [] });
    expect(tabs).toEqual([
      {
        path: '.atlas/views/Task table.md',
        title: 'Task table',
        icon: 'table',
        selected: true,
        virtual: true,
        movable: false,
        deletable: false,
      },
    ]);
  });

  it('lists the type’s views in their order with none selected, and only that type’s', () => {
    const tabs = typePageTabs({
      views: [milestones, allTasks, { ...board, order: 2 }],
      type: task,
      takenPaths: [],
    });
    expect(tabs.map((tab) => [tab.title, tab.selected, tab.virtual])).toEqual([
      ['Board', false, false],
      ['All tasks', false, false],
    ]);
  });

  it('says which tabs can be moved and deleted: a type’s written views, when there are two', () => {
    const two = typePageTabs({ views: [allTasks, board], type: task, takenPaths: [] });
    expect(two.map((tab) => [tab.movable, tab.deletable])).toEqual([
      [true, true],
      [true, true],
    ]);
    const one = typePageTabs({ views: [allTasks], type: task, takenPaths: [] });
    expect(one.map((tab) => [tab.movable, tab.deletable])).toEqual([[false, true]]);
  });
});

describe('savedViewSummary', () => {
  it('reads a view’s type, layout, title and query', () => {
    const path = createVaultPath('.atlas/views/Board.md');
    const filters = [{ key: 'status', operator: 'isNot', value: 'done' }];
    expect(
      savedViewSummary(path, {
        atlas: 'view',
        type: 'task',
        layout: 'board',
        groupBy: 'status',
        filters,
      }),
    ).toEqual({
      path,
      title: 'Board',
      type: 'task',
      layout: 'board',
      query: { type: 'task', columns: [], filters, sorts: [], limit: 500 },
      order: null,
      titleSource: 'file',
    });
  });

  it('titles a view as its page does: its title property, else its filename', () => {
    const path = createVaultPath('.atlas/views/Roadmap.md');
    const titled = savedViewSummary(path, { atlas: 'view', type: 'task', title: 'The road' });
    expect(titled?.title).toBe('The road');
    expect(titled?.titleSource).toBe('property');
    expect(savedViewSummary(path, { atlas: 'view', type: 'task' })?.titleSource).toBe('file');
  });

  it('reads the view’s place among its type’s tabs', () => {
    const path = createVaultPath('.atlas/views/Roadmap.md');
    expect(savedViewSummary(path, { atlas: 'view', type: 'task', order: 3 })?.order).toBe(3);
    expect(savedViewSummary(path, { atlas: 'view', type: 'task', order: '2' })?.order).toBe(2);
    expect(
      savedViewSummary(path, { atlas: 'view', type: 'task', order: 'soon' })?.order,
    ).toBeNull();
  });

  it('reads a board with nothing to group by as the table it is drawn as', () => {
    const path = createVaultPath('Views/Loose.md');
    expect(savedViewSummary(path, { atlas: 'view', type: 'task', layout: 'board' })?.layout).toBe(
      'table',
    );
  });

  it('is null for a note that is not a view, or a view with no type', () => {
    const path = createVaultPath('Notes/Plain.md');
    expect(savedViewSummary(path, { type: 'task' })).toBeNull();
    expect(savedViewSummary(path, { atlas: 'view' })).toBeNull();
  });
});

describe('query views (ADR-0019)', () => {
  const at = (name: string) => createVaultPath(`.atlas/views/${name}.md`);

  it('reads a query view as its path, title and layout, and nothing else as one', () => {
    expect(
      queryViewSummary(at('Open'), { atlas: 'view', layout: 'list', query: 'FROM task' }),
    ).toEqual({
      path: at('Open'),
      title: 'Open',
      layout: 'list',
    });
    expect(queryViewSummary(at('Tasks'), { atlas: 'view', type: 'task' })).toBeNull();
  });

  it('offers every saved query as a tab, boards first, this one selected', () => {
    const open = { path: at('Open'), title: 'Open', layout: 'table' as const };
    const board = { path: at('Work'), title: 'Work', layout: 'board' as const };
    const tabs = queryViewTabs({ views: [open, board], current: open });
    expect(tabs.map((tab) => [tab.title, tab.selected])).toEqual([
      ['Work', false],
      ['Open', true],
    ]);
  });

  it('still gives the page its own tab before the sidebar has read it', () => {
    const open = { path: at('Open'), title: 'Open', layout: 'table' as const };
    expect(queryViewTabs({ views: [], current: open }).map((tab) => tab.title)).toEqual(['Open']);
  });

  it('cannot move or delete a saved query from its tabs: they are a shelf, not a type’s', () => {
    const open = { path: at('Open'), title: 'Open', layout: 'table' as const };
    const board = { path: at('Work'), title: 'Work', layout: 'board' as const };
    const tabs = queryViewTabs({ views: [open, board], current: open });
    expect(tabs.map((tab) => [tab.movable, tab.deletable])).toEqual([
      [false, false],
      [false, false],
    ]);
  });
});
