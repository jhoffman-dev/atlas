// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { hueOf } from '@atlas/domain';
import { StatusPill, TintedPill } from './status-pill.tsx';

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

  it('as a dot beside its own label, says nothing a screen reader would hear twice', () => {
    const { container } = render(<StatusPill value="doing" variant="dot" decorative />);
    expect(screen.queryByRole('img')).toBeNull();
    const dot = container.querySelector('.status-pill--dot');
    expect(dot?.getAttribute('aria-hidden')).toBe('true');
    expect(dot?.getAttribute('aria-label')).toBeNull();
    expect(dot?.getAttribute('data-tone')).toBe('doing');
  });

  it('draws an option that is no status in the hue its value gives it, with no dot', () => {
    render(<StatusPill value="Interview" />);
    const pill = screen.getByText('Interview');
    expect(pill.getAttribute('data-hue')).toBe(hueOf('Interview'));
    expect(pill.getAttribute('data-tone')).toBeNull();
    expect(pill.querySelector('.status-pill__dot')).toBeNull();
  });

  it('gives the same value the same hue each time it is drawn', () => {
    render(
      <>
        <StatusPill value="1on1" />
        <StatusPill value="1on1" />
      </>,
    );
    const hues = screen.getAllByText('1on1').map((pill) => pill.getAttribute('data-hue'));
    expect(hues).toEqual([hueOf('1on1'), hueOf('1on1')]);
  });

  it('takes a palette hue the type chose', () => {
    render(<StatusPill value="Interview" tone="green" />);
    expect(screen.getByText('Interview').getAttribute('data-hue')).toBe('green');
  });

  it('as a dot, keeps a hue', () => {
    render(<StatusPill value="Interview" tone="blue" variant="dot" />);
    expect(screen.getByRole('img', { name: 'Interview' }).getAttribute('data-hue')).toBe('blue');
  });
});

describe('TintedPill', () => {
  it('writes its words as given, on a hue or on a tone with its dot', () => {
    render(
      <>
        <TintedPill text="larkspur Payroll" color="purple" />
        <TintedPill text="Review" color="review" />
      </>,
    );
    const hued = screen.getByText('larkspur Payroll');
    expect(hued.getAttribute('data-hue')).toBe('purple');
    const toned = screen.getByText('Review');
    expect(toned.getAttribute('data-tone')).toBe('review');
    expect(toned.querySelector('.status-pill__dot')).not.toBeNull();
  });
});
