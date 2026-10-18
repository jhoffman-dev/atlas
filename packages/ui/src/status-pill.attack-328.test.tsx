// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StatusPill } from './status-pill.tsx';

/**
 * PR #328 under attack: the bare dot is an image named by its status, so a
 * status with no words must not make an image with no name — a screen reader
 * then says "image" and nothing else.
 */
describe('StatusPill dot under attack (#328)', () => {
  it.each(['', '   '])('a dot for the empty status %j still has a name', (value) => {
    render(<StatusPill value={value} variant="dot" />);
    const dot = screen.getByRole('img');
    expect(dot.getAttribute('aria-label')?.trim()).not.toBe('');
  });

  it('a dot keeps a status name the domain does not know, as written', () => {
    render(<StatusPill value="on hold" variant="dot" />);
    expect(screen.getByRole('img', { name: 'On hold' })).toBeTruthy();
  });
});
