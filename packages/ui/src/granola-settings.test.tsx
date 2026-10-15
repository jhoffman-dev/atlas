// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { GranolaSettings, type GranolaView } from './granola-settings.tsx';

const KEY = 'grn_fictional0123456789';

function renderWith(overrides: Partial<GranolaView> = {}) {
  const view: GranolaView = {
    keyState: 'set',
    waiting: false,
    pulling: false,
    lastPull: null,
    lastPullAt: null,
    notes: [],
    addressesUnreadable: null,
    problem: null,
    pending: false,
    ...overrides,
  };
  const handlers = {
    onSaveKey: vi.fn(),
    onForgetKey: vi.fn(),
    onSyncNow: vi.fn(),
    onOpenNote: vi.fn(),
  };
  const { rerender } = render(<GranolaSettings view={view} {...handlers} />);
  /** Draws the same card again with the view changed, as the next render would. */
  const redraw = (changes: Partial<GranolaView>) =>
    rerender(<GranolaSettings view={{ ...view, ...changes }} {...handlers} />);
  return { ...handlers, redraw };
}

const card = () => screen.getByRole('region', { name: 'Granola' });
const button = (name: string | RegExp) => within(card()).getByRole('button', { name });
const keyField = () => within(card()).getByLabelText<HTMLInputElement>('Granola API key');
const keyStatus = () => within(card()).getByTestId('granola-key').textContent;
const pullStatus = () => within(card()).getByTestId('granola-pull').textContent;

describe('GranolaSettings', () => {
  it('with no key, says where to make one, and Sync now cannot be pressed', () => {
    renderWith({ keyState: 'none' });
    expect(keyStatus()).toBe('No key on this Mac');
    expect(card().textContent).toContain('Granola → Settings → Connectors → API keys');
    expect(button('Sync now')).toHaveProperty('disabled', true);
    expect(within(card()).queryByRole('button', { name: 'Forget key…' })).toBeNull();
  });

  it('cannot pull while it is still asking whether a key is held', () => {
    renderWith({ keyState: 'checking' });
    expect(keyStatus()).toBe('Checking…');
    expect(button('Sync now')).toHaveProperty('disabled', true);
  });

  it('hands a pasted key on, masked, and empties the field as it goes', async () => {
    const { onSaveKey } = renderWith({ keyState: 'none' });
    expect(keyField().type).toBe('password');
    expect(button('Save')).toHaveProperty('disabled', true);

    await userEvent.type(keyField(), ` ${KEY} `);
    await userEvent.click(button('Save'));

    expect(onSaveKey).toHaveBeenCalledWith(KEY);
    expect(keyField().value).toBe('');
  });

  it('says what Granola answered of a key just saved', () => {
    renderWith({ keyState: 'accepted' });
    expect(keyStatus()).toBe('Key accepted');
    expect(button('Sync now')).toHaveProperty('disabled', false);
  });

  it('says Granola refused the key, and still lets Sync now ask again', async () => {
    const { onSyncNow } = renderWith({ keyState: 'refused' });
    expect(keyStatus()).toBe('Granola refused this key');
    await userEvent.click(button('Sync now'));
    expect(onSyncNow).toHaveBeenCalledOnce();
  });

  it('says it is pulling, and Sync now waits for the pull', () => {
    renderWith({ pulling: true, lastPull: '2 new, 3 already in Atlas', lastPullAt: '9:40 AM' });
    expect(pullStatus()).toBe('Pulling from Granola…');
    expect(button('Sync now')).toHaveProperty('disabled', true);
  });

  it('waits for the vault’s first sync before pulling', () => {
    renderWith({ waiting: true });
    expect(card().textContent).toContain('Atlas pulls from Granola once this vault has synced.');
    expect(button('Sync now')).toHaveProperty('disabled', true);
  });

  it('says what the last pull did and when, with the meetings it did not write', async () => {
    const { onOpenNote } = renderWith({
      lastPull: '3 new, 12 already in Atlas, 1 refused',
      lastPullAt: '9:40 AM',
      notes: [
        {
          id: 'not_1',
          title: 'Larkspur Payroll renewal',
          problem: 'The meeting has no date.',
          url: 'https://notes.granola.ai/d/not_1',
        },
        { id: 'not_2', title: 'not_2', problem: 'Granola did not answer in time.', url: null },
      ],
    });
    expect(pullStatus()).toBe('3 new, 12 already in Atlas, 1 refused at 9:40 AM');

    const notes = within(card()).getByRole('list', { name: 'Meetings not written' });
    expect(within(notes).getAllByRole('listitem')).toHaveLength(2);
    expect(notes.textContent).toContain('The meeting has no date.');
    // Only the meeting Granola named a page for can be opened there.
    const opens = within(notes).getAllByRole('button', { name: 'Open in Granola' });
    expect(opens).toHaveLength(1);
    await userEvent.click(within(card()).getByText('Details'));
    await userEvent.click(opens[0] as HTMLElement);
    expect(onOpenNote).toHaveBeenCalledWith('https://notes.granola.ai/d/not_1');
  });

  it('says when this Mac last pulled, before any pull this session', () => {
    renderWith({ lastPullAt: '9:40 AM' });
    expect(pullStatus()).toBe('Last pulled at 9:40 AM');
    expect(within(card()).queryByRole('list', { name: 'Meetings not written' })).toBeNull();
  });

  it('says nothing of a pull on a Mac that has not pulled', () => {
    renderWith();
    expect(pullStatus()).toBe('Not pulled on this Mac yet');
  });

  it('shows why the last pull failed', () => {
    renderWith({ problem: 'Granola could not be reached: offline. Check the connection.' });
    expect(within(card()).getByRole('alert').textContent).toContain('Granola could not be reached');
  });

  it('points to Settings → Profile for the addresses that make “me” You, with no field of its own', () => {
    renderWith();
    expect(card().textContent).toContain('one of Your emails in Settings → Profile');
    expect(within(card()).queryByLabelText('Your emails')).toBeNull();
  });

  it('says addresses in the settings could not be read, and nothing when they were', () => {
    const words =
      'Your emails in settings could not be read: Not an email address: “Mara”. ' +
      'The group addresses in settings could not be read: Not an email address: “eng@example..com”.';
    const { redraw } = renderWith({ addressesUnreadable: words });
    expect(
      within(card()).getByRole('alert', { name: 'Addresses in settings could not be read' })
        .textContent,
    ).toBe(words);
    redraw({ addressesUnreadable: null });
    expect(
      within(card()).queryByRole('alert', { name: 'Addresses in settings could not be read' }),
    ).toBeNull();
  });

  it('while a key is being saved, neither another save nor a forget nor Sync now can be pressed', async () => {
    const { onSaveKey, onForgetKey, onSyncNow } = renderWith({ pending: true });
    await userEvent.type(keyField(), KEY);
    expect(button('Save')).toHaveProperty('disabled', true);
    expect(button('Forget key…')).toHaveProperty('disabled', true);
    expect(button('Sync now')).toHaveProperty('disabled', true);
    await userEvent.click(button('Save'));
    expect(onSaveKey).not.toHaveBeenCalled();
    expect(onForgetKey).not.toHaveBeenCalled();
    expect(onSyncNow).not.toHaveBeenCalled();
  });

  it('cannot confirm a forget once a save has started', async () => {
    const { onForgetKey, redraw } = renderWith();
    await userEvent.click(button('Forget key…'));
    // A save starts with the question still open.
    redraw({ pending: true });
    expect(button('Forget key')).toHaveProperty('disabled', true);
    await userEvent.click(button('Forget key'));
    expect(onForgetKey).not.toHaveBeenCalled();
  });

  it('forgets the key only once that is confirmed', async () => {
    const { onForgetKey } = renderWith();
    await userEvent.click(button('Forget key…'));
    expect(onForgetKey).not.toHaveBeenCalled();
    await userEvent.click(button('Cancel'));
    await userEvent.click(button('Forget key…'));
    await userEvent.click(button('Forget key'));
    expect(onForgetKey).toHaveBeenCalledOnce();
  });
});
