// @vitest-environment jsdom
/**
 * The rows' shared menu at its edges (#250, PR #251): a key held from the "…",
 * Tab out of it, its row going away while it is up, and a close that comes
 * before its first frame.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createVaultPath, type SidebarTreeRow } from '@atlas/domain';
import { VaultTree, type TreeEditing } from './vault-tree.tsx';

const noteRow = (name: string): SidebarTreeRow => ({
  entry: { kind: 'file', name: `${name}.md`, path: createVaultPath(`${name}.md`) },
  depth: 0,
  isExpanded: false,
  isLoaded: true,
  label: name,
  icon: 'doc',
  opensArchive: false,
});

const ROWS = ['Atlas', 'Budget', 'Garden', 'Ledger'].map(noteRow);

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
        menuFor: () => [
          { label: 'New note here', onSelect: () => {} },
          { label: 'Rename', onSelect: () => {} },
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

const more = (name: string) => screen.getByRole('button', { name: `Options for ${name}` });

/** Opens Ledger's menu with Enter on its "…" and waits for the focus on the first item. */
async function openFromKeyboard(): Promise<HTMLElement> {
  more('Ledger').focus();
  await userEvent.keyboard('{Enter}');
  const menu = await screen.findByRole('menu', { name: 'Page' });
  const first = within(menu).getAllByRole('menuitem')[0];
  await waitFor(() => expect(document.activeElement).toBe(first));
  return menu;
}

afterEach(() => {
  vi.useRealTimers();
});

describe('a key held from the "…"', () => {
  it('runs no command on its repeats, and runs one on the next fresh press', async () => {
    const newNote = vi.fn();
    render(tree({ editing: { menuFor: () => [{ label: 'New note here', onSelect: newNote }] } }));
    await openFromKeyboard();
    const first = screen.getByRole('menuitem', { name: 'New note here' });

    fireEvent.keyDown(first, { key: 'Enter', repeat: true });
    fireEvent.keyDown(first, { key: ' ', repeat: true });
    fireEvent.keyDown(first, { key: 'Enter', repeat: true });
    expect(newNote).not.toHaveBeenCalled();
    expect(screen.getByRole('menu', { name: 'Page' })).toBeDefined();

    await userEvent.keyboard('{Enter}');
    expect(newNote).toHaveBeenCalledOnce();
  });

  it('lets an arrow held in the menu repeat once a fresh key has been pressed there', async () => {
    render(tree());
    const menu = await openFromKeyboard();
    const [first, second] = within(menu).getAllByRole('menuitem');
    fireEvent.keyDown(first!, { key: 'ArrowDown' });
    fireEvent.keyDown(second!, { key: 'ArrowDown', repeat: true });
    await waitFor(() => expect(document.activeElement).toBe(first));
  });
});

describe('Tab in the menu', () => {
  it.each(['{Tab}', '{Shift>}{Tab}{/Shift}'])(
    'shuts it on %s and gives the focus back to the "…"',
    async (keys) => {
      render(tree());
      await openFromKeyboard();
      await userEvent.keyboard(keys);
      await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
      expect(document.activeElement).toBe(more('Ledger'));
    },
  );
});

describe('the row going away while its menu is up', () => {
  it('shuts the menu and puts the focus on the row that took its place', async () => {
    const onMenuOpenChange = vi.fn();
    const view = render(tree({ editing: { onMenuOpenChange } }));
    more('Budget').focus();
    await userEvent.keyboard('{Enter}');
    await screen.findByRole('menu', { name: 'Page' });

    view.rerender(
      tree({ rows: ROWS.filter((row) => row.label !== 'Budget'), editing: { onMenuOpenChange } }),
    );
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
    expect(onMenuOpenChange).toHaveBeenLastCalledWith(false);
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole('treeitem', { name: 'Garden' })),
    );
  });

  it('puts the focus on the last row when the last row went', async () => {
    const view = render(tree());
    await openFromKeyboard();
    view.rerender(tree({ rows: ROWS.filter((row) => row.label !== 'Ledger') }));
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole('treeitem', { name: 'Garden' })),
    );
  });
});

describe('a menu shut before its first frame', () => {
  it('focuses none of its items when the frame comes, though it is still fading out', () => {
    vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame'] });
    // An exit animation that has not finished keeps the shut popup, and its
    // items, in the page, as the stylesheet's fade does in the app. jsdom has
    // no Web Animations, so the method is added for this test alone.
    const running = { finished: new Promise<never>(() => {}) } as unknown as Animation;
    Object.defineProperty(HTMLElement.prototype, 'getAnimations', {
      configurable: true,
      value: () => [running],
    });
    try {
      const view = render(tree());
      more('Ledger').focus();
      fireEvent.click(more('Ledger'), { detail: 0 });
      // The app shuts it before any frame has run: another overlay took over
      // (the one-overlay rule), so the entry is still the menu's.
      view.rerender(tree({ editing: { menuOpen: false } }));
      expect(document.querySelectorAll('[role="menuitem"]').length).toBeGreaterThan(0);
      act(() => {
        vi.advanceTimersToNextFrame();
      });
      expect(document.activeElement?.getAttribute('role')).not.toBe('menuitem');
    } finally {
      Reflect.deleteProperty(HTMLElement.prototype, 'getAnimations');
    }
  });
});
