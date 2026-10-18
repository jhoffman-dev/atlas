// @vitest-environment jsdom
/**
 * Focusing a row the Today page has not put in the DOM (#238): it is asked
 * for, and it takes the focus as it is drawn.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { createVaultPath } from '@atlas/domain';
import { useRowFocus } from './today-row-focus.ts';

const first = createVaultPath('Tasks/First.md');
const far = createVaultPath('Tasks/Far.md');

function mounted(): HTMLInputElement {
  const box = document.createElement('input');
  box.type = 'checkbox';
  document.body.append(box);
  return box;
}

describe('useRowFocus — a row not in the DOM', () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  it('focuses a row in the DOM at once, wanting none', () => {
    const { result } = renderHook(() =>
      useRowFocus({ order: [first, far], shown: {}, problem: null }),
    );
    const box = mounted();
    result.current.rowRef(first)(box);

    act(() => result.current.focusRow(first));

    expect(document.activeElement).toBe(box);
    expect(result.current.wanted).toBeNull();
  });

  it('wants a row that is not drawn, and focuses it once it is', () => {
    const { result } = renderHook(() =>
      useRowFocus({ order: [first, far], shown: {}, problem: null }),
    );

    act(() => result.current.focusRow(far));
    expect(result.current.wanted).toBe(far);

    const box = mounted();
    act(() => result.current.rowRef(far)(box));

    expect(document.activeElement).toBe(box);
    expect(result.current.wanted).toBeNull();
  });

  it('does not focus another row drawn while one is wanted', () => {
    const { result } = renderHook(() =>
      useRowFocus({ order: [first, far], shown: {}, problem: null }),
    );
    act(() => result.current.focusRow(far));

    const other = mounted();
    act(() => result.current.rowRef(first)(other));

    expect(document.activeElement).not.toBe(other);
    expect(result.current.wanted).toBe(far);
  });

  it('leaves the focus on a control the person put it on before the wanted row is drawn', () => {
    const { result } = renderHook(() =>
      useRowFocus({ order: [first, far], shown: {}, problem: null }),
    );
    act(() => result.current.focusRow(far));
    const theirs = mounted();
    theirs.focus();

    const box = mounted();
    act(() => result.current.rowRef(far)(box));

    expect(document.activeElement).toBe(theirs);
    expect(result.current.wanted).toBeNull();
  });

  it('forgets a wanted row that leaves the order, so it takes no focus when it comes back', () => {
    const { result, rerender } = renderHook(
      ({ order }) => useRowFocus({ order, shown: {}, problem: null }),
      { initialProps: { order: [first, far] } },
    );
    act(() => result.current.focusRow(far));
    rerender({ order: [first] });
    expect(result.current.wanted).toBeNull();

    rerender({ order: [first, far] });
    const box = mounted();
    act(() => result.current.rowRef(far)(box));

    expect(document.activeElement).not.toBe(box);
  });

  it('wants no row that is not in the order', () => {
    const { result } = renderHook(() => useRowFocus({ order: [first], shown: {}, problem: null }));

    act(() => result.current.focusRow(far));

    expect(result.current.wanted).toBeNull();
  });
});

describe('useRowFocus — a row that leaves while its action is under way (#260)', () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  it('focuses the next row once the action is done, when its controls can take the focus', () => {
    const next = mounted();
    next.disabled = true;
    const { result, rerender } = renderHook(
      ({ order, busy }) => useRowFocus({ order, shown: { order }, problem: null, busy }),
      { initialProps: { order: [first, far], busy: false } },
    );
    act(() => result.current.rowRef(far)(next));
    act(() => result.current.actedOn(first));

    // The row leaves at once, while every row's controls wait for its write.
    rerender({ order: [far], busy: true });
    expect(document.activeElement).not.toBe(next);

    next.disabled = false;
    rerender({ order: [far], busy: false });
    expect(document.activeElement).toBe(next);
  });
});
