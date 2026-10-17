// @vitest-environment jsdom
/**
 * Attack on #252: what one arrow press draws in a long grouped table. A
 * press to a line already drawn moves the focus and draws nothing; one to a
 * line not drawn yet draws the lines the scroll brings in, not every row.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import {
  groupResultRows,
  parseObjectType,
  toBoardRows,
  viewGroupLevels,
  type RowGroup,
} from '@atlas/domain';
import { TableView, type TableResult } from './table-view.tsx';
import { startCountingRenders, stopCountingRenders } from './testing/render-counter.ts';
import { scrollableSheet } from './testing/scrollable-sheet.ts';

// Before React loads, so every commit is handed to the counter.
await vi.hoisted(async () => {
  const { installRenderCounter } = await import('./testing/render-counter.ts');
  installRenderCounter();
});

afterEach(cleanup);

const TASK = parseObjectType({
  name: 'task',
  properties: { status: { kind: 'select', options: ['backlog', 'doing'] } },
});

const ROWS = 300;

const result: TableResult = {
  columns: ['path', 'title', 'status'],
  rows: Array.from({ length: ROWS }, (_, at) => [
    `r${at}.md`,
    `Row ${at}`,
    at < ROWS / 2 ? 'backlog' : 'doing',
  ]),
  truncated: false,
  sql: '',
};

const groups: RowGroup[] = groupResultRows({
  rows: toBoardRows(result),
  groups: viewGroupLevels({ type: TASK, groupBy: 'status', subGroupBy: null, sorts: [] }),
});

function LongGrouped() {
  return (
    <TableView
      result={result}
      sorts={[]}
      error={null}
      schema={{ kinds: { status: 'select' }, labels: {}, noun: 'task' }}
      onOpenNote={() => {}}
      onEditCell={() => {}}
      onToggleSort={() => {}}
      grouping={{ groups, collapsed: new Set(), onToggle: () => {}, onNew: () => {} }}
    />
  );
}

function rowsDrawnBy(act: () => void): number {
  startCountingRenders();
  act();
  return stopCountingRenders().renders['TableRow'] ?? 0;
}

const drawnRows = () => document.querySelectorAll('tr.table__row').length;

describe('#252 attack — what one arrow press draws in a grouped table', () => {
  const { sheetOf, scrollSheet } = scrollableSheet();

  it('draws no row for a press to a line already drawn', () => {
    render(<LongGrouped />);
    const first = screen.getByRole('button', { name: 'Row 0' });
    first.focus();
    const drawn = rowsDrawnBy(() => {
      fireEvent.keyDown(first, { key: 'ArrowDown' });
    });
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Row 1' }));
    expect(drawn).toBe(0);
  });

  it('draws only the rows the scroll brings in for End, not every row', () => {
    render(<LongGrouped />);
    const screenful = drawnRows();
    expect(screenful).toBeLessThan(ROWS / 4);
    const header = document.querySelector('tr[data-index="0"] .table__group-toggle') as HTMLElement;
    header.focus();
    const drawn = rowsDrawnBy(() => {
      fireEvent.keyDown(header, { key: 'End' });
      scrollSheet(sheetOf(), (ROWS + 4) * 44);
    });
    expect(document.activeElement).toBe(screen.getByRole('button', { name: `Row ${ROWS - 1}` }));
    // The rows newly in the page, and no more than a screenful drawn again besides.
    expect(drawn).toBeLessThanOrEqual(2 * screenful);
  });
});
