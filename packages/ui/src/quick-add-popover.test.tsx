// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  quickAddFields,
  quickAddStartValues,
  type ObjectType,
  type PropertyDef,
} from '@atlas/domain';
import { QuickAddPopover } from './quick-add-popover.tsx';

const property = (key: string, kind: PropertyDef['kind'], extra: Partial<PropertyDef> = {}) =>
  ({
    key,
    kind,
    label: key.charAt(0).toUpperCase() + key.slice(1),
    required: false,
    options: [],
    target: null,
    many: false,
    ...extra,
  }) satisfies PropertyDef;

const TASK: ObjectType = {
  name: 'task',
  label: 'Task',
  properties: [
    property('status', 'select', { options: ['backlog', 'doing', 'done'], required: true }),
    property('estimate', 'text'),
    property('due', 'date'),
    property('project', 'relation', { target: 'project' }),
  ],
};

const PERSON: ObjectType = {
  name: 'person',
  label: 'Person',
  properties: [property('email', 'text'), property('company', 'relation', { target: 'company' })],
};

function renderFor(
  type: ObjectType,
  { onAdd = vi.fn(() => Promise.resolve()), onClose = vi.fn() } = {},
) {
  const fields = quickAddFields(type);
  render(
    <QuickAddPopover
      label={type.label}
      icon="task"
      fields={fields}
      startValues={quickAddStartValues(fields)}
      choices={{ project: [{ path: 'Garden.md', title: 'Garden' }] }}
      onAdd={onAdd}
      onClose={onClose}
    />,
  );
  return { onAdd, onClose };
}

describe('QuickAddPopover', () => {
  it('asks a task for its name, status, project and due date — nothing else', () => {
    renderFor(TASK);
    expect(screen.getByRole('dialog', { name: 'New Task' })).toBeDefined();
    expect(screen.getByRole('textbox', { name: 'Task name' })).toBeDefined();
    expect(screen.getByLabelText('Status')).toBeDefined();
    expect(screen.getByLabelText('Project')).toBeDefined();
    expect(screen.getByLabelText('Due')).toBeDefined();
    expect(screen.queryByLabelText('Estimate')).toBeNull();
  });

  it('asks another type for its own fields', () => {
    renderFor(PERSON);
    expect(screen.getByRole('dialog', { name: 'New Person' })).toBeDefined();
    expect(screen.getByLabelText('Company')).toBeDefined();
    expect(screen.queryByLabelText('Status')).toBeNull();
    expect(screen.queryByLabelText('Email')).toBeNull();
  });

  it('starts the status at its first option', () => {
    renderFor(TASK);
    expect((screen.getByLabelText('Status') as HTMLSelectElement).value).toBe('backlog');
  });

  it('focuses the name, so adding starts with typing', async () => {
    renderFor(TASK);
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Task name' })),
    );
  });

  it('adds on Enter with what was filled in, staying where you were', async () => {
    const { onAdd } = renderFor(TASK);
    await userEvent.selectOptions(screen.getByLabelText('Status'), 'doing');
    await userEvent.selectOptions(screen.getByLabelText('Project'), 'Garden');
    await userEvent.type(screen.getByRole('textbox', { name: 'Task name' }), 'Plant bulbs{Enter}');

    expect(onAdd).toHaveBeenCalledWith({
      name: 'Plant bulbs',
      values: { status: 'doing', project: '[[Garden]]', due: '' },
      open: false,
    });
  });

  it('adds and opens on Cmd+Enter, and from its button', async () => {
    const { onAdd } = renderFor(TASK);
    const name = screen.getByRole('textbox', { name: 'Task name' });
    await userEvent.type(name, 'First{Meta>}{Enter}{/Meta}');
    expect(onAdd).toHaveBeenLastCalledWith(expect.objectContaining({ name: 'First', open: true }));
  });

  it('offers "Add and open" as a button too', async () => {
    const { onAdd } = renderFor(PERSON);
    await userEvent.type(screen.getByRole('textbox', { name: 'Person name' }), 'Ada');
    await userEvent.click(screen.getByRole('button', { name: 'Add and open' }));
    expect(onAdd).toHaveBeenCalledWith(expect.objectContaining({ name: 'Ada', open: true }));
  });

  it('adds nothing without a name', async () => {
    const { onAdd } = renderFor(TASK);
    await userEvent.type(screen.getByRole('textbox', { name: 'Task name' }), '   {Enter}');
    expect(onAdd).not.toHaveBeenCalled();
    expect((screen.getByRole('button', { name: 'Add' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('closes on Escape', async () => {
    const { onClose } = renderFor(TASK);
    await userEvent.type(screen.getByRole('textbox', { name: 'Task name' }), '{Escape}');
    expect(onClose).toHaveBeenCalled();
  });

  it('says why an add failed, and lets it be tried again', async () => {
    const onAdd = vi.fn(() => Promise.reject(new Error('disk full')));
    renderFor(TASK, { onAdd });
    await userEvent.type(screen.getByRole('textbox', { name: 'Task name' }), 'X{Enter}');

    expect((await screen.findByRole('alert')).textContent).toBe('disk full');
    expect((screen.getByRole('button', { name: 'Add' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('asks a required checkbox as a checkbox, not a text box', () => {
    const CONTRACT: ObjectType = {
      name: 'contract',
      label: 'Contract',
      properties: [property('signed', 'checkbox', { required: true })],
    };
    renderFor(CONTRACT);
    expect(screen.getByLabelText('Signed')).toBeDefined();
    expect(screen.queryByRole('textbox', { name: 'Signed' })).toBeNull();
    expect(screen.getByRole('checkbox', { name: 'Signed' })).toBeDefined();
  });

  it('hands on a ticked checkbox as ticked', async () => {
    const CONTRACT: ObjectType = {
      name: 'contract',
      label: 'Contract',
      properties: [property('signed', 'checkbox', { required: true })],
    };
    const { onAdd } = renderFor(CONTRACT);
    await userEvent.click(screen.getByRole('checkbox', { name: 'Signed' }));
    await userEvent.type(screen.getByRole('textbox', { name: 'Contract name' }), 'Lease');
    await userEvent.click(screen.getByRole('button', { name: 'Add' }));
    expect(onAdd).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Lease', values: { signed: 'true' } }),
    );
  });
});
