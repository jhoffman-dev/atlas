// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { GoogleCalendarSettings, type GoogleCalendarView } from './google-calendar-settings.tsx';

const CLIENT_ID = '1234-fictional.apps.googleusercontent.com';

const BLOCKS = { id: 'atlas-blocks@group.calendar.example.com', name: 'Atlas blocks' };

function renderWith(overrides: Partial<GoogleCalendarView> = {}) {
  const view: GoogleCalendarView = {
    phase: 'disconnected',
    clientId: '',
    calendars: [],
    chosen: null,
    canCreate: true,
    calendarName: 'Atlas blocks',
    problem: null,
    pending: false,
    ...overrides,
  };
  const handlers = {
    onConnect: vi.fn(),
    onCancel: vi.fn(),
    onDisconnect: vi.fn(),
    onChoose: vi.fn(),
    onCreate: vi.fn(),
  };
  render(<GoogleCalendarSettings view={view} {...handlers} />);
  return handlers;
}

const card = () => screen.getByRole('region', { name: 'Google Calendar' });
const button = (name: string | RegExp) => within(card()).getByRole('button', { name });
const queryButton = (name: string | RegExp) => within(card()).queryByRole('button', { name });

describe('GoogleCalendarSettings', () => {
  it('asks for a client while disconnected, starting from the one the vault keeps', async () => {
    const { onConnect } = renderWith({ clientId: CLIENT_ID });

    const client = within(card()).getByRole<HTMLInputElement>('textbox', {
      name: 'OAuth client ID',
    });
    expect(client.value).toBe(CLIENT_ID);
    await userEvent.type(within(card()).getByLabelText('Client secret, if Google issued one'), 'S');
    await userEvent.click(button('Connect'));

    expect(onConnect).toHaveBeenCalledWith({ clientId: CLIENT_ID, clientSecret: 'S' });
    expect(queryButton(/Disconnect/)).toBeNull();
  });

  it('cannot connect without a client ID', () => {
    renderWith();
    expect(button('Connect')).toHaveProperty('disabled', true);
  });

  it('keeps the client secret masked, and empties it once handed on', async () => {
    renderWith({ clientId: CLIENT_ID });
    const secret = within(card()).getByLabelText<HTMLInputElement>(
      'Client secret, if Google issued one',
    );
    expect(secret.type).toBe('password');
    await userEvent.type(secret, 'GOCSPX-fictional');
    await userEvent.click(button('Connect'));
    expect(secret.value).toBe('');
  });

  it('waits on the browser with a way to cancel', async () => {
    const { onCancel } = renderWith({ phase: 'connecting' });

    expect(within(card()).getByText('Finish signing in in your browser…')).not.toBeNull();
    expect(queryButton('Connect')).toBeNull();
    await userEvent.click(button('Cancel'));

    expect(onCancel).toHaveBeenCalled();
  });

  it('once connected, says where blocks go and lets another calendar be chosen', async () => {
    const other = { id: 'other@example.com', name: 'Deep work' };
    const { onChoose } = renderWith({
      phase: 'connected',
      calendars: [BLOCKS, other],
      chosen: BLOCKS.id,
      canCreate: false,
    });

    expect(within(card()).getByText('Connected. Blocks go to Atlas blocks.')).not.toBeNull();
    expect(queryButton(/Create/)).toBeNull();
    await userEvent.selectOptions(
      within(card()).getByRole('combobox', { name: 'Calendar for blocks' }),
      other.id,
    );

    expect(onChoose).toHaveBeenCalledWith(other.id);
  });

  it('offers to make Atlas’s calendar when there is none to choose', async () => {
    const { onCreate } = renderWith({ phase: 'connected', calendars: [], canCreate: true });

    expect(within(card()).getByText('Connected. Choose the calendar blocks go to.')).not.toBeNull();
    expect(within(card()).queryByRole('combobox')).toBeNull();
    await userEvent.click(button('Create “Atlas blocks”'));

    expect(onCreate).toHaveBeenCalled();
  });

  it('disconnects only once it is confirmed, saying what is kept', async () => {
    const { onDisconnect } = renderWith({ phase: 'connected', calendars: [BLOCKS] });

    await userEvent.click(button('Disconnect…'));
    const confirm = within(card()).getByRole('group', { name: 'Disconnect Google Calendar?' });
    expect(within(confirm).getByText(/calendar and its events stay/)).not.toBeNull();
    expect(onDisconnect).not.toHaveBeenCalled();
    await userEvent.click(within(confirm).getByRole('button', { name: 'Disconnect' }));

    expect(onDisconnect).toHaveBeenCalled();
  });

  it('shows a problem with its fix', () => {
    renderWith({
      problem: {
        problem: 'Google no longer accepts Atlas’s sign-in: it expired or was revoked.',
        fix: 'Connect again in Settings → Google Calendar.',
      },
    });

    const alert = within(card()).getByRole('alert');
    expect(within(alert).getByText(/expired or was revoked/)).not.toBeNull();
    expect(within(alert).getByText('Connect again in Settings → Google Calendar.')).not.toBeNull();
  });

  it('shows no alert when nothing is wrong, and holds its buttons while busy', () => {
    renderWith({ phase: 'connected', calendars: [BLOCKS], pending: true });
    expect(within(card()).queryByRole('alert')).toBeNull();
    expect(button('Disconnect…')).toHaveProperty('disabled', true);
    expect(button('Create “Atlas blocks”')).toHaveProperty('disabled', true);
  });

  it('says it is checking before the host has answered', () => {
    renderWith({ phase: 'loading' });
    expect(within(card()).getByText('Checking…')).not.toBeNull();
    expect(queryButton('Connect')).toBeNull();
  });
});
