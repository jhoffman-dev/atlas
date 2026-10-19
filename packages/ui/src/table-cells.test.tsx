// @vitest-environment jsdom
/**
 * Editing in place (brief §5.4, #299): every cell edits without opening the
 * note. Click or ↵ opens a cell's editor, Tab and ⇧Tab move across cells
 * and on to the next row, Esc cancels, ↵ commits — one write per commit. A
 * status opens its picker, a relation its own, a box ticks, a date and a
 * number get the fields their kind calls for.
 */
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createVaultPath, noteNames, type PropertyDef } from '@atlas/domain';
import { NoteNamesProvider } from './note-names.tsx';
import type { RelationChoice } from './properties-panel.tsx';
import {
  TableView,
  type TableResult,
  type TableSchema,
  type TableViewProps,
} from './table-view.tsx';

const STATUSES = [
  'inbox',
  'next',
  'waiting',
  'someday',
  'scheduled',
  'longterm',
  'done',
  'archive',
];

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
  status: def('status', 'select', { options: STATUSES }),
  due: def('due', 'date'),
  count: def('count', 'number'),
  urgent: def('urgent', 'checkbox'),
  project: def('project', 'relation', { target: 'project' }),
  people: def('people', 'relation', { target: 'person', many: true }),
  note: def('note', 'text'),
};

const schema: TableSchema = {
  kinds: Object.fromEntries(Object.values(properties).map((p) => [p.key, p.kind])),
  labels: Object.fromEntries(Object.values(properties).map((p) => [p.key, p.label])),
  noun: 'task',
  properties,
};

const result: TableResult = {
  columns: ['path', 'title', 'status', 'due', 'count', 'urgent', 'project', 'people', 'note'],
  rows: [
    ['a.md', 'Book the hall', 'next', '2026-03-01', 3, false, '[[P-01]]', '[[Ada]]', 'first'],
    ['b.md', 'Order chairs', 'inbox', '2026-03-02', null, true, null, null, 'second'],
  ],
  truncated: false,
  sql: '',
};

const names = noteNames([
  { path: createVaultPath('P-01.md'), title: 'Larkspur launch' },
  { path: createVaultPath('P-02.md'), title: 'Garden' },
  { path: createVaultPath('people/Ada.md'), title: 'Ada Lovelace' },
  { path: createVaultPath('people/Mara.md'), title: 'Mara Quill' },
]);

const relationChoices: Record<string, readonly RelationChoice[]> = {
  project: [
    { path: 'P-01.md', title: 'Larkspur launch', type: 'project' },
    { path: 'P-02.md', title: 'Garden', type: 'project' },
  ],
  people: [
    { path: 'people/Ada.md', title: 'Ada Lovelace', type: 'person' },
    { path: 'people/Mara.md', title: 'Mara Quill', type: 'person' },
  ],
};

function table(overrides: Partial<TableViewProps> = {}, { editable = true } = {}) {
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
        {...(editable && { onEditCell })}
        relationChoices={relationChoices}
        {...overrides}
      />
    </NoteNamesProvider>,
  );
  return onEditCell;
}

const cell = (name: string) => screen.getByRole('button', { name });
const field = () => document.querySelector('.table__input') as HTMLInputElement;
const picker = () => screen.getByRole('dialog', { name: 'Set Status' });
const filter = () => within(picker()).getByRole('combobox') as HTMLInputElement;

describe('a typed-in cell', () => {
  it('opens on a click, commits on ↵ and gives the cell the focus back', async () => {
    const onEditCell = table();
    await userEvent.click(cell('first'));
    expect(field().value).toBe('first');
    await userEvent.clear(field());
    await userEvent.type(field(), 'changed{Enter}');

    expect(onEditCell).toHaveBeenCalledExactlyOnceWith({
      path: 'a.md',
      column: 'note',
      value: 'changed',
    });
    // The result is not read again here, so the cell still reads as it did.
    expect(document.activeElement).toBe(cell('first'));
  });

  it('takes the focus on a click even where the click left it elsewhere, as WebKit does', async () => {
    render(<input aria-label="Search" />);
    table();
    screen.getByRole('textbox', { name: 'Search' }).focus();
    // fireEvent moves no focus: the click lands with the search box still focused.
    fireEvent.click(cell('first'));
    expect(document.activeElement).toBe(field());
  });

  it('opens on ↵ from the cell, and Esc puts it back as it was with the focus on it', async () => {
    const onEditCell = table();
    cell('first').focus();
    await userEvent.keyboard('{Enter}');
    expect(document.activeElement).toBe(field());
    await userEvent.type(field(), 'X{Escape}');

    expect(onEditCell).not.toHaveBeenCalled();
    expect(document.querySelector('.table__input')).toBeNull();
    expect(document.activeElement).toBe(cell('first'));
  });

  it('reports an emptied cell as empty text, once', async () => {
    const onEditCell = table();
    await userEvent.click(cell('first'));
    await userEvent.clear(field());
    await userEvent.keyboard('{Enter}');
    expect(onEditCell).toHaveBeenCalledExactlyOnceWith({ path: 'a.md', column: 'note', value: '' });
  });

  it('Tab commits and opens the next cell; at the row’s end, the next row’s first cell', async () => {
    const onEditCell = table();
    await userEvent.click(cell('first'));
    await userEvent.clear(field());
    await userEvent.type(field(), 'third{Tab}');

    expect(onEditCell).toHaveBeenCalledExactlyOnceWith({
      path: 'a.md',
      column: 'note',
      value: 'third',
    });
    // The last column of the first row wraps to the first editable column of the second.
    expect(picker()).toBeDefined();
    expect(cell('Inbox').getAttribute('data-editing')).toBe('');
  });

  it('⇧Tab commits and opens the previous cell, back across rows', async () => {
    const onEditCell = table();
    cell('Inbox').focus();
    await userEvent.keyboard('{Enter}');
    expect(picker()).toBeDefined();
    await userEvent.keyboard('{Shift>}{Tab}{/Shift}');

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(field().value).toBe('first');
    expect(document.activeElement).toBe(field());
    expect(onEditCell).not.toHaveBeenCalled();
  });

  it('Tab past the last cell of the last row ends the edit and leaves the focus on the cell', async () => {
    const onEditCell = table();
    await userEvent.click(cell('second'));
    await userEvent.type(field(), '!{Tab}');
    expect(onEditCell).toHaveBeenCalledExactlyOnceWith({
      path: 'b.md',
      column: 'note',
      value: 'second!',
    });
    expect(document.querySelector('.table__input')).toBeNull();
    expect(document.activeElement).toBe(cell('second'));
  });
});

describe('a status cell', () => {
  it('opens a picker listing the options with their number keys, the held one ticked', async () => {
    table();
    await userEvent.click(cell('Next'));
    const options = within(picker()).getAllByRole('option');
    expect(options.map((option) => option.textContent)).toEqual([
      'Inbox1',
      'Next2',
      'Waiting3',
      'Someday4',
      'Scheduled5',
      'Longterm6',
      'Done7',
      'Archive8',
    ]);
    expect(options[1]?.getAttribute('aria-selected')).toBe('true');
    expect(cell('Next').getAttribute('data-editing')).toBe('');
    expect(document.activeElement).toBe(filter());
  });

  it('picks the third option by its number key, in one write, and the cell takes the focus back', async () => {
    const onEditCell = table();
    await userEvent.click(cell('Next'));
    await userEvent.keyboard('3');
    expect(onEditCell).toHaveBeenCalledExactlyOnceWith({
      path: 'a.md',
      column: 'status',
      value: 'waiting',
    });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(cell('Next'));
  });

  it('lets a digit filter instead once the filter starts with one', async () => {
    const onEditCell = table();
    await userEvent.click(cell('Next'));
    // 9 picks nothing (eight options), so it reaches the filter; 3 would pick, but the filter wins.
    await userEvent.type(filter(), '9');
    await userEvent.keyboard('3');
    expect(filter().value).toBe('93');
    expect(onEditCell).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog', { name: 'Set Status' })).toBeDefined();
  });

  it('filters the options by what is typed, and ↵ picks the highlighted one', async () => {
    const onEditCell = table();
    await userEvent.click(cell('Next'));
    await userEvent.type(filter(), 'so');
    expect(
      within(picker())
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['Someday4']);
    await userEvent.keyboard('{Enter}');
    expect(onEditCell).toHaveBeenCalledExactlyOnceWith({
      path: 'a.md',
      column: 'status',
      value: 'someday',
    });
  });

  it('↓ moves the highlight on from the held option, and a click picks', async () => {
    const onEditCell = table();
    await userEvent.click(cell('Next'));
    await userEvent.keyboard('{ArrowDown}{Enter}');
    expect(onEditCell).toHaveBeenCalledExactlyOnceWith({
      path: 'a.md',
      column: 'status',
      value: 'waiting',
    });
    await userEvent.click(cell('Inbox'));
    await userEvent.click(within(picker()).getByRole('option', { name: /Done/ }));
    expect(onEditCell).toHaveBeenLastCalledWith({ path: 'b.md', column: 'status', value: 'done' });
  });

  /** Status alone, so Tab from one row's picker reaches the next row's. */
  const statusOnly: TableResult = {
    ...result,
    columns: ['path', 'title', 'status'],
    rows: [
      ['a.md', 'Book the hall', 'next'],
      ['b.md', 'Order chairs', 'inbox'],
    ],
  };

  it('Tab opens the next row’s picker afresh: ↵ at once keeps that row’s own status', async () => {
    const onEditCell = table({ result: statusOnly });
    await userEvent.click(cell('Next'));
    await userEvent.keyboard('{ArrowDown}');
    await userEvent.keyboard('{Tab}');
    // The second row's picker, on Inbox: nothing of the first row's carries over.
    expect(picker()).toBeDefined();
    expect(cell('Inbox').getAttribute('data-editing')).toBe('');
    await userEvent.keyboard('{Enter}');
    expect(onEditCell).not.toHaveBeenCalled();
  });

  it('a filter typed in one picker does not carry into the next', async () => {
    table({ result: statusOnly });
    await userEvent.click(cell('Next'));
    await userEvent.type(filter(), 'wa');
    await userEvent.keyboard('{Tab}');
    expect(filter().value).toBe('');
    expect(within(picker()).getAllByRole('option')).toHaveLength(STATUSES.length);
  });

  it('a press dragged off the open cell swallows no later ↵', async () => {
    table();
    await userEvent.click(cell('Next'));
    expect(picker()).toBeDefined();
    // A press dragged off ends in no click, so it closes nothing; Esc does.
    fireEvent.pointerDown(cell('Next'));
    fireEvent.pointerLeave(cell('Next'));
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(cell('Next'));
    await userEvent.keyboard('{Enter}');
    expect(picker()).toBeDefined();
  });

  it('writes nothing for the option the cell already holds, nor on Esc', async () => {
    const onEditCell = table();
    await userEvent.click(cell('Next'));
    await userEvent.keyboard('2');
    expect(onEditCell).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).toBeNull();

    await userEvent.click(cell('Next'));
    await userEvent.keyboard('{Escape}');
    expect(onEditCell).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(cell('Next'));
  });

  it('edits as text where the type declares no options', async () => {
    const onEditCell = table({
      schema: { kinds: { status: 'select' }, labels: {}, noun: 'task' },
    });
    await userEvent.click(cell('Next'));
    expect(screen.queryByRole('dialog')).toBeNull();
    await userEvent.clear(field());
    await userEvent.type(field(), 'done{Enter}');
    expect(onEditCell).toHaveBeenCalledExactlyOnceWith({
      path: 'a.md',
      column: 'status',
      value: 'done',
    });
  });
});

describe('a relation cell', () => {
  const stop = (name: string) => screen.getByRole('button', { name });
  const box = (name: string) => screen.getByRole('checkbox', { name }) as HTMLInputElement;
  const popover = (label: string) => screen.getByRole('dialog', { name: `Set ${label}` });

  it('opens a picker of the notes not linked yet, and links the one picked', async () => {
    const onEditCell = table();
    await userEvent.click(stop('Larkspur launch'));
    const select = within(popover('Project')).getByRole('combobox');
    expect([...select.querySelectorAll('option')].map((o) => o.textContent)).toEqual([
      'Change project…',
      'Garden',
    ]);
    await userEvent.selectOptions(select, '[[P-02]]');
    expect(onEditCell).toHaveBeenCalledExactlyOnceWith({
      path: 'a.md',
      column: 'project',
      value: '[[P-02]]',
    });
  });

  it('adds to a relation of several, and removes one by its ×', async () => {
    const onEditCell = table();
    await userEvent.click(stop('Ada Lovelace'));
    await userEvent.selectOptions(within(popover('People')).getByRole('combobox'), '[[Mara]]');
    expect(onEditCell).toHaveBeenLastCalledWith({
      path: 'a.md',
      column: 'people',
      value: ['[[Ada]]', '[[Mara]]'],
    });
    // The removal builds on the pick just made, not on what the file still shows.
    await userEvent.click(
      within(popover('People')).getByRole('button', { name: 'Remove Ada Lovelace from People' }),
    );
    expect(onEditCell).toHaveBeenLastCalledWith({
      path: 'a.md',
      column: 'people',
      value: ['[[Mara]]'],
    });
  });

  it('shows the links as read again once a write of them fails', async () => {
    const onEditCell = vi.fn().mockRejectedValue(new Error('refused'));
    table({ onEditCell });
    await userEvent.click(stop('Ada Lovelace'));
    const people = () => popover('People');
    await userEvent.click(
      within(people()).getByRole('button', { name: 'Remove Ada Lovelace from People' }),
    );
    // The chip went as the write was made, and is back once the write failed.
    await vi.waitFor(() =>
      expect(within(people()).getByRole('button', { name: 'Open Ada Lovelace' })).toBeDefined(),
    );
    expect(onEditCell).toHaveBeenCalledTimes(1);
  });

  it('makes a note from "New …" through onCreateRelated and links it', async () => {
    const onCreateRelated = vi.fn().mockResolvedValue('[[P-09]]');
    const onEditCell = table({ onCreateRelated });
    await userEvent.click(stop('Larkspur launch'));
    const select = within(popover('Project')).getByRole('combobox');
    await userEvent.selectOptions(select, 'New project…');
    await userEvent.type(
      screen.getByRole('textbox', { name: 'Name of the new project' }),
      'Fête{Enter}',
    );
    expect(onCreateRelated).toHaveBeenCalledWith({ target: 'project', name: 'Fête' });
    await vi.waitFor(() =>
      expect(onEditCell).toHaveBeenCalledWith({
        path: 'a.md',
        column: 'project',
        value: '[[P-09]]',
      }),
    );
  });

  it('opens from the keyboard with ↵ and closes on Esc with nothing written', async () => {
    const onEditCell = table();
    stop('No project').focus();
    await userEvent.keyboard('{Enter}');
    expect(popover('Project')).toBeDefined();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(onEditCell).not.toHaveBeenCalled();
  });

  it('Tab skips a relation the type says nothing about, whose stop opens nothing', async () => {
    const rest = { ...properties };
    delete rest['project'];
    const onEditCell = table({ schema: { ...schema, properties: rest } });
    // The cell is still a stop for the arrows, but a click opens no picker.
    await userEvent.click(stop('Larkspur launch'));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(stop('Larkspur launch').getAttribute('data-editing')).toBeNull();
    // Tab from the box before it walks straight on to the people picker.
    box('Urgent for Book the hall').focus();
    await userEvent.click(cell('3'));
    await userEvent.keyboard('{Tab}{Tab}');
    expect(popover('People')).toBeDefined();
    expect(onEditCell).not.toHaveBeenCalled();
  });

  it('still opens the linked note from its chip, not the picker', async () => {
    const onOpenNote = vi.fn();
    table({ onOpenNote });
    await userEvent.click(screen.getByRole('button', { name: 'Open Ada Lovelace' }));
    expect(onOpenNote).toHaveBeenCalledWith('people/Ada.md');
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('a checkbox cell', () => {
  const box = (name: string) => screen.getByRole('checkbox', { name }) as HTMLInputElement;

  it('takes the focus when Tab reaches it, and ⇧Tab or Esc leave it as from any editor', async () => {
    const onEditCell = table();
    await userEvent.click(cell('3'));
    await userEvent.keyboard('{Tab}');
    expect(document.activeElement).toBe(box('Urgent for Book the hall'));
    await userEvent.keyboard('{Shift>}{Tab}{/Shift}');
    expect(field().value).toBe('3');
    await userEvent.keyboard('{Tab}');
    await userEvent.keyboard('{Escape}');
    expect(document.querySelector('.table__input')).toBeNull();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(onEditCell).not.toHaveBeenCalled();
  });

  it('ticks on Space, one write per tick, and on a click', async () => {
    const onEditCell = table();
    expect(box('Urgent for Book the hall').checked).toBe(false);
    box('Urgent for Book the hall').focus();
    await userEvent.keyboard(' ');
    expect(onEditCell).toHaveBeenCalledExactlyOnceWith({
      path: 'a.md',
      column: 'urgent',
      value: true,
    });
    await userEvent.click(box('Urgent for Order chairs'));
    expect(onEditCell).toHaveBeenLastCalledWith({ path: 'b.md', column: 'urgent', value: false });
  });

  it('is read only where cells do not edit', () => {
    table({}, { editable: false });
    expect(box('Urgent for Order chairs').disabled).toBe(true);
  });
});

describe('a date cell', () => {
  it('commits a day as YYYY-MM-DD', async () => {
    const onEditCell = table();
    await userEvent.click(cell('2026-03-01'));
    expect(field().type).toBe('date');
    fireEvent.change(field(), { target: { value: '2026-04-01' } });
    await userEvent.keyboard('{Enter}');
    expect(onEditCell).toHaveBeenCalledExactlyOnceWith({
      path: 'a.md',
      column: 'due',
      value: '2026-04-01',
    });
  });

  it('commits nothing for a day erased part-way, nor for the day it had', async () => {
    const onEditCell = table();
    await userEvent.click(cell('2026-03-01'));
    fireEvent.change(field(), { target: { value: '' } });
    await userEvent.keyboard('{Enter}');
    expect(onEditCell).not.toHaveBeenCalled();
    expect(document.querySelector('.table__input')).toBeNull();
  });
});

describe('a number cell', () => {
  it('refuses a letter and commits a number', async () => {
    const onEditCell = table();
    await userEvent.click(cell('3'));
    await userEvent.type(field(), 'a');
    expect(field().value).toBe('3');
    await userEvent.type(field(), '.5{Enter}');
    expect(onEditCell).toHaveBeenCalledExactlyOnceWith({
      path: 'a.md',
      column: 'count',
      value: 3.5,
    });
  });

  it('commits null once emptied', async () => {
    const onEditCell = table();
    await userEvent.click(cell('3'));
    await userEvent.clear(field());
    await userEvent.keyboard('{Enter}');
    expect(onEditCell).toHaveBeenCalledExactlyOnceWith({
      path: 'a.md',
      column: 'count',
      value: null,
    });
  });
});

describe('moving between cells without editing', () => {
  it('← and → move along the row’s stops, ↓ keeps the column', async () => {
    table();
    cell('Next').focus();
    await userEvent.keyboard('{ArrowRight}');
    expect(document.activeElement).toBe(cell('2026-03-01'));
    await userEvent.keyboard('{ArrowLeft}{ArrowLeft}');
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Book the hall' }));
    cell('Next').focus();
    await userEvent.keyboard('{ArrowDown}');
    expect(document.activeElement).toBe(cell('Inbox'));
    await userEvent.keyboard('{ArrowUp}');
    expect(document.activeElement).toBe(cell('Next'));
  });
});
