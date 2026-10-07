// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  RepositoryPicker,
  type RepositoryChoice,
  type RepositoryListView,
} from './repository-picker.tsx';

const REPOSITORIES: readonly RepositoryChoice[] = [
  {
    nameWithOwner: 'james/notes',
    url: 'https://github.com/james/notes',
    isPrivate: true,
    defaultBranch: 'main',
  },
  {
    nameWithOwner: 'james/old-vault',
    url: 'https://github.com/james/old-vault',
    isPrivate: true,
    defaultBranch: 'master',
  },
  {
    nameWithOwner: 'james/site',
    url: 'https://github.com/james/site',
    isPrivate: false,
    defaultBranch: null,
  },
];

/** What the app's search does, near enough for the picker: by words in `owner/name`. */
const find = (query: string) =>
  REPOSITORIES.filter(({ nameWithOwner }) =>
    query
      .toLowerCase()
      .split(/\s+/)
      .every((word) => nameWithOwner.includes(word)),
  );

function show(list: RepositoryListView, { busy = false } = {}) {
  const actions = { onLoad: vi.fn(), onConnect: vi.fn(), find: vi.fn(find) };
  render(
    <RepositoryPicker
      list={list}
      find={actions.find}
      busy={busy}
      onLoad={actions.onLoad}
      onConnect={actions.onConnect}
    />,
  );
  return actions;
}

const ready: RepositoryListView = { kind: 'ready', repositories: REPOSITORIES };

describe('RepositoryPicker', () => {
  it('asks for the list as it first shows, and says it is looking', () => {
    const { onLoad } = show({ kind: 'idle' });
    expect(onLoad).toHaveBeenCalledOnce();
    expect(screen.getByText('Looking up your GitHub repositories…')).toBeDefined();
    expect((screen.getByRole('searchbox') as HTMLInputElement).disabled).toBe(true);
  });

  it('does not ask again once the list is loading or loaded', () => {
    expect(show({ kind: 'loading' }).onLoad).not.toHaveBeenCalled();
  });

  it('lists each repository with whether it is private and its default branch', () => {
    show(ready);
    const items = screen.getAllByRole('listitem');
    expect(items.map((item) => item.textContent)).toEqual([
      'james/notesPrivate · mainConnect',
      'james/old-vaultPrivate · masterConnect',
      'james/sitePublicConnect',
    ]);
  });

  it('narrows the list as the person searches, and says when nothing matches', async () => {
    show(ready);
    await userEvent.type(screen.getByRole('searchbox'), 'vault');
    expect(screen.getAllByRole('listitem').map((item) => item.textContent)).toEqual([
      'james/old-vaultPrivate · masterConnect',
    ]);
    await userEvent.type(screen.getByRole('searchbox'), 'zzz');
    expect(screen.queryAllByRole('listitem')).toHaveLength(0);
    expect(screen.getByText('No repository matches “vaultzzz”.')).toBeDefined();
  });

  it('connects the repository picked, by its address', async () => {
    const { onConnect } = show(ready);
    await userEvent.click(screen.getByRole('button', { name: 'Connect james/old-vault' }));
    expect(onConnect).toHaveBeenCalledWith('https://github.com/james/old-vault');
  });

  it('holds every Connect while setting up runs', () => {
    show(ready, { busy: true });
    const buttons = within(screen.getByRole('list')).getAllByRole('button');
    expect(buttons).toHaveLength(3);
    expect(buttons.every((button) => (button as HTMLButtonElement).disabled)).toBe(true);
  });

  it('says why the list could not be read, and that the other ways still work', () => {
    show({ kind: 'failed', problem: 'The GitHub command line isn’t logged in.' });
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain('isn’t logged in');
    expect(alert.textContent).toContain('paste an address below');
  });

  it('says so when there are no repositories at all', () => {
    show({ kind: 'ready', repositories: [] });
    expect(screen.getByText('You have no repositories on GitHub yet.')).toBeDefined();
  });
});
