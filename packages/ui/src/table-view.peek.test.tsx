// @vitest-environment jsdom
/**
 * A row's name clicked peeks its note (slice 6b): the table hands over the
 * row and every row's path in the order it shows them — from its data, the
 * rows the virtualiser has not drawn among them — so the peek can step to
 * a row that is not on screen. A click that asks for a tab or a split, or a
 * table given no peek, still opens the note. Peeking draws no row again.
 */
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { groupResultRows, parseObjectType, toBoardRows, viewGroupLevels } from '@dfai/domain';
import { TableView, type TableResult, type TableViewProps } from './table-view.tsx';
import { tableRowsMeasured } from './testing/table-rows-measured.ts';
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

const name = (title: string) => screen.getByRole('button', { name: title });

describe('TableView — a row peeked', () => {
  tableRowsMeasured();

  it('peeks the row with every row of a 420-row table in order, the undrawn ones too', async () => {
    const onPeek = vi.fn();
    const onOpenNote = vi.fn();
    render(<TableView {...props(read(420), { onPeek, onOpenNote })} />);
    expect(screen.queryByText('Task 419')).toBeNull();
    await userEvent.click(name('Task 5'));
    const order = Array.from({ length: 420 }, (_, at) => `t${at}.md`);
    expect(onPeek).toHaveBeenCalledWith({ path: 't5.md', order });
    expect(onOpenNote).not.toHaveBeenCalled();
  });

  it('hands over a grouped table’s rows group by group, as they are drawn', async () => {
    const result = read(6);
    const groups = groupResultRows({
      rows: toBoardRows(result),
      groups: viewGroupLevels({ type: TASK, groupBy: 'status', subGroupBy: null, sorts: [] }),
    });
    const onPeek = vi.fn();
    render(
      <TableView
        {...props(result, {
          onPeek,
          grouping: { groups, collapsed: new Set(), onToggle: () => {} },
        })}
      />,
    );
    await userEvent.click(name('Task 4'));
    expect(onPeek).toHaveBeenCalledWith({
      path: 't4.md',
      order: ['t0.md', 't3.md', 't1.md', 't2.md', 't4.md', 't5.md'],
    });
  });

  it('opens the note where a ⌘-click or ⌘⇧-click asks, without peeking', async () => {
    const onPeek = vi.fn();
    const onOpenNote = vi.fn();
    render(<TableView {...props(read(3), { onPeek, onOpenNote })} />);
    const user = userEvent.setup();
    await user.keyboard('{Meta>}');
    await user.click(name('Task 1'));
    await user.keyboard('{Shift>}');
    await user.click(name('Task 2'));
    await user.keyboard('{/Shift}{/Meta}');
    expect(onOpenNote).toHaveBeenNthCalledWith(1, 't1.md', 'new-tab');
    expect(onOpenNote).toHaveBeenNthCalledWith(2, 't2.md', 'split');
    expect(onPeek).not.toHaveBeenCalled();
  });

  it('opens the note in place when the table is given no peek (control)', async () => {
    const onOpenNote = vi.fn();
    render(<TableView {...props(read(3), { onOpenNote })} />);
    await userEvent.click(name('Task 1'));
    expect(onOpenNote).toHaveBeenCalledWith('t1.md', 'here');
  });

  it('focuses the name as it is clicked, as WebKit does not, for the peek to hand it back', () => {
    render(<TableView {...props(read(3), { onPeek: vi.fn() })} />);
    // fireEvent moves no focus, as a click in WebKit does not.
    fireEvent.click(name('Task 1'));
    expect(document.activeElement).toBe(name('Task 1'));
  });

  it('draws no row again as a row is peeked', async () => {
    const onPeek = vi.fn();
    render(<TableView {...props(read(420), { onPeek })} />);
    startCountingRenders();
    await userEvent.click(name('Task 5'));
    const drawn = stopCountingRenders().renders['TableRow'] ?? 0;
    expect(onPeek).toHaveBeenCalledTimes(1);
    expect(drawn).toBe(0);
  });
});
