// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { useState } from 'react';
import userEvent from '@testing-library/user-event';
import { createVaultPath, noteNames } from '@atlas/domain';
import { NoteNamesProvider } from './note-names.tsx';
import { TableView, type TableResult } from './table-view.tsx';

const result: TableResult = {
  columns: ['path', 'title', 'status'],
  rows: [
    ['a.md', 'First task', 'doing'],
    ['b.md', 'Second task', null],
  ],
  truncated: false,
  sql: 'SELECT "path", "title", "status"\nFROM "v_task"',
};

const noop = () => {};
const props = {
  sorts: [],
  error: null,
  onOpenNote: noop,
  onEditCell: noop,
  onToggleSort: noop,
};

describe('TableView', () => {
  it('shows a column per field, without the path, headed in sentence case', () => {
    render(<TableView {...props} result={result} />);
    expect(screen.getByRole('columnheader', { name: 'Name' })).toBeDefined();
    expect(screen.getByRole('columnheader', { name: 'Status' })).toBeDefined();
    expect(screen.getAllByRole('columnheader')).toHaveLength(2);
  });

  it('does not make a column of the summary the index hands back for cards', () => {
    render(
      <TableView
        {...props}
        result={{ ...result, columns: ['path', 'title', 'summary'], rows: [['a.md', 'A', 'x']] }}
      />,
    );
    expect(screen.getByRole('columnheader', { name: 'Name' })).toBeDefined();
    expect(screen.queryByRole('columnheader', { name: 'Summary' })).toBeNull();
  });

  it('humanises a key with no declared label', () => {
    render(
      <TableView
        {...props}
        result={{ ...result, columns: ['path', 'title', 'blocked_by'], rows: [['a.md', 'A', '']] }}
      />,
    );
    expect(screen.getByRole('columnheader', { name: 'Blocked by' })).toBeDefined();
  });

  it('heads a column with the label its type declares, over the key', () => {
    render(
      <TableView
        {...props}
        result={{ ...result, columns: ['path', 'title', 'status'] }}
        schema={{ kinds: {}, labels: { status: 'Stage' }, noun: 'Task' }}
      />,
    );
    expect(screen.getByRole('columnheader', { name: 'Stage' })).toBeDefined();
  });

  it('shows a row per result', () => {
    render(<TableView {...props} result={result} />);
    expect(screen.getByText('First task')).toBeDefined();
    expect(screen.getByText('Second task')).toBeDefined();
  });

  it('leaves an empty cell empty, with a quiet "Empty" to click on', () => {
    render(<TableView {...props} result={result} />);
    const blank = screen.getByRole('button', { name: 'Empty' });
    expect(blank.querySelector('.table__blank')).not.toBeNull();
  });

  it('draws a select as a status pill, in its tone', () => {
    render(
      <TableView
        {...props}
        result={result}
        schema={{ kinds: { status: 'select' }, labels: {}, noun: 'Task' }}
      />,
    );
    const pill = screen.getByRole('button', { name: 'Doing' }).querySelector('.status-pill');
    expect(pill?.getAttribute('data-tone')).toBe('doing');
  });

  it('draws a source of "you" as a You chip, and any other source as text', () => {
    render(
      <TableView
        {...props}
        result={{
          ...result,
          columns: ['path', 'title', 'source'],
          rows: [
            ['a.md', 'Mine', 'you'],
            ['b.md', 'Theirs', 'bug-fixer'],
          ],
        }}
      />,
    );
    expect(screen.getByText('You').closest('.table__you')).not.toBeNull();
    expect(
      screen.getByRole('button', { name: 'bug-fixer' }).querySelector('.table__you'),
    ).toBeNull();
  });

  it('opens the note when its title is clicked', async () => {
    const onOpenNote = vi.fn();
    render(<TableView {...props} result={result} onOpenNote={onOpenNote} />);
    await userEvent.click(screen.getByRole('button', { name: 'First task' }));
    expect(onOpenNote).toHaveBeenCalledWith('a.md');
  });

  it('asks to sort when a heading is clicked', async () => {
    const onToggleSort = vi.fn();
    render(<TableView {...props} result={result} onToggleSort={onToggleSort} />);
    await userEvent.click(screen.getByRole('button', { name: 'Status' }));
    expect(onToggleSort).toHaveBeenCalledWith('status');
  });

  it('says which column is sorted, and which way', () => {
    const { rerender } = render(
      <TableView {...props} result={result} sorts={[{ key: 'status', direction: 'desc' }]} />,
    );
    const status = () => screen.getByRole('columnheader', { name: 'Status' });
    expect(status().getAttribute('aria-sort')).toBe('descending');
    expect(screen.getByRole('columnheader', { name: 'Name' }).getAttribute('aria-sort')).toBeNull();

    rerender(
      <TableView {...props} result={result} sorts={[{ key: 'status', direction: 'asc' }]} />,
    );
    expect(status().getAttribute('aria-sort')).toBe('ascending');
  });

  it('edits a cell and reports the new value', async () => {
    const onEditCell = vi.fn();
    render(<TableView {...props} result={result} onEditCell={onEditCell} />);

    await userEvent.click(screen.getByRole('button', { name: 'doing' }));
    const input = screen.getByDisplayValue('doing');
    await userEvent.clear(input);
    await userEvent.type(input, 'done{Enter}');

    expect(onEditCell).toHaveBeenCalledWith({ path: 'a.md', column: 'status', value: 'done' });
  });

  it('keeps an edit in progress when its row leaves the page, as a scrolled-away row does', async () => {
    const onEditCell = vi.fn();
    const { rerender } = render(<TableView {...props} result={result} onEditCell={onEditCell} />);

    await userEvent.click(screen.getByRole('button', { name: 'doing' }));
    const input = screen.getByDisplayValue('doing');
    await userEvent.clear(input);
    await userEvent.type(input, 'done');
    rerender(
      <TableView
        {...props}
        result={{ ...result, rows: result.rows.slice(1) }}
        onEditCell={onEditCell}
      />,
    );

    expect(screen.queryByDisplayValue('done')).toBeNull();
    expect(onEditCell).toHaveBeenCalledExactlyOnceWith({
      path: 'a.md',
      column: 'status',
      value: 'done',
    });
  });

  it('writes a finished edit once, however its row leaves the page after', async () => {
    const onEditCell = vi.fn();
    const { rerender } = render(<TableView {...props} result={result} onEditCell={onEditCell} />);

    await userEvent.click(screen.getByRole('button', { name: 'doing' }));
    const input = screen.getByDisplayValue('doing');
    await userEvent.clear(input);
    await userEvent.type(input, 'done{Enter}');
    rerender(
      <TableView
        {...props}
        result={{ ...result, rows: result.rows.slice(1) }}
        onEditCell={onEditCell}
      />,
    );

    expect(onEditCell).toHaveBeenCalledTimes(1);
  });

  it('writes an edit once when writing it takes its row off the page at once', async () => {
    const onEditCell = vi.fn();
    function Regrouping() {
      const [rows, setRows] = useState(result.rows);
      return (
        <TableView
          {...props}
          result={{ ...result, rows }}
          onEditCell={(edit) => {
            onEditCell(edit);
            setRows((was) => was.filter((row) => row[0] !== edit.path));
          }}
        />
      );
    }
    render(<Regrouping />);

    await userEvent.click(screen.getByRole('button', { name: 'doing' }));
    const input = screen.getByDisplayValue('doing');
    await userEvent.clear(input);
    await userEvent.type(input, 'done{Enter}');

    expect(screen.queryByRole('button', { name: 'First task' })).toBeNull();
    expect(onEditCell).toHaveBeenCalledTimes(1);
  });

  it('does not report an edit that changed nothing', async () => {
    const onEditCell = vi.fn();
    render(<TableView {...props} result={result} onEditCell={onEditCell} />);

    await userEvent.click(screen.getByRole('button', { name: 'doing' }));
    await userEvent.keyboard('{Enter}');

    expect(onEditCell).not.toHaveBeenCalled();
  });

  it('abandons an edit on escape', async () => {
    const onEditCell = vi.fn();
    render(<TableView {...props} result={result} onEditCell={onEditCell} />);

    await userEvent.click(screen.getByRole('button', { name: 'doing' }));
    await userEvent.type(screen.getByDisplayValue('doing'), 'X{Escape}');

    expect(onEditCell).not.toHaveBeenCalled();
  });

  it('counts the rows in the type’s words', () => {
    render(
      <TableView {...props} result={result} schema={{ kinds: {}, labels: {}, noun: 'Task' }} />,
    );
    expect(screen.getByText('2 tasks')).toBeDefined();
  });

  it('offers a new note of the type in the footer, when it can make one', async () => {
    const onNewNote = vi.fn();
    const { rerender } = render(
      <TableView
        {...props}
        result={result}
        schema={{ kinds: {}, labels: {}, noun: 'Task' }}
        onNewNote={onNewNote}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'New task' }));
    expect(onNewNote).toHaveBeenCalledOnce();

    rerender(<TableView {...props} result={result} />);
    expect(screen.queryByRole('button', { name: /^New/ })).toBeNull();
  });

  it('says when results were cut short', () => {
    render(<TableView {...props} result={{ ...result, truncated: true }} />);
    expect(screen.getByText(/left out/)).toBeDefined();
  });

  it('says so when a view matches nothing', () => {
    render(<TableView {...props} result={{ ...result, rows: [] }} />);
    expect(screen.getByText('Nothing matches this view yet.')).toBeDefined();
  });

  it('announces a failed query', () => {
    render(<TableView {...props} result={null} error="no such column: nope" />);
    expect(screen.getByRole('alert').textContent).toBe('no such column: nope');
  });

  it('says it is working before results arrive', () => {
    render(<TableView {...props} result={null} />);
    expect(screen.getByText('Running…')).toBeDefined();
  });
});

describe('a relation in the table', () => {
  const names = noteNames([
    { path: createVaultPath('P-01.md'), title: 'Atlas' },
    { path: createVaultPath('people/Ada.md'), title: 'Ada Lovelace' },
  ]);
  const related: TableResult = {
    columns: ['path', 'title', 'project', 'people'],
    rows: [['a.md', 'First task', '[[P-01]]', '[[Ada]], [[Gone]]']],
    truncated: false,
    sql: '',
  };
  const table = (onOpenNote = vi.fn()) => {
    render(
      <NoteNamesProvider value={names}>
        <TableView
          {...props}
          onOpenNote={onOpenNote}
          result={related}
          schema={{ kinds: { project: 'relation', people: 'relation' }, labels: {}, noun: 'task' }}
        />
      </NoteNamesProvider>,
    );
    return onOpenNote;
  };

  it('shows each linked note by its title, never the link', () => {
    table();
    const row = screen.getAllByRole('row')[1];
    expect(row?.textContent).toBe('First taskAtlasAda LovelaceGone');
  });

  it('opens the note a link names, not the row', async () => {
    const onOpenNote = table();
    await userEvent.click(screen.getByRole('button', { name: 'Open Ada Lovelace' }));
    expect(onOpenNote).toHaveBeenCalledExactlyOnceWith('people/Ada.md');
  });

  it('marks a link to nothing as missing, with nothing to open', () => {
    table();
    expect(screen.getByText('Gone').getAttribute('data-missing')).toBe('true');
    expect(screen.queryByRole('button', { name: 'Open Gone' })).toBeNull();
  });
});

describe('TableView choosing rows', () => {
  it('draws no boxes until rows can be chosen', () => {
    render(<TableView {...props} result={result} />);
    expect(screen.queryAllByRole('checkbox')).toEqual([]);
  });

  it('leads each row with a box that chooses it by its path', async () => {
    const onToggle = vi.fn();
    render(
      <TableView
        {...props}
        result={result}
        selection={{ selected: new Set(['b.md']), onToggle, onToggleAll: vi.fn() }}
      />,
    );
    const second = screen.getByRole('checkbox', { name: 'Select Second task' }) as HTMLInputElement;
    expect(second.checked).toBe(true);
    await userEvent.click(screen.getByRole('checkbox', { name: 'Select First task' }));
    expect(onToggle).toHaveBeenCalledWith('a.md');
  });

  it('chooses every row from the heading', async () => {
    const onToggleAll = vi.fn();
    render(
      <TableView
        {...props}
        result={result}
        selection={{ selected: new Set(), onToggle: vi.fn(), onToggleAll }}
      />,
    );
    await userEvent.click(screen.getByRole('checkbox', { name: 'Select all' }));
    expect(onToggleAll).toHaveBeenCalledWith({ paths: ['a.md', 'b.md'], select: true });
  });
});
