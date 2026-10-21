// @vitest-environment jsdom
/**
 * Attack on #250 / PR #251: a keyboard open of a row's "…" puts the focus on
 * the menu's first enabled item one frame after the menu mounts. These tests
 * try the edges: disabled items, a close before the frame, mixed pointer and
 * keyboard opens, a rename under way, and the row going away underneath.
 */
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createVaultPath, type SidebarTreeRow, type VaultEntry } from '@dfai/domain';
import { VaultTree, type TreeEditing } from './vault-tree.tsx';
import { startCountingRenders, stopCountingRenders } from './testing/render-counter.ts';
import type { MenuCommand } from './menu-items.tsx';

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

const ROWS = ['DFAI', 'Budget', 'Garden', 'Ledger'].map(noteRow);

const twoItems = (entry: VaultEntry): MenuCommand[] => [
  { label: 'Rename', onSelect: () => {} },
  { label: `Duplicate ${entry.name}`, onSelect: () => {} },
];

function tree({
  rows = ROWS,
  editing = {},
}: { rows?: readonly SidebarTreeRow[]; editing?: Partial<TreeEditing> } = {}) {
  return (
    <VaultTree
      rows={rows}
      open={new Set()}
      starred={new Set()}
      onToggleDirectory={() => {}}
      onSelectFile={() => {}}
      onToggleFavorite={() => {}}
      editing={{
        menuFor: twoItems,
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

const more = (name: string) => screen.getByRole('button', { name: `Options for ${name}` });
/** Two frames: FocusFirstItem's, and Base UI's own initial focus after it. */
const frames = async () => {
  await new Promise((resolve) => requestAnimationFrame(resolve));
  await new Promise((resolve) => requestAnimationFrame(resolve));
};
const focusedItem = () =>
  document.activeElement instanceof HTMLElement &&
  document.activeElement.getAttribute('role') === 'menuitem'
    ? document.activeElement
    : null;

describe('a row menu opened from the keyboard — which item it lands on', () => {
  it('skips a disabled first item and lands on the first enabled one', async () => {
    render(
      tree({
        editing: {
          menuFor: () => [
            { label: 'New folder', onSelect: () => {}, disabled: true },
            { label: 'Rename', onSelect: () => {} },
          ],
        },
      }),
    );
    more('Ledger').focus();
    await userEvent.keyboard('{Enter}');
    const menu = await screen.findByRole('menu', { name: 'Page' });
    await waitFor(() =>
      expect(document.activeElement).toBe(within(menu).getByRole('menuitem', { name: 'Rename' })),
    );
  });

  it('keeps the focus inside the menu when every item is disabled', async () => {
    render(
      tree({
        editing: {
          menuFor: () => [
            { label: 'Rename', onSelect: () => {}, disabled: true },
            { label: 'Delete…', onSelect: () => {}, disabled: true, destructive: true },
          ],
        },
      }),
    );
    more('Ledger').focus();
    await userEvent.keyboard('{Enter}');
    const menu = await screen.findByRole('menu', { name: 'Page' });
    await frames();
    expect(menu.contains(document.activeElement)).toBe(true);
    expect(document.activeElement).not.toBe(document.body);
  });
});

describe('a row menu opened from the keyboard — closing and opening again', () => {
  it('never focuses an item of a menu shut before its first frame', async () => {
    render(tree());
    more('Ledger').focus();
    // Enter and Escape in one go, before any frame has run.
    fireEvent.click(more('Ledger'), { detail: 0 });
    expect(screen.getByRole('menu', { name: 'Page' })).toBeDefined();
    // On the document, where Base UI listens: the "…" itself stops a key's propagation.
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
    await frames();
    expect(focusedItem()).toBeNull();
    expect(document.activeElement).not.toBe(document.body);
  });

  it('opens on the menu box after a keyboard open, when the next open is a click', async () => {
    render(tree());
    more('Ledger').focus();
    await userEvent.keyboard('{Enter}');
    await screen.findByRole('menu', { name: 'Page' });
    await waitFor(() => expect(focusedItem()).not.toBeNull());
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());

    await userEvent.click(more('Budget'));
    const menu = await screen.findByRole('menu', { name: 'Page' });
    await frames();
    expect(document.activeElement).toBe(menu);
  });

  it('opens on the first item from the keyboard after a right-click open', async () => {
    render(tree());
    await userEvent.pointer({
      keys: '[MouseRight]',
      target: screen.getByRole('treeitem', { name: 'Budget' }),
    });
    await screen.findByRole('menu', { name: 'Page' });
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());

    more('Ledger').focus();
    await userEvent.keyboard('{Enter}');
    const menu = await screen.findByRole('menu', { name: 'Page' });
    await waitFor(() =>
      expect(document.activeElement).toBe(within(menu).getByRole('menuitem', { name: 'Rename' })),
    );
  });

  it('gives the focus back to the row after Shift+F10 then Escape', async () => {
    render(tree());
    const row = screen.getByRole('treeitem', { name: 'Ledger' });
    row.focus();
    await userEvent.keyboard('{Shift>}{F10}{/Shift}');
    await waitFor(() => expect(focusedItem()).not.toBeNull());
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
    expect(document.activeElement).toBe(row);
  });

  it('opens on the first item from the keyboard while another row is being renamed', async () => {
    render(tree({ editing: { renaming: createVaultPath('Budget.md') } }));
    more('Ledger').focus();
    await userEvent.keyboard('{Enter}');
    const menu = await screen.findByRole('menu', { name: 'Page' });
    await waitFor(() =>
      expect(document.activeElement).toBe(within(menu).getByRole('menuitem', { name: 'Rename' })),
    );
  });
});

describe('a row menu opened from the keyboard — the row going away underneath', () => {
  it('does not drop the focus on the page when its row is removed and the menu is shut', async () => {
    const view = render(tree());
    more('Ledger').focus();
    await userEvent.keyboard('{Enter}');
    const menu = await screen.findByRole('menu', { name: 'Page' });
    await waitFor(() => expect(menu.contains(document.activeElement)).toBe(true));
    // A watcher refresh: Ledger was deleted on disk while its menu was up.
    view.rerender(tree({ rows: ROWS.filter((row) => row.label !== 'Ledger') }));
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
    expect(document.activeElement).not.toBe(document.body);
  });

  it('does not offer commands for a row that is no longer in the tree', async () => {
    const view = render(tree());
    more('Ledger').focus();
    await userEvent.keyboard('{Enter}');
    expect(await screen.findByRole('menuitem', { name: 'Duplicate Ledger.md' })).toBeDefined();
    view.rerender(tree({ rows: ROWS.filter((row) => row.label !== 'Ledger') }));
    await frames();
    expect(screen.queryByRole('menuitem', { name: 'Duplicate Ledger.md' })).toBeNull();
  });
});

describe('a row menu — what opening it draws', () => {
  it('draws no row again for a keyboard open that follows a right-click open', async () => {
    render(tree());
    // The right-click presses the row, which moves the tab order to it and so
    // draws two rows; that is the row's own change, so it is left uncounted.
    await userEvent.pointer({
      keys: '[MouseRight]',
      target: screen.getByRole('treeitem', { name: 'Budget' }),
    });
    await screen.findByRole('menu', { name: 'Page' });
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
    more('Ledger').focus();
    startCountingRenders();
    await userEvent.keyboard('{Enter}');
    await waitFor(() => expect(focusedItem()).not.toBeNull());
    const { renders } = stopCountingRenders();
    expect(renders['EntryMenu'] ?? 0).toBeGreaterThan(0);
    expect({ rows: renders['VaultTreeRow'] ?? 0, more: renders['MoreButton'] ?? 0 }).toEqual({
      rows: 0,
      more: 0,
    });
  });
});
