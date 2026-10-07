// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createVaultPath, type SidebarTreeRow } from '@atlas/domain';
import { VaultTree } from './vault-tree.tsx';

// Labelled with the file's own name, so the keyboard tests below can find a row
// by what is on disk. What a row is labelled is the domain's rule, tested there;
// here the tree only has to show the label it is handed.
const directoryRow = (path: string, isExpanded = false): SidebarTreeRow => ({
  entry: { kind: 'directory', name: path.split('/').at(-1) ?? '', path: createVaultPath(path) },
  depth: path.split('/').length - 1,
  isExpanded,
  isLoaded: true,
  label: path.split('/').at(-1) ?? '',
  icon: 'folder',
  opensArchive: false,
});

const fileRow = (path: string, label = path.split('/').at(-1) ?? ''): SidebarTreeRow => ({
  entry: { kind: 'file', name: path.split('/').at(-1) ?? '', path: createVaultPath(path) },
  depth: path.split('/').length - 1,
  isExpanded: false,
  isLoaded: true,
  label,
  icon: 'doc',
  opensArchive: false,
});

const noop = () => {};

function show(overrides: Partial<Parameters<typeof VaultTree>[0]> = {}) {
  return render(
    <VaultTree
      rows={[]}
      open={new Set()}
      starred={new Set()}
      onToggleDirectory={noop}
      onSelectFile={noop}
      onToggleFavorite={noop}
      {...overrides}
    />,
  );
}

describe('VaultTree', () => {
  it('says so when the vault has nothing to show', () => {
    show();
    expect(screen.getByText('Nothing here yet.')).toBeDefined();
  });

  it('renders a row per entry', () => {
    show({ rows: [directoryRow('Notes'), fileRow('a.md')] });
    expect(screen.getAllByRole('treeitem')).toHaveLength(2);
    expect(screen.getByText('Notes')).toBeDefined();
    expect(screen.getByText('a.md')).toBeDefined();
  });

  it('shows and names a row by its label, not by its file name', () => {
    show({ rows: [fileRow('Notes/today.md', 'today')] });
    expect(screen.getByRole('treeitem', { name: 'today' })).toBeDefined();
    expect(screen.getByText('today')).toBeDefined();
    expect(screen.queryByText('today.md')).toBeNull();
    expect(screen.getByRole('button', { name: 'Add today to favorites' })).toBeDefined();
  });

  it('jumps to a row by the first letters of its label', async () => {
    show({ rows: [fileRow('b.md', 'Alpha'), fileRow('c.md', 'Zulu')] });
    screen.getByRole('treeitem', { name: 'Alpha' }).focus();
    await userEvent.keyboard('z');
    expect(document.activeElement).toBe(screen.getByRole('treeitem', { name: 'Zulu' }));
  });

  it('reports nesting depth as the tree level', () => {
    show({ rows: [directoryRow('Notes', true), fileRow('Notes/today.md')] });
    const [parent, child] = screen.getAllByRole('treeitem');
    expect(parent?.getAttribute('aria-level')).toBe('1');
    expect(child?.getAttribute('aria-level')).toBe('2');
  });

  it('exposes whether a directory is open', () => {
    show({ rows: [directoryRow('Notes', true)] });
    expect(screen.getByRole('treeitem').getAttribute('aria-expanded')).toBe('true');
  });

  it('does not claim a file can be expanded', () => {
    show({ rows: [fileRow('a.md')] });
    expect(screen.getByRole('treeitem').getAttribute('aria-expanded')).toBeNull();
  });

  it('marks the open note', () => {
    show({ rows: [fileRow('a.md'), fileRow('b.md')], open: new Set(['b.md']) });
    const selected = screen
      .getAllByRole('treeitem')
      .filter((item) => item.getAttribute('aria-selected') === 'true');
    expect(selected).toHaveLength(1);
    expect(selected[0]?.textContent).toContain('b.md');
  });

  it('marks a note open in each pane, since both are on screen', () => {
    show({ rows: [fileRow('a.md'), fileRow('b.md')], open: new Set(['a.md', 'b.md']) });
    const selected = screen
      .getAllByRole('treeitem')
      .filter((item) => item.getAttribute('aria-selected') === 'true');
    expect(selected).toHaveLength(2);
  });

  it('asks to toggle when a directory is clicked', async () => {
    const onToggleDirectory = vi.fn();
    show({ rows: [directoryRow('Notes')], onToggleDirectory });
    await userEvent.click(screen.getByText('Notes'));
    expect(onToggleDirectory).toHaveBeenCalledWith('Notes');
  });

  it('asks to open when a file is clicked', async () => {
    const onSelectFile = vi.fn();
    show({ rows: [fileRow('Notes/today.md')], onSelectFile });
    await userEvent.click(screen.getByText('today.md'));
    expect(onSelectFile).toHaveBeenCalledWith('Notes/today.md');
  });

  it('names a row by its file, not by what its star would do', () => {
    show({ rows: [fileRow('today.md')] });
    expect(screen.getByRole('treeitem', { name: 'today.md' })).toBeDefined();
  });

  it('offers a star on a note', async () => {
    const onToggleFavorite = vi.fn();
    show({ rows: [fileRow('today.md')], onToggleFavorite });

    await userEvent.click(screen.getByRole('button', { name: 'Add today.md to favorites' }));

    expect(onToggleFavorite).toHaveBeenCalledWith('today.md');
  });

  it('opens nothing when the star is pressed', async () => {
    const onSelectFile = vi.fn();
    show({ rows: [fileRow('today.md')], onSelectFile });
    await userEvent.click(screen.getByRole('button', { name: 'Add today.md to favorites' }));
    expect(onSelectFile).not.toHaveBeenCalled();
  });

  it('shows a note that is already a favourite as one', () => {
    show({ rows: [fileRow('today.md')], starred: new Set(['today.md']) });
    expect(screen.getByRole('button', { name: 'Remove today.md from favorites' })).toBeDefined();
  });

  it('offers no star on a folder, which is not a thing to open', () => {
    show({ rows: [directoryRow('Notes')] });
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('offers no star on a file that is not a note', () => {
    show({ rows: [fileRow('photo.png')] });
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('virtualises: a vault of 5000 notes renders only a screenful of rows', () => {
    show({ rows: Array.from({ length: 5000 }, (_, index) => fileRow(`note-${index}.md`)) });
    const rendered = screen.getAllByRole('treeitem').length;
    expect(rendered).toBeGreaterThan(0);
    expect(rendered).toBeLessThan(100);
  });
});

/**
 * The tree navigates the way a tree is expected to: the arrows move between
 * rows, Tab does not. Focusing a row that the virtualiser has not rendered is
 * covered end to end instead, where a scroller has a real height.
 */
describe('VaultTree keyboard navigation', () => {
  const threeNotes = [fileRow('a.md'), fileRow('b.md'), fileRow('c.md')];

  const row = (name: string) => screen.getByRole('treeitem', { name });
  const star = (name: string) => screen.getByRole('button', { name: `Add ${name} to favorites` });

  it('offers exactly one row to the tab key', () => {
    show({ rows: threeNotes });
    const tabbable = screen
      .getAllByRole('treeitem')
      .filter((item) => item.tabIndex === 0)
      .map((item) => item.getAttribute('aria-label'));
    expect(tabbable).toEqual(['a.md']);
  });

  it('moves to the next row on the down arrow', async () => {
    show({ rows: threeNotes });
    row('a.md').focus();
    await userEvent.keyboard('{ArrowDown}');
    expect(document.activeElement).toBe(row('b.md'));
  });

  it('moves to the previous row on the up arrow', async () => {
    show({ rows: threeNotes });
    row('b.md').focus();
    await userEvent.keyboard('{ArrowUp}');
    expect(document.activeElement).toBe(row('a.md'));
  });

  it('stops at the ends rather than wrapping round them', async () => {
    show({ rows: threeNotes });
    row('a.md').focus();
    await userEvent.keyboard('{ArrowUp}');
    expect(document.activeElement).toBe(row('a.md'));
    expect(row('a.md').tabIndex).toBe(0);

    row('c.md').focus();
    await userEvent.keyboard('{ArrowDown}');
    expect(document.activeElement).toBe(row('c.md'));
    expect(row('c.md').tabIndex).toBe(0);
  });

  it('jumps to the ends on Home and End', async () => {
    show({ rows: threeNotes });
    row('b.md').focus();
    await userEvent.keyboard('{End}');
    expect(document.activeElement).toBe(row('c.md'));
    await userEvent.keyboard('{Home}');
    expect(document.activeElement).toBe(row('a.md'));
  });

  it('moves the tab stop with the focus, so the tree is re-entered where it was left', async () => {
    show({ rows: threeNotes });
    row('a.md').focus();
    await userEvent.keyboard('{ArrowDown}');
    expect(row('b.md').tabIndex).toBe(0);
    expect(row('a.md').tabIndex).toBe(-1);
  });

  it('moves the tab stop to a row that was clicked', async () => {
    show({ rows: threeNotes });
    await userEvent.click(screen.getByText('c.md'));
    expect(row('c.md').tabIndex).toBe(0);
    expect(row('a.md').tabIndex).toBe(-1);
  });

  it('opens the focused note on Enter', async () => {
    const onSelectFile = vi.fn();
    show({ rows: threeNotes, onSelectFile });
    row('b.md').focus();
    await userEvent.keyboard('{Enter}');
    expect(onSelectFile).toHaveBeenCalledWith('b.md');
  });

  it('opens the focused note on Space', async () => {
    const onSelectFile = vi.fn();
    show({ rows: threeNotes, onSelectFile });
    row('b.md').focus();
    await userEvent.keyboard('[Space]');
    expect(onSelectFile).toHaveBeenCalledWith('b.md');
  });

  it('toggles the focused folder on Enter', async () => {
    const onToggleDirectory = vi.fn();
    show({ rows: [directoryRow('Notes')], onToggleDirectory });
    row('Notes').focus();
    await userEvent.keyboard('{Enter}');
    expect(onToggleDirectory).toHaveBeenCalledWith('Notes');
  });

  it('expands a closed folder on the right arrow, without moving off it', async () => {
    const onToggleDirectory = vi.fn();
    show({ rows: [directoryRow('Notes'), fileRow('z.md')], onToggleDirectory });
    row('Notes').focus();
    await userEvent.keyboard('{ArrowRight}');
    expect(onToggleDirectory).toHaveBeenCalledWith('Notes');
    expect(document.activeElement).toBe(row('Notes'));
  });

  it('moves into an open folder on the right arrow, without shutting it', async () => {
    const onToggleDirectory = vi.fn();
    show({
      rows: [directoryRow('Notes', true), fileRow('Notes/today.md')],
      onToggleDirectory,
    });
    row('Notes').focus();
    await userEvent.keyboard('{ArrowRight}');
    expect(document.activeElement).toBe(row('today.md'));
    expect(onToggleDirectory).not.toHaveBeenCalled();
  });

  it('stays put on the right arrow when an open folder has nothing in it', async () => {
    show({ rows: [directoryRow('Notes', true), fileRow('z.md')] });
    row('Notes').focus();
    await userEvent.keyboard('{ArrowRight}');
    expect(document.activeElement).toBe(row('Notes'));
  });

  it('does nothing on the right arrow on a note', async () => {
    const onSelectFile = vi.fn();
    const onToggleDirectory = vi.fn();
    show({ rows: threeNotes, onSelectFile, onToggleDirectory });
    row('b.md').focus();
    await userEvent.keyboard('{ArrowRight}');
    expect(document.activeElement).toBe(row('b.md'));
    expect(onSelectFile).not.toHaveBeenCalled();
    expect(onToggleDirectory).not.toHaveBeenCalled();
  });

  it('collapses an open folder on the left arrow', async () => {
    const onToggleDirectory = vi.fn();
    show({
      rows: [directoryRow('Notes', true), fileRow('Notes/today.md')],
      onToggleDirectory,
    });
    row('Notes').focus();
    await userEvent.keyboard('{ArrowLeft}');
    expect(onToggleDirectory).toHaveBeenCalledWith('Notes');
    expect(document.activeElement).toBe(row('Notes'));
  });

  it('moves to the folder that holds a row on the left arrow', async () => {
    const onToggleDirectory = vi.fn();
    show({
      rows: [directoryRow('Notes', true), fileRow('Notes/today.md')],
      onToggleDirectory,
    });
    row('today.md').focus();
    await userEvent.keyboard('{ArrowLeft}');
    expect(document.activeElement).toBe(row('Notes'));
    expect(onToggleDirectory).not.toHaveBeenCalled();
  });

  it('stays put on the left arrow at the top level', async () => {
    show({ rows: threeNotes });
    row('b.md').focus();
    await userEvent.keyboard('{ArrowLeft}');
    expect(document.activeElement).toBe(row('b.md'));
  });

  it('jumps to the next row that starts with the letter typed', async () => {
    show({ rows: [fileRow('apple.md'), fileRow('banana.md'), fileRow('cherry.md')] });
    row('apple.md').focus();
    await userEvent.keyboard('c');
    expect(document.activeElement).toBe(row('cherry.md'));
  });

  it('narrows on the letters typed after the first', async () => {
    show({ rows: [fileRow('apple.md'), fileRow('banana.md'), fileRow('blueberry.md')] });
    row('apple.md').focus();
    await userEvent.keyboard('bl');
    expect(document.activeElement).toBe(row('blueberry.md'));
  });

  it('cycles the rows under a letter when that letter is typed again', async () => {
    show({ rows: [fileRow('apple.md'), fileRow('apricot.md'), fileRow('banana.md')] });
    row('apple.md').focus();
    await userEvent.keyboard('a');
    expect(document.activeElement).toBe(row('apricot.md'));
    await userEvent.keyboard('a');
    expect(document.activeElement).toBe(row('apple.md'));
  });

  it('starts a fresh prefix once the typing pauses', async () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(1_000);
    try {
      show({ rows: [fileRow('apple.md'), fileRow('banana.md')] });
      row('apple.md').focus();
      await userEvent.keyboard('b');
      expect(document.activeElement).toBe(row('banana.md'));

      clock.mockReturnValue(9_000);
      await userEvent.keyboard('a');
      expect(document.activeElement).toBe(row('apple.md'));
    } finally {
      clock.mockRestore();
    }
  });

  it('stays put when nothing starts with what was typed', async () => {
    const onSelectFile = vi.fn();
    show({ rows: threeNotes, onSelectFile });
    row('a.md').focus();
    await userEvent.keyboard('q');
    expect(document.activeElement).toBe(row('a.md'));
    expect(onSelectFile).not.toHaveBeenCalled();
  });

  it("keeps only the focused row's star in the tab order", () => {
    show({ rows: threeNotes });
    expect(star('a.md').tabIndex).toBe(0);
    expect(star('b.md').tabIndex).toBe(-1);
    expect(star('c.md').tabIndex).toBe(-1);
  });

  it("reaches the focused row's star with Tab, and leaves the tree with the next", async () => {
    show({ rows: threeNotes });
    const tree = screen.getByRole('tree');
    row('a.md').focus();

    await userEvent.tab();
    expect(document.activeElement).toBe(star('a.md'));

    await userEvent.tab();
    // The star was inside the tree, so this only holds if no other row offered
    // Tab a stop of its own.
    expect(tree.contains(document.activeElement)).toBe(false);
  });

  it("leaves the star's own keys to the star", async () => {
    const onSelectFile = vi.fn();
    const onToggleFavorite = vi.fn();
    show({ rows: threeNotes, onSelectFile, onToggleFavorite });
    star('a.md').focus();

    await userEvent.keyboard('{ArrowDown}');
    expect(document.activeElement).toBe(star('a.md'));

    await userEvent.keyboard('{Enter}');
    expect(onToggleFavorite).toHaveBeenCalledWith('a.md');
    expect(onSelectFile).not.toHaveBeenCalled();
  });
});

describe('the Archive row', () => {
  const archiveRow: SidebarTreeRow = {
    ...directoryRow('Archive'),
    icon: 'archive',
    opensArchive: true,
  };

  it('opens the Archive rather than expanding, from a click or the keyboard', async () => {
    const onOpenArchive = vi.fn();
    const onToggleDirectory = vi.fn();
    show({ rows: [archiveRow], onOpenArchive, onToggleDirectory });
    const row = screen.getByRole('treeitem', { name: 'Archive' });
    expect(row.getAttribute('aria-expanded')).toBeNull();

    await userEvent.click(row);
    row.focus();
    await userEvent.keyboard('{Enter}{ArrowRight}');
    expect(onOpenArchive).toHaveBeenCalledTimes(2);
    expect(onToggleDirectory).not.toHaveBeenCalled();
  });

  it('has no menu to rename, move or delete it from', () => {
    show({
      rows: [archiveRow, directoryRow('Notes')],
      onOpenArchive: vi.fn(),
      editing: {
        menuFor: () => [],
        menuOpen: false,
        onMenuOpenChange: vi.fn(),
        renaming: null,
        onRename: vi.fn(),
        onCancelRename: vi.fn(),
        canDrop: () => true,
        onDrop: vi.fn(),
      },
    });
    expect(screen.getByRole('button', { name: 'Options for Notes' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Options for Archive' })).toBeNull();
  });
});
