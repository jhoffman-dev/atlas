// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useChosenPeople } from './use-chosen-people.ts';

describe('people chosen in the Person table', () => {
  it('offers Merge into… for the rows chosen, says them to ⌘K, and lets go on leaving', () => {
    const merge = { mergeMany: vi.fn(), noteChosen: vi.fn() };
    const { result, unmount } = renderHook(() => useChosenPeople({ resetKey: 'person', merge }));
    expect(result.current?.actions).toEqual([]);
    act(() => result.current?.selection.onToggle('Mara.md'));
    expect(result.current?.actions.map((action) => action.label)).toEqual(['Merge into…']);
    act(() => result.current?.selection.onToggle('Inbox/Marra Quill.md'));
    expect(result.current?.actions.map((action) => action.label)).toEqual(['Merge 2 people into…']);
    expect(merge.noteChosen).toHaveBeenLastCalledWith(['Mara.md', 'Inbox/Marra Quill.md']);
    act(() => result.current?.actions[0]?.onRun());
    expect(merge.mergeMany).toHaveBeenCalledWith(['Mara.md', 'Inbox/Marra Quill.md']);
    unmount();
    expect(merge.noteChosen).toHaveBeenLastCalledWith([]);
  });

  it('is nothing for a table that is not of people', () => {
    const { result } = renderHook(() => useChosenPeople({ resetKey: 'task', merge: null }));
    expect(result.current).toBeNull();
  });
});
