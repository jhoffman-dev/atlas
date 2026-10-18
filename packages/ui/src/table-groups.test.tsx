// @vitest-environment jsdom
/**
 * A table drawn in groups and sub-groups, as Coda draws them (issue #6): the
 * header rows, their counts and column summaries, folding, the keyboard, and
 * "+ New" at each innermost group's foot.
 */
import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import {
  groupResultRows,
  parseObjectType,
  toBoardRows,
  viewGroupLevels,
  type RowGroup,
} from '@atlas/domain';
import { TableView, type TableResult } from './table-view.tsx';
import { tableRowsMeasured } from './testing/table-rows-measured.ts';

const TASK = parseObjectType({
  name: 'task',
  properties: {
    status: { kind: 'select', options: ['backlog', 'doing', 'done'] },
    phase: 'number',
    flagged: 'checkbox',
  },
});

const result: TableResult = {
  columns: ['path', 'title', 'status', 'phase', 'flagged'],
  rows: [
    ['a.md', 'Alpha', 'doing', 2, 'true'],
    ['b.md', 'Beta', 'doing', 3, 'false'],
    ['c.md', 'Gamma', 'backlog', 5, 'true'],
    ['d.md', 'Delta', null, null, null],
  ],
  truncated: false,
  sql: '',
};

const schema = {
  kinds: { status: 'select', phase: 'number', flagged: 'checkbox' } as const,
  labels: {},
  noun: 'task',
};

function groupsBy(subGroupBy: string | null): RowGroup[] {
  return groupResultRows({
    rows: toBoardRows(result),
    groups: viewGroupLevels({ type: TASK, groupBy: 'status', subGroupBy, sorts: [] }),
  });
}

function Grouped({
  subGroupBy = null,
  onNew = () => {},
  rows = result,
}: {
  subGroupBy?: string | null;
  onNew?: (chain: readonly RowGroup[]) => void;
  rows?: TableResult;
}) {
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const groups =
    rows === result
      ? groupsBy(subGroupBy)
      : groupResultRows({
          rows: toBoardRows(rows),
          groups: viewGroupLevels({ type: TASK, groupBy: 'status', subGroupBy, sorts: [] }),
        });
  return (
    <TableView
      result={rows}
      sorts={[]}
      error={null}
      schema={schema}
      onOpenNote={() => {}}
      onToggleSort={() => {}}
      grouping={{
        groups,
        collapsed,
        onToggle: (id) =>
          setCollapsed((was) => {
            const next = new Set(was);
            if (!next.delete(id)) next.add(id);
            return next;
          }),
        onNew,
      }}
    />
  );
}

const header = (name: RegExp) => screen.getByRole('button', { name });
const rowOf = (element: HTMLElement) => element.closest('tr') as HTMLTableRowElement;
const titles = () =>
  [...document.querySelectorAll('.table__title')].map((node) => node.textContent);

describe('a grouped table', () => {
  tableRowsMeasured();

  it('marks the grid as grouped, with the name column’s heading, so the names indent under the headers', () => {
    render(<Grouped />);
    const grid = screen.getByRole('table');
    expect(grid.classList.contains('table__grid--grouped')).toBe(true);
    expect(
      screen.getByRole('columnheader', { name: 'Name' }).classList.contains('table__name-head'),
    ).toBe(true);
    // The name cell, not the first cell, is what the indent lands on.
    expect(screen.getByText('Alpha').closest('td')?.classList.contains('table__name')).toBe(true);
  });

  it('does not mark a flat table as grouped', () => {
    render(
      <TableView
        result={result}
        sorts={[]}
        error={null}
        schema={schema}
        onOpenNote={() => {}}
        onToggleSort={() => {}}
      />,
    );
    expect(screen.getByRole('table').classList.contains('table__grid--grouped')).toBe(false);
  });

  it('reads a status group’s name once: the dot is decoration beside the label', () => {
    render(<Grouped />);
    const header = screen.getByRole('button', { name: /^Doing/ });
    expect(header.querySelector('[aria-hidden="true"] .status-pill--dot')).not.toBeNull();
    expect(header.textContent).toBe('Doing2');
  });

  it('moves a window of lines with Page Down and Page Up, landing on a stop', async () => {
    const many: TableResult = {
      ...result,
      rows: Array.from({ length: 120 }, (_, at) => [
        `n${at}.md`,
        `Note ${at}`,
        at < 60 ? 'backlog' : 'doing',
        1,
        'true',
      ]),
    };
    render(<Grouped rows={many} />);
    const page = Math.floor(880 / 34) - 1;
    screen.getByRole('button', { name: /^Backlog/ }).focus();
    await userEvent.keyboard('{PageDown}');
    // Line 0 is Backlog's header; line n is Note n-1.
    expect(document.activeElement).toBe(screen.getByRole('button', { name: `Note ${page - 1}` }));
    await userEvent.keyboard('{PageUp}');
    expect(document.activeElement).toBe(screen.getByRole('button', { name: /^Backlog/ }));
  });

  it('totals each group in the footer, and says what it is grouped by', () => {
    render(<Grouped />);
    const footer = screen.getByText('4 tasks').parentElement as HTMLElement;
    expect([...footer.querySelectorAll('.table__total')].map((node) => node.textContent)).toEqual([
      '1 backlog',
      '2 doing',
      '1 no value',
    ]);
    expect(within(footer).getByText('Grouped by status')).toBeDefined();
  });

  it('draws a header row per group, in option order, with no value last', () => {
    render(<Grouped />);
    const headers = [...document.querySelectorAll('.table__group-toggle')].map(
      (node) => node.textContent,
    );
    expect(headers).toEqual(['Backlog1', 'Doing2', 'No value1']);
    expect(titles()).toEqual(['Gamma', 'Alpha', 'Beta', 'Delta']);
  });

  it('spans the header across the name, and draws a select’s value as its pill', () => {
    render(<Grouped />);
    const doing = header(/^doing/i);
    expect(doing.querySelector('.status-pill')).not.toBeNull();
    expect(header(/^No value/).querySelector('.status-pill')).toBeNull();
    // One cell for the name, then one per remaining column: the row is full width.
    expect(rowOf(doing).cells).toHaveLength(4);
    expect(rowOf(screen.getByText('Alpha')).cells).toHaveLength(4);
  });

  it('counts each group’s rows', () => {
    render(<Grouped />);
    expect(within(header(/^doing/i)).getByLabelText('2 tasks')).toBeDefined();
    expect(within(header(/^backlog/i)).getByLabelText('1 task')).toBeDefined();
  });

  it('sums a number column and counts a checkbox’s ticks under the header', () => {
    render(<Grouped />);
    const summaries = [...rowOf(header(/^doing/i)).querySelectorAll('.table__summary')].map(
      (cell) => cell.textContent,
    );
    // status, phase, flagged: nothing to add up for a select.
    expect(summaries).toEqual(['', 'Sum 5', '1 checked']);
  });

  it('folds a group shut, drawing nothing of its rows, and opens it again', async () => {
    render(<Grouped />);
    const doing = header(/^doing/i);
    expect(doing.getAttribute('aria-expanded')).toBe('true');
    await userEvent.click(doing);
    expect(header(/^doing/i).getAttribute('aria-expanded')).toBe('false');
    expect(titles()).toEqual(['Gamma', 'Delta']);
    expect(screen.queryByRole('button', { name: 'New task in doing' })).toBeNull();
    await userEvent.click(header(/^doing/i));
    expect(titles()).toEqual(['Gamma', 'Alpha', 'Beta', 'Delta']);
  });

  it('nests sub-groups one step in, each with its own arrow and count', async () => {
    render(<Grouped subGroupBy="flagged" />);
    const depths = [...document.querySelectorAll('.table__group-toggle')].map((node) => [
      node.textContent,
      node.getAttribute('data-depth'),
    ]);
    expect(depths).toEqual([
      ['Backlog1', '0'],
      ['true1', '1'],
      ['Doing2', '0'],
      ['true1', '1'],
      ['false1', '1'],
      ['No value1', '0'],
      ['false1', '1'],
    ]);
    // Folding a sub-group leaves its siblings drawn.
    const doingTrue = document.querySelectorAll<HTMLButtonElement>('.table__group-toggle')[3];
    await userEvent.click(doingTrue as HTMLButtonElement);
    expect(titles()).toEqual(['Gamma', 'Beta', 'Delta']);
  });

  it('adds a note at the foot of a group, handing over it and the groups it is in', async () => {
    const onNew = vi.fn();
    render(<Grouped subGroupBy="flagged" onNew={onNew} />);
    await userEvent.click(screen.getByRole('button', { name: 'New task in doing · false' }));
    const chain = onNew.mock.calls[0]?.[0] as RowGroup[];
    expect(chain.map((group) => [group.field, group.value])).toEqual([
      ['status', 'doing'],
      ['flagged', 'false'],
    ]);
  });

  // The long, virtualised case — a move to a line not drawn yet, and what
  // cancels one — is in table-groups.keyboard.test.tsx.
  it('moves row to row and header to header with Up and Down, across groups, skipping "+ New" (#248)', async () => {
    render(<Grouped />);
    const name = (title: string) => screen.getByRole('button', { name: title });
    header(/^backlog/i).focus();
    const order = [
      name('Gamma'),
      header(/^doing/i),
      name('Alpha'),
      name('Beta'),
      header(/^No value/),
      name('Delta'),
    ];
    for (const next of order) {
      await userEvent.keyboard('{ArrowDown}');
      expect(document.activeElement).toBe(next);
    }
    // The last row stays put, rather than going on to its "+ New".
    await userEvent.keyboard('{ArrowDown}');
    expect(document.activeElement).toBe(name('Delta'));
    for (const next of [...order.slice(0, -1)].reverse()) {
      await userEvent.keyboard('{ArrowUp}');
      expect(document.activeElement).toBe(next);
    }
    await userEvent.keyboard('{ArrowUp}{ArrowUp}');
    expect(document.activeElement).toBe(header(/^backlog/i));
  });

  it('goes to the first header with Home and the last row with End (#248)', async () => {
    render(<Grouped />);
    screen.getByRole('button', { name: 'Alpha' }).focus();
    await userEvent.keyboard('{End}');
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Delta' }));
    await userEvent.keyboard('{Home}');
    expect(document.activeElement).toBe(header(/^backlog/i));
  });

  it('steps over a folded group to the header after it, and through sub-group headers (#248)', async () => {
    render(<Grouped subGroupBy="flagged" />);
    await userEvent.click(header(/^doing/i));
    screen.getByRole('button', { name: 'Gamma' }).focus();
    await userEvent.keyboard('{ArrowDown}');
    expect(document.activeElement).toBe(header(/^doing/i));
    await userEvent.keyboard('{ArrowDown}');
    expect(document.activeElement).toBe(header(/^No value/));
    // Into the "No value" group: its sub-group's header comes before its row.
    await userEvent.keyboard('{ArrowDown}');
    expect((document.activeElement as HTMLElement).classList).toContain('table__group-toggle');
    expect(document.activeElement?.getAttribute('data-depth')).toBe('1');
    await userEvent.keyboard('{ArrowDown}');
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Delta' }));
  });

  it('leaves a chord to the app, and folds a header with Enter or Space', async () => {
    render(<Grouped />);
    header(/^doing/i).focus();
    for (const chord of ['{Shift>}{ArrowDown}{/Shift}', '{Meta>}{End}{/Meta}']) {
      await userEvent.keyboard(chord);
      expect(document.activeElement).toBe(header(/^doing/i));
    }
    await userEvent.keyboard('{Enter}');
    expect(header(/^doing/i).getAttribute('aria-expanded')).toBe('false');
    await userEvent.keyboard(' ');
    expect(header(/^doing/i).getAttribute('aria-expanded')).toBe('true');
  });

  it('counts its header rows and "+ New" lines among its rows, for assistive technology (#244)', async () => {
    render(<Grouped />);
    // Three groups, four notes, and a "+ New" at the foot of each group: ten lines and the heading.
    const lines = [...document.querySelectorAll('tbody tr:not(.table__spacer)')];
    expect(lines).toHaveLength(10);
    expect(screen.getByRole('table').getAttribute('aria-rowcount')).toBe('11');
    expect(lines.map((line) => line.getAttribute('aria-rowindex'))).toEqual(
      lines.map((_, at) => String(at + 2)),
    );

    await userEvent.click(header(/^doing/i));
    expect(screen.getByRole('table').getAttribute('aria-rowcount')).toBe('8');
  });

  it('virtualises: a group of 3000 rows puts only a screenful in the page', () => {
    const many: TableResult = {
      ...result,
      rows: Array.from({ length: 3000 }, (_, at) => [
        `n${at}.md`,
        `Note ${at}`,
        'doing',
        1,
        'true',
      ]),
    };
    render(<Grouped rows={many} />);
    const drawn = document.querySelectorAll('.table__row').length;
    expect(drawn).toBeGreaterThan(0);
    expect(drawn).toBeLessThan(60);
  });

  it('measures each line, so a row taller than the estimate — a wrapped cell — is placed by its own height', () => {
    const many: TableResult = {
      ...result,
      rows: Array.from({ length: 3000 }, (_, at) => [
        `n${at}.md`,
        `Note ${at}`,
        'doing',
        1,
        'true',
      ]),
    };
    render(<Grouped rows={many} />);
    const drawn = [...document.querySelectorAll('.table__row')];
    expect(drawn.length).toBeGreaterThan(0);
    // A screenful at 34px a row is some 24 rows plus the overscan.
    expect(drawn.length).toBeLessThan(60);
    expect(drawn.every((line) => line.getAttribute('data-index') !== null)).toBe(true);
  });

  it('is a plain table when nothing groups it', () => {
    render(
      <TableView
        result={result}
        sorts={[]}
        error={null}
        schema={schema}
        onOpenNote={() => {}}
        onToggleSort={() => {}}
        grouping={{ groups: [], collapsed: new Set(), onToggle: () => {} }}
      />,
    );
    expect(document.querySelector('.table__group')).toBeNull();
    expect(titles()).toEqual(['Alpha', 'Beta', 'Gamma', 'Delta']);
  });
});
