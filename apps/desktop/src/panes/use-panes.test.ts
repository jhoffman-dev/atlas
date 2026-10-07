// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { createVaultPath, type PaneLayout, type VaultPath } from '@atlas/domain';
import { usePanes, type PaneLayoutStore } from './use-panes.ts';

const VAULT = '/Users/j/Vault';
const today = createVaultPath('today.md');
const board = createVaultPath('.atlas/views/Board.md');

/** A store held in memory, standing in for the one backed by local storage. */
function fakeStore(remembered: Record<string, PaneLayout> = {}): PaneLayoutStore & {
  readonly written: Record<string, PaneLayout>;
} {
  const written: Record<string, PaneLayout> = {};
  return {
    written,
    read: (vaultKey) => remembered[vaultKey] ?? null,
    write: ({ vaultKey, layout }) => {
      written[vaultKey] = layout;
      remembered[vaultKey] = layout;
    },
  };
}

const show = (store: PaneLayoutStore, vaultKey: string | null = VAULT) =>
  renderHook(({ key }: { key: string | null }) => usePanes({ store, vaultKey: key }), {
    initialProps: { key: vaultKey },
  });

describe('usePanes', () => {
  it('starts as one empty pane when nothing is remembered', () => {
    const { result } = show(fakeStore());
    expect(result.current.layout.paths).toEqual([null]);
  });

  it('opens a note in the pane being worked in', () => {
    const { result } = show(fakeStore());

    act(() => result.current.openInFocusedPane(today));

    expect(result.current.layout.paths).toEqual([today]);
  });

  it('opens a link followed inside a pane in that pane, and works there from then on', () => {
    const { result } = show(fakeStore());
    act(() => result.current.openInFocusedPane(today));
    act(() => result.current.toggleSplit());

    // Pane 0 is not the focused one after a split; following a link in it
    // should still land there rather than in the pane that had the focus.
    act(() => result.current.openInPane({ pane: 0, path: board }));

    expect(result.current.layout.paths).toEqual([board, today]);
    expect(result.current.layout.focused).toBe(0);
  });

  it('refuses an open aimed at a pane that is no longer there', () => {
    const store = fakeStore();
    const { result } = show(store);
    act(() => result.current.openInFocusedPane(today));
    act(() => result.current.toggleSplit());
    act(() => result.current.openInPane({ pane: 1, path: board }));
    act(() => result.current.close(1));

    // Pane 1 has gone. Aiming at it used to focus nothing and then open in
    // whichever pane had the focus, so the note being read was replaced.
    act(() => result.current.openInPane({ pane: 1, path: createVaultPath('Elsewhere.md') }));

    expect(result.current.layout.paths).toEqual([today]);
    expect(store.written[VAULT]).toEqual({ paths: [today], focused: 0 });
  });

  it('closes the pane it is asked to close, and keeps the other one', () => {
    const { result } = show(fakeStore());
    act(() => result.current.openInFocusedPane(today));
    act(() => result.current.toggleSplit());
    act(() => result.current.openInPane({ pane: 1, path: board }));

    act(() => result.current.close(1));

    expect(result.current.layout.paths).toEqual([today]);
  });

  it('splits from the button, and leaves a split window as it is rather than closing a pane', () => {
    const { result } = show(fakeStore());
    act(() => result.current.openInFocusedPane(today));

    act(() => result.current.split(0));
    expect(result.current.layout.paths).toEqual([today, today]);
    expect(result.current.histories).toHaveLength(2);

    const before = result.current.layout;
    act(() => result.current.split(0));
    expect(result.current.layout).toBe(before);
    expect(result.current.histories).toHaveLength(2);
  });

  it('closes the pane being worked in when the shortcut is used on a split window', () => {
    const { result } = show(fakeStore());
    act(() => result.current.openInFocusedPane(today));
    act(() => result.current.toggleSplit());
    act(() => result.current.openInPane({ pane: 1, path: board }));

    act(() => result.current.toggleSplit());

    expect(result.current.layout.paths).toEqual([today]);
  });

  it('moves every pane showing a note onto its new name', () => {
    const { result } = show(fakeStore());
    act(() => result.current.openInFocusedPane(today));
    act(() => result.current.toggleSplit());

    act(() => result.current.followMove({ from: today, to: createVaultPath('Tomorrow.md') }));

    expect(result.current.layout.paths).toEqual([
      createVaultPath('Tomorrow.md'),
      createVaultPath('Tomorrow.md'),
    ]);
  });

  // React keys the panes by these: a pane keyed by its place would hand the
  // closed left pane's editor to the note that slid into its place.
  it('keeps the surviving pane its key when the pane before it closes', () => {
    const { result } = show(fakeStore());
    act(() => result.current.openInFocusedPane(today));
    act(() => result.current.split(0));
    const [, right] = result.current.keys;

    act(() => result.current.close(0));

    expect(result.current.keys).toEqual([right]);
  });

  it('gives a new pane a key no pane has had in this split', () => {
    const { result } = show(fakeStore());
    act(() => result.current.split(0));
    const [first, second] = result.current.keys;
    act(() => result.current.close(1));
    act(() => result.current.split(0));

    expect(result.current.keys).toHaveLength(2);
    expect(new Set([first, second, result.current.keys[1]]).size).toBe(3);
  });

  it('keeps the key of the pane left when a deleted note closes the other', () => {
    const { result } = show(fakeStore());
    act(() => result.current.openInFocusedPane(today));
    act(() => result.current.split(0));
    act(() => result.current.openInPane({ pane: 1, path: board }));
    const [, right] = result.current.keys;

    act(() => result.current.closeNotes([today]));

    expect(result.current.keys).toEqual([right]);
  });

  it('has a key for every pane of a remembered split', () => {
    const { result } = show(fakeStore({ [VAULT]: { paths: [today, board], focused: 1 } }));
    expect(result.current.keys).toHaveLength(2);
    expect(new Set(result.current.keys).size).toBe(2);
  });

  it('closes the pane on a deleted note and keeps the other', () => {
    const store = fakeStore();
    const { result } = show(store);
    act(() => result.current.openInFocusedPane(today));
    act(() => result.current.toggleSplit());
    act(() => result.current.openInPane({ pane: 1, path: board }));

    act(() => result.current.closeNotes([today]));

    expect(result.current.layout).toEqual({ paths: [board], focused: 0 });
  });

  it('writes every change through, so a restart finds the split as it was left', () => {
    const store = fakeStore();
    const { result } = show(store);

    act(() => result.current.openInFocusedPane(today));
    act(() => result.current.toggleSplit());
    act(() => result.current.openInPane({ pane: 1, path: board }));

    expect(store.written[VAULT]).toEqual({ paths: [today, board], focused: 1 });
  });

  it('opens the split that was remembered for this vault', () => {
    const store = fakeStore({ [VAULT]: { paths: [today, board], focused: 1 } });
    const { result } = show(store);
    expect(result.current.layout).toEqual({ paths: [today, board], focused: 1 });
  });

  it('leaves the split behind when another vault is opened', () => {
    const store = fakeStore({ [VAULT]: { paths: [today, board], focused: 1 } });
    const { result, rerender } = show(store);

    rerender({ key: '/Users/j/Other' });

    expect(result.current.layout.paths).toEqual([null]);
  });

  describe('every render, not only the last (R14-03)', () => {
    const OTHER = '/Users/j/Other';
    const elsewhere = createVaultPath('elsewhere.md');

    /** The layout each render handed out, beside the vault it was rendered for. */
    function watch(store: PaneLayoutStore, first: string | null) {
      const seen: { key: string | null; paths: readonly (VaultPath | null)[] }[] = [];
      const hook = renderHook(
        ({ key }: { key: string | null }) => {
          const view = usePanes({ store, vaultKey: key });
          seen.push({ key, paths: view.layout.paths });
          return view;
        },
        { initialProps: { key: first } },
      );
      return { seen, rerender: hook.rerender };
    }

    it('shows the remembered split on the very first render', () => {
      const store = fakeStore({ [VAULT]: { paths: [today, board], focused: 1 } });
      const { seen } = watch(store, VAULT);
      expect(seen[0]?.paths).toEqual([today, board]);
    });

    it("never renders one vault's panes under another's key", () => {
      const store = fakeStore({
        [VAULT]: { paths: [today, board], focused: 1 },
        [OTHER]: { paths: [elsewhere], focused: 0 },
      });
      const { seen, rerender } = watch(store, VAULT);

      rerender({ key: OTHER });
      rerender({ key: null });

      const afterSwitch = seen.filter(({ key }) => key === OTHER);
      expect(afterSwitch.length).toBeGreaterThan(0);
      expect(afterSwitch.every(({ paths }) => paths[0] === elsewhere)).toBe(true);
      const closed = seen.filter(({ key }) => key === null);
      expect(closed.length).toBeGreaterThan(0);
      expect(closed.every(({ paths }) => paths.length === 1 && paths[0] === null)).toBe(true);
    });

    it('starts Back and Forward afresh with the new vault, in the same render', () => {
      const store = fakeStore({ [VAULT]: { paths: [today, board], focused: 1 } });
      const hook = renderHook(({ key }: { key: string }) => usePanes({ store, vaultKey: key }), {
        initialProps: { key: VAULT },
      });
      act(() => hook.result.current.openInFocusedPane(today));

      hook.rerender({ key: OTHER });

      expect(hook.result.current.histories).toHaveLength(1);
      expect(hook.result.current.layout.paths).toEqual([null]);
    });
  });

  it('remembers nothing while no vault is open, since the paths would belong to none', () => {
    const store = fakeStore();
    const { result } = show(store, null);

    act(() => result.current.openInFocusedPane(today));

    expect(store.written).toEqual({});
  });
});
