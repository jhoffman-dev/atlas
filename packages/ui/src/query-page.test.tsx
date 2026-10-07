// @vitest-environment jsdom
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { SchemaTable, SqlShow, ViewLayout } from '@atlas/domain';
import { QueryPage, type QueryChoice } from './query-page.tsx';
import type { TableResult } from './table-view.tsx';

const SCHEMA: SchemaTable[] = [
  { name: 'v_task', kind: 'view', columns: ['path', 'title', 'status'] },
  { name: 'files', kind: 'table', columns: ['path', 'title'] },
];

const RESULT: TableResult = {
  columns: ['status', 'n'],
  rows: [
    ['doing', 2],
    ['backlog', 6],
  ],
  truncated: false,
  sql: 'SELECT status, n FROM counts',
};

const LAYOUTS: QueryChoice<ViewLayout>[] = [
  { value: 'table', label: 'Table', problem: null },
  { value: 'list', label: 'List', problem: 'A list needs the query to return path and title.' },
];

const SHOWS: QueryChoice<SqlShow>[] = [
  { value: 'table', label: 'Table', problem: null },
  { value: 'bar', label: 'Bar chart', problem: null },
];

function page({
  result = null,
  error = null,
  schema = SCHEMA,
  initial = '',
}: {
  result?: TableResult | null;
  error?: string | null;
  schema?: SchemaTable[] | null;
  initial?: string;
} = {}) {
  const onRun = vi.fn();
  const onSave = vi.fn();
  const onAdd = vi.fn();
  function Harness() {
    const [sql, setSql] = useState(initial);
    return (
      <>
        <QueryPage
          sql={sql}
          onSqlChange={setSql}
          onRun={onRun}
          running={false}
          result={result}
          error={error}
          sorts={[]}
          onToggleSort={() => undefined}
          onOpenNote={() => undefined}
          schema={schema}
          save={{ layouts: LAYOUTS, error: null, onSave }}
          dashboards={{
            choices: [{ value: '.atlas/dashboards/Home.md', label: 'Home' }],
            shows: SHOWS,
            notice: null,
            onAdd,
          }}
        />
        <pre data-testid="sql">{sql}</pre>
      </>
    );
  }
  render(<Harness />);
  return { onRun, onSave, onAdd, sql: () => screen.getByTestId('sql').textContent };
}

describe('QueryPage', () => {
  it('runs on Cmd+Enter and from the Run button', async () => {
    const { onRun } = page();
    await userEvent.type(
      screen.getByRole('textbox', { name: 'SQL' }),
      'SELECT 1{Meta>}{Enter}{/Meta}',
    );
    expect(onRun).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole('button', { name: /Run/ }));
    expect(onRun).toHaveBeenCalledTimes(2);
  });

  it('numbers every line of the statement', async () => {
    page({ initial: 'SELECT 1\nFROM x\nWHERE y' });
    const gutter = document.querySelector('.query__gutter');
    expect(gutter?.textContent).toBe('123');
  });

  it('shows the rows, how many, and cells that cannot be edited', async () => {
    page({ result: RESULT });
    expect(document.querySelector('.query__count')?.textContent).toBe('2 rows');
    const table = screen.getByRole('table');
    expect(within(table).getByText('backlog')).toBeDefined();
    await userEvent.click(within(table).getByText('doing'));
    expect(within(table).queryByRole('textbox')).toBeNull();
  });

  it('shows the index’s error in its own words instead of a result', () => {
    page({ error: 'no such table: v_nothing' });
    expect(screen.getByRole('alert').textContent).toBe('no such table: v_nothing');
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('puts a clicked column or table name where the cursor is', async () => {
    const { sql } = page({ initial: 'SELECT  FROM ' });
    const field = screen.getByRole('textbox', { name: 'SQL' }) as HTMLTextAreaElement;
    field.setSelectionRange(7, 7);
    await userEvent.click(screen.getByRole('button', { name: 'Insert v_task.status' }));
    expect(sql()).toBe('SELECT status FROM ');
    // The cursor lands after what was put in, once the field has redrawn.
    await waitFor(() => expect(field.selectionStart).toBe('SELECT status'.length));
    field.setSelectionRange(sql()!.length, sql()!.length);
    await userEvent.click(screen.getByRole('button', { name: 'Insert v_task' }));
    await waitFor(() => expect(sql()).toBe('SELECT status FROM v_task'));
  });

  it('lists the views and tables it was given, and says when it is still reading', () => {
    page({ schema: null });
    expect(screen.getByText('Reading the index…')).toBeDefined();
  });

  it('saves the query as a view in a layout its columns allow', async () => {
    const { onSave } = page({ result: RESULT });
    await userEvent.click(screen.getByRole('button', { name: 'Save as view' }));
    await userEvent.type(await screen.findByRole('textbox', { name: 'View name' }), 'Counts');
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Layout' }), 'list');
    expect(screen.getByText('A list needs the query to return path and title.')).toBeDefined();
    expect((screen.getByRole('button', { name: 'Save view' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Layout' }), 'table');
    await userEvent.click(screen.getByRole('button', { name: 'Save view' }));
    expect(onSave).toHaveBeenCalledWith({ name: 'Counts', layout: 'table' });
  });

  it('adds the query to a dashboard as the chosen kind of widget', async () => {
    const { onAdd } = page({ result: RESULT });
    await userEvent.click(screen.getByRole('button', { name: 'Add to dashboard' }));
    await userEvent.selectOptions(await screen.findByRole('combobox', { name: 'Show as' }), 'bar');
    await userEvent.type(screen.getByRole('textbox', { name: 'Widget title' }), 'By status');
    await userEvent.click(screen.getByRole('button', { name: 'Add widget' }));
    expect(onAdd).toHaveBeenCalledWith({
      path: '.atlas/dashboards/Home.md',
      show: 'bar',
      title: 'By status',
    });
  });

  it('offers neither until a query has run', () => {
    page();
    expect(screen.queryByRole('button', { name: 'Save as view' })).toBeNull();
    expect(screen.getByRole('button', { name: /Run/ })).toBeDefined();
  });
});
