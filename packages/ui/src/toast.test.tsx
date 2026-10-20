// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { Toast } from './toast.tsx';

afterEach(() => {
  vi.useRealTimers();
});

describe('Toast', () => {
  it('says what happened, and does its one action', () => {
    const onClick = vi.fn();
    const onDismiss = vi.fn();
    render(
      <Toast message="Task added" action={{ label: 'Open', onClick }} onDismiss={onDismiss} />,
    );

    expect(screen.getByRole('status').textContent).toContain('Task added');
    fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    expect(onClick).toHaveBeenCalled();
    expect(onDismiss).toHaveBeenCalled();
  });

  it('offers Undo for a change, which undoes and then goes', () => {
    const onUndo = vi.fn();
    const onDismiss = vi.fn();
    render(<Toast message="Moved to Done" onUndo={onUndo} onDismiss={onDismiss} />);

    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(onUndo).toHaveBeenCalledTimes(1);
    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(onUndo.mock.invocationCallOrder[0]).toBeLessThan(onDismiss.mock.invocationCallOrder[0]!);
  });

  it('has no Undo unless there is something to undo', () => {
    render(<Toast message="Task added" onDismiss={vi.fn()} />);
    expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull();
  });

  it('is sent away by its ×, without doing anything else', () => {
    const onUndo = vi.fn();
    const onDismiss = vi.fn();
    render(<Toast message="Moved to Done" onUndo={onUndo} onDismiss={onDismiss} />);

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(onUndo).not.toHaveBeenCalled();
  });

  it('goes by itself after five seconds', () => {
    vi.useFakeTimers();
    const onDismiss = vi.fn();
    render(<Toast message="Task added" onDismiss={onDismiss} />);

    act(() => vi.advanceTimersByTime(4999));
    expect(onDismiss).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('waits while the pointer is on it, then gives the full time again', () => {
    vi.useFakeTimers();
    const onDismiss = vi.fn();
    render(<Toast message="Task added" onDismiss={onDismiss} />);

    act(() => vi.advanceTimersByTime(4000));
    fireEvent.pointerEnter(screen.getByRole('status'));
    act(() => vi.advanceTimersByTime(60_000));
    expect(onDismiss).not.toHaveBeenCalled();

    fireEvent.pointerLeave(screen.getByRole('status'));
    act(() => vi.advanceTimersByTime(4999));
    expect(onDismiss).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('waits while the focus is on a button of its, as a keyboard reaches it', () => {
    vi.useFakeTimers();
    const onDismiss = vi.fn();
    render(<Toast message="Moved to Done" onUndo={vi.fn()} onDismiss={onDismiss} />);

    act(() => screen.getByRole('button', { name: 'Undo' }).focus());
    act(() => vi.advanceTimersByTime(60_000));
    expect(onDismiss).not.toHaveBeenCalled();

    // Focus moving from Undo to the × stays inside the toast, so it still waits.
    act(() => screen.getByRole('button', { name: 'Dismiss' }).focus());
    act(() => vi.advanceTimersByTime(60_000));
    expect(onDismiss).not.toHaveBeenCalled();

    act(() => screen.getByRole('button', { name: 'Dismiss' }).blur());
    act(() => vi.advanceTimersByTime(5000));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});

describe('Toast — reached by Tab in WebKit (#468)', () => {
  // WebKit, and so the app's webview, Tabs only to a button that says it is
  // in the tab order: without the attribute, Tab never reaches an Undo.
  it('puts each of its buttons in the tab order by name', () => {
    render(
      <Toast
        message="Changed “Order chairs”."
        tone="change"
        onUndo={() => {}}
        action={{ label: 'Open', onClick: () => {} }}
        onDismiss={() => {}}
      />,
    );
    for (const name of ['Undo', 'Open', 'Dismiss']) {
      expect(screen.getByRole('button', { name }).getAttribute('tabindex')).toBe('0');
    }
  });
});
