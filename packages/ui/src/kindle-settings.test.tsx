// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { KindleSettings, type KindleView } from './kindle-settings.tsx';

function renderWith(overrides: Partial<KindleView> = {}) {
  const view: KindleView = {
    connected: false,
    busy: null,
    last: null,
    heldUntil: null,
    problem: null,
    ...overrides,
  };
  const handlers = { onConnect: vi.fn(), onSyncNow: vi.fn(), onDisconnect: vi.fn() };
  render(<KindleSettings view={view} {...handlers} />);
  return handlers;
}

const card = () => screen.getByRole('region', { name: 'Kindle' });
const status = () => within(card()).getByTestId('kindle-sync');
const buttons = () =>
  within(card())
    .getAllByRole('button')
    .map((b) => b.textContent);

describe('KindleSettings', () => {
  it('is off until connected: it offers Connect alone and says what it would read', async () => {
    const { onConnect } = renderWith();
    expect(buttons()).toEqual(['Connect Kindle']);
    expect(status().textContent).toBe('Not connected on this Mac');
    expect(card().textContent).toContain('10 to 20');
    await userEvent.click(within(card()).getByRole('button', { name: 'Connect Kindle' }));
    expect(onConnect).toHaveBeenCalledOnce();
  });

  it('once connected, offers Sync now and Disconnect, and shows the last sync in its words', async () => {
    const { onSyncNow, onDisconnect } = renderWith({
      connected: true,
      last: { message: 'Added 3 highlights from 1 book.', ok: true, at: '09:00' },
    });
    expect(buttons()).toEqual(['Sync now', 'Disconnect']);
    expect(status().textContent).toBe('Added 3 highlights from 1 book. (09:00)');
    expect(status().className).toBe('settings__status');
    await userEvent.click(within(card()).getByRole('button', { name: 'Sync now' }));
    await userEvent.click(within(card()).getByRole('button', { name: 'Disconnect' }));
    expect(onSyncNow).toHaveBeenCalledOnce();
    expect(onDisconnect).toHaveBeenCalledOnce();
  });

  it('marks a sync that needs the person as a problem', () => {
    renderWith({
      connected: true,
      last: { message: 'Kindle sync needs you to sign in again.', ok: false, at: '09:00' },
    });
    expect(status().className).toBe('settings__problem');
  });

  it('says what it is doing while busy, and takes no second press', () => {
    renderWith({ connected: true, busy: 'syncing' });
    expect(status().textContent).toBe('Syncing Kindle…');
    for (const button of within(card()).getAllByRole('button')) {
      expect(button).toHaveProperty('disabled', true);
    }
  });

  it('says when automatic syncs start again after Amazon asked it to slow down', () => {
    renderWith({ connected: true, heldUntil: 'tomorrow at 09:00' });
    expect(card().textContent).toContain('until tomorrow at 09:00');
  });

  it('shows why Connect did not go through', () => {
    renderWith({ problem: 'This Mac cannot keep a Kindle session.' });
    expect(within(card()).getByRole('alert').textContent).toBe(
      'This Mac cannot keep a Kindle session.',
    );
  });
});
