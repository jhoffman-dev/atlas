// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { createToasts, MAX_TOASTS } from './toasts.ts';
import { ToastHost } from './toast-host.tsx';

/** #320: the window's toasts — a queue held outside the pages, five seconds each, with Undo. */
afterEach(() => {
  vi.useRealTimers();
});

const said = (toasts: ReturnType<typeof createToasts>) =>
  toasts.store.getState().toasts.map((toast) => toast.message);

describe('the toasts', () => {
  it('queues each toast shown, oldest first, each with its own id', () => {
    const toasts = createToasts();
    const first = toasts.show({ message: 'Finished “Water the beds”.', tone: 'change' });
    const second = toasts.show({ message: 'Finished “Water the beds”.', tone: 'change' });
    expect(first).not.toBe(second);
    expect(said(toasts)).toEqual(['Finished “Water the beds”.', 'Finished “Water the beds”.']);
  });

  it('keeps a few at most, letting the oldest go first', () => {
    const toasts = createToasts();
    const gone = vi.fn();
    toasts.show({ message: 'first', tone: 'change', onGone: gone });
    for (let at = 1; at <= MAX_TOASTS; at += 1)
      toasts.show({ message: `then ${at}`, tone: 'change' });
    expect(said(toasts)).toHaveLength(MAX_TOASTS);
    expect(said(toasts)).not.toContain('first');
    expect(gone).toHaveBeenCalledTimes(1);
  });

  it('puts a slot’s new toast in place of its last: one surface, one last change', () => {
    const toasts = createToasts();
    const gone = vi.fn();
    toasts.show({ message: 'Finished “A”.', tone: 'change', slot: 'today', onGone: gone });
    toasts.show({ message: 'Moved “B” to Done.', tone: 'change' });
    toasts.show({ message: 'Finished “C”.', tone: 'change', slot: 'today' });
    expect(said(toasts)).toEqual(['Moved “B” to Done.', 'Finished “C”.']);
    expect(gone).toHaveBeenCalledTimes(1);
  });

  it('says when a toast has gone, once, however it went', () => {
    const toasts = createToasts();
    const gone = vi.fn();
    const id = toasts.show({ message: 'x', tone: 'change', onGone: gone });
    toasts.dismiss(id);
    toasts.dismiss(id);
    expect(gone).toHaveBeenCalledTimes(1);
    expect(said(toasts)).toEqual([]);
  });
});

describe('ToastHost', () => {
  it('draws the queue, and Undo undoes that change and lets its toast go', () => {
    const toasts = createToasts();
    const undo = vi.fn();
    const activity = { record: vi.fn() };
    render(<ToastHost toasts={toasts} activity={activity} />);
    act(
      () =>
        void toasts.show({ message: 'Finished “Water the beds”.', tone: 'change', onUndo: undo }),
    );

    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));

    expect(undo).toHaveBeenCalledTimes(1);
    expect(said(toasts)).toEqual([]);
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('lets a toast go after five seconds', () => {
    vi.useFakeTimers();
    const toasts = createToasts();
    render(<ToastHost toasts={toasts} activity={{ record: vi.fn() }} />);
    act(() => void toasts.show({ message: 'Finished “A”.', tone: 'change' }));
    act(() => vi.advanceTimersByTime(4999));
    expect(said(toasts)).toHaveLength(1);
    act(() => vi.advanceTimersByTime(1));
    expect(said(toasts)).toEqual([]);
  });

  it('records a warning and an error in Activity as each appears, and never a change', () => {
    const toasts = createToasts();
    const activity = { record: vi.fn() };
    const { rerender } = render(<ToastHost toasts={toasts} activity={activity} />);
    act(() => {
      toasts.show({ message: 'Finished “A”.', tone: 'change' });
      toasts.show({
        message: '“A” has changed since, so the change was not undone.',
        tone: 'warning',
      });
      toasts.show({ message: 'The disk is full.', tone: 'error' });
    });
    rerender(<ToastHost toasts={toasts} activity={activity} />);

    expect(activity.record.mock.calls.map(([report]) => [report.level, report.message])).toEqual([
      ['warning', '“A” has changed since, so the change was not undone.'],
      ['error', 'The disk is full.'],
    ]);
  });
});
