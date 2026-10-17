// @vitest-environment jsdom
/**
 * How much a table draws again (#238): the window draws the open table again
 * for everything else that happens in it — every key typed in ⌘K — with its
 * handlers and schema made anew each time. A row draws again only for a
 * change of its own; and the rows are virtualised, so a long table puts a
 * screenful in the page and the keyboard still reaches its last row.
 */
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { DoneTicks } from './done-checkbox.tsx';
import type { RowSelection } from './row-selection.tsx';
import { TableView, type TableResult, type TableViewProps } from './table-view.tsx';
import { startCountingRenders, stopCountingRenders } from './testing/render-counter.ts';

// Before React loads, so every commit is handed to the counter.
await vi.hoisted(async () => {
  const { installRenderCounter } = await import('./testing/render-counter.ts');
  installRenderCounter();
});

const COLUMNS = ['path', 'title', 'status', 'tags'];

/** A result as the index hands one back: every row a new array, each time it is read. */
function read(count: number, change: (at: number) => string = () => 'doing'): TableResult {
  return {
    columns: COLUMNS,
    rows: Array.from({ length: count }, (_, at) => [
      `t${at}.md`,
      `Task ${at}`,
      change(at),
      ['home', 'work'],
    ]),
    truncated: false,
    sql: '',
  };
}

/** The table as the app hands it over: every handler, and the schema, made again on each render. */
function props(result: TableResult, overrides: Partial<TableViewProps> = {}): TableViewProps {
  return {
    result,
    sorts: [],
    error: null,
    schema: { kinds: { status: 'select' }, labels: {}, noun: 'Task' },
    onOpenNote: () => {},
    onEditCell: () => {},
    onToggleSort: () => {},
    hiddenColumns: [],
    ...overrides,
  };
}

const ticksFor = (onToggle: DoneTicks['onToggle'] = () => {}): DoneTicks => ({
  isDone: (values) => values['status'] === 'done',
  onToggle,
});

const selectionOf = (selected: readonly string[]): RowSelection => ({
  selected: new Set(selected),
  onToggle: () => {},
  onToggleAll: () => {},
});

/** How many of `component` `act` drew: rows, unless another is named. */
function rowsDrawnBy(act: () => void, component = 'TableRow'): number {
  startCountingRenders();
  act();
  return stopCountingRenders().renders[component] ?? 0;
}

describe('TableView — what one commit draws', () => {
  it('draws no row again for a commit that changes nothing in the table', () => {
    const result = read(12);
    const view = render(<TableView {...props(result, { ticks: ticksFor() })} />);
    expect(screen.getByText('Task 11')).toBeDefined();

    const drawn = rowsDrawnBy(() => {
      view.rerender(<TableView {...props(result, { ticks: ticksFor() })} />);
      view.rerender(<TableView {...props(result, { ticks: ticksFor() })} />);
    });
    expect(drawn).toBe(0);
  });

  it('draws no icon again for a commit that changes nothing, though the heading is drawn again', () => {
    const result = read(12);
    const view = render(<TableView {...props(result)} />);
    const drawn = rowsDrawnBy(() => view.rerender(<TableView {...props(result)} />), 'Icon');
    expect(drawn).toBe(0);
    expect(document.querySelectorAll('thead .icon').length).toBeGreaterThan(0);
  });

  it('draws the one row whose values changed when the query is read again', () => {
    const view = render(<TableView {...props(read(12))} />);
    const drawn = rowsDrawnBy(() => {
      view.rerender(<TableView {...props(read(12, (at) => (at === 4 ? 'done' : 'doing')))} />);
    });
    expect(drawn).toBe(1);
  });

  it('draws the one row a tick changed', () => {
    const view = render(<TableView {...props(read(12), { ticks: ticksFor() })} />);
    const ticked = read(12, (at) => (at === 7 ? 'done' : 'doing'));
    const drawn = rowsDrawnBy(() => {
      view.rerender(<TableView {...props(ticked, { ticks: ticksFor() })} />);
    });
    expect(drawn).toBe(1);
    expect(screen.getByRole('checkbox', { name: 'Mark Task 7 done' })).toHaveProperty(
      'checked',
      true,
    );
  });

  it('draws the one row that was chosen', () => {
    const result = read(12);
    const view = render(<TableView {...props(result, { selection: selectionOf(['t1.md']) })} />);
    const drawn = rowsDrawnBy(() => {
      view.rerender(
        <TableView {...props(result, { selection: selectionOf(['t1.md', 't3.md']) })} />,
      );
    });
    expect(drawn).toBe(1);
    expect(screen.getByRole('checkbox', { name: 'Select Task 3' })).toHaveProperty('checked', true);
  });

  it('calls the latest handlers, though the rows were not drawn again for them', async () => {
    const result = read(3);
    const first = vi.fn();
    const latest = vi.fn();
    const onTick = vi.fn();
    const view = render(<TableView {...props(result, { onOpenNote: first })} />);
    view.rerender(
      <TableView {...props(result, { onOpenNote: latest, ticks: ticksFor(onTick) })} />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Task 1' }));
    await userEvent.click(screen.getByRole('checkbox', { name: 'Mark Task 2 done' }));

    expect(first).not.toHaveBeenCalled();
    expect(latest).toHaveBeenCalledWith('t1.md');
    expect(onTick).toHaveBeenCalledWith({ path: 't2.md', done: true });
  });
});

describe('TableView — a long table', () => {
  it('puts only a screenful of its 420 rows in the page', () => {
    render(<TableView {...props(read(420))} />);
    const drawn = document.querySelectorAll('.table__row').length;
    expect(drawn).toBeGreaterThan(0);
    expect(drawn).toBeLessThan(60);
    expect(screen.queryByText('Task 419')).toBeNull();
    expect(screen.getByText('420 tasks')).toBeDefined();
  });

  // Reaching a row the virtualiser has not drawn needs a scroller with a real
  // height, which jsdom has not: e2e/table-keyboard.spec.ts covers it.
  it('moves between rows with Up, Down, Home and End, and stops at the ends', async () => {
    render(<TableView {...props(read(3))} />);
    const name = (title: string) => screen.getByRole('button', { name: title });
    name('Task 0').focus();
    await userEvent.keyboard('{ArrowDown}');
    expect(document.activeElement).toBe(name('Task 1'));
    await userEvent.keyboard('{ArrowDown}{ArrowDown}');
    expect(document.activeElement).toBe(name('Task 2'));
    await userEvent.keyboard('{Home}');
    expect(document.activeElement).toBe(name('Task 0'));
    await userEvent.keyboard('{End}');
    expect(document.activeElement).toBe(name('Task 2'));
    await userEvent.keyboard('{Home}');
    expect(document.activeElement).toBe(name('Task 0'));
    await userEvent.keyboard('{ArrowUp}');
    expect(document.activeElement).toBe(name('Task 0'));
  });
});
