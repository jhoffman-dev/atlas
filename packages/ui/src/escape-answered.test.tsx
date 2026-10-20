// @vitest-environment jsdom
/**
 * A field that answers Escape itself — putting a typed date back, closing a
 * new card's name, leaving a title being renamed — says so (`preventDefault`),
 * so the peek round it stays up for that press (PR #428 attack).
 */
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { AddCard } from './board-card.tsx';
import { EditableTitle } from './page-head.tsx';

describe('an Escape a field answers', () => {
  it('is prevented by a new card’s name field as it closes', () => {
    const onClose = vi.fn();
    render(<AddCard label="Doing" onAdd={vi.fn()} onClose={onClose} />);
    const notPrevented = fireEvent.keyDown(screen.getByLabelText('New card in Doing'), {
      key: 'Escape',
    });
    expect(onClose).toHaveBeenCalled();
    expect(notPrevented).toBe(false);
  });

  it('is prevented by a title being renamed as it closes', () => {
    render(
      <EditableTitle value="Plan" label="Note name" hint="Rename" onCommit={vi.fn()} editing />,
    );
    const notPrevented = fireEvent.keyDown(screen.getByLabelText('Note name'), { key: 'Escape' });
    expect(notPrevented).toBe(false);
  });
});
