// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ProfileSettings } from './profile-settings.tsx';
import type { SelfEmailsView } from './self-emails-form.tsx';

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
  const { rerender } = render(draw(view));
  /** Draws the same card again with the addresses changed, as the next render would. */
  const redraw = (changes: Partial<SelfEmailsView>) => rerender(draw({ ...view, ...changes }));
  return { ...handlers, redraw };
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
  const saveEmails = () => within(card()).getByRole('button', { name: 'Save emails' });

  it('offers the Person note’s addresses while none are in use, and saves what is in the field', async () => {
    const { onSaveEmails } = renderWith({ emails: { suggested: 'mara.quill@example.com' } });
    expect(emailsField().value).toBe('mara.quill@example.com');
    expect(card().textContent).toContain('From your Person note.');

    await userEvent.type(emailsField(), ', mq@example.com');
    await userEvent.click(saveEmails());
    expect(onSaveEmails).toHaveBeenCalledWith('mara.quill@example.com, mq@example.com');
  });

  it('shows the addresses kept, and saves nothing until they change', async () => {
    const { onSaveEmails } = renderWith({
      emails: { kept: 'mara@example.com', suggested: 'mara.quill@example.com' },
    });
    expect(emailsField().value).toBe('mara@example.com');
    expect(card().textContent).not.toContain('From your Person note.');
    expect(saveEmails()).toHaveProperty('disabled', true);

    await userEvent.clear(emailsField());
    await userEvent.click(saveEmails());
    expect(onSaveEmails).toHaveBeenCalledWith('');
  });

  it('shows the addresses in use from Granola’s key, says so, and lets them be kept here', async () => {
    const { onSaveEmails } = renderWith({
      emails: { inherited: 'mara@example.com', suggested: 'mara.quill@example.com' },
    });
    expect(emailsField().value).toBe('mara@example.com');
    expect(card().textContent).toContain('In use from granola_self_emails');
    expect(card().textContent).not.toContain('From your Person note.');
    expect(saveEmails()).toHaveProperty('disabled', false);

    await userEvent.click(saveEmails());
    expect(onSaveEmails).toHaveBeenCalledWith('mara@example.com');
  });

  it('lets the addresses in use from Granola’s key be cleared, saving none', async () => {
    const { onSaveEmails } = renderWith({ emails: { inherited: 'mara@example.com' } });
    await userEvent.clear(emailsField());
    // Nothing is kept here, but Granola's key is in use: saving none removes it.
    expect(saveEmails()).toHaveProperty('disabled', false);
    await userEvent.click(saveEmails());
    expect(onSaveEmails).toHaveBeenCalledWith('');
  });

  it('holds what was typed until the write settles, and keeps it when the write fails', async () => {
    const { onSaveEmails, redraw } = renderWith({ emails: { kept: 'mara@example.com' } });
    let settle: (kept: boolean) => void = () => undefined;
    onSaveEmails.mockImplementation(() => new Promise<boolean>((resolve) => (settle = resolve)));
    await userEvent.clear(emailsField());
    await userEvent.type(emailsField(), 'mq@example.org');
    await userEvent.click(saveEmails());
    // Under way, and the settings read back as they were: the field still holds what was sent.
    redraw({ kept: 'mara@example.com' });
    expect(emailsField().value).toBe('mq@example.org');

    await act(async () => settle(false));
    expect(emailsField().value).toBe('mq@example.org');
  });

  it('holds an untouched field’s addresses while they are saved, whatever is read meanwhile', async () => {
    const { onSaveEmails, redraw } = renderWith({ emails: { inherited: 'mara@example.com' } });
    let settle: (kept: boolean) => void = () => undefined;
    onSaveEmails.mockImplementation(() => new Promise<boolean>((resolve) => (settle = resolve)));
    await userEvent.click(saveEmails());
    expect(onSaveEmails).toHaveBeenCalledWith('mara@example.com');
    // Another edit lands while the write is under way: the field keeps what was sent.
    redraw({ inherited: 'tobias.fenn@example.com' });
    expect(emailsField().value).toBe('mara@example.com');

    await act(async () => settle(false));
    expect(emailsField().value).toBe('mara@example.com');
  });

  it('shows what the settings keep once the write settles as kept', async () => {
    const { onSaveEmails, redraw } = renderWith({ emails: { kept: 'mara@example.com' } });
    let settle: (kept: boolean) => void = () => undefined;
    onSaveEmails.mockImplementation(() => new Promise<boolean>((resolve) => (settle = resolve)));
    await userEvent.clear(emailsField());
    await userEvent.type(emailsField(), 'MQ@example.org');
    await userEvent.click(saveEmails());
    redraw({ kept: 'mq@example.org' });
    expect(emailsField().value).toBe('MQ@example.org');

    await act(async () => settle(true));
    expect(emailsField().value).toBe('mq@example.org');
  });

  it('keeps what was typed, and says why, when the addresses are refused', async () => {
    const { onSaveEmails, redraw } = renderWith({ emails: { kept: 'mara@example.com' } });
    onSaveEmails.mockResolvedValue(false);
    await userEvent.clear(emailsField());
    await userEvent.type(emailsField(), 'mara@example.com and mq');
    await userEvent.click(saveEmails());
    expect(onSaveEmails).toHaveBeenCalledWith('mara@example.com and mq');
    redraw({ problem: 'Not an email address: “and”.' });
    expect(emailsField().value).toBe('mara@example.com and mq');
    expect(
      within(card()).getByRole('alert', { name: 'Your emails were not saved' }).textContent,
    ).toBe('Not an email address: “and”.');
  });

  it('shows what the settings keep once the addresses typed are saved', async () => {
    const { onSaveEmails, redraw } = renderWith();
    await userEvent.type(emailsField(), 'Mara Quill <Mara@Example.com>');
    await userEvent.click(saveEmails());
    expect(onSaveEmails).toHaveBeenCalledWith('Mara Quill <Mara@Example.com>');
    redraw({ kept: 'mara@example.com' });
    expect(emailsField().value).toBe('mara@example.com');
    expect(saveEmails()).toHaveProperty('disabled', true);
  });

  it('takes the addresses in a field of several lines, a line break kept as typed', async () => {
    const { onSaveEmails } = renderWith();
    expect(emailsField().tagName).toBe('TEXTAREA');
    await userEvent.type(emailsField(), 'mara@example.com{Enter}Mara Quill <mq@example.com>');
    await userEvent.click(saveEmails());
    expect(onSaveEmails).toHaveBeenCalledWith('mara@example.com\nMara Quill <mq@example.com>');
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

  it('says nothing of the settings’ addresses when they were read', () => {
    renderWith({ emails: { kept: 'mara@example.com' } });
    expect(emailsField()).toBeTruthy();
    expect(
      within(card()).queryByRole('alert', { name: 'Your emails in settings could not be read' }),
    ).toBeNull();
  });

  it('shows the suggestion that arrives while the field is untouched', () => {
    const { redraw } = renderWith();
    redraw({ suggested: 'mara.quill@example.com' });
    expect(emailsField().value).toBe('mara.quill@example.com');
    expect(card().textContent).toContain('From your Person note.');
  });

  it('does not wipe addresses being typed when the Person note’s suggestion arrives', async () => {
    const { redraw } = renderWith();
    await userEvent.type(emailsField(), 'mq@example.com');
    redraw({ suggested: 'mara.quill@example.com' });
    expect(emailsField().value).toBe('mq@example.com');
  });

  it('cannot be changed until the settings are read', async () => {
    const { onSaveEmails } = renderWith({
      emails: { disabled: true, suggested: 'mara.quill@example.com' },
    });
    expect(emailsField()).toHaveProperty('disabled', true);
    expect(saveEmails()).toHaveProperty('disabled', true);
    await userEvent.click(saveEmails());
    expect(onSaveEmails).not.toHaveBeenCalled();
  });
});
