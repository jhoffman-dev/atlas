// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Toggle } from './toggle.tsx';

describe('Toggle', () => {
  it('is a switch that says whether it is on', () => {
    render(<Toggle label="Dark theme" checked onChange={() => {}} />);
    expect(screen.getByRole('switch', { name: 'Dark theme' }).getAttribute('aria-checked')).toBe(
      'true',
    );
  });

  it('says when it is off', () => {
    render(<Toggle label="Dark theme" checked={false} onChange={() => {}} />);
    expect(screen.getByRole('switch', { name: 'Dark theme' }).getAttribute('aria-checked')).toBe(
      'false',
    );
  });

  it('asks for the opposite of what it is', async () => {
    const onChange = vi.fn();
    render(<Toggle label="Dark theme" checked={false} onChange={onChange} />);
    await userEvent.click(screen.getByRole('switch'));
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it('turns off again', async () => {
    const onChange = vi.fn();
    render(<Toggle label="Dark theme" checked onChange={onChange} />);
    await userEvent.click(screen.getByRole('switch'));
    expect(onChange).toHaveBeenCalledWith(false);
  });

  it('answers the keyboard', async () => {
    const onChange = vi.fn();
    render(<Toggle label="Dark theme" checked={false} onChange={onChange} />);
    screen.getByRole('switch').focus();
    await userEvent.keyboard(' ');
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it('does nothing when disabled', async () => {
    const onChange = vi.fn();
    render(<Toggle label="Dark theme" checked={false} disabled onChange={onChange} />);
    await userEvent.click(screen.getByRole('switch'));
    expect(onChange).not.toHaveBeenCalled();
  });
});
