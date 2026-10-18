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
import { tableRowsMeasured } from './testing/table-rows-measured.ts';
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
  tableRowsMeasured();

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

  it('draws no cell again for a commit that changes nothing, though the heading is drawn again', () => {
    const result = read(12);
    const view = render(<TableView {...props(result)} />);
    const drawn = rowsDrawnBy(() => view.rerender(<TableView {...props(result)} />), 'Cell');
    expect(drawn).toBe(0);
    expect(rowsDrawnBy(() => view.rerender(<TableView {...props(result)} />), 'TableHead')).toBe(1);
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

  it('calls the latest handlers, and draws no row again for new ones', async () => {
    const result = read(3);
    const isDone: DoneTicks['isDone'] = (values) => values['status'] === 'done';
    const first = { open: vi.fn(), tick: vi.fn() };
    const latest = { open: vi.fn(), tick: vi.fn() };
    const view = render(
      <TableView
        {...props(result, { onOpenNote: first.open, ticks: { isDone, onToggle: first.tick } })}
      />,
    );
    const drawn = rowsDrawnBy(() =>
      view.rerender(
        <TableView
          {...props(result, { onOpenNote: latest.open, ticks: { isDone, onToggle: latest.tick } })}
        />,
      ),
    );
    expect(drawn).toBe(0);
    await userEvent.click(screen.getByRole('button', { name: 'Task 1' }));
    await userEvent.click(screen.getByRole('checkbox', { name: 'Mark Task 2 done' }));

    expect(first.open).not.toHaveBeenCalled();
    expect(first.tick).not.toHaveBeenCalled();
    expect(latest.open).toHaveBeenCalledWith('t1.md', 'here');
    expect(latest.tick).toHaveBeenCalledWith({ path: 't2.md', done: true });
  });
});

describe('TableView — what a change of its own draws', () => {
  tableRowsMeasured();
  const cellsOf = (title: string) =>
    [...(screen.getByRole('button', { name: title }).closest('tr')?.querySelectorAll('td') ?? [])]
      .map((cell) => cell.textContent)
      .join('|');

  it('draws every row again when a column is hidden, and the column is gone from each', () => {
    const result = read(12);
    const view = render(<TableView {...props(result)} />);
    expect(cellsOf('Task 3')).toContain('Doing');
    const drawn = rowsDrawnBy(() =>
      view.rerender(<TableView {...props(result, { hiddenColumns: ['status'] })} />),
    );
    expect(drawn).toBe(12);
    expect(screen.queryByText('Doing')).toBeNull();
    expect(cellsOf('Task 3')).toBe('Task 3|home,work');
    expect(screen.queryByRole('button', { name: 'Sort by Status' })).toBeNull();
  });

  it('draws every row again when the columns are reordered, each in the new order', () => {
    const view = render(<TableView {...props(read(12))} />);
    const swapped: TableResult = {
      ...read(12),
      columns: ['path', 'title', 'tags', 'status'],
      rows: read(12).rows.map(([path, title, status, tags]) => [path, title, tags, status]),
    };
    const drawn = rowsDrawnBy(() => view.rerender(<TableView {...props(swapped)} />));
    expect(drawn).toBe(12);
    expect(cellsOf('Task 3').indexOf('home')).toBeLessThan(cellsOf('Task 3').indexOf('Doing'));
  });

  it('draws the one row whose tag changed inside its list, with the new tag', () => {
    const view = render(<TableView {...props(read(12))} />);
    const retagged = read(12);
    const rows = retagged.rows.map((row, at) =>
      at === 5 ? [...row.slice(0, 3), ['home', 'play']] : row,
    );
    const drawn = rowsDrawnBy(() => view.rerender(<TableView {...props({ ...retagged, rows })} />));
    expect(drawn).toBe(1);
    expect(cellsOf('Task 5')).toContain('play');
    expect(cellsOf('Task 4')).not.toContain('play');
  });

  it('ticks a row whose done-ness changed though its values did not', () => {
    const result = read(12);
    const doneOnly = (title: string): DoneTicks => ({
      isDone: (values) => values['title'] === title,
      onToggle: () => {},
    });
    const box = (title: string) =>
      screen.getByRole('checkbox', { name: `Mark ${title} done` }) as HTMLInputElement;
    const view = render(<TableView {...props(result, { ticks: doneOnly('Task 3') })} />);
    expect(box('Task 3').checked).toBe(true);
    const drawn = rowsDrawnBy(() =>
      view.rerender(<TableView {...props(result, { ticks: doneOnly('Task 4') })} />),
    );
    expect(drawn).toBe(2);
    expect(box('Task 3').checked).toBe(false);
    expect(box('Task 4').checked).toBe(true);
    expect(box('Task 4').closest('tr')?.className).toContain('table__row--done');
  });
});

describe('TableView — what assistive technology is told of a virtualised table', () => {
  tableRowsMeasured();
  it('says how many rows the table has, and where each drawn row sits', () => {
    render(<TableView {...props(read(420))} />);
    expect(screen.getByRole('table').getAttribute('aria-rowcount')).toBe('421');
    const drawn = [...document.querySelectorAll('tr.table__row')];
    expect(drawn.length).toBeLessThan(60);
    for (const row of drawn) {
      expect(row.getAttribute('aria-rowindex')).toBe(
        String(Number(row.getAttribute('data-index')) + 2),
      );
    }
    expect(drawn[0]?.getAttribute('aria-rowindex')).toBe('2');
  });
});

describe('TableView — a long table', () => {
  tableRowsMeasured();
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

  it('moves a window of rows with Page Down and Page Up, stopping at the ends', async () => {
    // jsdom's scroller measures no height, so a window is the estimate's: 880 / 34 rows, less one.
    const page = Math.floor(880 / 34) - 1;
    const name = (title: string) => screen.getByRole('button', { name: title });
    const long = render(<TableView {...props(read(page + 6))} />);
    name('Task 0').focus();
    await userEvent.keyboard('{PageDown}');
    expect(document.activeElement).toBe(name(`Task ${page}`));
    await userEvent.keyboard('{PageUp}');
    expect(document.activeElement).toBe(name('Task 0'));
    await userEvent.keyboard('{PageUp}');
    expect(document.activeElement).toBe(name('Task 0'));
    long.unmount();

    // Fewer rows than a window: Page Down lands on the last, and stays there.
    render(<TableView {...props(read(10))} />);
    name('Task 3').focus();
    await userEvent.keyboard('{PageDown}');
    expect(document.activeElement).toBe(name('Task 9'));
    await userEvent.keyboard('{PageDown}');
    expect(document.activeElement).toBe(name('Task 9'));
  });

  it('leaves a chord to the app: Shift, Alt, Ctrl or Cmd with an arrow does not move between rows', async () => {
    render(<TableView {...props(read(3))} />);
    const first = screen.getByRole('button', { name: 'Task 0' });
    first.focus();
    for (const chord of [
      '{Shift>}{ArrowDown}{/Shift}',
      '{Alt>}{ArrowDown}{/Alt}',
      '{Control>}{End}{/Control}',
      '{Meta>}{ArrowDown}{/Meta}',
    ]) {
      await userEvent.keyboard(chord);
      expect(document.activeElement).toBe(first);
    }
  });
});
