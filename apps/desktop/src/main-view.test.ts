// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useMainView } from './main-view.ts';

describe('useMainView', () => {
  it('shows the panes until a page is opened over them', () => {
    const { result } = renderHook(() => useMainView());
    expect(result.current.view).toEqual({ kind: 'panes' });
    expect([result.current.openTypeName, result.current.graphScope]).toEqual([null, null]);
    expect(result.current.queryOpen).toBe(false);
  });

  it('holds one page at a time: opening one leaves the one before', () => {
    const { result } = renderHook(() => useMainView());
    act(() => result.current.openType('task'));
    expect(result.current.openTypeName).toBe('task');
    act(() => result.current.openGraph({ kind: 'vault' }));
    expect(result.current.openTypeName).toBeNull();
    expect(result.current.graphScope).toEqual({ kind: 'vault' });
    act(() => result.current.openQuery());
    expect(result.current.graphScope).toBeNull();
    expect(result.current.queryOpen).toBe(true);
    act(() => result.current.showPanes());
    expect(result.current.view).toEqual({ kind: 'panes' });
  });

  it('opens a type on its notes unless asked for its editor, and switches between them', () => {
    const { result } = renderHook(() => useMainView());
    act(() => result.current.openType('task', 'edit'));
    expect(result.current.typeMode).toBe('edit');
    act(() => result.current.setTypeMode('notes'));
    expect(result.current.typeMode).toBe('notes');
    act(() => result.current.openType('project'));
    expect(result.current.view).toEqual({ kind: 'type', name: 'project', mode: 'notes' });
  });

  it('changes no mode while no type is open', () => {
    const { result } = renderHook(() => useMainView());
    act(() => result.current.setTypeMode('edit'));
    expect(result.current.view).toEqual({ kind: 'panes' });
  });
});
