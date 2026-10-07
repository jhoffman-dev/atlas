// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SegmentedControl } from './segmented-control.tsx';

const views = [
  { value: 'board', label: 'Board' },
  { value: 'table', label: 'Table' },
  { value: 'calendar', label: 'Calendar' },
] as const;

const show = (value: 'board' | 'table' | 'calendar', onChange = () => {}) =>
  render(<SegmentedControl label="View" value={value} onChange={onChange} options={views} />);

describe('SegmentedControl', () => {
  it('marks only the chosen option as checked', () => {
    show('table');
    expect(screen.getByRole('radio', { name: 'Board' }).getAttribute('aria-checked')).toBe('false');
    expect(screen.getByRole('radio', { name: 'Table' }).getAttribute('aria-checked')).toBe('true');
  });

  it('fills the chosen option', () => {
    show('table');
    expect(screen.getByRole('radio', { name: 'Table' }).className).toContain(
      'segmented__option--on',
    );
    expect(screen.getByRole('radio', { name: 'Board' }).className).not.toContain(
      'segmented__option--on',
    );
  });

  it('reports the option that was clicked', async () => {
    const onChange = vi.fn();
    show('board', onChange);
    await userEvent.click(screen.getByRole('radio', { name: 'Calendar' }));
    expect(onChange).toHaveBeenCalledWith('calendar');
  });

  it('keeps only the chosen option in the tab order', () => {
    show('table');
    expect(screen.getByRole('radio', { name: 'Table' }).tabIndex).toBe(0);
    expect(screen.getByRole('radio', { name: 'Board' }).tabIndex).toBe(-1);
    expect(screen.getByRole('radio', { name: 'Calendar' }).tabIndex).toBe(-1);
  });

  it('moves to the next option on the right arrow', async () => {
    const onChange = vi.fn();
    show('board', onChange);
    screen.getByRole('radio', { name: 'Board' }).focus();
    await userEvent.keyboard('{ArrowRight}');
    expect(onChange).toHaveBeenCalledWith('table');
  });

  it('moves to the previous option on the left arrow', async () => {
    const onChange = vi.fn();
    show('table', onChange);
    screen.getByRole('radio', { name: 'Table' }).focus();
    await userEvent.keyboard('{ArrowLeft}');
    expect(onChange).toHaveBeenCalledWith('board');
  });

  it('wraps round both ends rather than stopping', async () => {
    const onChange = vi.fn();
    const { unmount } = show('calendar', onChange);
    screen.getByRole('radio', { name: 'Calendar' }).focus();
    await userEvent.keyboard('{ArrowRight}');
    expect(onChange).toHaveBeenCalledWith('board');
    unmount();

    const back = vi.fn();
    show('board', back);
    screen.getByRole('radio', { name: 'Board' }).focus();
    await userEvent.keyboard('{ArrowLeft}');
    expect(back).toHaveBeenCalledWith('calendar');
  });

  it('jumps to the ends on Home and End', async () => {
    const onChange = vi.fn();
    show('table', onChange);
    screen.getByRole('radio', { name: 'Table' }).focus();
    await userEvent.keyboard('{End}');
    expect(onChange).toHaveBeenCalledWith('calendar');
    await userEvent.keyboard('{Home}');
    expect(onChange).toHaveBeenCalledWith('board');
  });

  it('moves focus with the selection, so the arrows keep working', async () => {
    show('board');
    screen.getByRole('radio', { name: 'Board' }).focus();
    await userEvent.keyboard('{ArrowRight}');
    expect(document.activeElement).toBe(screen.getByRole('radio', { name: 'Table' }));
  });

  it('leaves other keys to the app', async () => {
    const onChange = vi.fn();
    show('board', onChange);
    screen.getByRole('radio', { name: 'Board' }).focus();
    await userEvent.keyboard('x');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('names the group for a screen reader', () => {
    show('board');
    expect(screen.getByRole('radiogroup', { name: 'View' })).toBeDefined();
  });
});
