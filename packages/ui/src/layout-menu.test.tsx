// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { layoutChoices, type PropertyDef } from '@atlas/domain';
import { LayoutMenu } from './layout-menu.tsx';

const status: PropertyDef = {
  key: 'status',
  kind: 'select',
  label: 'Status',
  required: false,
  options: ['todo', 'done'],
  target: null,
  many: false,
};

/** A type with a status and no date: a board can be drawn, a calendar cannot. */
const choices = layoutChoices({ name: 'task', label: 'Task', properties: [status] });

async function openMenu(onChoose = vi.fn()) {
  render(<LayoutMenu choices={choices} current="table" onChoose={onChoose} />);
  await userEvent.click(screen.getByRole('button', { name: 'Layout' }));
  return onChoose;
}

describe('LayoutMenu', () => {
  it('lists every layout, the current one checked', async () => {
    await openMenu();
    const items = await screen.findAllByRole('menuitemradio');
    expect(items.map((item) => item.textContent?.split(/(?=A )/)[0])).toEqual([
      'Table',
      'Board',
      'List',
      'Gallery',
      'Feed',
      'Calendar',
      'Timeline',
    ]);
    const table = screen.getByRole('menuitemradio', { name: /Table/ });
    expect(table.getAttribute('aria-checked')).toBe('true');
    expect(screen.getByRole('menuitemradio', { name: /Feed/ }).getAttribute('aria-checked')).toBe(
      'false',
    );
  });

  it('draws the view as the layout chosen', async () => {
    const onChoose = await openMenu();
    await userEvent.click(await screen.findByRole('menuitemradio', { name: /Feed/ }));
    expect(onChoose).toHaveBeenCalledWith('feed');
  });

  it('explains, and will not choose, a layout the type cannot draw', async () => {
    const onChoose = await openMenu();
    const calendar = await screen.findByRole('menuitemradio', { name: /Calendar/ });
    expect(calendar.textContent).toContain('A calendar needs a date');
    expect(calendar.getAttribute('aria-disabled')).toBe('true');
    await userEvent.click(calendar);
    expect(onChoose).not.toHaveBeenCalled();
  });

  it('does nothing when the current layout is chosen again', async () => {
    const onChoose = await openMenu();
    await userEvent.click(await screen.findByRole('menuitemradio', { name: /Table/ }));
    expect(onChoose).not.toHaveBeenCalled();
  });
});
