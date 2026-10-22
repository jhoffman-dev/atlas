// @vitest-environment jsdom
/**
 * Attack on #244 (memoised sidebar rows): every change a row shows — a
 * rename, a move, a star, the open note, a folder opened or closed, editing
 * turned on or off — reaches the row on screen, without a remount.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { createVaultPath, type SidebarTreeRow } from '@dfai/domain';
import { VaultTree, type TreeEditing } from './vault-tree.tsx';

afterEach(cleanup);

const note = (name: string, depth = 0): SidebarTreeRow => ({
  entry: { kind: 'file', name: `${name}.md`, path: createVaultPath(`${name}.md`) },
  depth,
  isExpanded: false,
  isLoaded: true,
  label: name,
  icon: 'doc',
  opensArchive: false,
});

const folder = (name: string, isExpanded: boolean): SidebarTreeRow => ({
  entry: { kind: 'directory', name, path: createVaultPath(name) },
  depth: 0,
  isExpanded,
  isLoaded: true,
  label: name,
  icon: 'folder',
  opensArchive: false,
});

const EDITING: TreeEditing = {
  menuFor: () => [],
  menuOpen: false,
  onMenuOpenChange: () => {},
  renaming: null,
  onRename: () => {},
  onCancelRename: () => {},
  canDrop: () => true,
  onDrop: () => {},
};

function tree({
  rows,
  open = [],
  starred = [],
  editing = EDITING,
}: {
  rows: readonly SidebarTreeRow[];
  open?: readonly string[];
  starred?: readonly string[];
  /** Null for a tree that only opens and expands. */
  editing?: TreeEditing | null;
}) {
  return (
    <VaultTree
      rows={rows}
      open={new Set(open)}
      starred={new Set(starred)}
      onToggleDirectory={() => {}}
      onSelectFile={() => {}}
      onToggleFavorite={() => {}}
      {...(editing !== null && { editing })}
    />
  );
}

const row = (name: string) => screen.getByRole('treeitem', { name });

describe('VaultTree (#244) — memoised rows never go stale', () => {
  it('shows a renamed note under its new name', () => {
    const view = render(tree({ rows: [note('Fern'), note('Moss')] }));
    view.rerender(tree({ rows: [note('Fern'), { ...note('Moss'), label: 'Lichen' }] }));
    expect(row('Lichen')).toBeDefined();
    expect(screen.queryByRole('treeitem', { name: 'Moss' })).toBeNull();
  });

  it('sets a note moved into a folder in by its new depth', () => {
    const view = render(tree({ rows: [folder('Garden', true), note('Fern')] }));
    const before = row('Fern').style.paddingLeft;
    view.rerender(tree({ rows: [folder('Garden', true), note('Fern', 1)] }));
    expect(row('Fern').style.paddingLeft).not.toBe(before);
    expect(row('Fern').getAttribute('aria-level')).toBe('2');
  });

  it('shows a note starred and unstarred', () => {
    const view = render(tree({ rows: [note('Fern')] }));
    view.rerender(tree({ rows: [note('Fern')], starred: ['Fern.md'] }));
    const starred = row('Fern').querySelector('.star--on');
    view.rerender(tree({ rows: [note('Fern')] }));
    expect(starred).not.toBeNull();
    expect(row('Fern').querySelector('.star--on')).toBeNull();
  });

  it('moves the selected look with the open note', () => {
    const rows = [note('Fern'), note('Moss')];
    const view = render(tree({ rows, open: ['Fern.md'] }));
    view.rerender(tree({ rows, open: ['Moss.md'] }));
    expect(row('Fern').getAttribute('aria-selected')).toBe('false');
    expect(row('Moss').getAttribute('aria-selected')).toBe('true');
  });

  it('shows a folder expanded, then collapsed', () => {
    const view = render(tree({ rows: [folder('Garden', false)] }));
    view.rerender(tree({ rows: [folder('Garden', true), note('Fern', 1)] }));
    expect(row('Garden').getAttribute('aria-expanded')).toBe('true');
    view.rerender(tree({ rows: [folder('Garden', false)] }));
    expect(row('Garden').getAttribute('aria-expanded')).toBe('false');
  });

  it('drops the "…" when editing is turned off, and brings it back when on', () => {
    const rows = [note('Fern')];
    const view = render(tree({ rows }));
    const more = () => row('Fern').querySelectorAll('button').length;
    const withEditing = more();
    view.rerender(tree({ rows, editing: null }));
    const without = more();
    view.rerender(tree({ rows }));
    expect(without).toBeLessThan(withEditing);
    expect(more()).toBe(withEditing);
  });

  it('turns a row into its name field when renaming starts', () => {
    const rows = [note('Fern'), note('Moss')];
    const view = render(tree({ rows }));
    view.rerender(tree({ rows, editing: { ...EDITING, renaming: createVaultPath('Moss.md') } }));
    expect(row('Moss').querySelector('input')).not.toBeNull();
    expect(row('Fern').querySelector('input')).toBeNull();
  });
});
