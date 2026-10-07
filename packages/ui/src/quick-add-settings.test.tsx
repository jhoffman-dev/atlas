// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QuickAddSettings, type QuickAddRow } from './quick-add-settings.tsx';

const row = (name: string, label: string, missing = false): QuickAddRow => ({
  name,
  label,
  icon: 'task',
  missing,
});

function renderWith(
  rows: readonly QuickAddRow[],
  available = [{ name: 'person', label: 'Person' }],
) {
  const handlers = { onAdd: vi.fn(), onRemove: vi.fn(), onMove: vi.fn() };
  render(
    <QuickAddSettings rows={rows} available={available} limit={5} problem={null} {...handlers} />,
  );
  return handlers;
}

const card = () => screen.getByRole('region', { name: 'Quick add' });

describe('QuickAddSettings', () => {
  it('lists the types the button offers, in order', () => {
    renderWith([row('task', 'Task'), row('project', 'Project')]);
    const labels = within(card())
      .getAllByRole('listitem')
      .map((item) => item.querySelector('.quick-add-settings__label')?.textContent);
    expect(labels).toEqual(['Task', 'Project']);
  });

  it("adds a type picked from the vault's types", async () => {
    const { onAdd } = renderWith([row('task', 'Task')]);
    await userEvent.selectOptions(
      screen.getByRole('combobox', { name: 'Add a type to quick add' }),
      'Person',
    );
    expect(onAdd).toHaveBeenCalledWith('person');
  });

  it('takes a type away', async () => {
    const { onRemove } = renderWith([row('task', 'Task'), row('project', 'Project')]);
    await userEvent.click(screen.getByRole('button', { name: 'Remove Project from quick add' }));
    expect(onRemove).toHaveBeenCalledWith('project');
  });

  it('reorders from the keyboard with Alt and an arrow', async () => {
    const { onMove } = renderWith([row('task', 'Task'), row('project', 'Project')]);
    screen.getByRole('button', { name: 'Move Project' }).focus();
    await userEvent.keyboard('{Alt>}{ArrowUp}{/Alt}');
    expect(onMove).toHaveBeenCalledWith({ id: 'project', to: 0 });
  });

  it('flags a type the vault no longer has', () => {
    renderWith([row('task', 'Task'), row('book', 'book', true)]);
    const flagged = screen.getByText('Not in this vault — skipped');
    expect(flagged.closest('[data-missing]')?.getAttribute('data-missing')).toBe('true');
    expect(screen.getAllByText('Not in this vault — skipped')).toHaveLength(1);
  });

  it('refuses a sixth type', () => {
    const five = ['a', 'b', 'c', 'd', 'e'].map((name) => row(name, name));
    renderWith(five);
    const add = screen.getByRole('combobox', { name: 'Add a type to quick add' });
    expect((add as HTMLSelectElement).disabled).toBe(true);
    expect(within(add).getByText('5 is the most')).toBeDefined();
  });

  it('says the button is hidden when nothing is listed', () => {
    renderWith([]);
    expect(screen.getByText(/the button is hidden/)).toBeDefined();
  });
});
