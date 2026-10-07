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

  it('goes by itself after a while', () => {
    vi.useFakeTimers();
    const onDismiss = vi.fn();
    render(<Toast message="Task added" onDismiss={onDismiss} />);

    act(() => vi.advanceTimersByTime(5000));
    expect(onDismiss).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(2000));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('waits while the pointer is on it, then gives the full time again', () => {
    vi.useFakeTimers();
    const onDismiss = vi.fn();
    render(<Toast message="Task added" onDismiss={onDismiss} />);

    act(() => vi.advanceTimersByTime(5000));
    fireEvent.pointerEnter(screen.getByRole('status'));
    act(() => vi.advanceTimersByTime(60_000));
    expect(onDismiss).not.toHaveBeenCalled();

    fireEvent.pointerLeave(screen.getByRole('status'));
    act(() => vi.advanceTimersByTime(5000));
    expect(onDismiss).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(2000));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('waits while the focus is on its action, as a keyboard reaches it', () => {
    vi.useFakeTimers();
    const onDismiss = vi.fn();
    render(
      <Toast
        message="Task added"
        action={{ label: 'Open', onClick: vi.fn() }}
        onDismiss={onDismiss}
      />,
    );

    act(() => screen.getByRole('button', { name: 'Open' }).focus());
    act(() => vi.advanceTimersByTime(60_000));
    expect(onDismiss).not.toHaveBeenCalled();

    act(() => screen.getByRole('button', { name: 'Open' }).blur());
    act(() => vi.advanceTimersByTime(7000));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
