// @vitest-environment jsdom
/**
 * The type editor renders a type and hands every change over as a `TypeEdit`;
 * it decides nothing. What is asserted is that each control is reachable by
 * name and by keyboard, and that it asks for the change it is labelled with.
 */
import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { parseObjectType, TYPE_ICONS, type TypeEdit } from '@atlas/domain';
import { TypeEditor } from './type-editor.tsx';

const TASK = parseObjectType({
  name: 'task',
  label: 'Task',
  properties: {
    status: { kind: 'select', options: ['backlog', 'review', 'done'], colors: { review: 'next' } },
    due: 'date',
    project: { kind: 'relation', target: 'project' },
  },
});

const TARGETS = [
  { name: 'project', label: 'Project' },
  { name: 'person', label: 'Person' },
  { name: 'task', label: 'Task' },
];

function editor(overrides: Partial<Parameters<typeof TypeEditor>[0]> = {}) {
  const onEdit = vi.fn<(edit: TypeEdit) => void>();
  render(
    <TypeEditor
      type={TASK}
      icons={TYPE_ICONS}
      targets={TARGETS}
      prompt={null}
      notice={null}
      onEdit={onEdit}
      {...overrides}
    />,
  );
  return onEdit;
}

const open = async (label: string) =>
  userEvent.click(screen.getByRole('button', { name: `Edit ${label}` }));

describe('TypeEditor', () => {
  it('lists the properties in order, each with its kind', () => {
    editor();
    const list = screen
      .getAllByRole('listitem')
      .filter((item) => item.closest('.type-editor__properties'));
    expect(list.map((item) => item.querySelector('.type-editor__label')?.textContent)).toEqual([
      'Status',
      'Due',
      'Project',
    ]);
    expect(screen.getByText('Relation')).toBeDefined();
  });

  it('adds a property', async () => {
    const onEdit = editor();
    await userEvent.click(screen.getByRole('button', { name: 'Add property' }));
    expect(onEdit).toHaveBeenCalledWith({ kind: 'addProperty', label: 'Property' });
  });

  it('opens a property in place, and says so to a screen reader', async () => {
    editor();
    const toggle = screen.getByRole('button', { name: 'Edit Due' });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    await userEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByRole('textbox', { name: 'Name of Due' })).toBeDefined();
  });

  it('renames a label on Enter, and a key on leaving its field', async () => {
    const onEdit = editor();
    await open('Due');
    const name = screen.getByRole('textbox', { name: 'Name of Due' });
    await userEvent.clear(name);
    await userEvent.type(name, 'Deadline{Enter}');
    expect(onEdit).toHaveBeenLastCalledWith({
      kind: 'renameProperty',
      key: 'due',
      newKey: 'due',
      label: 'Deadline',
    });

    const key = screen.getByRole('textbox', { name: 'Key of Due' });
    await userEvent.clear(key);
    await userEvent.type(key, 'deadline');
    await userEvent.tab();
    expect(onEdit).toHaveBeenLastCalledWith({
      kind: 'renameProperty',
      key: 'due',
      newKey: 'deadline',
      label: 'Due',
    });
  });

  it('keeps a property open when its key is renamed', async () => {
    const onEdit = vi.fn();
    const props = { icons: TYPE_ICONS, targets: TARGETS, prompt: null, notice: null, onEdit };
    const { rerender } = render(<TypeEditor type={TASK} {...props} />);
    await open('Due');
    const renamed = {
      ...TASK,
      properties: TASK.properties.map((p) => (p.key === 'due' ? { ...p, key: 'deadline' } : p)),
    };
    rerender(<TypeEditor type={renamed} {...props} />);
    expect(screen.getByRole('textbox', { name: 'Key of Due' })).toHaveProperty('value', 'deadline');
  });

  it('commits a rename once, not again when the field is left after Enter', async () => {
    const onEdit = editor();
    await open('Due');
    const name = screen.getByRole('textbox', { name: 'Name of Due' });
    await userEvent.clear(name);
    await userEvent.type(name, 'Deadline{Enter}');
    await userEvent.tab();
    expect(onEdit.mock.calls.filter(([edit]) => edit.kind === 'renameProperty')).toHaveLength(1);
  });

  it('puts a name back on Escape without committing it', async () => {
    const onEdit = editor();
    await open('Due');
    const name = screen.getByRole('textbox', { name: 'Name of Due' });
    await userEvent.type(name, 'xyz{Escape}');
    expect((name as HTMLInputElement).value).toBe('Due');
    await userEvent.tab();
    expect(onEdit).not.toHaveBeenCalled();
  });

  it('changes the kind, toggles required, and removes', async () => {
    const onEdit = editor();
    await open('Due');
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Kind of Due' }), 'number');
    expect(onEdit).toHaveBeenLastCalledWith({
      kind: 'changeKind',
      key: 'due',
      propertyKind: 'number',
    });
    await userEvent.click(screen.getByRole('switch', { name: 'Due is required' }));
    expect(onEdit).toHaveBeenLastCalledWith({ kind: 'setRequired', key: 'due', required: true });
    await userEvent.click(screen.getByRole('button', { name: 'Remove Due' }));
    expect(onEdit).toHaveBeenLastCalledWith({ kind: 'removeProperty', key: 'due' });
  });

  it('points a relation at any type, itself included, and makes it hold several', async () => {
    const onEdit = editor();
    await open('Project');
    const target = screen.getByRole('combobox', { name: 'Type Project points at' });
    expect(
      within(target)
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toEqual(['Project', 'Person', 'Task']);
    await userEvent.selectOptions(target, 'task');
    expect(onEdit).toHaveBeenLastCalledWith({
      kind: 'setRelation',
      key: 'project',
      target: 'task',
      many: false,
    });
    await userEvent.click(screen.getByRole('switch', { name: 'Project holds several notes' }));
    expect(onEdit).toHaveBeenLastCalledWith({
      kind: 'setRelation',
      key: 'project',
      target: 'project',
      many: true,
    });
  });

  it('edits a select’s options: rename, colour, remove, add', async () => {
    const onEdit = editor();
    await open('Status');
    const options = screen.getByRole('group', { name: 'Options of Status' });

    const review = within(options).getByRole('textbox', { name: 'Rename review' });
    await userEvent.clear(review);
    await userEvent.type(review, 'in review{Enter}');
    expect(onEdit).toHaveBeenLastCalledWith({
      kind: 'renameOption',
      key: 'status',
      from: 'review',
      to: 'in review',
    });

    // The colour the type chose, not the one the name would give.
    const colour = within(options).getByRole('combobox', { name: 'Colour of review' });
    expect((colour as HTMLSelectElement).value).toBe('next');
    await userEvent.selectOptions(colour, 'done');
    expect(onEdit).toHaveBeenLastCalledWith({
      kind: 'setOptionColor',
      key: 'status',
      option: 'review',
      tone: 'done',
    });

    await userEvent.click(within(options).getByRole('button', { name: 'Remove backlog' }));
    expect(onEdit).toHaveBeenLastCalledWith({
      kind: 'removeOption',
      key: 'status',
      option: 'backlog',
    });

    await userEvent.type(
      within(options).getByRole('textbox', { name: 'New option for Status' }),
      'blocked{Enter}',
    );
    expect(onEdit).toHaveBeenLastCalledWith({
      kind: 'addOption',
      key: 'status',
      option: 'blocked',
    });
  });

  it('chooses which option of a single choice means done, or leaves it to the name', async () => {
    const onEdit = editor();
    await open('Status');
    const options = screen.getByRole('group', { name: 'Options of Status' });
    const picker = within(options).getByRole('combobox', { name: 'Done option of Status' });
    expect((picker as HTMLSelectElement).value).toBe('');

    await userEvent.selectOptions(picker, 'review');
    expect(onEdit).toHaveBeenLastCalledWith({
      kind: 'setDoneOption',
      key: 'status',
      option: 'review',
    });
    await userEvent.selectOptions(picker, '');
    expect(onEdit).toHaveBeenLastCalledWith({ kind: 'setDoneOption', key: 'status', option: null });
  });

  it('shows the done option the type names', async () => {
    const marked = parseObjectType({
      name: 'task',
      properties: { status: { kind: 'select', options: ['open', 'shipped'], done: 'shipped' } },
    });
    editor({ type: marked });
    await open('Status');
    const picker = screen.getByRole('combobox', { name: 'Done option of Status' });
    expect((picker as HTMLSelectElement).value).toBe('shipped');
  });

  it('offers no done option for a choice of several', async () => {
    const tagged = parseObjectType({
      name: 'task',
      properties: { tags: { kind: 'multiSelect', options: ['a', 'done'] } },
    });
    editor({ type: tagged });
    await open('Tags');
    expect(screen.getByRole('group', { name: 'Options of Tags' })).toBeDefined();
    expect(screen.queryByRole('combobox', { name: 'Done option of Tags' })).toBeNull();
  });

  it('moves a property with Alt+Up and Alt+Down on its handle', async () => {
    const onEdit = editor();
    const handle = screen.getByRole('button', { name: 'Move Due' });
    handle.focus();
    await userEvent.keyboard('{Alt>}{ArrowUp}{/Alt}');
    expect(onEdit).toHaveBeenLastCalledWith({ kind: 'moveProperty', key: 'due', to: 0 });
    await userEvent.keyboard('{Alt>}{ArrowDown}{/Alt}');
    expect(onEdit).toHaveBeenLastCalledWith({ kind: 'moveProperty', key: 'due', to: 2 });
  });

  it('does not move the first property up, or move on an arrow without Alt', async () => {
    const onEdit = editor();
    screen.getByRole('button', { name: 'Move Status' }).focus();
    await userEvent.keyboard('{Alt>}{ArrowUp}{/Alt}');
    await userEvent.keyboard('{ArrowDown}');
    expect(onEdit).not.toHaveBeenCalled();
  });

  it('moves an option with the keyboard, which is the order of a board’s columns', async () => {
    const onEdit = editor();
    await open('Status');
    screen.getByRole('button', { name: 'Move Done' }).focus();
    await userEvent.keyboard('{Alt>}{ArrowUp}{/Alt}');
    expect(onEdit).toHaveBeenLastCalledWith({
      kind: 'moveOption',
      key: 'status',
      option: 'done',
      to: 1,
    });
  });

  it('chooses an icon, and pressing the chosen one again clears it', async () => {
    const onEdit = editor({ type: { ...TASK, icon: 'board' } });
    const board = screen.getByRole('button', { name: 'board icon' });
    expect(board.getAttribute('aria-pressed')).toBe('true');
    await userEvent.click(board);
    expect(onEdit).toHaveBeenLastCalledWith({ kind: 'setIcon', icon: null });
    await userEvent.click(screen.getByRole('button', { name: 'grid icon' }));
    expect(onEdit).toHaveBeenLastCalledWith({ kind: 'setIcon', icon: 'grid' });
  });

  it('asks before a change that touches notes, with the decision focused', async () => {
    const yes = vi.fn();
    const no = vi.fn();
    editor({
      prompt: {
        text: '3 notes use “review”.',
        actions: [
          { label: 'Rename and update 3 notes', primary: true, run: yes },
          { label: 'Rename only', run: no },
        ],
      },
    });
    const dialog = screen.getByRole('alertdialog', { name: 'Confirm change' });
    expect(dialog.textContent).toContain('3 notes use “review”.');
    const primary = within(dialog).getByRole('button', { name: 'Rename and update 3 notes' });
    expect(document.activeElement).toBe(primary);
    await userEvent.keyboard('{Enter}');
    expect(yes).toHaveBeenCalledOnce();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Rename only' }));
    expect(no).toHaveBeenCalledOnce();
  });

  it('reports what a change did, and each note it could not write', () => {
    editor({
      notice: {
        tone: 'problem',
        text: 'Updated 1 note; 1 note could not be updated.',
        details: ['a: gone'],
      },
    });
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain('could not be updated');
    expect(within(alert).getByText('a: gone')).toBeDefined();
  });

  it('asks to delete a type of its own', async () => {
    const onDelete = vi.fn();
    editor({ deletion: { refusal: null, onDelete } });
    const button = screen.getByRole('button', { name: 'Delete Task…' });
    expect(button.hasAttribute('disabled')).toBe(false);
    await userEvent.click(button);
    expect(onDelete).toHaveBeenCalledOnce();
    expect(screen.queryByText('Built in')).toBeNull();
  });

  it('refuses to delete a built-in type, saying why, and leaves its properties editable', async () => {
    const onDelete = vi.fn();
    const onEdit = editor({
      deletion: { refusal: 'Task is built in — the board makes tasks of it.', onDelete },
    });
    const button = screen.getByRole('button', { name: 'Delete Task…' });
    expect(button.hasAttribute('disabled')).toBe(true);
    // The reason is what the disabled button is described by, so it is read out with it.
    const why = document.getElementById(button.getAttribute('aria-describedby') ?? '');
    expect(why?.textContent).toContain('the board makes tasks of it');
    await userEvent.click(button);
    expect(onDelete).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: 'Add property' }));
    expect(onEdit).toHaveBeenCalledWith({ kind: 'addProperty', label: 'Property' });
  });

  it('offers no delete where the type cannot be deleted from here', () => {
    editor();
    expect(screen.getByRole('button', { name: 'Add property' })).toBeDefined();
    expect(screen.queryByRole('button', { name: /^Delete/ })).toBeNull();
  });
});
