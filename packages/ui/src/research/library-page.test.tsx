// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  createVaultPath,
  DEFAULT_LIBRARY_SORT,
  libraryChoices,
  NO_LIBRARY_FILTER,
  type LibraryEntry,
} from '@dfai/domain';
import type { CoverSource } from '../card-cover.tsx';
import { LibraryPage, type LibraryPageProps } from './library-page.tsx';

function entry(name: string, rest: Partial<LibraryEntry> = {}): LibraryEntry {
  return {
    path: createVaultPath(`Library/${name}.md`),
    title: name,
    author: null,
    kind: 'pdf',
    highlights: 0,
    modified: Date.UTC(2026, 9, 3),
    tags: [],
    projects: [],
    cover: null,
    ...rest,
  };
}

const ART = entry('The Art of War', {
  author: 'Sun Tzu',
  highlights: 12,
  tags: ['strategy'],
  projects: [{ path: createVaultPath('Projects/Reading.md'), name: 'Reading list' }],
  cover: 'covers/art.jpg',
});
const STOIC = entry('Meditations', { kind: 'kindle', highlights: 1 });
const ENTRIES = [ART, STOIC];

const NO_COVERS: CoverSource = { coverOf: () => null, load: async () => null };

function renderPage(props: Partial<LibraryPageProps> = {}) {
  const handlers = {
    onFilter: vi.fn(),
    onSort: vi.fn(),
    onOpen: vi.fn(),
  };
  render(
    <LibraryPage
      state={{ kind: 'ready', shown: ENTRIES, total: ENTRIES.length }}
      choices={libraryChoices(ENTRIES)}
      filter={NO_LIBRARY_FILTER}
      sort={DEFAULT_LIBRARY_SORT}
      covers={NO_COVERS}
      {...handlers}
      {...props}
    />,
  );
  return handlers;
}

const rows = () => within(screen.getByRole('list', { name: 'Sources' })).getAllByRole('listitem');

describe('LibraryPage (#507)', () => {
  it('lists each source: title, author, kind in its pastel, highlights and the day it changed', () => {
    renderPage();
    const [art, stoic] = rows();
    expect(art?.textContent).toContain('The Art of War');
    expect(art?.textContent).toContain('Sun Tzu');
    expect(within(art!).getByText('PDF')?.getAttribute('data-hue')).toBe('red');
    expect(art?.textContent).toContain('12 highlights');
    expect(art?.textContent).toContain('Sat, Oct 3, 2026');
    expect(within(stoic!).getByText('Kindle')?.getAttribute('data-hue')).toBe('orange');
    expect(stoic?.textContent).toContain('1 highlight');
    expect(screen.getByText('2 sources')).toBeTruthy();
  });

  it('says how many are shown of how many when a filter leaves some out', () => {
    renderPage({ state: { kind: 'ready', shown: [ART], total: 2 } });
    expect(screen.getByText('1 of 2 sources')).toBeTruthy();
  });

  it("opens a source's note where the click asks", async () => {
    const { onOpen } = renderPage();
    await userEvent.click(screen.getByRole('button', { name: /The Art of War/ }));
    expect(onOpen).toHaveBeenLastCalledWith(ART.path, 'here');
    const user = userEvent.setup();
    await user.keyboard('{Meta>}');
    await user.click(screen.getByRole('button', { name: /Meditations/ }));
    expect(onOpen).toHaveBeenLastCalledWith(STOIC.path, 'new-tab');
  });

  it('toggles a kind, picks a tag and a project, and searches, each as a new filter', async () => {
    const { onFilter } = renderPage({ filter: { ...NO_LIBRARY_FILTER, kinds: ['kindle'] } });
    const kinds = screen.getByRole('group', { name: 'Kind' });
    expect(
      within(kinds)
        .getByRole('button', { name: /Kindle/ })
        ?.getAttribute('aria-pressed'),
    ).toBe('true');
    await userEvent.click(within(kinds).getByRole('button', { name: /PDF/ }));
    expect(onFilter).toHaveBeenLastCalledWith({ ...NO_LIBRARY_FILTER, kinds: ['kindle', 'pdf'] });

    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Tag' }), 'strategy');
    expect(onFilter).toHaveBeenLastCalledWith({
      ...NO_LIBRARY_FILTER,
      kinds: ['kindle'],
      tag: 'strategy',
    });

    await userEvent.selectOptions(
      screen.getByRole('combobox', { name: 'Project' }),
      'Projects/Reading.md',
    );
    expect(onFilter).toHaveBeenLastCalledWith({
      ...NO_LIBRARY_FILTER,
      kinds: ['kindle'],
      project: 'Projects/Reading.md',
    });

    await userEvent.type(screen.getByRole('searchbox', { name: 'Search the Library' }), 'w');
    expect(onFilter).toHaveBeenLastCalledWith({
      ...NO_LIBRARY_FILTER,
      kinds: ['kindle'],
      search: 'w',
    });
  });

  it('offers each tag and project with how many sources it would show, and "any" to clear it', async () => {
    const { onFilter } = renderPage({ filter: { ...NO_LIBRARY_FILTER, tag: 'strategy' } });
    const tag = screen.getByRole('combobox', { name: 'Tag' });
    expect(
      within(tag)
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toEqual(['Any tag', '#strategy (1)']);
    await userEvent.selectOptions(tag, 'Any tag');
    expect(onFilter).toHaveBeenLastCalledWith(NO_LIBRARY_FILTER);
  });

  it('sorts by another key, and turns the order round', async () => {
    const { onSort } = renderPage();
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Sort by' }), 'title');
    expect(onSort).toHaveBeenLastCalledWith({ key: 'title', descending: true });
    await userEvent.click(screen.getByRole('button', { name: 'Descending' }));
    expect(onSort).toHaveBeenLastCalledWith({ key: 'modified', descending: false });
  });

  it("fronts a source with its cover from the vault, and the book's glyph without one", async () => {
    const load = vi.fn(async () => 'blob:art');
    renderPage({
      covers: { coverOf: (path) => (path === ART.path ? 'covers/art.jpg' : null), load },
    });
    await waitFor(() =>
      expect(load).toHaveBeenCalledWith({ path: ART.path, src: 'covers/art.jpg' }),
    );
    const [art, stoic] = rows();
    await waitFor(() => expect(art!.querySelector('img')?.getAttribute('src')).toBe('blob:art'));
    expect(stoic!.querySelector('img')).toBeNull();
    expect(stoic!.querySelector('.library__cover svg')).not.toBeNull();
  });

  it('says it is reading, why it failed, and when there is nothing or nothing matches', () => {
    const cases: [LibraryPageProps['state'], string][] = [
      [{ kind: 'loading' }, 'Reading the Library…'],
      [
        { kind: 'failed', message: 'The Library could not be read: busy' },
        'The Library could not be read: busy',
      ],
      [{ kind: 'ready', shown: [], total: 0 }, 'No sources yet.'],
      [{ kind: 'ready', shown: [], total: 3 }, 'No source matches.'],
    ];
    for (const [state, said] of cases) {
      const view = render(
        <LibraryPage
          state={state}
          choices={libraryChoices([])}
          filter={NO_LIBRARY_FILTER}
          sort={DEFAULT_LIBRARY_SORT}
          covers={NO_COVERS}
          onFilter={() => {}}
          onSort={() => {}}
          onOpen={() => {}}
        />,
      );
      expect(view.getByText(said, { exact: false })).toBeTruthy();
      expect(view.queryByRole('list', { name: 'Sources' })).toBeNull();
      view.unmount();
    }
  });

  it('puts only a screenful of 2,000 sources in the page', () => {
    const many = Array.from({ length: 2000 }, (_, at) => entry(`Book ${at}`));
    renderPage({ state: { kind: 'ready', shown: many, total: many.length } });
    const drawn = rows().length;
    expect(drawn).toBeGreaterThan(5);
    expect(drawn).toBeLessThan(80);
  });
});
