// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StatusPill } from './status-pill.tsx';

describe('StatusPill', () => {
  it('is a pill with its label and the tone its name decides', () => {
    render(<StatusPill value="doing" />);
    const pill = screen.getByText('Doing');
    expect(pill.className).toBe('status-pill');
    expect(pill.getAttribute('data-tone')).toBe('doing');
    expect(pill.querySelector('.status-pill__dot')?.getAttribute('aria-hidden')).toBe('true');
  });

  it('takes the tone the type chose over its name', () => {
    render(<StatusPill value="Seed" tone="review" />);
    expect(screen.getByText('Seed').getAttribute('data-tone')).toBe('review');
  });

  it('as a dot, shows no words but still names the status', () => {
    render(<StatusPill value="doing" variant="dot" />);
    const dot = screen.getByRole('img', { name: 'Doing' });
    expect(dot.textContent).toBe('');
    expect(dot.className).toBe('status-pill status-pill--dot');
    expect(dot.getAttribute('data-tone')).toBe('doing');
    expect(dot.querySelector('.status-pill__dot')).not.toBeNull();
  });

  it('as a dot, keeps the chosen tone', () => {
    render(<StatusPill value="Seed" tone="done" variant="dot" />);
    expect(screen.getByRole('img', { name: 'Seed' }).getAttribute('data-tone')).toBe('done');
  });
});
