// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { createVaultPath } from '@atlas/domain';
import {
  createAsideStore,
  focusRow,
  hideAside,
  loadVaultAside,
  selectAsideTab,
  showAsideTab,
  toggleAside,
  toggleClaude,
  useAsideOpen,
  useClaudeShown,
  useFocusedRow,
  withinOf,
  type RememberedAside,
  type RememberedAsides,
} from './aside-store.ts';

/** A remembered store over a map, with the writes counted. */
function remembering(initial: Record<string, RememberedAside> = {}) {
  const held = new Map(Object.entries(initial));
  const remembered: RememberedAsides = {
    read: vi.fn((vaultKey: string) => held.get(vaultKey) ?? null),
    write: vi.fn(({ vaultKey, aside }) => {
      held.set(vaultKey, aside);
    }),
  };
  return { remembered, held };
}

const task = createVaultPath('Tasks/Ship it.md');
const book = createVaultPath('Books/Dune.md');

describe('the aside store', () => {
  it('opens a vault with nothing remembered shut, on Properties', () => {
    const store = createAsideStore(remembering());
    loadVaultAside(store, '/v');
    expect(store.getState()).toMatchObject({ vault: '/v', open: false, tab: 'properties' });
  });

  it('reads what the vault remembered, and the other vault its own', () => {
    const store = createAsideStore(
      remembering({
        '/a': { open: true, tab: 'outline' },
        '/b': { open: false, tab: 'claude' },
      }),
    );
    loadVaultAside(store, '/a');
    expect(store.getState()).toMatchObject({ open: true, tab: 'outline' });
    loadVaultAside(store, '/b');
    expect(store.getState()).toMatchObject({ open: false, tab: 'claude' });
  });

  it('remembers a toggle and a tab change under the open vault, and nothing with no vault', () => {
    const { remembered, held } = remembering();
    const store = createAsideStore({ remembered });
    toggleAside(store);
    expect(remembered.write).not.toHaveBeenCalled();

    loadVaultAside(store, '/v');
    toggleAside(store);
    expect(held.get('/v')).toEqual({ open: true, tab: 'properties' });
    selectAsideTab(store, 'backlinks');
    expect(held.get('/v')).toEqual({ open: true, tab: 'backlinks' });
    hideAside(store);
    expect(held.get('/v')).toEqual({ open: false, tab: 'backlinks' });
  });

  it('writes nothing for a change that changes nothing', () => {
    const { remembered } = remembering();
    const store = createAsideStore({ remembered });
    loadVaultAside(store, '/v');
    hideAside(store);
    selectAsideTab(store, 'properties');
    expect(remembered.write).not.toHaveBeenCalled();
  });

  it('opening the vault already open changes nothing', () => {
    const { remembered } = remembering();
    const store = createAsideStore({ remembered });
    loadVaultAside(store, '/v');
    toggleAside(store);
    loadVaultAside(store, '/v');
    expect(store.getState().open).toBe(true);
    expect(remembered.read).toHaveBeenCalledTimes(1);
  });

  it('⌘J brings the aside up on Claude, and takes it down from Claude only', () => {
    const store = createAsideStore(remembering());
    loadVaultAside(store, '/v');
    const { result } = renderHook(() => useClaudeShown(store));
    expect(result.current).toBe(false);

    toggleClaude(store);
    expect(store.getState()).toMatchObject({ open: true, tab: 'claude' });
    toggleClaude(store);
    expect(store.getState().open).toBe(false);

    // Open on Properties, ⌘J shows Claude rather than closing.
    showAsideTab(store, 'properties');
    toggleClaude(store);
    expect(store.getState()).toMatchObject({ open: true, tab: 'claude' });
  });

  it('holds the focused row by tab, against the page it was focused on', () => {
    const store = createAsideStore(remembering());
    loadVaultAside(store, '/v');
    focusRow(store, { tab: 't1', path: task, within: 'type:task' });

    const onPage = renderHook(() => useFocusedRow(store, { tab: 't1', within: 'type:task' }));
    expect(onPage.result.current).toBe(task);
    const movedOn = renderHook(() => useFocusedRow(store, { tab: 't1', within: book }));
    expect(movedOn.result.current).toBeNull();
    const otherTab = renderHook(() => useFocusedRow(store, { tab: 't2', within: 'type:task' }));
    expect(otherTab.result.current).toBeNull();
  });

  it('the same row focused again does not change the state', () => {
    const store = createAsideStore(remembering());
    focusRow(store, { tab: 't1', path: task, within: 'type:task' });
    const before = store.getState();
    focusRow(store, { tab: 't1', path: task, within: 'type:task' });
    expect(store.getState()).toBe(before);
    focusRow(store, { tab: 't1', path: book, within: 'type:task' });
    expect(store.getState().rows.get('t1')?.path).toBe(book);
  });

  it('another vault starts with no focused rows', () => {
    const store = createAsideStore(remembering());
    loadVaultAside(store, '/a');
    focusRow(store, { tab: 't1', path: task, within: 'type:task' });
    loadVaultAside(store, '/b');
    expect(store.getState().rows.size).toBe(0);
  });

  it('a subscriber to open is not told of a row focus', () => {
    const store = createAsideStore(remembering());
    const { result } = renderHook(() => useAsideOpen(store));
    const seen = result.current;
    focusRow(store, { tab: 't1', path: task, within: 'type:task' });
    expect(result.current).toBe(seen);
  });

  it('names the page a table is on', () => {
    expect(withinOf({ kind: 'note', path: task })).toBe(task);
    expect(withinOf({ kind: 'type', name: 'task' })).toBe('type:task');
    expect(withinOf({ kind: 'today' })).toBe('today');
    expect(withinOf(null)).toBeNull();
  });
});
