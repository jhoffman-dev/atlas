// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createVaultPath, type ViewTab } from '@atlas/domain';
import { ViewToolbar, type ViewToolbarProps } from './view-toolbar.tsx';

const tab = (title: string, icon: ViewTab['icon'], selected = false): ViewTab => ({
  path: createVaultPath(`.atlas/views/${title}.md`),
  title,
  icon,
  selected,
  virtual: false,
  movable: false,
  deletable: false,
});

function show(overrides: Partial<ViewToolbarProps> = {}) {
  const props: ViewToolbarProps = {
    tabs: [tab('Board', 'board', true), tab('All tasks', 'table'), tab('Roadmap', 'timeline')],
    onOpenView: vi.fn(),
    fields: [
      { key: 'title', label: 'Name' },
      { key: 'status', label: 'Status', kind: 'select' },
      { key: 'phase', label: 'Phase', kind: 'number' },
    ],
    filters: [],
    sorts: [],
    onChangeFilters: vi.fn(),
    onChangeSorts: vi.fn(),
    newLabel: 'New task',
    onNew: vi.fn(),
    ...overrides,
  };
  render(<ViewToolbar {...props} />);
  return props;
}

const tabs = () => within(screen.getByRole('navigation', { name: 'Views' }));

describe('ViewToolbar tabs', () => {
  it('lists the views over the type, marking the one that is open', () => {
    show();
    expect(
      tabs()
        .getAllByRole('button')
        .map((button) => button.textContent),
    ).toEqual(['Board', 'All tasks', 'Roadmap']);
    expect(tabs().getByRole('button', { name: 'Board' }).getAttribute('aria-pressed')).toBe('true');
    expect(tabs().getByRole('button', { name: 'Roadmap' }).getAttribute('aria-pressed')).toBe(
      'false',
    );
  });

  it('opens another view when its tab is pressed, and does nothing for the open one', async () => {
    const props = show();
    await userEvent.click(tabs().getByRole('button', { name: 'All tasks' }));
    await userEvent.click(tabs().getByRole('button', { name: 'Board' }));
    expect(props.onOpenView).toHaveBeenCalledExactlyOnceWith('.atlas/views/All tasks.md');
  });
});

describe('ViewToolbar new', () => {
  it('adds a note of the view’s type', async () => {
    const props = show();
    await userEvent.click(screen.getByRole('button', { name: 'New task' }));
    expect(props.onNew).toHaveBeenCalledOnce();
  });
});

describe('ViewToolbar filter', () => {
  it('lists the filters as sentences and removes one', async () => {
    const props = show({
      filters: [
        { key: 'status', operator: 'isNot', value: 'done' },
        { key: 'phase', operator: 'isEmpty' },
      ],
    });
    await userEvent.click(screen.getByRole('button', { name: /Filter/ }));

    expect(screen.getByText('Status is not done')).toBeDefined();
    await userEvent.click(screen.getByRole('button', { name: 'Remove filter: Phase is empty' }));
    expect(props.onChangeFilters).toHaveBeenCalledExactlyOnceWith([
      { key: 'status', operator: 'isNot', value: 'done' },
    ]);
  });

  it('adds a filter, storing a number as a number', async () => {
    const props = show();
    await userEvent.click(screen.getByRole('button', { name: /Filter/ }));

    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Property' }), 'phase');
    await userEvent.selectOptions(
      screen.getByRole('combobox', { name: 'Condition' }),
      'greaterThan',
    );
    await userEvent.type(screen.getByRole('textbox', { name: 'Value' }), '14');
    await userEvent.click(screen.getByRole('button', { name: 'Add filter' }));

    expect(props.onChangeFilters).toHaveBeenCalledExactlyOnceWith([
      { key: 'phase', operator: 'greaterThan', value: 14 },
    ]);
  });

  it('keeps digits typed for a property that is not a number as the text typed', async () => {
    const props = show();
    await userEvent.click(screen.getByRole('button', { name: /Filter/ }));

    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Property' }), 'status');
    await userEvent.type(screen.getByRole('textbox', { name: 'Value' }), '007');
    await userEvent.click(screen.getByRole('button', { name: 'Add filter' }));

    expect(props.onChangeFilters).toHaveBeenCalledExactlyOnceWith([
      { key: 'status', operator: 'is', value: '007' },
    ]);
  });

  it('asks for no value where the condition needs none, and waits for one where it does', async () => {
    const props = show();
    await userEvent.click(screen.getByRole('button', { name: /Filter/ }));

    const add = screen.getByRole('button', { name: 'Add filter' });
    expect((add as HTMLButtonElement).disabled).toBe(true);

    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Condition' }), 'isEmpty');
    expect(screen.queryByRole('textbox', { name: 'Value' })).toBeNull();
    await userEvent.click(add);
    expect(props.onChangeFilters).toHaveBeenCalledExactlyOnceWith([
      { key: 'title', operator: 'isEmpty' },
    ]);
  });

  it('shows how many filters are set on the button', () => {
    show({ filters: [{ key: 'status', operator: 'is', value: 'done' }] });
    expect(screen.getByRole('button', { name: /Filter/ }).textContent).toBe('Filter1');
  });

  it('shows no count on Sort, since a sort hides nothing', () => {
    show({ sorts: [{ key: 'phase', direction: 'asc' }] });
    expect(screen.getByRole('button', { name: /^Sort/ }).textContent).toBe('Sort');
  });
});

describe('ViewToolbar sort', () => {
  it('turns a sort round, and takes one off', async () => {
    const props = show({
      sorts: [
        { key: 'phase', direction: 'asc' },
        { key: 'title', direction: 'desc' },
      ],
    });
    await userEvent.click(screen.getByRole('button', { name: /^Sort/ }));

    await userEvent.click(screen.getByRole('button', { name: 'Sort Phase descending' }));
    expect(props.onChangeSorts).toHaveBeenLastCalledWith([
      { key: 'phase', direction: 'desc' },
      { key: 'title', direction: 'desc' },
    ]);

    await userEvent.click(screen.getByRole('button', { name: 'Stop sorting by Name' }));
    expect(props.onChangeSorts).toHaveBeenLastCalledWith([{ key: 'phase', direction: 'asc' }]);
  });

  it('adds a sort by a property not yet sorted by, ascending', async () => {
    const props = show({ sorts: [{ key: 'phase', direction: 'asc' }] });
    await userEvent.click(screen.getByRole('button', { name: /^Sort/ }));

    const pick = screen.getByRole('combobox', { name: 'Sort by' });
    const offered = within(pick)
      .getAllByRole('option')
      .map((option) => option.textContent);
    expect(offered).toEqual(['Sort by…', 'Name', 'Status']);

    await userEvent.selectOptions(pick, 'status');
    expect(props.onChangeSorts).toHaveBeenCalledExactlyOnceWith([
      { key: 'phase', direction: 'asc' },
      { key: 'status', direction: 'asc' },
    ]);
  });
});

describe('ViewToolbar and archived notes', () => {
  it('offers nothing about the Archive unless asked to', () => {
    show();
    expect(screen.queryByRole('button', { name: /Include archived/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Select' })).toBeNull();
  });

  it('turns Include archived on and off, showing which it is', async () => {
    const onChange = vi.fn();
    show({ archived: { included: false, onChange } });
    const button = screen.getByRole('button', { name: /Include archived/ });
    expect(button.getAttribute('aria-pressed')).toBe('false');
    await userEvent.click(button);
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it('turns select mode on from Select', async () => {
    const onChange = vi.fn();
    show({ selecting: { on: true, onChange } });
    const button = screen.getByRole('button', { name: 'Select' });
    expect(button.getAttribute('aria-pressed')).toBe('true');
    await userEvent.click(button);
    expect(onChange).toHaveBeenCalledWith(false);
  });
});
