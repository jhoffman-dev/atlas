// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TableView, type TableResult, type TableViewProps } from './table-view.tsx';
import { tableRowsMeasured } from './testing/table-rows-measured.ts';
import { startCountingRenders, stopCountingRenders } from './testing/render-counter.ts';

await vi.hoisted(async () => {
  const { installRenderCounter } = await import('./testing/render-counter.ts');
  installRenderCounter();
});

const RESULT: TableResult = {
  columns: ['path', 'title', 'status'],
  rows: [
    ['t0.md', 'Task 0', 'doing'],
    ['t1.md', 'Task 1', 'doing'],
  ],
  truncated: false,
  sql: '',
};

function props(overrides: Partial<TableViewProps> = {}): TableViewProps {
  return {
    result: RESULT,
    sorts: [],
    error: null,
    schema: { kinds: { status: 'select' }, labels: {}, noun: 'Task' },
    onOpenNote: () => {},
    onEditCell: () => {},
    onToggleSort: () => {},
    ...overrides,
  };
}

/** The name cell's button of a row: the focus landing anywhere in the row counts. */
const nameOf = (title: string) => screen.getByRole('button', { name: title });

describe('TableView — the focused row (UI v2 slice 8b)', () => {
  tableRowsMeasured();

  it('says which row the focus landed in, by the note’s path', async () => {
    const onRowFocus = vi.fn();
    render(<TableView {...props({ onRowFocus })} />);
    nameOf('Task 0').focus();
    expect(onRowFocus).toHaveBeenCalledWith('t0.md');
    // Tab walks from the name into the row's own cells: still that row.
    await userEvent.tab();
    expect(onRowFocus).toHaveBeenLastCalledWith('t0.md');
    nameOf('Task 1').focus();
    expect(onRowFocus).toHaveBeenLastCalledWith('t1.md');
  });

  it('says nothing where nothing follows the focused row', async () => {
    render(<TableView {...props()} />);
    nameOf('Task 1').focus();
    expect(document.activeElement).toBe(nameOf('Task 1'));
  });

  it('a new handler on the next render draws no row again', () => {
    const { rerender } = render(<TableView {...props({ onRowFocus: () => {} })} />);
    startCountingRenders();
    rerender(<TableView {...props({ onRowFocus: () => {} })} />);
    expect(stopCountingRenders().renders['TableRow'] ?? 0).toBe(0);
  });
});
