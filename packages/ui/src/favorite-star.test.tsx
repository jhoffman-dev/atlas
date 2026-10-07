// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FavoriteStar } from './favorite-star.tsx';

describe('FavoriteStar', () => {
  it('says what pressing it will do when the note is not a favourite', () => {
    render(<FavoriteStar name="Acme" favorite={false} onToggle={() => {}} />);
    expect(screen.getByRole('button', { name: 'Add Acme to favorites' })).toBeDefined();
  });

  it('says what pressing it will do when the note already is one', () => {
    render(<FavoriteStar name="Acme" favorite onToggle={() => {}} />);
    expect(screen.getByRole('button', { name: 'Remove Acme from favorites' })).toBeDefined();
  });

  it('shows a filled star for a favourite and an empty one otherwise', () => {
    const { rerender } = render(<FavoriteStar name="Acme" favorite={false} onToggle={() => {}} />);
    expect(screen.getByRole('button').classList.contains('star--on')).toBe(false);
    rerender(<FavoriteStar name="Acme" favorite onToggle={() => {}} />);
    expect(screen.getByRole('button').classList.contains('star--on')).toBe(true);
  });

  it('asks to toggle when pressed', async () => {
    const onToggle = vi.fn();
    render(<FavoriteStar name="Acme" favorite={false} onToggle={onToggle} />);
    await userEvent.click(screen.getByRole('button'));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it('is reachable from the keyboard', async () => {
    const onToggle = vi.fn();
    render(<FavoriteStar name="Acme" favorite={false} onToggle={onToggle} />);
    await userEvent.tab();
    expect(document.activeElement).toBe(screen.getByRole('button'));
    await userEvent.keyboard('{Enter}');
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it('does not also press the row it sits in', async () => {
    const onToggle = vi.fn();
    const onOpen = vi.fn();
    render(
      // A div with a click handler is what the virtualised tree's rows are.
      <div onClick={onOpen}>
        <FavoriteStar name="Acme" favorite={false} onToggle={onToggle} />
      </div>,
    );

    await userEvent.click(screen.getByRole('button'));

    expect(onToggle).toHaveBeenCalledTimes(1);
    expect(onOpen).not.toHaveBeenCalled();
  });
});
