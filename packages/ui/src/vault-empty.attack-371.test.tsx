// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { VaultEmptyState } from './vault-empty.tsx';

/** Attack on PR #371 (slice 13f): the Welcome restyle keeps both actions working. */
describe('VaultEmptyState, attack 371', () => {
  it('Open a vault from GitHub… calls its own callback, not Choose folder’s', async () => {
    const onChooseVault = vi.fn();
    const onOpenFromGitHub = vi.fn();
    render(<VaultEmptyState onChooseVault={onChooseVault} onOpenFromGitHub={onOpenFromGitHub} />);
    await userEvent.click(screen.getByRole('button', { name: 'Open a vault from GitHub…' }));
    expect(onOpenFromGitHub).toHaveBeenCalledOnce();
    expect(onChooseVault).not.toHaveBeenCalled();
  });

  it('offers only Choose folder… when there is no GitHub way in', () => {
    render(<VaultEmptyState onChooseVault={vi.fn()} />);
    expect(screen.getAllByRole('button').map((button) => button.textContent)).toEqual([
      'Choose folder…',
    ]);
  });

  it('both buttons answer the keyboard', async () => {
    const onChooseVault = vi.fn();
    const onOpenFromGitHub = vi.fn();
    render(<VaultEmptyState onChooseVault={onChooseVault} onOpenFromGitHub={onOpenFromGitHub} />);
    const user = userEvent.setup();
    await user.tab();
    await user.keyboard('{Enter}');
    await user.tab();
    await user.keyboard(' ');
    expect(onChooseVault).toHaveBeenCalledOnce();
    expect(onOpenFromGitHub).toHaveBeenCalledOnce();
  });

  it('names its region by its title, with the tile gone', () => {
    render(<VaultEmptyState onChooseVault={vi.fn()} />);
    expect(screen.getByRole('region', { name: 'Open a vault' })).toBeTruthy();
    expect(screen.queryByText('A', { exact: true })).toBeNull();
  });
});
