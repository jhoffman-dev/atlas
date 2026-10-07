// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SecretsSettings, type SecretRow } from './secrets-settings.tsx';

const VALUE = 'ghp_TYPED_VALUE_123';

const rows: readonly SecretRow[] = [
  {
    name: 'github',
    usedBy: ['Issues', 'Stars'],
    stored: true,
    origins: ['https://api.github.com'],
  },
  { name: 'spare', usedBy: [], stored: true, origins: [] },
  { name: 'calendar', usedBy: ['Work calendar'], stored: false, origins: [] },
];

/** A save the test settles by hand, to see what the card does before and after. */
function deferred() {
  let settle: (saved: boolean) => void = () => undefined;
  const promise = new Promise<boolean>((resolve) => {
    settle = resolve;
  });
  return { promise, settle };
}

function renderCard(overrides: Partial<Parameters<typeof SecretsSettings>[0]> = {}) {
  const onSave = vi.fn(async () => true);
  const onBind = vi.fn(async () => true);
  const onDelete = vi.fn();
  const view = render(
    <SecretsSettings
      secrets={rows}
      problem={null}
      pending={false}
      onSave={onSave}
      onBind={onBind}
      onDelete={onDelete}
      {...overrides}
    />,
  );
  return { ...view, onSave, onBind, onDelete };
}

const item = (name: string) => {
  const found = screen
    .getAllByRole('listitem')
    .find((row) => within(row).queryByText(name, { selector: 'code' }) !== null);
  if (found === undefined) throw new Error(`no row for ${name}`);
  return found;
};

async function fillAdd(sites = 'api.github.com') {
  await userEvent.type(screen.getByLabelText('Secret name'), 'github');
  await userEvent.type(screen.getByLabelText('Secret value'), VALUE);
  if (sites !== '') await userEvent.type(screen.getByLabelText('Sites it may be sent to'), sites);
}

describe('SecretsSettings', () => {
  it('lists each name with the sources that use it', () => {
    renderCard();

    expect(within(item('github')).getByText('Used by Issues, Stars')).toBeTruthy();
    expect(within(item('spare')).getByText('Not used by any source')).toBeTruthy();
    expect(
      within(item('calendar')).getByText('Used by Work calendar — not set on this Mac'),
    ).toBeTruthy();
  });

  it('says where each stored secret may be sent, and that an unbound one goes nowhere', () => {
    renderCard();

    expect(within(item('github')).getByText('Sent only to https://api.github.com')).toBeTruthy();
    expect(
      within(item('spare')).getByText('Sent nowhere until you choose the sites it is for'),
    ).toBeTruthy();
    expect(within(item('calendar')).queryByText(/^Sent/)).toBeNull();
  });

  it('adds a secret from a masked field, with the sites it may be sent to', async () => {
    const { container, onSave } = renderCard();
    expect(screen.getByLabelText('Secret value').getAttribute('type')).toBe('password');

    await fillAdd();
    await userEvent.click(screen.getByRole('button', { name: 'Add' }));

    expect(onSave).toHaveBeenCalledWith({ name: 'github', value: VALUE, sites: 'api.github.com' });
    expect((screen.getByLabelText('Secret value') as HTMLInputElement).value).toBe('');
    // Nowhere on the card: not in its text, not in any attribute or field.
    expect(container.innerHTML).not.toContain(VALUE);
  });

  it('empties the form only once the save has landed, and keeps it when refused', async () => {
    const save = deferred();
    renderCard({ onSave: () => save.promise });
    await fillAdd();
    const name = screen.getByLabelText('Secret name') as HTMLInputElement;

    await userEvent.click(screen.getByRole('button', { name: 'Add' }));
    expect(name.value).toBe('github');

    await act(async () => save.settle(false));
    expect(name.value).toBe('github');
    expect((screen.getByLabelText('Sites it may be sent to') as HTMLInputElement).value).toBe(
      'api.github.com',
    );
  });

  it('never shows a value, even while one is being typed', async () => {
    const { container } = renderCard();

    await userEvent.type(screen.getByLabelText('Secret value'), VALUE);

    expect(container.textContent).not.toContain(VALUE);
    expect(screen.queryByText(VALUE)).toBeNull();
  });

  it('will not add without a name, a value and a site', async () => {
    renderCard();
    const add = screen.getByRole('button', { name: 'Add' }) as HTMLButtonElement;
    expect(add.disabled).toBe(true);

    await fillAdd('');
    expect(add.disabled).toBe(true);

    await userEvent.type(screen.getByLabelText('Sites it may be sent to'), 'api.github.com');
    expect(add.disabled).toBe(false);
  });

  it('replaces a value through its own masked field, keeping where it is sent', async () => {
    const { container, onSave } = renderCard();

    await userEvent.click(within(item('github')).getByRole('button', { name: 'Replace…' }));
    const field = screen.getByLabelText('New value for github');
    expect(field.getAttribute('type')).toBe('password');
    await userEvent.type(field, VALUE);
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(onSave).toHaveBeenCalledWith({ name: 'github', value: VALUE });
    expect(screen.queryByLabelText('New value for github')).toBeNull();
    expect(container.innerHTML).not.toContain(VALUE);
  });

  it('keeps the replace form open while the save is refused', async () => {
    renderCard({ onSave: async () => false });

    await userEvent.click(within(item('github')).getByRole('button', { name: 'Replace…' }));
    await userEvent.type(screen.getByLabelText('New value for github'), VALUE);
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(screen.getByLabelText('New value for github')).toBeTruthy();
  });

  it('asks for the sites as well when setting a name a source uses but this Mac does not hold', async () => {
    const { onSave } = renderCard();
    const row = item('calendar');

    expect(within(row).queryByRole('button', { name: 'Delete calendar' })).toBeNull();
    await userEvent.click(within(row).getByRole('button', { name: 'Set…' }));
    await userEvent.type(screen.getByLabelText('New value for calendar'), VALUE);
    await userEvent.type(screen.getByLabelText('Sites calendar may be sent to'), 'cal.test');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(onSave).toHaveBeenCalledWith({ name: 'calendar', value: VALUE, sites: 'cal.test' });
  });

  it('changes where a stored secret may be sent, starting from where it goes now', async () => {
    const { onBind } = renderCard();

    await userEvent.click(within(item('github')).getByRole('button', { name: 'Sites…' }));
    const field = screen.getByLabelText('Sites github may be sent to') as HTMLInputElement;
    expect(field.value).toBe('https://api.github.com');
    await userEvent.type(field, ', uploads.github.com');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(onBind).toHaveBeenCalledWith({
      name: 'github',
      sites: 'https://api.github.com, uploads.github.com',
    });
    expect(screen.queryByLabelText('Sites github may be sent to')).toBeNull();
  });

  it('asks before deleting, and says which sources will stop working', async () => {
    const { onDelete } = renderCard();

    await userEvent.click(screen.getByRole('button', { name: 'Delete github' }));
    const confirm = screen.getByRole('group', { name: 'Delete github?' });
    expect(within(confirm).getByText(/Issues, Stars will fail to refresh/)).toBeTruthy();
    expect(onDelete).not.toHaveBeenCalled();

    await userEvent.click(within(confirm).getByRole('button', { name: 'Delete' }));
    expect(onDelete).toHaveBeenCalledWith('github');
  });

  it('cancelling a delete deletes nothing', async () => {
    const { onDelete } = renderCard();

    await userEvent.click(screen.getByRole('button', { name: 'Delete spare' }));
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(onDelete).not.toHaveBeenCalled();
    expect(screen.queryByRole('group', { name: 'Delete spare?' })).toBeNull();
  });

  it('says why the last change was refused', () => {
    renderCard({ problem: 'the keychain refused access' });
    expect(screen.getByRole('alert').textContent).toBe('the keychain refused access');
  });

  it('says when there are none', () => {
    renderCard({ secrets: [] });
    expect(screen.getByText('No secrets yet.')).toBeTruthy();
  });
});
