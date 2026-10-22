// @vitest-environment jsdom
/**
 * A table's rows are worked out once per result (#217): the window renders
 * the open table again for everything else that happens — every key typed in
 * ⌘K — and 420 rows were turned into board rows each time.
 */
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import * as domain from '@dfai/domain';
import { TableView, type TableResult } from './table-view.tsx';

vi.mock('@dfai/domain', async (importOriginal) => {
  const actual = await importOriginal<typeof domain>();
  return { ...actual, toBoardRows: vi.fn(actual.toBoardRows) };
});

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
const props = { sorts: [], error: null, onOpenNote: noop, onEditCell: noop, onToggleSort: noop };

describe('TableView — its rows', () => {
  it('works them out once while the result stays the same, however often it is drawn', () => {
    const boardRows = vi.mocked(domain.toBoardRows);
    boardRows.mockClear();
    const view = render(<TableView {...props} result={result} />);
    // Drawn again by the window, with handlers made anew, for something else entirely.
    view.rerender(<TableView {...props} onOpenNote={() => {}} result={result} />);
    view.rerender(<TableView {...props} onToggleSort={() => {}} result={result} />);

    expect(screen.getByText('Second task')).toBeDefined();
    expect(boardRows).toHaveBeenCalledTimes(1);
  });

  it('works them out again for a new result', () => {
    const boardRows = vi.mocked(domain.toBoardRows);
    boardRows.mockClear();
    const view = render(<TableView {...props} result={result} />);
    const next = { ...result, rows: [...result.rows, ['c.md', 'Third task', null]] };
    view.rerender(<TableView {...props} result={next} />);

    expect(screen.getByText('Third task')).toBeDefined();
    expect(boardRows).toHaveBeenCalledTimes(2);
  });
});
