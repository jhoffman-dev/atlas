// @vitest-environment jsdom
/**
 * How much the sidebar's lists draw again (#293): the app draws the sidebar
 * again for everything the window does — an autosave, a tick — with its
 * handlers made anew each time, and its catalogue read back as the same
 * objects while nothing in it changed. A list draws again only for a change
 * of its own, and its rows still call the latest handlers.
 */
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  createVaultPath,
  sidebarEntry,
  type ActiveSidebarPage,
  type SidebarEntry,
} from '@dfai/domain';
import { Sidebar, type SidebarType } from './sidebar.tsx';
import type { SectionStore } from './sidebar-sections.ts';
import { startCountingRenders, stopCountingRenders } from './testing/render-counter.ts';

// Before React loads, so every commit is handed to the counter.
await vi.hoisted(async () => {
  const { installRenderCounter } = await import('./testing/render-counter.ts');
  installRenderCounter();
});

const STORE: SectionStore = { read: () => null, write: () => {} };
const FAVORITES = [sidebarEntry(createVaultPath('Acme.md'))];
const TYPES: readonly SidebarType[] = [
  { name: 'task', label: 'Task', count: 62, icon: 'task' },
  { name: 'person', label: 'Person', count: 4, icon: 'person' },
];
const VIEWS = [sidebarEntry(createVaultPath('.atlas/views/Board.md'))];
const DASHBOARDS = [sidebarEntry(createVaultPath('.atlas/dashboards/Progress.md'))];
const NO_ROWS = { rows: [], onToggleDirectory: () => {} };

/** The sidebar as the app hands it over: every handler, the tree and where you are made again on each render. */
function sidebar({
  favorites = FAVORITES,
  views = VIEWS,
  types = TYPES,
  active = null,
  onOpen = () => {},
}: {
  favorites?: readonly SidebarEntry[];
  views?: readonly SidebarEntry[];
  types?: readonly SidebarType[];
  active?: ActiveSidebarPage;
  onOpen?: (path: string) => void;
} = {}) {
  return (
    <Sidebar
      favorites={favorites}
      types={types}
      views={views}
      dashboards={DASHBOARDS}
      quick={[]}
      tree={{ ...NO_ROWS }}
      active={active === null ? null : { ...active }}
      sectionStore={STORE}
      onSearch={() => {}}
      onOpen={(path) => onOpen(path)}
      onOpenType={() => {}}
      onEditType={() => {}}
      onEditTemplate={() => {}}
      onToggleFavorite={() => {}}
    />
  );
}

/** How many of each list, and of the stars in them, `act` drew. */
function drawnBy(act: () => void): { entryLists: number; typeLists: number; stars: number } {
  startCountingRenders();
  act();
  const { renders } = stopCountingRenders();
  return {
    entryLists: renders['EntryList'] ?? 0,
    typeLists: renders['TypeList'] ?? 0,
    stars: renders['FavoriteStar'] ?? 0,
  };
}

describe('Sidebar — what one commit draws of its lists', () => {
  it('draws no list again for a commit that changes nothing in them', () => {
    const view = render(sidebar());
    expect(screen.getByRole('button', { name: 'Board' })).toBeDefined();
    const drawn = drawnBy(() => {
      view.rerender(sidebar());
      view.rerender(sidebar());
    });
    expect(drawn).toEqual({ entryLists: 0, typeLists: 0, stars: 0 });
  });

  it('draws only the Views list for a new view, and only the Types list for a new count', () => {
    const view = render(sidebar());
    const planner = sidebarEntry(createVaultPath('.atlas/views/Planner.md'));
    const views = [...VIEWS, planner];
    expect(drawnBy(() => view.rerender(sidebar({ views })))).toEqual({
      entryLists: 1,
      typeLists: 0,
      stars: 2,
    });
    expect(screen.getByRole('button', { name: 'Planner' })).toBeDefined();

    const counted = TYPES.map((type) => (type.name === 'task' ? { ...type, count: 63 } : type));
    const drawn = drawnBy(() => view.rerender(sidebar({ views, types: counted })));
    expect(drawn).toEqual({ entryLists: 0, typeLists: 1, stars: 0 });
    expect(screen.getByRole('button', { name: 'Task, 63 notes' })).toBeDefined();
  });

  it('draws the lists again when the note open changes, to mark it', () => {
    const board = VIEWS[0]!.path;
    const view = render(sidebar());
    const drawn = drawnBy(() => view.rerender(sidebar({ active: { kind: 'note', path: board } })));
    // Favourites, Views and Dashboards each say which of their rows is open.
    expect(drawn.entryLists).toBe(3);
    expect(screen.getByRole('button', { name: 'Board' }).getAttribute('aria-current')).toBe('page');
  });

  it('draws the star of a view starred again, and shows it starred', () => {
    const view = render(sidebar());
    expect(screen.getAllByRole('button', { name: 'Add Board to favorites' })).toHaveLength(1);

    const starred = [...FAVORITES, VIEWS[0]!];
    const drawn = drawnBy(() => view.rerender(sidebar({ favorites: starred })));

    expect(drawn.stars).toBeGreaterThan(0);
    // Listed in Favorites too now, and starred in both places.
    expect(screen.queryAllByRole('button', { name: 'Add Board to favorites' })).toHaveLength(0);
    expect(screen.getAllByRole('button', { name: 'Remove Board from favorites' })).toHaveLength(2);
  });

  it('calls the latest handler from a row not drawn again', async () => {
    const first = vi.fn();
    const latest = vi.fn();
    const view = render(sidebar({ onOpen: first }));
    view.rerender(sidebar({ onOpen: latest }));

    await userEvent.click(screen.getByRole('button', { name: 'Board' }));

    expect(first).not.toHaveBeenCalled();
    expect(latest).toHaveBeenCalledWith(VIEWS[0]!.path);
  });
});
