// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PromotionBanner } from './promotion-notice.tsx';

/**
 * P30-03: what the page says when a checklist line could not become a task,
 * or its Undo could not take it back. A task made is said in the window's
 * toast, with Open and Undo (UI v2, slice 15); only a failure stays here.
 */
describe('PromotionBanner', () => {
  afterEach(() => vi.useRealTimers());

  const REFUSED = 'Save the note first: it has typing not yet written.';

  it('says why, and goes when dismissed', async () => {
    const onDismiss = vi.fn();
    render(<PromotionBanner notice={{ message: REFUSED, onDismiss }} />);
    expect(screen.getByRole('status').textContent).toContain(REFUSED);
    await userEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('offers nothing to open or undo: nothing was made', () => {
    render(<PromotionBanner notice={{ message: REFUSED, onDismiss: vi.fn() }} />);
    expect(screen.queryByRole('button', { name: 'Open' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull();
  });

  it('stays, however long, until it is read and dismissed', () => {
    vi.useFakeTimers();
    const onDismiss = vi.fn();
    render(<PromotionBanner notice={{ message: REFUSED, onDismiss }} />);
    act(() => vi.advanceTimersByTime(120_000));
    expect(onDismiss).not.toHaveBeenCalled();
    expect(screen.getByRole('status')).toBeTruthy();
  });

  it('is nothing when there is nothing to say', () => {
    const { container } = render(<PromotionBanner notice={null} />);
    expect(container.childElementCount).toBe(0);
  });

  it('is the notice bar, with Dismiss as its ghost verb (#319)', () => {
    render(<PromotionBanner notice={{ message: REFUSED, onDismiss: vi.fn() }} />);
    const bar = screen.getByRole('status');
    expect([...bar.classList]).toEqual(expect.arrayContaining(['notice-bar', 'promotion-notice']));
    const dismiss = screen.getByRole('button', { name: 'Dismiss' });
    expect([...dismiss.classList].filter((each) => each !== 'btn')).toEqual([
      'btn--ghost',
      'btn--sm',
    ]);
  });
});
