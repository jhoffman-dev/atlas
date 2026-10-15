// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ProfileSettings } from './profile-settings.tsx';
import { SAVE_EMAILS_AFTER_MS, type SelfEmailsView } from './self-emails-form.tsx';

const NO_EMAILS: SelfEmailsView = {
  kept: '',
  inherited: null,
  suggested: null,
  problem: null,
  unreadable: null,
  disabled: false,
};

function renderWith({
  name = '',
  preferredName = '',
  problem = null,
  disabled = false,
  emails = {},
}: {
  name?: string;
  preferredName?: string;
  problem?: string | null;
  disabled?: boolean;
  emails?: Partial<SelfEmailsView>;
} = {}) {
  const handlers = {
    onName: vi.fn(),
    onPreferredName: vi.fn(),
    onSaveEmails: vi.fn<(emails: string) => Promise<boolean>>(async () => true),
  };
  const draw = (view: SelfEmailsView) => (
    <ProfileSettings
      name={name}
      preferredName={preferredName}
      placeholder="[Your name]"
      problem={problem}
      disabled={disabled}
      emails={view}
      {...handlers}
    />
  );
  const view = { ...NO_EMAILS, ...emails };
  const { rerender, unmount } = render(draw(view));
  /** Draws the same card again with the addresses changed, as the next render would. */
  const redraw = (changes: Partial<SelfEmailsView>) => rerender(draw({ ...view, ...changes }));
  return { ...handlers, redraw, unmount };
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

/** #173: the person's own addresses, moved here from Settings → Granola. */
describe('ProfileSettings: your emails', () => {
  const emailsField = () => within(card()).getByLabelText<HTMLTextAreaElement>('Your emails');
  const state = () =>
    within(card()).queryByRole('status', { name: 'Where your emails stand' })?.textContent;
  const failure = () =>
    within(card()).queryByRole('alert', { name: 'Your emails were not saved' })?.textContent;

  /** Typing as a person does, with the clock under the test's hand. */
  function typist() {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    return userEvent.setup({ advanceTimers: (ms) => vi.advanceTimersByTime(ms) });
  }
  const rest = () => act(async () => void vi.advanceTimersByTime(SAVE_EMAILS_AFTER_MS));
  afterEach(() => void vi.useRealTimers());

  it('has no Save button: the field is the whole control (#226)', () => {
    renderWith({ emails: { kept: 'mara@example.com' } });
    expect(within(card()).queryByRole('button')).toBeNull();
    expect(emailsField().tagName).toBe('TEXTAREA');
  });

  it('shows the Person note’s addresses as in use while none are saved, and saves nothing for them', async () => {
    const user = typist();
    const { onSaveEmails } = renderWith({ emails: { suggested: 'mara.quill@example.com' } });
    expect(emailsField().value).toBe('mara.quill@example.com');
    expect(state()).toBe('In use from your Person note. Type your own here to use those instead.');

    await user.click(emailsField());
    await user.tab();
    await rest();
    expect(onSaveEmails).not.toHaveBeenCalled();
  });

  it('saves once typing pauses, and says Saved', async () => {
    const user = typist();
    const { onSaveEmails } = renderWith({ emails: { suggested: 'mara.quill@example.com' } });
    await user.type(emailsField(), ', mq@example.com');
    expect(onSaveEmails).not.toHaveBeenCalled();

    await rest();
    expect(onSaveEmails).toHaveBeenCalledTimes(1);
    expect(onSaveEmails).toHaveBeenCalledWith('mara.quill@example.com, mq@example.com');
    await waitFor(() => expect(state()).toBe('Saved'));
  });

  it('saves on leaving the field, without waiting, and once', async () => {
    const user = typist();
    const { onSaveEmails } = renderWith();
    await user.type(emailsField(), 'mara@example.com');
    await user.tab();
    expect(onSaveEmails).toHaveBeenCalledWith('mara@example.com');

    await rest();
    expect(onSaveEmails).toHaveBeenCalledTimes(1);
  });

  it('takes the addresses in a field of several lines, a line break kept as typed', async () => {
    const user = typist();
    const { onSaveEmails } = renderWith();
    await user.type(emailsField(), 'mara@example.com{Enter}Mara Quill <mq@example.com>');
    await user.tab();
    expect(onSaveEmails).toHaveBeenCalledWith('mara@example.com\nMara Quill <mq@example.com>');
  });

  it('keeps what was typed, and says why, when the write fails', async () => {
    const user = typist();
    const { onSaveEmails, redraw } = renderWith({ emails: { kept: 'mara@example.com' } });
    onSaveEmails.mockResolvedValue(false);
    await user.clear(emailsField());
    await user.type(emailsField(), 'mq@example.org');
    await user.tab();
    redraw({ kept: 'mara@example.com', problem: 'The settings note is read-only.' });

    await waitFor(() => expect(failure()).toBe('Couldn’t save: The settings note is read-only.'));
    expect(emailsField().value).toBe('mq@example.org');
  });

  it('keeps what was typed, and says why, when the addresses are refused', async () => {
    const user = typist();
    const { onSaveEmails, redraw } = renderWith({ emails: { kept: 'mara@example.com' } });
    onSaveEmails.mockResolvedValue(false);
    await user.clear(emailsField());
    await user.type(emailsField(), 'mara@example.com and mq');
    await rest();
    expect(onSaveEmails).toHaveBeenCalledWith('mara@example.com and mq');
    redraw({ kept: 'mara@example.com', problem: 'Not an email address: “and”.' });

    await waitFor(() => expect(failure()).toBe('Couldn’t save: Not an email address: “and”.'));
    expect(emailsField().value).toBe('mara@example.com and mq');
  });

  it('tries again when the same text is left again after a failed save', async () => {
    const user = typist();
    const { onSaveEmails } = renderWith();
    onSaveEmails.mockResolvedValueOnce(false);
    await user.type(emailsField(), 'mq@example.org');
    await user.tab();
    await waitFor(() => expect(failure()).toBeDefined());
    await user.click(emailsField());
    await user.tab();
    expect(onSaveEmails).toHaveBeenCalledTimes(2);
    expect(onSaveEmails).toHaveBeenLastCalledWith('mq@example.org');
  });

  it('holds what was typed until the write settles, whatever the settings read meanwhile', async () => {
    const user = typist();
    const { onSaveEmails, redraw } = renderWith({ emails: { kept: 'mara@example.com' } });
    let settle: (kept: boolean) => void = () => undefined;
    onSaveEmails.mockImplementation(() => new Promise<boolean>((resolve) => (settle = resolve)));
    await user.clear(emailsField());
    await user.type(emailsField(), 'MQ@example.org');
    await user.tab();
    expect(state()).toBe('Saving…');
    redraw({ kept: 'mara@example.com' });
    expect(emailsField().value).toBe('MQ@example.org');

    redraw({ kept: 'mq@example.org' });
    await act(async () => settle(true));
    expect(emailsField().value).toBe('mq@example.org');
    expect(state()).toBe('Saved');
  });

  it('falls back to the Person note’s addresses once emptied and saved', async () => {
    const user = typist();
    const { onSaveEmails, redraw } = renderWith({
      emails: { kept: 'mq@example.org', suggested: null },
    });
    await user.clear(emailsField());
    await user.tab();
    expect(onSaveEmails).toHaveBeenCalledWith('');
    // Nothing saved now: the hook hands back the Person note's addresses as in use.
    redraw({ kept: '', suggested: 'mara.quill@example.com' });
    await waitFor(() => expect(emailsField().value).toBe('mara.quill@example.com'));
  });

  it('saves typing not yet saved when Settings closes', async () => {
    const user = typist();
    const { onSaveEmails, unmount } = renderWith();
    await user.type(emailsField(), 'mq@example.org');
    unmount();
    expect(onSaveEmails).toHaveBeenCalledWith('mq@example.org');
  });

  it('shows the addresses in use from Granola’s key, and says so', () => {
    renderWith({ emails: { inherited: 'mara@example.com', suggested: 'mara.quill@example.com' } });
    expect(emailsField().value).toBe('mara@example.com');
    expect(state()).toContain('In use from granola_self_emails');
  });

  it('says Saved for addresses the settings keep', () => {
    renderWith({ emails: { kept: 'mara@example.com', suggested: 'mara.quill@example.com' } });
    expect(emailsField().value).toBe('mara@example.com');
    expect(state()).toBe('Saved');
  });

  it('says the settings’ addresses could not be read, and shows none of them as kept', () => {
    renderWith({
      emails: {
        unreadable:
          'Your emails in settings could not be read: Not an email address: “Mara <someone>”.',
      },
    });
    expect(
      within(card()).getByRole('alert', { name: 'Your emails in settings could not be read' })
        .textContent,
    ).toBe('Your emails in settings could not be read: Not an email address: “Mara <someone>”.');
    expect(emailsField().value).toBe('');
  });

  it('shows the Person note’s addresses that arrive while the field is untouched', () => {
    const { redraw } = renderWith();
    redraw({ suggested: 'mara.quill@example.com' });
    expect(emailsField().value).toBe('mara.quill@example.com');
  });

  it('does not wipe addresses being typed when the Person note’s arrive', async () => {
    const user = typist();
    const { redraw } = renderWith();
    await user.type(emailsField(), 'mq@example.com');
    redraw({ suggested: 'mara.quill@example.com' });
    expect(emailsField().value).toBe('mq@example.com');
  });

  it('cannot be changed until the settings are read', () => {
    renderWith({ emails: { disabled: true, suggested: 'mara.quill@example.com' } });
    expect(emailsField()).toHaveProperty('disabled', true);
  });
});
