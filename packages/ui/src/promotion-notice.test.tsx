// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PromotionBanner } from './promotion-notice.tsx';

/** P30-03: what the page says after a checklist line became a task. */
describe('PromotionBanner', () => {
  it('says what was made, and opens it, undoes it or goes away', async () => {
    const onOpen = vi.fn();
    const onUndo = vi.fn();
    const onDismiss = vi.fn();
    render(
      <PromotionBanner
        notice={{ message: '“Order chairs” is a task now.', onOpen, onUndo, onDismiss }}
      />,
    );
    expect(screen.getByRole('status').textContent).toContain('“Order chairs” is a task now.');
    await userEvent.click(screen.getByRole('button', { name: 'Open' }));
    await userEvent.click(screen.getByRole('button', { name: 'Undo' }));
    await userEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect([onOpen, onUndo, onDismiss].map((called) => called.mock.calls.length)).toEqual([
      1, 1, 1,
    ]);
  });

  it('offers nothing to open or undo after a refusal', () => {
    render(
      <PromotionBanner
        notice={{
          message: 'Plan has unsaved changes.',
          onOpen: null,
          onUndo: null,
          onDismiss: vi.fn(),
        }}
      />,
    );
    expect(screen.getByRole('status').textContent).toContain('Plan has unsaved changes.');
    expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Open' })).toBeNull();
  });

  it('is nothing when there is nothing to say', () => {
    const { container } = render(<PromotionBanner notice={null} />);
    expect(container.childElementCount).toBe(0);
  });
});

describe('PromotionBanner — goes by itself (#165)', () => {
  afterEach(() => vi.useRealTimers());

  it('dismisses itself, and its Undo, after 20 seconds unless the pointer is on it', () => {
    vi.useFakeTimers();
    const onDismiss = vi.fn();
    render(
      <PromotionBanner
        notice={{
          message: '“Order chairs” is a task now.',
          onOpen: vi.fn(),
          onUndo: vi.fn(),
          onDismiss,
        }}
      />,
    );
    fireEvent.pointerEnter(screen.getByRole('status'));
    act(() => vi.advanceTimersByTime(120_000));
    expect(onDismiss).not.toHaveBeenCalled();

    fireEvent.pointerLeave(screen.getByRole('status'));
    act(() => vi.advanceTimersByTime(19_900));
    expect(onDismiss).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(200));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
