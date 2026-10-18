// @vitest-environment jsdom
/**
 * Shift-click on a table row's box extends the choice to it (#249): the box
 * hands the selection every row's path in the order the table shows them —
 * flat, or group by group — the rows the virtualiser has not drawn among
 * them, and only the rows whose choice changed are drawn again.
 */
import { describe, expect, it, vi, type Mock } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import {
  groupResultRows,
  parseObjectType,
  toBoardRows,
  viewGroupLevels,
  type RowGroup,
} from '@atlas/domain';
import type { RowSelection } from './row-selection.tsx';
import { TableView, type TableResult, type TableViewProps } from './table-view.tsx';
import { startCountingRenders, stopCountingRenders } from './testing/render-counter.ts';

// Before React loads, so every commit is handed to the counter.
await vi.hoisted(async () => {
  const { installRenderCounter } = await import('./testing/render-counter.ts');
  installRenderCounter();
});

const TASK = parseObjectType({
  name: 'task',
  properties: { status: { kind: 'select', options: ['backlog', 'doing'] } },
});

/** `count` tasks, every third in Backlog and the rest Doing, so the groups interleave the result. */
function read(count: number): TableResult {
  return {
    columns: ['path', 'title', 'status'],
    rows: Array.from({ length: count }, (_, at) => [
      `t${at}.md`,
      `Task ${at}`,
      at % 3 === 0 ? 'backlog' : 'doing',
    ]),
    truncated: false,
    sql: '',
  };
}

const groupsOf = (result: TableResult): RowGroup[] =>
  groupResultRows({
    rows: toBoardRows(result),
    groups: viewGroupLevels({ type: TASK, groupBy: 'status', subGroupBy: null, sorts: [] }),
  });

function props(result: TableResult, overrides: Partial<TableViewProps> = {}): TableViewProps {
  return {
    result,
    sorts: [],
    error: null,
    schema: { kinds: { status: 'select' }, labels: {}, noun: 'Task' },
    onOpenNote: () => {},
    onToggleSort: () => {},
    ...overrides,
  };
}

/** A selection that only records what it was asked to do. */
function recording(): RowSelection & { onToggle: Mock<RowSelection['onToggle']> } {
  return {
    selected: new Set(),
    onToggle: vi.fn<RowSelection['onToggle']>(),
    onToggleAll: () => {},
  };
}

const box = (title: string) => screen.getByRole('checkbox', { name: `Select ${title}` });

async function shiftClick(element: HTMLElement): Promise<void> {
  const user = userEvent.setup();
  await user.keyboard('{Shift>}');
  await user.click(element);
  await user.keyboard('{/Shift}');
}

describe('TableView — Shift-click on a row’s box', () => {
  it('toggles the one row on a plain click, with no range', async () => {
    const selection = recording();
    render(<TableView {...props(read(420), { selection })} />);
    await userEvent.click(box('Task 2'));
    expect(selection.onToggle).toHaveBeenCalledTimes(1);
    expect(selection.onToggle).toHaveBeenCalledWith('t2.md');
  });

  it('hands over every row of a 420-row table in order, the undrawn ones too', async () => {
    const selection = recording();
    render(<TableView {...props(read(420), { selection })} />);
    expect(screen.queryByText('Task 419')).toBeNull();
    await shiftClick(box('Task 5'));
    const order = Array.from({ length: 420 }, (_, at) => `t${at}.md`);
    expect(selection.onToggle).toHaveBeenCalledWith('t5.md', { order });
  });

  it('hands over a grouped table’s rows group by group, leaving out a folded group’s', async () => {
    const result = read(9);
    const selection = recording();
    const groups = groupsOf(result);
    const view = render(
      <TableView
        {...props(result, {
          selection,
          grouping: { groups, collapsed: new Set(), onToggle: () => {} },
        })}
      />,
    );
    await shiftClick(box('Task 4'));
    const backlog = ['t0.md', 't3.md', 't6.md'];
    const doing = ['t1.md', 't2.md', 't4.md', 't5.md', 't7.md', 't8.md'];
    expect(selection.onToggle).toHaveBeenLastCalledWith('t4.md', {
      order: [...backlog, ...doing],
    });

    const folded = new Set([groups[0]?.id ?? '']);
    view.rerender(
      <TableView
        {...props(result, {
          selection,
          grouping: { groups, collapsed: folded, onToggle: () => {} },
        })}
      />,
    );
    await shiftClick(box('Task 4'));
    expect(selection.onToggle).toHaveBeenLastCalledWith('t4.md', { order: doing });
  });

  it('leaves out the rows of a folded sub-group, keeping its open sibling’s', async () => {
    const phased = parseObjectType({
      name: 'task',
      properties: {
        status: { kind: 'select', options: ['backlog', 'doing'] },
        phase: { kind: 'select', options: ['early', 'late'] },
      },
    });
    const statuses = ['backlog', 'doing', 'doing', 'backlog', 'doing', 'doing'];
    const phases = ['early', 'early', 'late', 'late', 'early', 'late'];
    const result: TableResult = {
      columns: ['path', 'title', 'status', 'phase'],
      rows: statuses.map((status, at) => [`t${at}.md`, `Task ${at}`, status, phases[at]]),
      truncated: false,
      sql: '',
    };
    const groups = groupResultRows({
      rows: toBoardRows(result),
      groups: viewGroupLevels({ type: phased, groupBy: 'status', subGroupBy: 'phase', sorts: [] }),
    });
    const early = groups.find((group) => group.value === 'doing')?.subgroups[0];
    expect(early?.value).toBe('early');
    const selection = recording();
    render(
      <TableView
        {...props(result, {
          selection,
          grouping: { groups, collapsed: new Set([early?.id ?? '']), onToggle: () => {} },
        })}
      />,
    );
    // Backlog: early t0, late t3; Doing: early t1, t4 (folded), late t2, t5.
    expect(screen.queryByRole('checkbox', { name: 'Select Task 1' })).toBeNull();
    await shiftClick(box('Task 5'));
    expect(selection.onToggle).toHaveBeenCalledWith('t5.md', {
      order: ['t0.md', 't3.md', 't2.md', 't5.md'],
    });
  });

  it('hands over the order as it is now, once the rows are sorted again', async () => {
    const result = read(4);
    const selection = recording();
    const view = render(<TableView {...props(result, { selection })} />);
    view.rerender(
      <TableView {...props({ ...result, rows: [...result.rows].reverse() }, { selection })} />,
    );
    await shiftClick(box('Task 1'));
    expect(selection.onToggle).toHaveBeenCalledWith('t1.md', {
      order: ['t3.md', 't2.md', 't1.md', 't0.md'],
    });
  });

  it('extends the choice from Shift+Space on a focused box', async () => {
    const selection = recording();
    render(<TableView {...props(read(6), { selection })} />);
    box('Task 3').focus();
    await userEvent.keyboard('{Shift>} {/Shift}');
    expect(selection.onToggle).toHaveBeenCalledWith('t3.md', {
      order: ['t0.md', 't1.md', 't2.md', 't3.md', 't4.md', 't5.md'],
    });
  });
});

/** A selection that chooses `extend.order` from its first row to the one clicked, as the app's does. */
function Choosing({ result }: { result: TableResult }) {
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set(['t2.md']));
  const selection: RowSelection = {
    selected,
    onToggle: (path, extend) => {
      const order = extend?.order ?? [];
      setSelected(new Set(order.slice(order.indexOf('t2.md'), order.indexOf(path) + 1)));
    },
    onToggleAll: () => {},
  };
  return <TableView {...props(result, { selection })} />;
}

describe('TableView — what a Shift-click draws', () => {
  it('draws again only the rows the range newly chose, not every row', async () => {
    render(<Choosing result={read(420)} />);
    startCountingRenders();
    await shiftClick(box('Task 6'));
    const drawn = stopCountingRenders().renders['TableRow'] ?? 0;
    expect(drawn).toBe(4);
    for (const at of [2, 3, 4, 5, 6]) {
      expect(box(`Task ${at}`)).toHaveProperty('checked', true);
    }
    expect(box('Task 7')).toHaveProperty('checked', false);
  });
});
