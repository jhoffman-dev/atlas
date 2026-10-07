// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TemplatesPage, type TemplatesPageProps } from './templates-page.tsx';
import { lostUsesText, templateUsesText } from './template-words.ts';

const CATALOG: NonNullable<TemplatesPageProps['catalog']> = {
  templates: [
    {
      path: '.atlas/templates/Daily.md',
      name: 'Daily',
      uses: [{ kind: 'daily' }],
    },
    {
      path: '.atlas/templates/Person.md',
      name: 'Person',
      uses: [{ kind: 'type', typeName: 'person', typeLabel: 'Person' }],
    },
    { path: '.atlas/templates/Meeting.md', name: 'Meeting', uses: [] },
  ],
  typesWithout: [
    { name: 'book', label: 'Book', templateName: 'Book' },
    { name: 'company', label: 'Company', templateName: 'Company' },
  ],
};

/** A stand-in for the domain's rule: blank and Person are refused. */
const nameProblem = (name: string, except: string | null) => {
  if (name.trim() === '') return 'Name the template.';
  if (name.trim().toLowerCase() === 'person' && except !== '.atlas/templates/Person.md') {
    return 'There is already a template called “Person”.';
  }
  return null;
};

function show(overrides: Partial<TemplatesPageProps> = {}) {
  const props: TemplatesPageProps = {
    catalog: CATALOG,
    error: null,
    nameProblem,
    onOpen: vi.fn(),
    onCreate: vi.fn(),
    onRename: vi.fn(),
    onDelete: vi.fn(),
    onMoveToNotes: vi.fn(),
    usesLost: (path: string, name: string) =>
      path === '.atlas/templates/Person.md' && name.trim().toLowerCase() !== 'person'
        ? [{ kind: 'type' as const, typeName: 'person', typeLabel: 'Person' }]
        : [],
    ...overrides,
  };
  render(<TemplatesPage {...props} />);
  return props;
}

const rowOf = (name: string) => {
  const link = screen.getByRole('button', { name });
  const row = link.closest('tr');
  if (row === null) throw new Error(`no row for ${name}`);
  return within(row);
};

describe('TemplatesPage', () => {
  it('says what a template is, and lists each with what it is used for', () => {
    show();
    expect(screen.getByText(/A template is what a new note starts as/)).toBeTruthy();
    expect(rowOf('Person').getByText('New Person notes')).toBeTruthy();
    expect(rowOf('Daily').getByText('Today’s note')).toBeTruthy();
    expect(rowOf('Meeting').getByText('Only the New menu')).toBeTruthy();
  });

  it('opens a template from its name or its Edit, and asks to delete it', async () => {
    const onOpen = vi.fn();
    const { onDelete } = show({ onOpen });
    await userEvent.click(screen.getByRole('button', { name: 'Person' }));
    await userEvent.click(screen.getByRole('button', { name: 'Edit Daily template' }));
    expect(onOpen.mock.calls).toEqual([
      ['.atlas/templates/Person.md'],
      ['.atlas/templates/Daily.md'],
    ]);
    await userEvent.click(screen.getByRole('button', { name: 'Delete Meeting template' }));
    expect(onDelete).toHaveBeenCalledExactlyOnceWith('.atlas/templates/Meeting.md');
  });

  it('renames a template in place, on Enter', async () => {
    const { onRename } = show();
    await userEvent.click(screen.getByRole('button', { name: 'Rename Meeting template' }));
    const field = screen.getByRole('textbox', { name: 'New name for Meeting' });
    await userEvent.clear(field);
    await userEvent.type(field, 'Standup{Enter}');
    expect(onRename).toHaveBeenCalledExactlyOnceWith({
      path: '.atlas/templates/Meeting.md',
      name: 'Standup',
    });
    expect(screen.queryByRole('textbox', { name: 'New name for Meeting' })).toBeNull();
  });

  it('keeps a rename open, saying why, while the name cannot be used', async () => {
    const { onRename } = show();
    await userEvent.click(screen.getByRole('button', { name: 'Rename Meeting template' }));
    const field = screen.getByRole('textbox', { name: 'New name for Meeting' });
    await userEvent.clear(field);
    await userEvent.type(field, 'person{Enter}');
    expect(screen.getByRole('alert').textContent).toBe(
      'There is already a template called “Person”.',
    );
    expect(onRename).not.toHaveBeenCalled();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('textbox', { name: 'New name for Meeting' })).toBeNull();
    expect(onRename).not.toHaveBeenCalled();
  });

  it('makes a template for a type without one, named after it so that it serves it', async () => {
    const { onCreate } = show();
    await userEvent.click(screen.getByRole('button', { name: 'New template' }));
    const form = within(screen.getByRole('form', { name: 'New template' }));
    const name = form.getByRole('textbox', { name: 'Name' }) as HTMLInputElement;
    expect(name.value).toBe('Book');
    await userEvent.selectOptions(form.getByRole('combobox', { name: 'For' }), 'company');
    expect(name.value).toBe('Company');
    // The name is what ties a template to its type: it is not typed over.
    expect(name.readOnly).toBe(true);
    await userEvent.type(name, 'Clients');
    expect(name.value).toBe('Company');
    expect(
      form.getByText(/named after the type, so new Company notes start from it/i),
    ).toBeTruthy();
    await userEvent.click(form.getByRole('button', { name: 'Create' }));
    expect(onCreate).toHaveBeenCalledExactlyOnceWith({ name: 'Company', typeName: 'company' });
  });

  it('makes a blank template under a typed name, and refuses one that is taken', async () => {
    const { onCreate } = show();
    await userEvent.click(screen.getByRole('button', { name: 'New template' }));
    const form = within(screen.getByRole('form', { name: 'New template' }));
    await userEvent.selectOptions(form.getByRole('combobox', { name: 'For' }), '');
    const name = form.getByRole('textbox', { name: 'Name' });
    expect((name as HTMLInputElement).value).toBe('');
    await userEvent.type(name, 'Person');
    await userEvent.click(form.getByRole('button', { name: 'Create' }));
    expect(form.getByRole('alert').textContent).toBe(
      'There is already a template called “Person”.',
    );
    expect(onCreate).not.toHaveBeenCalled();
    await userEvent.clear(name);
    await userEvent.type(name, 'Meeting notes');
    await userEvent.click(form.getByRole('button', { name: 'Create' }));
    expect(onCreate).toHaveBeenCalledExactlyOnceWith({ name: 'Meeting notes', typeName: null });
  });

  it('asks to turn a template into a note, from its row', async () => {
    const { onMoveToNotes } = show();
    await userEvent.click(screen.getByRole('button', { name: 'Move Meeting template to notes' }));
    expect(onMoveToNotes).toHaveBeenCalledExactlyOnceWith('.atlas/templates/Meeting.md');
  });

  it('warns, while renaming, what the new name stops using the template', async () => {
    show();
    await userEvent.click(screen.getByRole('button', { name: 'Rename Person template' }));
    const field = screen.getByRole('textbox', { name: 'New name for Person' });
    expect(screen.queryByText(/will start empty/)).toBeNull();
    await userEvent.clear(field);
    await userEvent.type(field, 'Contact');
    expect(screen.getByText('New Person notes will start empty.')).toBeTruthy();
  });

  it('says how to start when there are no templates, and what failed when reading did', () => {
    show({ catalog: { templates: [], typesWithout: [] } });
    expect(screen.getByText(/No templates yet/)).toBeTruthy();
  });

  it('shows a failure to read the templates in place of the list', () => {
    show({ error: 'The disk said no.' });
    expect(screen.getByRole('alert').textContent).toBe('The disk said no.');
    expect(screen.queryByRole('table')).toBeNull();
  });
});

describe('what a template is used for, in words', () => {
  it('names every use, in the order given', () => {
    expect(
      templateUsesText([
        { kind: 'type', typeName: 'task', typeLabel: 'Task' },
        { kind: 'capture' },
        { kind: 'artifact' },
        { kind: 'daily' },
      ]),
    ).toBe('New Task notes, Captured tasks, Saved artifacts, Today’s note');
  });

  it('says what stops being made from it, or nothing when nothing does', () => {
    expect(
      lostUsesText([{ kind: 'type', typeName: 'person', typeLabel: 'Person' }, { kind: 'daily' }]),
    ).toBe('New Person notes will start empty. Today’s note will start blank.');
    expect(lostUsesText([])).toBeNull();
  });
});
