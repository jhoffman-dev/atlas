// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ImageSettings } from './image-settings.tsx';

describe('ImageSettings', () => {
  it('shows where images go now, and offers the other place', async () => {
    const onChange = vi.fn();
    render(<ImageSettings placement="attachments" onChange={onChange} />);

    const group = screen.getByRole('radiogroup', { name: 'Images go in' });
    expect(group).toBeDefined();
    expect(
      screen.getByRole('radio', { name: 'Attachments folder' }).getAttribute('aria-checked'),
    ).toBe('true');
    expect(screen.getByText('attachments/, at the top of the vault')).toBeDefined();

    await userEvent.click(screen.getByRole('radio', { name: 'Beside the note' }));
    expect(onChange).toHaveBeenCalledWith('beside-note');
  });

  it('says the note’s folder when that is the choice', () => {
    render(<ImageSettings placement="beside-note" onChange={vi.fn()} />);
    expect(screen.getByText('The folder the note is in')).toBeDefined();
    expect(
      screen.getByRole('radio', { name: 'Beside the note' }).getAttribute('aria-checked'),
    ).toBe('true');
  });
});
