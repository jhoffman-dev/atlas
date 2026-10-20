// @vitest-environment jsdom
/**
 * Attack on PR #354 (UI v2 slice 5a, #299): the in-place cell editors. Each
 * test names one invariant of editing in place; a failing one is a finding.
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

function schemaOf(props: Record<string, PropertyDef>): TableSchema {
  return {
    kinds: Object.fromEntries(Object.values(props).map((p) => [p.key, p.kind])),
    labels: Object.fromEntries(Object.values(props).map((p) => [p.key, p.label])),
    noun: 'task',
    properties: props,
  };
}

const schema = schemaOf(properties);

const result: TableResult = {
  columns: ['path', 'title', 'status', 'due', 'count', 'urgent', 'project', 'people', 'note'],
  rows: [
    [
      'a.md',
      'Book the hall',
      'next',
      '2026-03-01',
      3,
      false,
      '[[P-01]]',
      ['[[Ada]]', '[[Mara]]'],
      'first',
    ],
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

function table(overrides: Partial<TableViewProps> = {}) {
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
        {...overrides}
      />
    </NoteNamesProvider>,
  );
  return onEditCell;
}

const cell = (name: string) => screen.getByRole('button', { name });
const field = () => document.querySelector('.table__input') as HTMLInputElement;
const picker = (label = 'Status') => screen.getByRole('dialog', { name: `Set ${label}` });
const filter = () => within(picker()).getByRole('combobox') as HTMLInputElement;

describe('attack #354 — the edit lifecycle', () => {
  it('a commit on ↵ followed by a blur writes once', async () => {
    const onEditCell = table();
    await userEvent.click(cell('first'));
    await userEvent.type(field(), '!{Enter}');
    fireEvent.blur(document.activeElement as Element);
    expect(onEditCell).toHaveBeenCalledTimes(1);
  });

  it('typing then a click on another cell writes once, for the cell typed in', async () => {
    const onEditCell = table();
    await userEvent.click(cell('first'));
    await userEvent.type(field(), '!');
    await userEvent.click(cell('second'));
    expect(onEditCell).toHaveBeenCalledExactlyOnceWith({
      path: 'a.md',
      column: 'note',
      value: 'first!',
      began: { value: 'first' },
    });
    expect(field().value).toBe('second');
  });

  it('keeps what was typed when the row is read again with a new value under the edit', async () => {
    const onEditCell = vi.fn();
    const props = {
      sorts: [],
      error: null,
      schema,
      onOpenNote: () => {},
      onToggleSort: () => {},
      onEditCell,
    };
    const { rerender } = render(
      <NoteNamesProvider value={names}>
        <TableView {...props} result={result} />
      </NoteNamesProvider>,
    );
    await userEvent.click(cell('first'));
    await userEvent.type(field(), '!');
    const changed = result.rows.map((row) =>
      row[0] === 'a.md' ? [...row.slice(0, 8), 'first, edited elsewhere'] : row,
    );
    rerender(
      <NoteNamesProvider value={names}>
        <TableView {...props} result={{ ...result, rows: changed }} />
      </NoteNamesProvider>,
    );
    expect(field().value).toBe('first!');
  });

  it('Tab onto a checkbox column leaves the focus on a cell of the table, not the page', async () => {
    // count → urgent (a checkbox, which has no editor) is the next editable column.
    table();
    await userEvent.click(cell('3'));
    await userEvent.keyboard('{Tab}');
    expect(document.activeElement).not.toBe(document.body);
    expect(document.activeElement?.closest('table')).not.toBeNull();
  });

  it('Tab onto a checkbox column, then Tab again, still walks on to the next cell', async () => {
    table();
    await userEvent.click(cell('3'));
    await userEvent.keyboard('{Tab}{Tab}');
    // Past urgent comes project: its picker should be open.
    expect(screen.queryByRole('dialog', { name: 'Set Project' })).not.toBeNull();
  });

  it('a relation column the schema gives no property for ends its edit on Esc', async () => {
    // As the app's schema reads today (no `properties`): the kind alone says relation.
    const rest = Object.fromEntries(
      Object.entries(properties).filter(([key]) => key !== 'project'),
    );
    table({
      schema: { ...schemaOf(rest), kinds: { ...schemaOf(rest).kinds, project: 'relation' } },
    });
    const stop = cell('Larkspur launch');
    await userEvent.click(stop);
    // No picker can open for it, so the cell must not be left wearing the ring.
    if (stop.getAttribute('data-editing') === '') {
      stop.focus();
      await userEvent.keyboard('{Escape}');
    }
    expect(stop.getAttribute('data-editing')).toBeNull();
  });
});

describe('attack #354 — the number cell', () => {
  it('never writes a value that is not a finite number', async () => {
    const onEditCell = table();
    await userEvent.click(cell('3'));
    await userEvent.clear(field());
    fireEvent.change(field(), { target: { value: '9'.repeat(400) } });
    await userEvent.keyboard('{Enter}');
    for (const [edit] of onEditCell.mock.calls as [{ value: unknown }][]) {
      expect(Number.isFinite(edit.value)).toBe(true);
    }
  });

  it('writes nothing for a draft that reads as the number the cell holds: "3."', async () => {
    const onEditCell = table();
    await userEvent.click(cell('3'));
    await userEvent.type(field(), '.{Enter}');
    expect(onEditCell).not.toHaveBeenCalled();
  });

  it('writes nothing for an empty cell left as a lone minus sign', async () => {
    const onEditCell = table();
    // b.md's count is null, so the cell is empty.
    const empty = document
      .querySelectorAll('tr[data-index]')[1]
      ?.querySelector('td[data-kind="number"] button') as HTMLElement;
    await userEvent.click(empty);
    await userEvent.type(field(), '-{Enter}');
    expect(onEditCell).not.toHaveBeenCalled();
  });

  it('commits .5 as 0.5 and refuses 1e5 and 1,000', async () => {
    const onEditCell = table();
    await userEvent.click(cell('3'));
    await userEvent.clear(field());
    await userEvent.type(field(), '1e5');
    expect(field().value).toBe('15');
    await userEvent.clear(field());
    await userEvent.type(field(), '1,000');
    expect(field().value).toBe('1000');
    await userEvent.clear(field());
    await userEvent.type(field(), '.5{Enter}');
    expect(onEditCell).toHaveBeenCalledExactlyOnceWith({
      path: 'a.md',
      column: 'count',
      value: 0.5,
      began: { value: 3 },
    });
  });

  it('a number the file holds as 1e+21 can still be edited by typing a digit', async () => {
    const big: TableResult = {
      ...result,
      rows: [['a.md', 'Book the hall', 'next', '2026-03-01', 1e21, false, null, null, 'first']],
    };
    table({ result: big });
    await userEvent.click(cell('1e+21'));
    await userEvent.type(field(), '5');
    expect(field().value).not.toBe('1e+21');
  });
});

describe('attack #354 — the date cell', () => {
  it('keeps the time after the day when the day changes', async () => {
    const timed: TableResult = {
      ...result,
      rows: [['a.md', 'Book the hall', 'next', '2026-03-01T09:30', 3, false, null, null, 'first']],
    };
    const onEditCell = table({ result: timed });
    await userEvent.click(cell('2026-03-01T09:30'));
    fireEvent.change(field(), { target: { value: '2026-03-05' } });
    await userEvent.keyboard('{Enter}');
    expect(onEditCell).toHaveBeenCalledExactlyOnceWith({
      path: 'a.md',
      column: 'due',
      value: '2026-03-05T09:30',
      began: { value: '2026-03-01T09:30' },
    });
  });
});

describe('attack #354 — the status picker', () => {
  const quarters = schemaOf({
    ...properties,
    status: def('status', 'select', { options: ['q1 review', 'q2 plan', 'q3 plan', 'q4 plan'] }),
  });
  const quarterResult: TableResult = {
    ...result,
    rows: [['a.md', 'Book the hall', 'q1 review', '2026-03-01', 3, false, null, null, 'first']],
  };

  it('a digit typed after a letter filters ("q3"), rather than picking the third option', async () => {
    const onEditCell = table({ schema: quarters, result: quarterResult });
    await userEvent.click(cell('Q1 review'));
    await userEvent.type(filter(), 'q3');
    expect(onEditCell).not.toHaveBeenCalled();
    expect(filter().value).toBe('q3');
  });

  it('a number key never picks an option the filter has hidden', async () => {
    const onEditCell = table();
    await userEvent.click(cell('Next'));
    // "wa" leaves Waiting alone; 1 is Inbox's key, which is no longer shown.
    await userEvent.type(filter(), 'wa');
    await userEvent.keyboard('1');
    for (const [edit] of onEditCell.mock.calls as [{ value: unknown }][]) {
      expect(edit.value).not.toBe('inbox');
    }
  });

  it('with two options, a number key past them picks nothing and is typed in the filter', async () => {
    const two = schemaOf({
      ...properties,
      status: def('status', 'select', { options: ['open', 'shut'] }),
    });
    const onEditCell = table({
      schema: two,
      result: {
        ...result,
        rows: [['a.md', 'Book the hall', 'open', '2026-03-01', 3, false, null, null, 'first']],
      },
    });
    await userEvent.click(cell('Open'));
    await userEvent.keyboard('3');
    expect(onEditCell).not.toHaveBeenCalled();
    expect(filter().value).toBe('3');
  });

  it('with more than eight options, the ninth has no number key and 8 picks the eighth', async () => {
    const ten = [...STATUSES, 'blocked', 'review'];
    const onEditCell = table({
      schema: schemaOf({ ...properties, status: def('status', 'select', { options: ten }) }),
    });
    await userEvent.click(cell('Next'));
    const keys = within(picker())
      .getAllByRole('option')
      .map((option) => option.querySelector('.cell-picker__key')?.textContent);
    expect(keys.slice(8)).toEqual(['', '']);
    await userEvent.keyboard('8');
    expect(onEditCell).toHaveBeenCalledExactlyOnceWith({
      path: 'a.md',
      column: 'status',
      value: 'archive',
      began: { value: 'next' },
    });
  });

  it('↓ from the last option wraps to the first', async () => {
    table();
    await userEvent.click(cell('Next'));
    // The picker opens on the held option, Next (the second): one press short
    // of a full round lands on the first.
    await userEvent.keyboard('{ArrowDown}'.repeat(STATUSES.length - 1));
    const highlighted = within(picker())
      .getAllByRole('option')
      .findIndex((option) => option.hasAttribute('data-highlighted'));
    expect(highlighted).toBe(0);
  });

  it('↑ from the first option wraps to the last', async () => {
    table();
    await userEvent.click(cell('Next'));
    await userEvent.keyboard('{ArrowUp}{ArrowUp}');
    const highlighted = within(picker())
      .getAllByRole('option')
      .findIndex((option) => option.hasAttribute('data-highlighted'));
    expect(highlighted).toBe(STATUSES.length - 1);
  });

  it('a press outside closes the picker with nothing written', async () => {
    const onEditCell = table();
    await userEvent.click(cell('Next'));
    await userEvent.click(document.body);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(onEditCell).not.toHaveBeenCalled();
    expect(cell('Next').getAttribute('data-editing')).toBeNull();
  });

  it('a click on the open cell itself closes its picker', async () => {
    table();
    await userEvent.click(cell('Next'));
    await userEvent.click(cell('Next'));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('opens with the held option highlighted, so ↵ at once keeps it', async () => {
    const onEditCell = table();
    await userEvent.click(cell('Next'));
    await userEvent.keyboard('{Enter}');
    expect(onEditCell).not.toHaveBeenCalled();
  });
});

describe('attack #354 — the relation cell', () => {
  it('↵ on a chip opens its note, not the picker', async () => {
    const onOpenNote = vi.fn();
    table({ onOpenNote });
    const chip = screen.getByRole('button', { name: 'Open Ada Lovelace' });
    chip.focus();
    await userEvent.keyboard('{Enter}');
    expect(onOpenNote).toHaveBeenCalledWith('people/Ada.md');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('removing two links one after the other, before the note is read again, removes both', async () => {
    const onEditCell = table();
    await userEvent.click(cell('Ada Lovelace, Mara Quill'));
    const popover = picker('People');
    await userEvent.click(
      within(popover).getByRole('button', { name: 'Remove Ada Lovelace from People' }),
    );
    await userEvent.click(
      within(popover).getByRole('button', { name: 'Remove Mara Quill from People' }),
    );
    const last = onEditCell.mock.calls.at(-1)?.[0] as { value: unknown };
    expect(last.value).toBeNull();
  });

  it('Esc in the field closes its suggestions and leaves the picker open', async () => {
    const onCreateRelated = vi.fn().mockResolvedValue('[[P-09]]');
    table({ onCreateRelated });
    await userEvent.click(cell('Larkspur launch'));
    await userEvent.type(within(picker('Project')).getByRole('combobox'), 'Fête');
    expect(screen.getByRole('option', { name: 'Create project ‘Fête’' })).toBeDefined();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('listbox', { name: 'Suggested notes' })).toBeNull();
    expect(screen.queryByRole('dialog', { name: 'Set Project' })).not.toBeNull();
    expect(onCreateRelated).not.toHaveBeenCalled();
  });
});

describe('attack #354 — the checkbox cell', () => {
  it('one click writes once, the opposite of what it held', async () => {
    const onEditCell = table();
    await userEvent.click(screen.getByRole('checkbox', { name: 'Urgent for Order chairs' }));
    expect(onEditCell).toHaveBeenCalledExactlyOnceWith({
      path: 'b.md',
      column: 'urgent',
      value: false,
    });
  });
});
