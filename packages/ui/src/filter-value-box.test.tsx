// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { QueryFilter } from '@atlas/domain';
import { FilterPopover, type ViewField } from './view-query-popovers.tsx';

/* #212: the Filter control's value box offers what the property can hold. */

const STATUS: ViewField = {
  key: 'status',
  label: 'Status',
  kind: 'select',
  choices: [
    { value: 'next-action', label: 'Next Action' },
    { value: 'in-progress', label: 'In Progress' },
    { value: 'archive', label: 'Archive' },
  ],
};

const PROJECT: ViewField = {
  key: 'project',
  label: 'Project',
  kind: 'relation',
  choices: [
    { value: '[[projects/Larkspur]]', label: 'Larkspur' },
    { value: '[[archive/Larkspur]]', label: 'Larkspur' },
  ],
};

function show(filters: readonly QueryFilter[] = []) {
  const onChange = vi.fn<(filters: readonly QueryFilter[]) => void>();
  const fields: ViewField[] = [
    { key: 'title', label: 'Name' },
    STATUS,
    PROJECT,
    { key: 'due', label: 'Due', kind: 'date' },
    { key: 'phase', label: 'Phase', kind: 'number' },
  ];
  render(<FilterPopover fields={fields} filters={filters} onChange={onChange} />);
  return onChange;
}

async function openOn(property: string, condition = 'is') {
  await userEvent.click(screen.getByRole('button', { name: /Filter/ }));
  await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Property' }), property);
  await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Condition' }), condition);
  return screen.getByRole('combobox', { name: 'Value' });
}

const options = () =>
  within(screen.getByRole('listbox', { name: 'Values' }))
    .getAllByRole('option')
    .map((option) => option.textContent);

describe('the filter value box', () => {
  it('lists the property’s choices when focused, and narrows them as it is typed in', async () => {
    show();
    const box = await openOn('status');
    expect(box.getAttribute('aria-expanded')).toBe('false');

    await userEvent.click(box);
    expect(box.getAttribute('aria-expanded')).toBe('true');
    expect(options()).toEqual(['Next Action', 'In Progress', 'Archive']);

    await userEvent.type(box, 'prog');
    expect(options()).toEqual(['In Progress']);
  });

  it('picks a choice from the keyboard and stores its value, not its label', async () => {
    const onChange = show();
    const box = await openOn('status', 'isNot');
    await userEvent.click(box);

    await userEvent.keyboard('{ArrowDown}{ArrowDown}');
    const active = box.getAttribute('aria-activedescendant');
    expect(active).not.toBeNull();
    expect(document.getElementById(active ?? '')?.textContent).toBe('In Progress');
    await userEvent.keyboard('{ArrowUp}');
    expect(
      document.getElementById(box.getAttribute('aria-activedescendant') ?? '')?.textContent,
    ).toBe('Next Action');

    // The first Enter picks; the list closes and the second adds the filter.
    await userEvent.keyboard('{Enter}');
    expect((box as HTMLInputElement).value).toBe('Next Action');
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
    await userEvent.keyboard('{Enter}');

    expect(onChange).toHaveBeenCalledExactlyOnceWith([
      { key: 'status', operator: 'isNot', value: 'next-action' },
    ]);
  });

  it('stores the option a typed label names', async () => {
    const onChange = show();
    const box = await openOn('status');
    await userEvent.type(box, 'archive');
    await userEvent.click(screen.getByRole('button', { name: 'Add filter' }));
    expect(onChange).toHaveBeenCalledExactlyOnceWith([
      { key: 'status', operator: 'is', value: 'archive' },
    ]);
  });

  it('keeps the very note picked when two share a title', async () => {
    const onChange = show();
    const box = await openOn('project');
    await userEvent.click(box);
    await userEvent.click(within(screen.getByRole('listbox')).getAllByRole('option')[1]!);
    expect((box as HTMLInputElement).value).toBe('Larkspur');
    await userEvent.click(screen.getByRole('button', { name: 'Add filter' }));
    expect(onChange).toHaveBeenCalledExactlyOnceWith([
      { key: 'project', operator: 'is', value: '[[archive/Larkspur]]' },
    ]);
  });

  it('closes its list on Escape and leaves the Filter popover open', async () => {
    show();
    const box = await openOn('status');
    await userEvent.click(box);
    expect(screen.getByRole('listbox')).toBeDefined();

    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(screen.getByRole('dialog', { name: 'Filter' })).toBeDefined();
  });

  it('starts empty for another property', async () => {
    show();
    const box = await openOn('status');
    await userEvent.type(box, 'archive');
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Property' }), 'phase');
    expect((screen.getByRole('combobox', { name: 'Value' }) as HTMLInputElement).value).toBe('');
  });

  it('offers nothing to pick for a property only ever typed', async () => {
    show();
    const box = await openOn('phase');
    await userEvent.click(box);
    expect(box.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('gives a date a date picker that fills the value', async () => {
    const onChange = show();
    await openOn('due', 'lessThan');
    const picker = screen.getByLabelText('Pick a date');
    expect(picker.getAttribute('type')).toBe('date');
    await userEvent.type(picker, '2026-10-14');
    await userEvent.click(screen.getByRole('button', { name: 'Add filter' }));
    expect(onChange).toHaveBeenCalledExactlyOnceWith([
      { key: 'due', operator: 'lessThan', value: '2026-10-14' },
    ]);
  });

  it('reads a filter set by its choice’s label', async () => {
    show([{ key: 'status', operator: 'isNot', value: 'next-action' }]);
    await userEvent.click(screen.getByRole('button', { name: /Filter/ }));
    expect(screen.getByText('Status is not Next Action')).toBeDefined();
  });
});

describe('a relation filter that is not an exact match', () => {
  const LAUNCH: ViewField = {
    key: 'project',
    label: 'Project',
    kind: 'relation',
    choices: [
      { value: '[[Larkspur launch]]', label: 'Larkspur launch' },
      { value: '[[Quill audit]]', label: 'Quill audit' },
    ],
  };

  function showLaunch() {
    const onChange = vi.fn<(filters: readonly QueryFilter[]) => void>();
    render(
      <FilterPopover
        fields={[{ key: 'title', label: 'Name' }, LAUNCH]}
        filters={[]}
        onChange={onChange}
      />,
    );
    return onChange;
  }

  it('stores the text typed for "contains", not the link of the note it names', async () => {
    // As a link, "Larkspur launch" would no longer be found in
    // `[[projects/Larkspur launch]]` or `[[Larkspur launch|Launch]]`.
    const onChange = showLaunch();
    const box = await openOn('project', 'contains');
    await userEvent.type(box, 'Larkspur launch');
    await userEvent.click(screen.getByRole('button', { name: 'Add filter' }));

    expect(onChange).toHaveBeenCalledExactlyOnceWith([
      { key: 'project', operator: 'contains', value: 'Larkspur launch' },
    ]);
  });

  it('stores the words of a note picked for "starts with", not its link', async () => {
    const onChange = showLaunch();
    const box = await openOn('project', 'startsWith');
    await userEvent.click(box);
    await userEvent.click(within(screen.getByRole('listbox')).getAllByRole('option')[0]!);
    await userEvent.click(screen.getByRole('button', { name: 'Add filter' }));

    expect(onChange).toHaveBeenCalledExactlyOnceWith([
      { key: 'project', operator: 'startsWith', value: 'Larkspur launch' },
    ]);
  });
});

describe('choices gathered only once wanted', () => {
  function showWanting(filters: readonly QueryFilter[] = []) {
    const onWantChoices = vi.fn<(key: string) => void>();
    render(
      <FilterPopover
        fields={[{ key: 'title', label: 'Name' }, STATUS, PROJECT]}
        filters={filters}
        onChange={vi.fn()}
        onWantChoices={onWantChoices}
      />,
    );
    return onWantChoices;
  }

  it('asks for nothing until the Filter control is opened', () => {
    const onWantChoices = showWanting([{ key: 'project', operator: 'is', value: '[[x]]' }]);
    expect(onWantChoices).not.toHaveBeenCalled();
  });

  it('asks for the choices of each filter it lists, so each reads by its label', async () => {
    const onWantChoices = showWanting([{ key: 'project', operator: 'is', value: '[[x]]' }]);
    await userEvent.click(screen.getByRole('button', { name: /Filter/ }));
    expect(onWantChoices).toHaveBeenCalledWith('project');
  });

  it('asks for a property’s choices when its value box opens', async () => {
    const onWantChoices = showWanting();
    const box = await openOn('project');
    expect(onWantChoices).not.toHaveBeenCalled();
    await userEvent.click(box);
    expect(onWantChoices).toHaveBeenCalledExactlyOnceWith('project');
  });
});
