// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { newWidgetDraft, optionsOfKind, parseDashboard, type WidgetDraft } from '@atlas/domain';
import { WidgetEditor, type WidgetEditorProps } from './widget-editor.tsx';

const bar: WidgetDraft = { ...newWidgetDraft({ kind: 'bar', type: 'task' }), groupBy: 'status' };

function props(more: Partial<WidgetEditorProps> = {}): WidgetEditorProps {
  const draft = more.draft ?? bar;
  return {
    mode: 'add',
    draft,
    options: optionsOfKind(draft.kind),
    defaultTitle: 'task',
    problems: [],
    preview: null,
    types: [
      { value: 'task', label: 'Task' },
      { value: 'person', label: 'Person' },
    ],
    views: [{ value: '.atlas/views/Open.md', label: 'Open' }],
    fields: [
      { key: 'title', label: 'Name' },
      { key: 'status', label: 'Status', kind: 'select' },
    ],
    groupings: [{ value: 'status', label: 'Status' }],
    groupValues: ['backlog', 'doing', 'done'],
    onChange: vi.fn(),
    onKind: vi.fn(),
    onType: vi.fn(),
    onStartFromView: vi.fn(),
    onSave: vi.fn(),
    onClose: vi.fn(),
    ...more,
  };
}

const sheet = () => screen.getByRole('dialog', { name: 'Add widget' });

describe('WidgetEditor', () => {
  it('picks a kind from the pictures', async () => {
    const given = props();
    render(<WidgetEditor {...given} />);
    const kinds = within(sheet()).getByRole('radiogroup', { name: 'Kind' });
    expect(
      within(kinds).getByRole('radio', { name: 'Bar chart' }).getAttribute('aria-checked'),
    ).toBe('true');

    await userEvent.click(within(kinds).getByRole('radio', { name: 'Donut' }));

    expect(given.onKind).toHaveBeenCalledExactlyOnceWith('donut');
  });

  it('offers only what the kind reads', () => {
    const number = newWidgetDraft({ kind: 'number', type: 'task' });
    render(<WidgetEditor {...props({ draft: number })} />);
    expect(screen.queryByLabelText('Group by')).toBeNull();
    expect(screen.queryByLabelText('Call out')).toBeNull();
    expect(screen.getByRole('radiogroup', { name: 'Icon' })).toBeTruthy();
    expect(screen.queryByRole('group', { name: 'Progress' })).toBeNull();
  });

  it('offers a hero its grouping, call-out and progress', () => {
    const hero = newWidgetDraft({ kind: 'hero', type: 'task' });
    render(<WidgetEditor {...props({ draft: hero })} />);
    expect(screen.getByLabelText('Group by')).toBeTruthy();
    expect(screen.getByLabelText('Call out')).toBeTruthy();
    expect(screen.getByRole('group', { name: 'Progress' })).toBeTruthy();
    expect(screen.queryByRole('radiogroup', { name: 'Icon' })).toBeNull();
  });

  it('changes the title, grouping and width', async () => {
    const given = props();
    render(<WidgetEditor {...given} />);

    await userEvent.type(screen.getByLabelText('Title'), 'X');
    expect(given.onChange).toHaveBeenLastCalledWith({ ...bar, title: 'X' });

    await userEvent.selectOptions(screen.getByLabelText('Group by'), '');
    expect(given.onChange).toHaveBeenLastCalledWith({ ...bar, groupBy: '' });
  });

  it('calls a group out by one of its values', async () => {
    const given = props();
    render(<WidgetEditor {...given} />);
    await userEvent.selectOptions(screen.getByLabelText('Call out'), 'doing');
    expect(given.onChange).toHaveBeenLastCalledWith({ ...bar, highlight: 'doing' });
  });

  it('adds a filter in place, without opening another overlay', async () => {
    const given = props();
    render(<WidgetEditor {...given} />);
    const filters = screen.getByRole('group', { name: 'Filters' });

    await userEvent.selectOptions(
      within(filters).getByRole('combobox', { name: 'Property' }),
      'status',
    );
    await userEvent.type(within(filters).getByRole('textbox', { name: 'Value' }), 'done');
    await userEvent.click(within(filters).getByRole('button', { name: 'Add filter' }));

    expect(given.onChange).toHaveBeenLastCalledWith({
      ...bar,
      filters: [{ key: 'status', operator: 'is', value: 'done' }],
    });
    // Adding a filter is not saving the widget.
    expect(given.onSave).not.toHaveBeenCalled();
    expect(given.onClose).not.toHaveBeenCalled();
  });

  it('changes the type, and starts from a saved view', async () => {
    const given = props();
    render(<WidgetEditor {...given} />);

    await userEvent.selectOptions(screen.getByLabelText('Type'), 'person');
    expect(given.onType).toHaveBeenCalledExactlyOnceWith('person');

    await userEvent.selectOptions(
      screen.getByLabelText('Start from a view'),
      '.atlas/views/Open.md',
    );
    expect(given.onStartFromView).toHaveBeenCalledExactlyOnceWith('.atlas/views/Open.md');
  });

  it('explains what stops it being saved, and will not save', async () => {
    const given = props({ problems: ['A bar chart needs a property to group by.'] });
    render(<WidgetEditor {...given} />);

    expect(screen.getByText('A bar chart needs a property to group by.')).toBeTruthy();
    const save = screen.getByRole('button', { name: 'Add widget' }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    await userEvent.click(save);
    expect(given.onSave).not.toHaveBeenCalled();
  });

  it('saves a widget that can be drawn', async () => {
    const given = props({ mode: 'edit' });
    render(<WidgetEditor {...given} />);
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(given.onSave).toHaveBeenCalledOnce();
  });

  it('draws the preview as the dashboard would', () => {
    const [widget] = parseDashboard({
      atlas: 'dashboard',
      widgets: [{ title: 'Doing now', kind: 'number', type: 'task' }],
    });
    if (widget === undefined) throw new Error('the preview widget does not parse');
    render(
      <WidgetEditor
        {...props({ preview: { widget, sql: 'SELECT 1', data: { shape: 'number', value: '12' } } })}
      />,
    );
    const preview = screen.getByRole('region', { name: 'Preview' });
    expect(within(preview).getByRole('region', { name: 'Doing now' }).textContent).toContain('12');
  });

  it('closes on Cancel without saving', async () => {
    const given = props();
    render(<WidgetEditor {...given} />);
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(given.onClose).toHaveBeenCalled();
    expect(given.onSave).not.toHaveBeenCalled();
  });
});
