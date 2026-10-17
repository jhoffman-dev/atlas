// @vitest-environment jsdom
/**
 * How much Pages draws again (#238): the sidebar is drawn again for
 * everything the window does — opening a note, every key typed in ⌘K — with
 * its handlers made anew each time. A row draws again only for a change of
 * its own, and the one menu every row's "…" opens still works from the first
 * key pressed, with the latest handlers.
 */
import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createVaultPath, type SidebarTreeRow, type VaultEntry } from '@atlas/domain';
import { VaultTree, type TreeEditing } from './vault-tree.tsx';
import { startCountingRenders, stopCountingRenders } from './testing/render-counter.ts';

// Before React loads, so every commit is handed to the counter.
await vi.hoisted(async () => {
  const { installRenderCounter } = await import('./testing/render-counter.ts');
  installRenderCounter();
});

const noteRow = (name: string): SidebarTreeRow => ({
  entry: { kind: 'file', name: `${name}.md`, path: createVaultPath(`${name}.md`) },
  depth: 0,
  isExpanded: false,
  isLoaded: true,
  label: name,
  icon: 'doc',
  opensArchive: false,
});

const ROWS = ['Atlas', 'Budget', 'Garden', 'Harbour', 'Ledger', 'Orchard'].map(noteRow);

/** Pages as the app hands it over: every handler, the sets and the editing made again on each render. */
function tree({
  open = [],
  editing = {},
  onSelectFile = () => {},
}: {
  open?: readonly string[];
  editing?: Partial<TreeEditing>;
  onSelectFile?: (path: string) => void;
} = {}) {
  return (
    <VaultTree
      rows={ROWS}
      open={new Set(open)}
      starred={new Set(['Garden.md'])}
      onToggleDirectory={() => {}}
      onSelectFile={onSelectFile}
      onToggleFavorite={() => {}}
      editing={{
        menuFor: (entry: VaultEntry) => [
          { label: 'Rename', onSelect: () => {} },
          { label: `Duplicate ${entry.name}`, onSelect: () => {} },
        ],
        menuOpen: true,
        onMenuOpenChange: () => {},
        renaming: null,
        onRename: () => {},
        onCancelRename: () => {},
        canDrop: () => true,
        onDrop: () => {},
        ...editing,
      }}
    />
  );
}

/** How many of each `act` drew. */
function drawnBy(act: () => void): { rows: number; more: number } {
  startCountingRenders();
  act();
  const { renders } = stopCountingRenders();
  return { rows: renders['VaultTreeRow'] ?? 0, more: renders['MoreButton'] ?? 0 };
}

describe('VaultTree — what one commit draws', () => {
  it('draws no row again for a commit that changes nothing in the tree', () => {
    const view = render(tree());
    expect(screen.getAllByRole('treeitem')).toHaveLength(ROWS.length);
    const drawn = drawnBy(() => {
      view.rerender(tree());
      view.rerender(tree());
    });
    expect(drawn).toEqual({ rows: 0, more: 0 });
  });

  it('draws the one row a note opened in', () => {
    const view = render(tree({ open: ['Atlas.md'] }));
    const drawn = drawnBy(() => view.rerender(tree({ open: ['Atlas.md', 'Ledger.md'] })));
    expect(drawn.rows).toBe(1);
    expect(screen.getByRole('treeitem', { name: 'Ledger' }).getAttribute('aria-selected')).toBe(
      'true',
    );
  });

  it('draws the one row being named in place', () => {
    const view = render(tree());
    const drawn = drawnBy(() =>
      view.rerender(tree({ editing: { renaming: createVaultPath('Budget.md') } })),
    );
    expect(drawn.rows).toBe(1);
    expect(screen.getByRole('textbox', { name: 'Name for Budget' })).toBeDefined();
  });

  it('opens with the latest handler, though the rows were not drawn again for it', async () => {
    const first = vi.fn();
    const latest = vi.fn();
    const view = render(tree({ onSelectFile: first }));
    view.rerender(tree({ onSelectFile: latest }));
    await userEvent.click(screen.getByRole('treeitem', { name: 'Harbour' }));
    expect(first).not.toHaveBeenCalled();
    expect(latest).toHaveBeenCalledWith('Harbour.md');
  });
});

/**
 * The rows share one menu, built once beside the tree rather than once a row,
 * so there is no per-row menu to build lazily: a row's "…" is a plain button
 * that opens it. These hold what that already does from the keyboard.
 */
describe('VaultTree — a row’s menu from the keyboard', () => {
  const more = (name: string) => screen.getByRole('button', { name: `Options for ${name}` });

  it.each(['{Enter}', ' '])(
    'opens on the first %s, keeps the focus in it, and Escape gives it back to the "…"',
    async (key) => {
      render(tree());
      more('Ledger').focus();
      await userEvent.keyboard(key);
      const menu = await screen.findByRole('menu', { name: 'Page' });
      expect(within(menu).getByRole('menuitem', { name: 'Duplicate Ledger.md' })).toBeDefined();
      await waitFor(() => expect(menu.contains(document.activeElement)).toBe(true));
      await userEvent.keyboard('{ArrowDown}');
      expect(document.activeElement).toBe(within(menu).getByRole('menuitem', { name: 'Rename' }));

      await userEvent.keyboard('{Escape}');
      await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
      expect(document.activeElement).toBe(more('Ledger'));
    },
  );
});
