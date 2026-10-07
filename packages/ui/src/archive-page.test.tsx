// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createVaultPath, type ArchivedNote } from '@atlas/domain';
import { ArchivePage, type ArchiveContents } from './archive-page.tsx';
import type { RowSelection } from './row-selection.tsx';

const note = (path: string, title: string, from: string, archivedOn: string | null) =>
  ({
    path: createVaultPath(path),
    title,
    from: createVaultPath(from),
    archivedOn,
  }) satisfies ArchivedNote;

const CONTENTS: ArchiveContents = {
  notes: [
    note('Archive/Projects/Old plan.md', 'Old plan', 'Projects/Old plan.md', '2026-09-20'),
    note('Archive/Recipe.md', 'Recipe', 'Recipe.md', null),
  ],
  truncated: false,
};

/** The page with its choice of rows held as the app holds it. */
function Page({
  contents = CONTENTS,
  onUnarchive = () => {},
  onOpen = () => {},
  onSearch = () => {},
  search = '',
}: {
  contents?: ArchiveContents | null;
  onUnarchive?: (paths: readonly string[]) => void;
  onOpen?: (path: string) => void;
  onSearch?: (search: string) => void;
  search?: string;
}) {
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const selection: RowSelection = {
    selected,
    onToggle: (path) =>
      setSelected((was) => {
        const next = new Set(was);
        if (next.has(path)) next.delete(path);
        else next.add(path);
        return next;
      }),
    onToggleAll: ({ paths, select }) => setSelected(select ? new Set(paths) : new Set()),
  };
  return (
    <ArchivePage
      contents={contents}
      error={null}
      search={search}
      onSearch={onSearch}
      selection={selection}
      onClearSelection={() => setSelected(new Set())}
      onOpen={onOpen}
      onUnarchive={onUnarchive}
      busy={false}
    />
  );
}

describe('ArchivePage', () => {
  it('lists each archived note with where it came from and the day it was archived', () => {
    render(<Page />);
    const rows = screen.getAllByRole('row').slice(1);
    expect(rows).toHaveLength(2);
    expect(within(rows[0] as HTMLElement).getByText('Old plan')).toBeTruthy();
    expect(within(rows[0] as HTMLElement).getByText('Projects/Old plan.md')).toBeTruthy();
    expect(within(rows[0] as HTMLElement).getByText('Sun, Sep 20, 2026')).toBeTruthy();
    expect(within(rows[1] as HTMLElement).getByText('—')).toBeTruthy();
    expect(screen.getByText(/2 archived notes/)).toBeTruthy();
  });

  it('opens a note from its name and unarchives it from its row', async () => {
    const onOpen = vi.fn();
    const onUnarchive = vi.fn();
    render(<Page onOpen={onOpen} onUnarchive={onUnarchive} />);
    await userEvent.click(screen.getByRole('button', { name: 'Recipe' }));
    await userEvent.click(screen.getByRole('button', { name: 'Unarchive Old plan' }));
    expect(onOpen).toHaveBeenCalledWith('Archive/Recipe.md');
    expect(onUnarchive).toHaveBeenCalledWith(['Archive/Projects/Old plan.md']);
  });

  it('unarchives the chosen rows together, and offers nothing until one is chosen', async () => {
    const onUnarchive = vi.fn();
    render(<Page onUnarchive={onUnarchive} />);
    expect(screen.queryByRole('toolbar', { name: 'Chosen notes' })).toBeNull();

    await userEvent.click(screen.getByRole('checkbox', { name: 'Select all' }));
    const bar = screen.getByRole('toolbar', { name: 'Chosen notes' });
    expect(within(bar).getByText('2 selected')).toBeTruthy();
    await userEvent.click(within(bar).getByRole('button', { name: 'Unarchive 2 notes' }));
    expect(onUnarchive).toHaveBeenCalledWith(['Archive/Projects/Old plan.md', 'Archive/Recipe.md']);
  });

  it('marks the heading’s box as mixed while only some rows are chosen', async () => {
    render(<Page />);
    await userEvent.click(screen.getByRole('checkbox', { name: 'Select Recipe' }));
    const all = screen.getByRole('checkbox', { name: 'Select all' }) as HTMLInputElement;
    expect(all.indeterminate).toBe(true);
    expect(all.checked).toBe(false);
  });

  it('searches as it is typed into', async () => {
    const onSearch = vi.fn();
    render(<Page onSearch={onSearch} />);
    await userEvent.type(screen.getByRole('searchbox', { name: 'Search the Archive' }), 'p');
    expect(onSearch).toHaveBeenCalledWith('p');
  });

  it('says when nothing is archived, and when nothing matches a search', () => {
    const empty = { notes: [], truncated: false };
    const { rerender } = render(<Page contents={empty} />);
    expect(screen.getByText(/Nothing is archived/)).toBeTruthy();
    rerender(<Page contents={empty} search="zzz" />);
    expect(screen.getByText('No archived note matches.')).toBeTruthy();
  });

  it('says so while it reads, and when more are archived than it lists', () => {
    const { rerender } = render(<Page contents={null} />);
    expect(screen.getByText('Reading the Archive…')).toBeTruthy();
    rerender(<Page contents={{ ...CONTENTS, truncated: true }} />);
    expect(screen.getByText(/More are archived/)).toBeTruthy();
  });
});
