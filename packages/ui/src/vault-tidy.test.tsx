// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { VaultTidy, type VaultTidyProps } from './vault-tidy.tsx';

const PREVIEW = {
  moves: [
    { from: 'Call Sam.md', to: 'Tasks/2026/10/Call Sam.md' },
    { from: 'Inbox/Meetings/2026-09-29 Sync.md', to: 'Meetings/2026/09/2026-09-29 Sync.md' },
  ],
  refused: [{ path: 'Idea.md', reason: 'Notes/2026/Idea.md is already a note there.' }],
};

function props(overrides: Partial<VaultTidyProps> = {}): VaultTidyProps {
  return {
    preview: PREVIEW,
    open: false,
    busy: false,
    result: null,
    problem: null,
    onOpen: vi.fn(),
    onApply: vi.fn(),
    onClose: vi.fn(),
    onDismiss: vi.fn(),
    ...overrides,
  };
}

describe('VaultTidy (#214)', () => {
  it('offers the tidy in one line, and moves nothing from there', async () => {
    const given = props();
    render(<VaultTidy {...given} />);

    expect(screen.getByText(/2 notes could move to theirs/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Move/ })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Preview the tidy' }));
    expect(given.onOpen).toHaveBeenCalledOnce();
    expect(given.onApply).not.toHaveBeenCalled();
  });

  it('previews every move from where each note is to where it goes, and every note it leaves', async () => {
    const given = props({ open: true });
    render(<VaultTidy {...given} />);

    const rows = screen
      .getAllByRole('row')
      .slice(1)
      .map((row) => row.textContent);
    expect(rows).toEqual([
      'Call Sam.mdTasks/2026/10/Call Sam.md',
      'Inbox/Meetings/2026-09-29 Sync.mdMeetings/2026/09/2026-09-29 Sync.md',
    ]);
    expect(screen.getByText(/Idea.md: Notes\/2026\/Idea.md is already a note there/)).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Move 2 notes' }));
    expect(given.onApply).toHaveBeenCalledOnce();
  });

  it('shows nothing when there is nothing to move and nothing to say', () => {
    const { container } = render(<VaultTidy {...props({ preview: null })} />);
    expect(container.textContent).toBe('');
  });

  it('says what the tidy did once it is done, with a way to put the line away', async () => {
    const given = props({ preview: null, result: 'Tidied the vault: moved 2 notes.' });
    render(<VaultTidy {...given} />);
    expect(screen.getByRole('status').textContent).toBe('Tidied the vault: moved 2 notes.');
    await userEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(given.onDismiss).toHaveBeenCalledOnce();
  });
});

/** #319: the offer is the one-line notice bar, its verbs at the end, grown open for the preview. */
describe('VaultTidy as the notice bar (#319)', () => {
  const region = () => screen.getByRole('region', { name: 'Tidy the vault' });

  it('is the bar, with Preview the tidy as the secondary verb and Not now as the ghost one', () => {
    render(<VaultTidy {...props()} />);
    expect(region().className).toBe('notice-bar inbox__offer vault-tidy');
    const verbs = screen
      .getAllByRole('button')
      .map((button) => [button.textContent, button.className]);
    expect(verbs).toEqual([
      ['Preview the tidy', 'btn btn--secondary btn--sm'],
      ['Not now', 'btn btn--ghost btn--sm'],
    ]);
  });

  it('carries --open while the preview shows under the line', () => {
    render(<VaultTidy {...props({ open: true })} />);
    expect(region().classList.contains('notice-bar--open')).toBe(true);
  });
});
