// @vitest-environment jsdom
/**
 * Attack on PR #354 (#299): the cell stops and Tab in long, virtualised
 * tables — flat (2,000 rows) and grouped — where the cell a key reaches may
 * be in a row the virtualiser has not drawn.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import {
  groupResultRows,
  parseObjectType,
  toBoardRows,
  viewGroupLevels,
  type RowGroup,
} from '@atlas/domain';
import { TableView, type TableResult } from './table-view.tsx';
import { ROW_ESTIMATE } from './grouped-rows.tsx';
import { scrollableSheet } from './testing/scrollable-sheet.ts';

afterEach(cleanup);

const ROWS = 2000;

const result: TableResult = {
  columns: ['path', 'title', 'status', 'due'],
  rows: Array.from({ length: ROWS }, (_, at) => [
    `r${at}.md`,
    `Row ${at}`,
    at < ROWS / 2 ? 'backlog' : 'doing',
    `2026-03-${String((at % 28) + 1).padStart(2, '0')}`,
  ]),
  truncated: false,
  sql: '',
};

const schema = { kinds: { status: 'select', due: 'date' }, labels: {}, noun: 'task' } as const;

/** The cell stop under a column in a drawn line. */
const stopAt = (line: number, column: string) =>
  document.querySelector(
    `tr[data-index="${line}"] [data-cell-stop="${column}"]`,
  ) as HTMLElement | null;
const focusedLine = () => document.activeElement?.closest('tr')?.getAttribute('data-index');
const focusedColumn = () => (document.activeElement as HTMLElement | null)?.dataset['cellStop'];

describe('attack #354 — a flat table of 2,000 rows', () => {
  const { sheetOf, scrollSheet } = scrollableSheet();

  function Flat() {
    return (
      <TableView
        result={result}
        sorts={[]}
        error={null}
        schema={schema}
        onOpenNote={() => {}}
        onEditCell={() => {}}
        onToggleSort={() => {}}
      />
    );
  }

  it('End from a cell reaches the same column of the last row, once it is drawn', () => {
    render(<Flat />);
    const from = stopAt(0, 'due') as HTMLElement;
    from.focus();
    fireEvent.keyDown(from, { key: 'End' });
    scrollSheet(sheetOf(), ROWS * ROW_ESTIMATE);
    expect(focusedLine()).toBe(String(ROWS - 1));
    expect(focusedColumn()).toBe('due');
  });

  it('PageDown from a cell keeps its column', () => {
    render(<Flat />);
    const from = stopAt(0, 'status') as HTMLElement;
    from.focus();
    fireEvent.keyDown(from, { key: 'PageDown' });
    scrollSheet(sheetOf(), 20 * ROW_ESTIMATE);
    expect(focusedColumn()).toBe('status');
    expect(Number(focusedLine())).toBeGreaterThan(0);
  });
});

describe('attack #354 — a grouped table: the column across a group header', () => {
  const { sheetOf, scrollSheet } = scrollableSheet();
  const TASK = parseObjectType({
    name: 'task',
    properties: { status: { kind: 'select', options: ['backlog', 'doing'] }, due: 'date' },
  });
  const short: TableResult = {
    ...result,
    rows: result.rows.slice(0, 300).map((row, at) => {
      const copy = [...row];
      copy[2] = at < 150 ? 'backlog' : 'doing';
      return copy;
    }),
  };
  const groups: RowGroup[] = groupResultRows({
    rows: toBoardRows(short),
    groups: viewGroupLevels({ type: TASK, groupBy: 'status', subGroupBy: null, sorts: [] }),
  });

  it('↓ from a due cell over the next group’s header lands on the due cell of its first row', () => {
    render(
      <TableView
        result={short}
        sorts={[]}
        error={null}
        schema={schema}
        onOpenNote={() => {}}
        onEditCell={() => {}}
        onToggleSort={() => {}}
        grouping={{ groups, collapsed: new Set(), onToggle: () => {}, onNew: () => {} }}
      />,
    );
    // Row 149 is line 150; "+ New" is 151, the Doing header 152, Row 150 line 153.
    scrollSheet(sheetOf(), 140 * ROW_ESTIMATE);
    const from = stopAt(150, 'due') as HTMLElement;
    from.focus();
    fireEvent.keyDown(from, { key: 'ArrowDown' });
    fireEvent.keyDown(document.activeElement as Element, { key: 'ArrowDown' });
    expect(focusedLine()).toBe('153');
    expect(focusedColumn()).toBe('due');
    expect(screen.getByRole('button', { name: 'Row 150' })).toBeDefined();
  });
});
