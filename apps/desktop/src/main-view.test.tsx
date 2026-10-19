// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { createVaultPath } from '@atlas/domain';
import { useMainView } from './main-view.ts';
import {
  createWorkspaceStore,
  focusPane,
  loadVault,
  openPlace,
  splitPane,
  workspaceNow,
} from './workspace/workspace-store.ts';

function openOn() {
  const store = createWorkspaceStore({ remembered: { read: () => null, write: () => {} } });
  loadVault(store, '/v');
  return store;
}

const placesOf = (store: ReturnType<typeof openOn>) =>
  workspaceNow(store).panes.map((pane) => pane.tabs.map((tab) => tab.history.current));

describe('useMainView', () => {
  it('reports no page while the focused tab shows a note', () => {
    const store = openOn();
    openPlace(store, { kind: 'note', path: createVaultPath('a.md') }, 'here');
    const { result } = renderHook(() => useMainView(store));
    expect([result.current.openTypeName, result.current.graphScope]).toEqual([null, null]);
    expect(result.current.queryOpen).toBe(false);
    expect(result.current.todayOpen).toBe(false);
  });

  it('opens each page as the focused tab’s place, one in a tab at a time', () => {
    const store = openOn();
    const { result } = renderHook(() => useMainView(store));
    act(() => result.current.openType('task'));
    expect(result.current.openTypeName).toBe('task');
    act(() => result.current.openGraph({ kind: 'vault' }));
    expect(result.current.openTypeName).toBeNull();
    expect(result.current.graphScope).toEqual({ kind: 'vault' });
    act(() => result.current.openQuery());
    expect(result.current.graphScope).toBeNull();
    expect(result.current.queryOpen).toBe(true);
    act(() => result.current.openToday());
    expect(result.current.todayOpen).toBe(true);
    expect(placesOf(store)).toEqual([[{ kind: 'today' }]]);
  });

  it('opens a type on its notes unless asked for its editor, and switches between them', () => {
    const store = openOn();
    const { result } = renderHook(() => useMainView(store));
    act(() => result.current.openType('task', 'edit'));
    expect(result.current.typeMode).toBe('edit');
    act(() => result.current.setTypeMode('notes'));
    expect(result.current.typeMode).toBe('notes');
    act(() => result.current.openType('project'));
    expect([result.current.openTypeName, result.current.typeMode]).toEqual(['project', 'notes']);
  });

  it('reports a page the other pane shows, so its props are still assembled', () => {
    const store = openOn();
    const { result } = renderHook(() => useMainView(store));
    act(() => result.current.openInbox());
    act(() => splitPane(store));
    act(() => openPlace(store, { kind: 'note', path: createVaultPath('a.md') }, 'here'));
    expect(result.current.inboxOpen).toBe(true);
    // The focused pane's type wins over the other pane's.
    act(() => result.current.openType('task'));
    act(() => focusPane(store, 0));
    act(() => result.current.openType('person'));
    expect(result.current.openTypeName).toBe('person');
  });

  it('is not drawn again for a switch between notes', () => {
    const store = openOn();
    let drawn = 0;
    renderHook(() => {
      drawn += 1;
      return useMainView(store);
    });
    const before = drawn;
    act(() => openPlace(store, { kind: 'note', path: createVaultPath('a.md') }, 'here'));
    act(() => openPlace(store, { kind: 'note', path: createVaultPath('b.md') }, 'new-tab'));
    expect(drawn - before).toBe(0);
  });
});
