// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PaneFrame } from './pane-frame.tsx';

function show(overrides: Partial<Parameters<typeof PaneFrame>[0]> = {}) {
  const props = {
    label: 'Pane 1',
    focused: false,
    onFocus: () => {},
    children: <button type="button">Inside the pane</button>,
    ...overrides,
  };
  return { ...render(<PaneFrame {...props} />), props };
}

const pane = (name: string) => screen.getByRole('region', { name });

describe('PaneFrame', () => {
  it('is a named region, so a split window has two places a reader can go', () => {
    show();
    expect(pane('Pane 1')).toBeDefined();
  });

  it('takes the focus when anything inside it is clicked', async () => {
    const onFocus = vi.fn();
    show({ onFocus });

    await userEvent.click(screen.getByRole('button', { name: 'Inside the pane' }));

    expect(onFocus).toHaveBeenCalled();
  });

  it('takes the focus when the pane itself is clicked, not only its contents', async () => {
    const onFocus = vi.fn();
    show({ onFocus });

    await userEvent.click(pane('Pane 1'));

    expect(onFocus).toHaveBeenCalled();
  });

  it('takes the focus when something inside it is tabbed to, without a click', () => {
    const onFocus = vi.fn();
    show({ onFocus });

    screen.getByRole('button', { name: 'Inside the pane' }).focus();

    expect(onFocus).toHaveBeenCalled();
  });

  it('says which pane the next note will open in', () => {
    show({ focused: true });
    expect(pane('Pane 1').className).toContain('pane--focused');
  });

  it('does not say so when it is the other pane', () => {
    show({ focused: false });
    expect(pane('Pane 1').className).not.toContain('pane--focused');
  });
});
