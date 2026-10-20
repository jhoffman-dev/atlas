// @vitest-environment jsdom
/**
 * Attack on PR #425 (#300). A saved view's table is fed by the index, whose
 * view of a type pivots a property of several values into one
 * comma-separated cell ("[[Ada]], [[Mara]]"). The relation picker must
 * treat that cell as the links it stands for; and a typed-in cell must not
 * commit the Enter that ends an IME composition.
 */
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createVaultPath, noteNames, type PropertyDef } from '@atlas/domain';
import { NoteNamesProvider } from './note-names.tsx';
import type { RelationChoice } from './properties-panel.tsx';
import { TableView, type TableResult, type TableSchema } from './table-view.tsx';

function def(key: string, kind: PropertyDef['kind'], more: Partial<PropertyDef> = {}): PropertyDef {
  return {
    key,
    kind,
    label: key.charAt(0).toUpperCase() + key.slice(1),
    required: false,
    options: [],
    target: null,
    many: false,
    ...more,
  };
}

const properties: Record<string, PropertyDef> = {
  people: def('people', 'relation', { target: 'person', many: true }),
  note: def('note', 'text'),
};

const schema: TableSchema = {
  kinds: { people: 'relation', note: 'text' },
  labels: { people: 'People', note: 'Note' },
  noun: 'task',
  properties,
};

// As the index's `v_task` view reads it: two links, one comma-joined cell.
const result: TableResult = {
  columns: ['path', 'title', 'people', 'note'],
  rows: [['a.md', 'Book the hall', '[[Ada]], [[Mara]]', 'first']],
  truncated: false,
  sql: '',
};

const names = noteNames([
  { path: createVaultPath('people/Ada.md'), title: 'Ada Lovelace' },
  { path: createVaultPath('people/Mara.md'), title: 'Mara Quill' },
  { path: createVaultPath('people/Tobias.md'), title: 'Tobias Fenn' },
]);

const relationChoices: Record<string, readonly RelationChoice[]> = {
  people: [
    { path: 'people/Ada.md', title: 'Ada Lovelace', type: 'person' },
    { path: 'people/Mara.md', title: 'Mara Quill', type: 'person' },
    { path: 'people/Tobias.md', title: 'Tobias Fenn', type: 'person' },
  ],
};

function table() {
  const onEditCell = vi.fn();
  render(
    <NoteNamesProvider value={names}>
      <TableView
        result={result}
        sorts={[]}
        error={null}
        schema={schema}
        onOpenNote={() => {}}
        onToggleSort={() => {}}
        onEditCell={onEditCell}
        relationChoices={relationChoices}
      />
    </NoteNamesProvider>,
  );
  return onEditCell;
}

const peopleStop = () => document.querySelector('.table [data-cell-stop="people"]') as HTMLElement;
const popover = () => screen.getByRole('dialog', { name: 'Set People' });
const field = () => document.querySelector('.table__input') as HTMLInputElement;

describe('a many-relation cell read from the index (comma-joined)', () => {
  it('adding a link writes each link held as its own item', async () => {
    const onEditCell = table();
    await userEvent.click(peopleStop());
    await userEvent.selectOptions(within(popover()).getByRole('combobox'), '[[Tobias]]');
    expect(onEditCell).toHaveBeenLastCalledWith({
      path: 'a.md',
      column: 'people',
      value: ['[[Ada]]', '[[Mara]]', '[[Tobias]]'],
    });
  });

  it('removing one link keeps the other', async () => {
    const onEditCell = table();
    await userEvent.click(peopleStop());
    await userEvent.click(
      within(popover()).getByRole('button', { name: 'Remove Ada Lovelace from People' }),
    );
    expect(onEditCell).toHaveBeenLastCalledWith({
      path: 'a.md',
      column: 'people',
      value: ['[[Mara]]'],
    });
  });

  it('shows a chip for each link held', async () => {
    table();
    await userEvent.click(peopleStop());
    const chips = within(popover()).getAllByRole('button', { name: /^Remove .* from People$/ });
    expect(chips.map((chip) => chip.getAttribute('aria-label'))).toEqual([
      'Remove Ada Lovelace from People',
      'Remove Mara Quill from People',
    ]);
  });

  it('offers only the notes not linked yet', async () => {
    table();
    await userEvent.click(peopleStop());
    const select = within(popover()).getByRole('combobox');
    const offered = [...select.querySelectorAll('option')].map((o) => o.textContent);
    expect(offered).not.toContain('Ada Lovelace');
    expect(offered).not.toContain('Mara Quill');
    expect(offered).toContain('Tobias Fenn');
  });
});

describe('a typed-in cell under an input method', () => {
  it('does not commit on the Enter that ends a composition', async () => {
    const onEditCell = table();
    await userEvent.click(screen.getByRole('button', { name: 'first' }));
    fireEvent.change(field(), { target: { value: 'にほん' } });
    fireEvent.keyDown(field(), { key: 'Enter', isComposing: true });
    expect(onEditCell).not.toHaveBeenCalled();
    expect(field()).not.toBeNull();
  });

  it('does not commit on WebKit’s composition Enter (keyCode 229)', async () => {
    const onEditCell = table();
    await userEvent.click(screen.getByRole('button', { name: 'first' }));
    fireEvent.change(field(), { target: { value: 'にほん' } });
    fireEvent.keyDown(field(), { key: 'Enter', keyCode: 229 });
    expect(onEditCell).not.toHaveBeenCalled();
    expect(field()).not.toBeNull();
  });
});
