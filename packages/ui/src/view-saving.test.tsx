// @vitest-environment jsdom
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { NewViewRequest } from '@atlas/domain';
import { NewViewDialog } from './new-view-dialog.tsx';
import { SearchPalette } from './search-palette.tsx';
import { ViewSaveControls } from './view-save-controls.tsx';
import { GroupByPopover, PropertiesPopover } from './view-settings-popovers.tsx';

const TYPES = [
  { value: 'task', label: 'Task' },
  { value: 'note', label: 'Note' },
];
const LAYOUTS = [
  { value: 'table' as const, label: 'Table' },
  { value: 'board' as const, label: 'Board' },
];

function newView(problemsFor: (request: NewViewRequest) => string[] = () => []) {
  const onCreate = vi.fn();
  const seen: NewViewRequest[] = [];
  function Harness() {
    const [request, setRequest] = useState<NewViewRequest>({
      name: '',
      type: 'task',
      layout: 'table',
    });
    seen.push(request);
    return (
      <NewViewDialog
        request={request}
        types={TYPES}
        layouts={LAYOUTS}
        problems={problemsFor(request)}
        onChange={setRequest}
        onCreate={onCreate}
        onClose={() => undefined}
      />
    );
  }
  render(<Harness />);
  return { onCreate, last: () => seen.at(-1) };
}

describe('NewViewDialog', () => {
  it('takes a name, a type and a layout, and creates', async () => {
    const { onCreate, last } = newView();
    await userEvent.type(screen.getByRole('textbox', { name: 'View name' }), 'Notes board');
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Type' }), 'note');
    const board = screen.getByRole('button', { name: 'Board' });
    await userEvent.click(board);
    expect(board.getAttribute('aria-pressed')).toBe('true');
    await userEvent.click(screen.getByRole('button', { name: 'Create view' }));
    expect(last()).toEqual({ name: 'Notes board', type: 'note', layout: 'board' });
    expect(onCreate).toHaveBeenCalledTimes(1);
  });

  it('shows what stops it, and does not create', async () => {
    const { onCreate } = newView((request) =>
      request.layout === 'board'
        ? ['A board needs a property to group by, and Task has none.']
        : [],
    );
    await userEvent.type(screen.getByRole('textbox', { name: 'View name' }), 'x');
    await userEvent.click(screen.getByRole('button', { name: 'Board' }));
    expect(screen.getByRole('alert').textContent).toMatch(/needs a property to group by/);
    await userEvent.click(screen.getByRole('button', { name: 'Create view' }));
    expect(onCreate).not.toHaveBeenCalled();
  });

  it('says nothing about a blank name until Create is pressed', async () => {
    newView((request) => (request.name === '' ? ['Name the view.'] : []));
    expect(screen.queryByRole('alert')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Create view' }));
    expect(screen.getByRole('alert').textContent).toBe('Name the view.');
  });
});

describe('ViewSaveControls', () => {
  it('saves, resets, and saves as a new view under the name given', async () => {
    const onSave = vi.fn();
    const onReset = vi.fn();
    const onSaveAs = vi.fn();
    render(
      <ViewSaveControls
        suggestedName="Board copy"
        error={null}
        onSave={onSave}
        onReset={onReset}
        onSaveAs={onSaveAs}
      />,
    );
    const group = screen.getByRole('group', { name: 'Unsaved view changes' });
    await userEvent.click(within(group).getByRole('button', { name: 'Save view' }));
    await userEvent.click(within(group).getByRole('button', { name: 'Reset' }));
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onReset).toHaveBeenCalledTimes(1);

    await userEvent.click(within(group).getByRole('button', { name: 'Save as new view…' }));
    const name = await screen.findByRole('textbox', { name: 'New view name' });
    expect((name as HTMLInputElement).value).toBe('Board copy');
    await userEvent.clear(name);
    await userEvent.type(name, 'Open work{Enter}');
    expect(onSaveAs).toHaveBeenCalledWith('Open work');
  });

  it('shows why a new view could not be saved', async () => {
    render(
      <ViewSaveControls
        suggestedName="x"
        error="There is already a view called “x”."
        onSave={() => undefined}
        onReset={() => undefined}
        onSaveAs={() => undefined}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Save as new view…' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/already a view/);
  });
});

describe('the toolbar’s view settings', () => {
  const FIELDS = [
    { key: 'status', label: 'Status' },
    { key: 'phase', label: 'Phase' },
    { key: 'due', label: 'Due' },
  ];

  const CHOICES = [
    ...FIELDS.map((field) => ({ ...field, reason: null })),
    {
      key: 'labels',
      label: 'Labels',
      reason: 'A note can have several of labels, so it cannot be grouped by it.',
    },
  ];

  function group(props: Partial<Parameters<typeof GroupByPopover>[0]> = {}) {
    const onChange = vi.fn();
    const onChangeSub = vi.fn();
    render(
      <GroupByPopover
        choices={CHOICES}
        groupBy="status"
        subGroupBy={null}
        onChange={onChange}
        onChangeSub={onChangeSub}
        {...props}
      />,
    );
    return { onChange, onChangeSub };
  }

  const groupBy = () => screen.findByRole('radiogroup', { name: 'Group by' });
  const thenBy = () => screen.getByRole('radiogroup', { name: 'Then by' });

  it('groups by the property picked', async () => {
    const { onChange } = group();
    await userEvent.click(screen.getByRole('button', { name: 'Group' }));
    const status = within(await groupBy()).getByRole('radio', { name: 'Status' });
    expect((status as HTMLInputElement).checked).toBe(true);
    await userEvent.click(within(await groupBy()).getByRole('radio', { name: 'Phase' }));
    expect(onChange).toHaveBeenCalledWith('phase');
  });

  it('then sub-groups by another property, never the grouping itself', async () => {
    const { onChangeSub } = group({ subGroupBy: 'due' });
    await userEvent.click(screen.getByRole('button', { name: 'Group' }));
    await groupBy();
    const offered = within(thenBy())
      .getAllByRole('radio')
      .map((radio) => radio.parentElement?.textContent);
    expect(offered).toEqual(['None', 'Phase', 'Due', 'Labels']);
    expect((within(thenBy()).getByRole('radio', { name: 'Due' }) as HTMLInputElement).checked).toBe(
      true,
    );
    await userEvent.click(within(thenBy()).getByRole('radio', { name: 'Phase' }));
    expect(onChangeSub).toHaveBeenCalledWith('phase');
    await userEvent.click(within(thenBy()).getByRole('radio', { name: 'None' }));
    expect(onChangeSub).toHaveBeenCalledWith(null);
  });

  it('lets a table be ungrouped, but a board must keep its columns', async () => {
    const { onChange } = group();
    await userEvent.click(screen.getByRole('button', { name: 'Group' }));
    await userEvent.click(within(await groupBy()).getByRole('radio', { name: 'None' }));
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it('offers no "None" for a board, and no "Then by" before there is a grouping', async () => {
    group({ required: true, groupBy: null });
    await userEvent.click(screen.getByRole('button', { name: 'Group' }));
    const radios = within(await groupBy()).getAllByRole('radio');
    expect(radios.map((radio) => radio.parentElement?.textContent)).toEqual([
      'Status',
      'Phase',
      'Due',
      'Labels',
    ]);
    expect(screen.queryByRole('radiogroup', { name: 'Then by' })).toBeNull();
  });

  it('shows why a field holding several values cannot group, and will not take it', async () => {
    const { onChange, onChangeSub } = group();
    await userEvent.click(screen.getByRole('button', { name: 'Group' }));
    const labels = within(await groupBy()).getByRole('radio', { name: 'Labels' });
    expect((labels as HTMLInputElement).disabled).toBe(true);
    expect(labels.getAttribute('aria-describedby')).not.toBeNull();
    const reason = document.getElementById(labels.getAttribute('aria-describedby') ?? '');
    expect(reason?.textContent).toBe(
      'A note can have several of labels, so it cannot be grouped by it.',
    );
    await userEvent.click(labels);
    await userEvent.click(within(thenBy()).getByRole('radio', { name: 'Labels' }));
    expect(onChange).not.toHaveBeenCalled();
    expect(onChangeSub).not.toHaveBeenCalled();
  });

  it('lists shown properties in order, then hidden ones, and moves and toggles them', async () => {
    const onChange = vi.fn();
    const onMove = vi.fn();
    render(
      <PropertiesPopover
        fields={FIELDS}
        columns={['phase', 'status']}
        onChange={onChange}
        onMove={onMove}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Properties' }));
    const shown = await screen.findByRole('list', { name: 'Shown properties' });
    expect(
      within(shown)
        .getAllByRole('checkbox')
        .map((box) => box.parentElement?.textContent),
    ).toEqual(['Phase', 'Status']);
    expect(
      (screen.getByRole('button', { name: 'Move Phase earlier' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    await userEvent.click(screen.getByRole('button', { name: 'Move Phase later' }));
    expect(onMove).toHaveBeenCalledWith('phase', 1);

    const hidden = screen.getByRole('list', { name: 'Hidden properties' });
    await userEvent.click(within(hidden).getByRole('checkbox', { name: 'Due' }));
    expect(onChange).toHaveBeenCalledWith('due');
  });
});

describe('SearchPalette commands', () => {
  it('lists the commands the query names above the notes, and runs one on Enter', async () => {
    const onCommand = vi.fn();
    const onPick = vi.fn();
    render(
      <SearchPalette
        query="new q"
        hits={[{ path: 'a.md', title: 'A', snippet: '' }]}
        selected={0}
        onQuery={() => undefined}
        onMove={() => undefined}
        onPick={onPick}
        onClose={() => undefined}
        commands={[{ id: 'new-query', label: 'New query' }]}
        onCommand={onCommand}
      />,
    );
    const options = screen.getAllByRole('option');
    expect(options.map((option) => option.textContent)).toEqual([
      expect.stringContaining('New query'),
      expect.stringContaining('A'),
    ]);
    expect(options[0]?.getAttribute('aria-selected')).toBe('true');
    await userEvent.type(screen.getByRole('searchbox'), '{Enter}');
    expect(onCommand).toHaveBeenCalledWith('new-query');
    expect(onPick).not.toHaveBeenCalled();
  });

  it('opens the note when the selection is past the commands', async () => {
    const onPick = vi.fn();
    render(
      <SearchPalette
        query="new"
        hits={[{ path: 'a.md', title: 'A', snippet: '' }]}
        selected={1}
        onQuery={() => undefined}
        onMove={() => undefined}
        onPick={onPick}
        onClose={() => undefined}
        commands={[{ id: 'new-query', label: 'New query' }]}
        onCommand={() => undefined}
      />,
    );
    await userEvent.type(screen.getByRole('searchbox'), '{Enter}');
    expect(onPick).toHaveBeenCalledWith('a.md');
  });
});
