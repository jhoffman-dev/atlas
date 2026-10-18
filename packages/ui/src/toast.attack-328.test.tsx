// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { Toast } from './toast.tsx';
import { TOAST_MS } from './dismiss-after.ts';

/**
 * PR #328 (UI v2 slice 2) under attack: the Toast's hold, its buttons, and
 * what it hands a screen reader.
 */

afterEach(() => {
  vi.useRealTimers();
});

/**
 * A caller like app.tsx's Granola toast: the words and a count of how many
 * times they were said, the Toast keyed by that count, and "say it" as the
 * way a new report arrives. The same words with no new key are the same
 * props, and a component cannot tell a re-render from a second showing — so
 * the count is the caller's part of the contract (use-granola-pull's
 * `toastShown`).
 */
function SaysAgain({ onDismiss }: { onDismiss: () => void }) {
  const [said, setSaid] = useState<{ readonly words: string; readonly shown: number } | null>({
    words: '1 meeting pulled',
    shown: 1,
  });
  return (
    <>
      <button
        type="button"
        onClick={() =>
          setSaid((before) => ({ words: '1 meeting pulled', shown: (before?.shown ?? 0) + 1 }))
        }
      >
        say it
      </button>
      {said !== null && (
        <Toast
          key={said.shown}
          message={said.words}
          onDismiss={() => {
            onDismiss();
            setSaid(null);
          }}
        />
      )}
    </>
  );
}

describe('Toast under attack (#328)', () => {
  it('a double-click on Undo undoes once', () => {
    const onUndo = vi.fn();
    // A caller whose toast leaves after a fade, or a queue that pops on the
    // next tick: the Toast is still in the page for the second click.
    render(<Toast message="Moved to Done" onUndo={onUndo} onDismiss={vi.fn()} />);

    const undo = screen.getByRole('button', { name: 'Undo' });
    fireEvent.click(undo);
    fireEvent.click(undo);

    expect(onUndo).toHaveBeenCalledTimes(1);
  });

  it('is dismissed once when Undo is pressed and its time runs out too', () => {
    vi.useFakeTimers();
    const onDismiss = vi.fn();
    render(<Toast message="Moved to Done" onUndo={vi.fn()} onDismiss={onDismiss} />);

    act(() => vi.advanceTimersByTime(TOAST_MS - 1));
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    act(() => vi.advanceTimersByTime(TOAST_MS));

    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('stays held while the focus moves from Undo to Open to ×', () => {
    vi.useFakeTimers();
    const onDismiss = vi.fn();
    render(
      <Toast
        message="Task added"
        onUndo={vi.fn()}
        action={{ label: 'Open', onClick: vi.fn() }}
        onDismiss={onDismiss}
      />,
    );
    const undo = screen.getByRole('button', { name: 'Undo' });
    const open = screen.getByRole('button', { name: 'Open' });
    const dismiss = screen.getByRole('button', { name: 'Dismiss' });

    act(() => undo.focus());
    act(() => vi.advanceTimersByTime(TOAST_MS));
    act(() => open.focus());
    act(() => vi.advanceTimersByTime(TOAST_MS));
    act(() => dismiss.focus());
    act(() => vi.advanceTimersByTime(TOAST_MS));

    expect(onDismiss).not.toHaveBeenCalled();
  });

  it('gives its full time again once the focus leaves it', () => {
    vi.useFakeTimers();
    const onDismiss = vi.fn();
    render(
      <>
        <button type="button">elsewhere</button>
        <Toast message="Moved to Done" onUndo={vi.fn()} onDismiss={onDismiss} />
      </>,
    );
    act(() => vi.advanceTimersByTime(TOAST_MS - 100));
    act(() => screen.getByRole('button', { name: 'Undo' }).focus());
    act(() => screen.getByRole('button', { name: 'elsewhere' }).focus());

    act(() => vi.advanceTimersByTime(TOAST_MS - 1));
    expect(onDismiss).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('is held while hovered, and goes a full five seconds after the pointer leaves', () => {
    vi.useFakeTimers();
    const onDismiss = vi.fn();
    render(<Toast message="Moved to Done" onUndo={vi.fn()} onDismiss={onDismiss} />);
    const toast = screen.getByRole('status');

    act(() => vi.advanceTimersByTime(TOAST_MS - 100));
    fireEvent.pointerEnter(toast);
    act(() => vi.advanceTimersByTime(TOAST_MS * 3));
    expect(onDismiss).not.toHaveBeenCalled();
    fireEvent.pointerLeave(toast);
    act(() => vi.advanceTimersByTime(TOAST_MS - 1));
    expect(onDismiss).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('a second toast with the same words gets its own full five seconds', () => {
    vi.useFakeTimers();
    const onDismiss = vi.fn();
    render(<SaysAgain onDismiss={onDismiss} />);

    act(() => vi.advanceTimersByTime(4000));
    fireEvent.click(screen.getByRole('button', { name: 'say it' }));
    act(() => vi.advanceTimersByTime(TOAST_MS - 1));

    expect(onDismiss).not.toHaveBeenCalled();
  });

  it('tabs Undo, then the action, then ×', () => {
    render(
      <Toast
        message="Task added"
        onUndo={vi.fn()}
        action={{ label: 'Open', onClick: vi.fn() }}
        onDismiss={vi.fn()}
      />,
    );
    const names = screen
      .getAllByRole('button')
      .map((button) => button.getAttribute('aria-label') ?? button.textContent);
    expect(names).toEqual(['Undo', 'Open', 'Dismiss']);
  });

  it('its live region announces what happened, not the names of its buttons', () => {
    render(
      <Toast
        message="Task added"
        onUndo={vi.fn()}
        action={{ label: 'Open', onClick: vi.fn() }}
        onDismiss={vi.fn()}
      />,
    );
    const live = document.querySelectorAll('[role="status"], [aria-live]');
    const announced = [...live].map((region) => region.textContent?.trim());
    expect(announced).toEqual(['Task added']);
  });
});
