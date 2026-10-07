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

  it('moves between headers with Up and Down, and folds one with Enter or Space', async () => {
    render(<Grouped />);
    header(/^backlog/i).focus();
    await userEvent.keyboard('{ArrowDown}');
    expect(document.activeElement).toBe(header(/^doing/i));
    await userEvent.keyboard('{ArrowDown}');
    expect(document.activeElement).toBe(header(/^No value/));
    await userEvent.keyboard('{ArrowDown}');
    expect(document.activeElement).toBe(header(/^No value/));
    await userEvent.keyboard('{ArrowUp}');
    expect(document.activeElement).toBe(header(/^doing/i));
    await userEvent.keyboard('{Enter}');
    expect(header(/^doing/i).getAttribute('aria-expanded')).toBe('false');
    await userEvent.keyboard(' ');
    expect(header(/^doing/i).getAttribute('aria-expanded')).toBe('true');
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
    // jsdom's shim measures every element 800px tall: one row fills the 800px window.
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
    // A screenful at 44px a row would be some 18 rows plus the overscan.
    expect(drawn.length).toBeLessThan(18);
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
