// @vitest-environment jsdom
/**
 * The arrow keys in a long, virtualised grouped table (#248): Up, Down, Home
 * and End reach a row's name or a group's header the virtualiser has not
 * drawn, by scrolling to it first, and a move left waiting for its line is
 * cancelled by a later move, a press, or a blur, and never takes the focus
 * from a cell being edited — as the flat table's are.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
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

const TASK = parseObjectType({
  name: 'task',
  properties: { status: { kind: 'select', options: ['backlog', 'doing'] }, due: 'date' },
});

/** 150 rows in Backlog, then 150 in Doing: 304 lines with the headers and each "+ New". */
const ROWS = 300;
const LINES = ROWS + 4;

const result: TableResult = {
  columns: ['path', 'title', 'status', 'due'],
  rows: Array.from({ length: ROWS }, (_, at) => [
    `r${at}.md`,
    `Row ${at}`,
    at < ROWS / 2 ? 'backlog' : 'doing',
    '2026-03-01',
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
      schema={{ kinds: { status: 'select', due: 'date' }, labels: {}, noun: 'task' }}
      onOpenNote={() => {}}
      onEditCell={() => {}}
      onToggleSort={() => {}}
      grouping={{ groups, collapsed: new Set(), onToggle: () => {}, onNew: () => {} }}
    />
  );
}

const name = (title: string) => screen.getByRole('button', { name: title });
/** The header toggle on a line: a select's cells say "backlog" too, so it is found by its place. */
const headerAt = (line: number) =>
  document.querySelector(`tr[data-index="${line}"] .table__group-toggle`) as HTMLElement;
const backlog = () => headerAt(0);
const focusedLine = () => document.activeElement?.closest('tr')?.getAttribute('data-index');

/** The highest line index drawn now. */
function lastDrawn(): number {
  const drawn = [...document.querySelectorAll('tbody tr[data-index]')].map((line) =>
    Number(line.getAttribute('data-index')),
  );
  return Math.max(...drawn);
}

describe('a long grouped table — the arrow keys (#248)', () => {
  const { sheetOf, scrollSheet } = scrollableSheet();

  it('reaches the last row with End, scrolling to it first, and the first header with Home', () => {
    render(<LongGrouped />);
    expect(screen.queryByRole('button', { name: `Row ${ROWS - 1}` })).toBeNull();
    backlog().focus();

    fireEvent.keyDown(backlog(), { key: 'End' });
    scrollSheet(sheetOf(), LINES * ROW_ESTIMATE);
    expect(document.activeElement).toBe(name(`Row ${ROWS - 1}`));

    fireEvent.keyDown(name(`Row ${ROWS - 1}`), { key: 'Home' });
    scrollSheet(sheetOf(), 0);
    expect(document.activeElement).toBe(backlog());
  });

  it('crosses from a group’s last row to the next group’s header, over its "+ New"', () => {
    render(<LongGrouped />);
    // Row 149 is line 150; "+ New" is 151, and the Doing header 152.
    scrollSheet(sheetOf(), 140 * ROW_ESTIMATE);
    name('Row 149').focus();
    fireEvent.keyDown(name('Row 149'), { key: 'ArrowDown' });
    expect(document.activeElement).toBe(headerAt(152));
    expect(headerAt(152).textContent).toMatch(/^doing/i);
    fireEvent.keyDown(document.activeElement as Element, { key: 'ArrowUp' });
    expect(document.activeElement).toBe(name('Row 149'));
  });

  it('a move to an undrawn line that a later move overtook does not take the focus when it is drawn', () => {
    render(<LongGrouped />);
    backlog().focus();
    fireEvent.keyDown(backlog(), { key: 'End' });
    // Home, before the scroll lands, brings the focus back to the first header, which is drawn.
    fireEvent.keyDown(backlog(), { key: 'Home' });
    expect(document.activeElement).toBe(backlog());

    scrollSheet(sheetOf(), LINES * ROW_ESTIMATE);
    expect(screen.getByRole('button', { name: `Row ${ROWS - 1}` })).toBeDefined();
    expect(focusedLine()).not.toBe(String(LINES - 2));
  });

  it('a press anywhere cancels a move left waiting for its line', () => {
    render(<LongGrouped />);
    backlog().focus();
    fireEvent.keyDown(backlog(), { key: 'End' });
    fireEvent.pointerDown(document.body);

    // Scrolled away, the header drops its focus to the body; the press still holds.
    scrollSheet(sheetOf(), LINES * ROW_ESTIMATE);
    expect(screen.getByRole('button', { name: `Row ${ROWS - 1}` })).toBeDefined();
    expect(document.activeElement).toBe(document.body);
  });

  it('a blur cancels a move left waiting for its line', () => {
    render(<LongGrouped />);
    backlog().focus();
    fireEvent.keyDown(backlog(), { key: 'End' });
    backlog().blur();

    scrollSheet(sheetOf(), LINES * ROW_ESTIMATE);
    expect(screen.getByRole('button', { name: `Row ${ROWS - 1}` })).toBeDefined();
    expect(document.activeElement).toBe(document.body);
  });

  it('a move left waiting never takes the focus from a cell being edited', () => {
    render(<LongGrouped />);
    const edge = lastDrawn();
    // The last line drawn is a Backlog row: line n is Row n-1.
    const last = name(`Row ${edge - 1}`);
    last.focus();
    fireEvent.keyDown(last, { key: 'ArrowDown' });
    fireEvent.click(screen.getAllByRole('button', { name: '2026-03-01' })[0] as HTMLElement);
    const input = document.querySelector('.table__input') as HTMLInputElement;
    expect(document.activeElement).toBe(input);

    // A few rows: enough to draw the next line, not so far that the edited row leaves the page.
    scrollSheet(sheetOf(), 4 * ROW_ESTIMATE);
    expect(document.querySelector(`tr[data-index="${edge + 1}"]`)).not.toBeNull();
    expect(document.activeElement).toBe(input);
  });

  it('nor from a cell opened after the name it was asked from was scrolled away, with no press or blur', () => {
    render(<LongGrouped />);
    const sheet = sheetOf();
    scrollSheet(sheet, 40 * ROW_ESTIMATE);
    const edge = lastDrawn();
    name(`Row ${edge - 1}`).focus();
    fireEvent.keyDown(name(`Row ${edge - 1}`), { key: 'ArrowDown' });

    // Scrolled back up, the name leaves the page and its focus drops to the body.
    scrollSheet(sheet, 25 * ROW_ESTIMATE);
    expect(document.querySelector(`tr[data-index="${edge}"]`)).toBeNull();
    expect(document.activeElement).toBe(document.body);
    // A cell opened from the keyboard: no press, and nothing left to blur.
    const line = document.querySelector(`tr[data-index="${edge - 25}"]`) as HTMLElement;
    fireEvent.click(within(line).getByRole('button', { name: '2026-03-01' }));
    const input = document.querySelector('.table__input') as HTMLInputElement;
    expect(document.activeElement).toBe(input);

    scrollSheet(sheet, 41 * ROW_ESTIMATE);
    expect(document.querySelector(`tr[data-index="${edge + 1}"]`)).not.toBeNull();
    expect(document.activeElement).toBe(input);
  });
});
