// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ProfileSettings } from './profile-settings.tsx';

function renderWith({
  name = '',
  preferredName = '',
  problem = null,
  disabled = false,
}: { name?: string; preferredName?: string; problem?: string | null; disabled?: boolean } = {}) {
  const handlers = { onName: vi.fn(), onPreferredName: vi.fn() };
  render(
    <ProfileSettings
      name={name}
      preferredName={preferredName}
      placeholder="[Your name]"
      problem={problem}
      disabled={disabled}
      {...handlers}
    />,
  );
  return handlers;
}

const card = () => screen.getByRole('region', { name: 'Profile' });
const field = (name: string) => within(card()).getByRole<HTMLInputElement>('textbox', { name });

describe('ProfileSettings', () => {
  it('shows the names the vault holds', () => {
    renderWith({ name: 'James Hoffman', preferredName: 'James' });
    expect(field('Full name').value).toBe('James Hoffman');
    expect(field('Preferred name').value).toBe('James');
    expect(within(card()).queryByText('What Claude writes for you')).not.toBeNull();
    expect(within(card()).queryByText(/Not set/)).toBeNull();
  });

  it('says what Claude writes while no name is set', () => {
    renderWith();
    expect(
      within(card()).queryByText('Not set: Claude writes “[Your name]” rather than guess one'),
    ).not.toBeNull();
    expect(within(card()).queryByRole('alert')).toBeNull();
  });

  it('commits the full name on Enter, trimmed', async () => {
    const { onName, onPreferredName } = renderWith();
    await userEvent.type(
      screen.getByRole('textbox', { name: 'Full name' }),
      '  Ada Lovelace {Enter}',
    );
    expect(onName).toHaveBeenCalledWith('Ada Lovelace');
    expect(onPreferredName).not.toHaveBeenCalled();
  });

  it('commits the preferred name on leaving the field', async () => {
    const { onPreferredName } = renderWith({ name: 'Ada Lovelace' });
    await userEvent.type(screen.getByRole('textbox', { name: 'Preferred name' }), 'Ada');
    await userEvent.tab();
    expect(onPreferredName).toHaveBeenCalledWith('Ada');
  });

  it('until the names are read, neither field can be changed, and neither says "Not set"', async () => {
    const { onName, onPreferredName } = renderWith({ disabled: true });
    expect(field('Full name').disabled).toBe(true);
    expect(field('Preferred name').disabled).toBe(true);
    expect(within(card()).queryByText(/Not set/)).toBeNull();
    expect(within(card()).queryByText('Not read yet: Claude asks for your name')).not.toBeNull();

    await userEvent.type(field('Full name'), 'Ada{Enter}');
    expect(onName).not.toHaveBeenCalled();
    expect(onPreferredName).not.toHaveBeenCalled();
  });

  it('says why the name could not be read or saved', () => {
    renderWith({ problem: '.atlas/settings.md can’t be read' });
    expect(within(card()).getByRole('alert').textContent).toBe('.atlas/settings.md can’t be read');
  });
});
