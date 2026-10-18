// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { WidgetBar, WidgetData, WidgetResult } from '@atlas/application';
import { parseDashboard, type Widget } from '@atlas/domain';
import { DashboardView } from './dashboard-view.tsx';

const widgetFor = (source: Record<string, unknown>): Widget => {
  const [widget] = parseDashboard({ atlas: 'dashboard', widgets: [source] });
  if (widget === undefined) throw new Error('the test asked for a widget that does not parse');
  return widget;
};

const result = (source: Record<string, unknown>, data: WidgetData): WidgetResult => ({
  widget: widgetFor(source),
  sql: 'SELECT 1',
  data,
});

const draw = (...results: WidgetResult[]) =>
  render(<DashboardView results={results} onOpenNote={() => {}} />);

/** Bars as the application hands them over, shares and all. */
const barsOf = (...pairs: [string, number][]): WidgetBar[] => {
  const total = pairs.reduce((sum, [, count]) => sum + count, 0);
  return pairs.map(([label, count]) => ({
    label,
    count,
    share: total === 0 ? 0 : Math.round((count / total) * 100),
  }));
};

const barData = (
  bars: WidgetBar[],
  more: { unset?: number; highlight?: string | null } = {},
): WidgetData => ({
  shape: 'bars',
  bars,
  unset: more.unset ?? 0,
  total: bars.reduce((sum, bar) => sum + bar.count, 0) + (more.unset ?? 0),
  highlight: more.highlight ?? null,
});

const styleVar = (element: Element | null | undefined, name: string): string =>
  (element as HTMLElement | null)?.style.getPropertyValue(name) ?? '';

const textsOf = (container: Element, selector: string): (string | null)[] =>
  [...container.querySelectorAll(selector)].map((element) => element.textContent);

describe('DashboardView', () => {
  it('says what to do when there are no widgets', () => {
    draw();
    expect(screen.getByText(/no widgets yet/)).toBeDefined();
  });

  it('shows a number widget on the strip: its value under its title, with a glyph', () => {
    const { container } = draw(
      result(
        { kind: 'number', type: 'task', title: 'In flight', icon: 'bolt' },
        { shape: 'number', value: '12' },
      ),
    );
    const cell = screen.getByRole('region', { name: 'In flight' });
    expect(within(cell).getByText('12').className).toBe('kpi__value');
    expect(within(cell).getByText('In flight').className).toBe('kpi__label');
    expect(container.querySelector('.kpi__icon')).not.toBeNull();
  });

  it('keeps a zero on the strip: "In flight 0" is the answer, not an empty cell', () => {
    draw(
      result({ kind: 'number', type: 'task', title: 'In flight' }, { shape: 'number', value: '0' }),
    );
    const cell = screen.getByRole('region', { name: 'In flight' });
    expect(within(cell).getByText('0').className).toBe('kpi__value');
  });

  it('puts the single figures on the strip and the charts in panels, whatever order the file lists them', () => {
    const { container } = draw(
      result({ kind: 'bar', type: 'task', groupBy: 'status', title: 'By status' }, barData([])),
      result({ kind: 'number', type: 'task', title: 'Tasks' }, { shape: 'number', value: '3' }),
    );
    const strip = container.querySelector('.dashboard__strip');
    const panels = container.querySelector('.dashboard__panels');
    expect(strip).not.toBeNull();
    expect(panels).not.toBeNull();
    expect([...(strip?.querySelectorAll('.widget') ?? [])].map((w) => w.ariaLabel)).toEqual([
      'Tasks',
    ]);
    expect([...(panels?.querySelectorAll('.widget') ?? [])].map((w) => w.ariaLabel)).toEqual([
      'By status',
    ]);
    // The strip comes first on the page.
    expect(strip?.nextElementSibling).toBe(panels);
  });

  it('titles a panel in sentence case as a heading, with no SQL tag beside it', () => {
    draw(result({ kind: 'bar', type: 'task', groupBy: 'status', title: 'By status' }, barData([])));
    expect(screen.getByRole('heading', { level: 2, name: 'By status' })).toBeDefined();
    expect(screen.queryByText('SQL')).toBeNull();
  });

  it('keeps the SQL behind the widget menu until it is asked for', async () => {
    const { container } = draw(
      result({ kind: 'number', type: 'task', title: 'Open' }, { shape: 'number', value: '1' }),
    );
    expect(container.querySelector('.widget__sql')).toBeNull();

    await userEvent.click(screen.getByRole('button', { name: 'Widget options' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Show SQL' }));
    expect(container.querySelector('.widget__sql')?.textContent).toBe('SELECT 1');

    await userEvent.click(screen.getByRole('button', { name: 'Widget options' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Hide SQL' }));
    expect(container.querySelector('.widget__sql')).toBeNull();
  });

  it('offers no menu for a widget whose query never compiled', () => {
    draw({
      ...result({ kind: 'number', type: 'task' }, { shape: 'error', message: 'bad column' }),
      sql: null,
    });
    expect(screen.queryByRole('button', { name: 'Widget options' })).toBeNull();
    expect(screen.getByText('bad column')).toBeDefined();
  });

  it('gives each widget the span it asked for on the twelve-column grid', () => {
    const { container } = draw(
      result({ kind: 'number', type: 'task', span: 3 }, { shape: 'number', value: '1' }),
      result({ kind: 'table', type: 'task', width: 2 }, { shape: 'rows', columns: [], rows: [] }),
    );
    const widgets = [...container.querySelectorAll('.widget')];
    expect(widgets.map((widget) => styleVar(widget, '--span'))).toEqual(['3', '8']);
    expect(widgets.map((widget) => widget.classList.contains('widget--wide'))).toEqual([
      false,
      true,
    ]);
  });

  it('opens the note behind a row of a list', async () => {
    const onOpenNote = vi.fn();
    render(
      <DashboardView
        results={[
          result(
            { kind: 'list', type: 'task' },
            {
              shape: 'rows',
              columns: ['path', 'title'],
              rows: [{ path: 'tasks/a.md', title: 'Write it', values: {} }],
            },
          ),
        ]}
        onOpenNote={onOpenNote}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Write it' }));
    expect(onOpenNote).toHaveBeenCalledWith('tasks/a.md');
  });

  it("puts a list row's other values on one metadata line, leaving out the empty ones", () => {
    const { container } = draw(
      result(
        { kind: 'list', type: 'task', columns: ['phase', 'estimate'] },
        {
          shape: 'rows',
          columns: ['path', 'title', 'phase', 'estimate'],
          rows: [
            { path: 'a.md', title: 'Write it', values: { phase: 'P14', estimate: '1h' } },
            { path: 'b.md', title: 'Read it', values: { phase: null, estimate: '' } },
          ],
        },
      ),
    );
    const rows = [...container.querySelectorAll('.widget__row')];
    expect(rows.map((row) => row.querySelector('.widget__meta')?.textContent ?? null)).toEqual([
      'P14 · 1h',
      null,
    ]);
    expect(screen.queryByText('null')).toBeNull();
  });

  it('shows a table column per field, leaving out the ones that identify the row', () => {
    draw(
      result(
        { kind: 'table', type: 'task', columns: ['status'] },
        {
          shape: 'rows',
          columns: ['path', 'title', 'status'],
          rows: [{ path: 'tasks/a.md', title: 'Write it', values: { status: 'doing' } }],
        },
      ),
    );
    expect(screen.getAllByRole('columnheader').map((cell) => cell.textContent)).toEqual([
      'Name',
      'status',
    ]);
    expect(screen.getByText('doing')).toBeDefined();
  });

  it('leaves a missing cell empty rather than showing null', () => {
    draw(
      result(
        { kind: 'table', type: 'task', columns: ['due'] },
        {
          shape: 'rows',
          columns: ['path', 'title', 'due'],
          rows: [{ path: 'a.md', title: 'No date', values: { due: null } }],
        },
      ),
    );
    expect(screen.getByText('No date')).toBeDefined();
    expect(screen.queryByText('null')).toBeNull();
  });

  it('says so when a widget matches nothing', () => {
    draw(result({ kind: 'list', type: 'task' }, { shape: 'rows', columns: [], rows: [] }));
    expect(screen.getByText('Nothing matches yet.')).toBeDefined();
  });

  it('draws the other widgets when one of them failed', () => {
    draw(
      result(
        { kind: 'number', type: 'gone', title: 'Broken' },
        { shape: 'error', message: 'no such table' },
      ),
      result({ kind: 'number', type: 'task', title: 'Fine' }, { shape: 'number', value: '5' }),
    );
    expect(screen.getByText('no such table')).toBeDefined();
    expect(screen.getByText('5')).toBeDefined();
  });
});

describe('BarChart', () => {
  const bars = (data: WidgetData, source: Record<string, unknown> = {}) =>
    draw(
      result({ kind: 'bar', type: 'task', groupBy: 'phase', title: 'Per phase', ...source }, data),
    );

  it('draws a bar per group, in the order it was given', () => {
    const { container } = bars(barData(barsOf(['2', 6], ['10', 7], ['13', 33])));
    expect(textsOf(container, '.bars__label')).toEqual(['2', '10', '13']);
  });

  it('sizes bars against the top of the scale, not against the total', () => {
    const { container } = bars(barData(barsOf(['1', 20], ['2', 10])));
    const heights = [...container.querySelectorAll('.bars__bar')].map((bar) =>
      styleVar(bar, '--at'),
    );
    // Ticks run 0 to 20, so 20 fills the plot and 10 half of it.
    expect(heights).toEqual(['100%', '50%']);
  });

  it('calls out the highlighted bar and only that one, and keys it beside the title', () => {
    const { container } = bars(barData(barsOf(['1', 4], ['2', 9]), { highlight: '1' }));
    const current = container.querySelectorAll('.bars__column--current');
    expect(current).toHaveLength(1);
    expect(current[0]?.querySelector('.bars__label')?.textContent).toBe('1');
    expect(container.querySelector('.bars__key')?.textContent).toBe('Current phase');
  });

  it('calls nothing out when there is no highlight, and shows no key', () => {
    const { container } = bars(barData(barsOf(['1', 4], ['2', 9])));
    expect(container.querySelectorAll('.bars__column--current')).toHaveLength(0);
    expect(container.querySelectorAll('.bars__column')).toHaveLength(2);
    expect(container.querySelector('.bars__key')).toBeNull();
  });

  it('writes a value over the tallest bar and the called-out one only', () => {
    const { container } = bars(barData(barsOf(['1', 4], ['2', 9], ['3', 2]), { highlight: '3' }));
    expect(textsOf(container, '.bars__value')).toEqual(['9', '2']);
  });

  it('writes a value over the first of the bars that tie for tallest, and over a lone bar', () => {
    // Fifty bars that tie would print fifty values over one another.
    const { container: tied } = bars(barData(barsOf(['1', 5], ['2', 5], ['3', 1])));
    expect(textsOf(tied, '.bars__value')).toEqual(['5']);
    expect(tied.querySelector('.bars__column .bars__value')?.closest('.bars__column')).toBe(
      tied.querySelector('.bars__column'),
    );
    const { container: lone } = bars(barData(barsOf(['1', 3])));
    expect(textsOf(lone, '.bars__value')).toEqual(['3']);
  });

  it('stands a negative value at the floor, with its value written there and read as it is', () => {
    const { container } = draw(
      result(
        { kind: 'sql', title: 'Hours', sql: 'SELECT client, SUM(hours) FROM v_task;', show: 'bar' },
        barData(barsOf(['Larkspur', 4], ['Quill', -3])),
      ),
    );
    const columns = [...container.querySelectorAll('.bars__column')];
    expect(styleVar(columns[1]?.querySelector('.bars__bar'), '--at')).toBe('0%');
    expect(columns[1]?.getAttribute('title')).toBe('Quill · -3');
  });

  it('offers the table and the total to a SQL widget drawn as bars', () => {
    draw(
      result(
        { kind: 'sql', title: 'Hours', sql: 'SELECT client, SUM(hours) FROM v_task;', show: 'bar' },
        barData(barsOf(['Larkspur', 4], ['Quill', 3])),
      ),
    );
    expect(screen.getByRole('button', { name: 'Show as table' })).toBeDefined();
    const panel = screen.getByRole('region', { name: 'Hours' });
    expect(within(panel).getByText('7').className).toBe('widget__total');
  });

  it('names each bar and its count when pointed at, and to a screen reader', () => {
    const { container } = bars(barData(barsOf(['2', 9])));
    const column = container.querySelector('.bars__column');
    expect(column?.getAttribute('title')).toBe('Phase 2 · 9 tasks');
    expect(column?.querySelector('.visually-hidden')?.textContent).toBe('Phase 2 · 9 tasks');
    // Not as a label: it would shadow a widget whose title the reading contains.
    expect(column?.hasAttribute('aria-label')).toBe(false);
  });

  it('marks the scale with round ticks from zero past the largest', () => {
    const { container } = bars(barData(barsOf(['1', 33])));
    const ticks = textsOf(container, '.bars__tick');
    expect(ticks[0]).toBe('0');
    expect(Number(ticks.at(-1))).toBeGreaterThanOrEqual(33);
  });

  it('says how many it counted, and how many have no value, beside the title', () => {
    bars(barData(barsOf(['1', 3]), { unset: 7 }));
    const panel = screen.getByRole('region', { name: 'Per phase' });
    expect(within(panel).getByText('7 without a phase')).toBeDefined();
    expect(within(panel).getByText('10 tasks').className).toBe('widget__total');
  });

  it('says nothing about unset notes when every note has a value', () => {
    bars(barData(barsOf(['1', 3])));
    expect(screen.queryByText(/without a/)).toBeNull();
  });

  it('reads as a table at the toggle, with the same numbers, and as a chart again', async () => {
    const { container } = bars(barData(barsOf(['1', 4], ['2', 12])));
    const toggle = screen.getByRole('button', { name: 'Show as table', pressed: false });

    await userEvent.click(toggle);
    expect(screen.getByRole('button', { name: 'Show as table', pressed: true })).toBeDefined();
    expect(container.querySelector('.bars')).toBeNull();
    expect(screen.getAllByRole('columnheader').map((cell) => cell.textContent)).toEqual([
      'Phase',
      'Tasks',
      'Share',
    ]);
    expect(
      [...container.querySelectorAll('.count-table__row')].map((row) => textsOf(row, 'td')),
    ).toEqual([
      ['1', '4', '25%'],
      ['2', '12', '75%'],
    ]);

    await userEvent.click(toggle);
    expect(container.querySelector('.bars')).not.toBeNull();
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('forgets the table choice once the widget leaves the page (Q9)', async () => {
    const data = barData(barsOf(['1', 4]));
    const { container, unmount } = bars(data);
    await userEvent.click(screen.getByRole('button', { name: 'Show as table' }));
    expect(container.querySelector('.bars')).toBeNull();
    unmount();

    const again = bars(data);
    expect(again.container.querySelector('.bars')).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Show as table', pressed: false })).toBeDefined();
  });

  it('offers no table for a chart with nothing to chart, and says so', () => {
    bars(barData([]));
    expect(screen.getByText('Nothing to chart yet.')).toBeDefined();
    expect(screen.queryByRole('button', { name: 'Show as table' })).toBeNull();
  });

  it('says so, not an empty table, when a chart left in table mode runs out of bars', async () => {
    const source = { kind: 'bar', type: 'task', groupBy: 'phase', title: 'Per phase' };
    const { container, rerender } = draw(result(source, barData(barsOf(['1', 4]))));
    await userEvent.click(screen.getByRole('button', { name: 'Show as table' }));
    expect(container.querySelector('.count-table')).not.toBeNull();

    rerender(<DashboardView results={[result(source, barData([]))]} onOpenNote={() => {}} />);
    expect(screen.getByText('Nothing to chart yet.')).toBeDefined();
    expect(container.querySelector('.count-table')).toBeNull();
  });

  it('marks the called-out group in the table, as the chart does in its bars', async () => {
    const { container } = bars(barData(barsOf(['1', 4], ['2', 9]), { highlight: '2' }));
    await userEvent.click(screen.getByRole('button', { name: 'Show as table' }));
    const current = container.querySelectorAll('.count-table__row--current');
    expect(current).toHaveLength(1);
    expect(current[0]?.getAttribute('aria-current')).toBe('true');
    expect(current[0]?.querySelector('.count-table__label')?.textContent).toBe('2');
  });
});

describe('DonutChart', () => {
  const donut = (bars: WidgetBar[], source: Record<string, unknown> = {}) =>
    draw(
      result(
        { kind: 'donut', type: 'task', groupBy: 'status', title: 'By status', ...source },
        barData(bars),
      ),
    );

  it('draws a segment per counted value, sized by its share, in the order given', () => {
    const { container } = donut(barsOf(['doing', 3], ['done', 1]));
    const segments = [...container.querySelectorAll('.donut__segment')];
    expect(segments.map((segment) => styleVar(segment, '--size'))).toEqual(['75', '25']);
  });

  it('draws no segment for a value nothing has, but still lists it, faintly', () => {
    const { container } = donut(barsOf(['done', 3], ['review', 0]));
    expect(container.querySelectorAll('.donut__segment')).toHaveLength(1);
    const empty = container.querySelectorAll('.count-table__row--empty');
    expect(empty).toHaveLength(1);
    expect(empty[0]?.textContent).toContain('Review');
  });

  it('says the whole beside the title', () => {
    donut(barsOf(['doing', 3], ['done', 1]));
    const panel = screen.getByRole('region', { name: 'By status' });
    expect(within(panel).getByText('4 tasks').className).toBe('widget__total');
  });

  it('lists every value with its name capitalised, its count and its share, under headings', () => {
    const { container } = donut(barsOf(['doing', 3], ['done', 1]));
    expect(screen.getAllByRole('columnheader').map((cell) => cell.textContent)).toEqual([
      'Status',
      'Tasks',
      'Share',
    ]);
    expect(
      [...container.querySelectorAll('.count-table__row')].map((row) => textsOf(row, 'td')),
    ).toEqual([
      ['Doing', '3', '75%'],
      ['Done', '1', '25%'],
    ]);
  });

  it('leaves a value that is no status on the ramp, even in a status grouping', () => {
    const { container } = donut(barsOf(['done', 3], ['Other', 2], ['', 1], ['blocked', 1]));
    const segments = [...container.querySelectorAll('.donut__segment')];
    expect(segments.map((segment) => segment.getAttribute('data-tone'))).toEqual([
      'done',
      null,
      null,
      null,
    ]);
    expect(segments.map((segment) => segment.getAttribute('data-rank'))).toEqual([
      '1',
      '2',
      '3',
      '4',
    ]);
  });

  it('paints a status in its own dot, and anything else down the ramp by size', () => {
    const { container: byStatus } = donut(barsOf(['done', 3], ['doing', 1]));
    const statusSegments = [...byStatus.querySelectorAll('.donut__segment')];
    expect(statusSegments.map((segment) => segment.getAttribute('data-tone'))).toEqual([
      'done',
      'doing',
    ]);
    expect(byStatus.querySelector('.count-table__swatch')?.getAttribute('data-tone')).toBe('done');

    const { container: byPhase } = donut(barsOf(['14', 3], ['15', 1]), { groupBy: 'phase' });
    const phaseSegments = [...byPhase.querySelectorAll('.donut__segment')];
    expect(phaseSegments.map((segment) => segment.getAttribute('data-tone'))).toEqual([null, null]);
    expect(phaseSegments.map((segment) => segment.getAttribute('data-rank'))).toEqual(['1', '2']);
  });

  it('names a value nothing is called rather than leaving it blank', () => {
    donut(barsOf(['', 2]));
    expect(screen.getByText('No value')).toBeDefined();
  });

  it('keeps a group genuinely called Other apart from the gathered tail', () => {
    const bars = barsOf(
      ['Other', 9],
      ['a', 8],
      ['b', 7],
      ['c', 6],
      ['d', 5],
      ['e', 4],
      ['Other', 6],
    );
    const { container } = donut(bars);
    expect(container.querySelectorAll('.donut__segment')).toHaveLength(7);
    expect(screen.getAllByText('Other')).toHaveLength(2);
  });

  it('says so when there is nothing to chart', () => {
    donut([]);
    expect(screen.getByText('Nothing to chart yet.')).toBeDefined();
  });
});

describe('LineChart', () => {
  const line = (bars: WidgetBar[]) =>
    draw(result({ kind: 'line', type: 'task', groupBy: 'due' }, barData(bars)));

  it('puts a dot on the last reading only; the others wait to be pointed at', () => {
    const { container } = line(barsOf(['2026-09-01', 2], ['2026-09-02', 5], ['2026-09-03', 3]));
    expect(container.querySelectorAll('.line-chart__point')).toHaveLength(3);
    const last = container.querySelectorAll('.line-chart__point--last');
    expect(last).toHaveLength(1);
    expect(last[0]).toBe(container.querySelectorAll('.line-chart__point')[2]);
  });

  it('draws a smooth line through them, not straight segments', () => {
    const { container } = line(barsOf(['a', 1], ['b', 4], ['c', 2]));
    expect(container.querySelector('.line-chart__line')?.getAttribute('d')).toMatch(/^M[\d.]+,.*C/);
  });

  it('gives the numbers as a table, not only as a picture', () => {
    line(barsOf(['2026-09-01', 2], ['2026-09-02', 5]));
    expect(screen.getByRole('columnheader', { name: '2026-09-01' })).toBeDefined();
    expect(screen.getByText('5')).toBeDefined();
  });

  it('puts the top gridline where the highest point is', () => {
    const { container } = line(barsOf(['1', 1], ['2', 4]));
    const grids = [...container.querySelectorAll('.line-chart__grid')];
    const topGrid = Math.min(...grids.map((grid) => Number(grid.getAttribute('y1'))));
    const topPoint = Math.min(
      ...[...container.querySelectorAll('.line-chart__point')].map((dot) =>
        parseFloat(styleVar(dot, '--y')),
      ),
    );
    expect(grids.length).toBeGreaterThan(1);
    // The plot is 120 units tall; the dot's --y is a percentage of it.
    expect((topGrid / 120) * 100).toBeCloseTo(topPoint, 5);
  });

  it('says so when there is nothing to chart', () => {
    line([]);
    expect(screen.getByText('Nothing to chart yet.')).toBeDefined();
  });
});

describe('HeroStrip', () => {
  const hero = {
    kind: 'hero',
    type: 'task',
    title: 'Tasks',
    groupBy: 'phase',
    progress: { filters: [{ key: 'status', operator: 'is', value: 'done' }] },
  };
  const heroData: WidgetData = {
    shape: 'hero',
    total: 177,
    part: { label: 'done', count: 166 },
    groups: [
      { label: '14', count: 22 },
      { label: '15', count: 12 },
    ],
    highlight: { label: '15', count: 12 },
  };

  it('draws as cells of the strip: the total, the done part and the current group', () => {
    const { container } = draw(result(hero, heroData));
    expect(container.querySelector('.widget')?.className).toContain('widget--strip');
    expect(styleVar(container.querySelector('.widget'), '--cells')).toBe('3');
    expect(textsOf(container, '.kpi__label')).toEqual(['Tasks', 'Done', 'Current phase']);
    expect(textsOf(container, '.kpi__value')).toEqual(['177', '166', '15']);
    expect(textsOf(container, '.kpi__sub')).toEqual(['2 phases', '94%', '12 tasks']);
  });

  it('shows the done part as a status bar of the whole', () => {
    const { container } = draw(result(hero, heroData));
    expect(screen.getByRole('img', { name: '94% of all' })).toBeDefined();
    const part = parseFloat(styleVar(container.querySelector('.kpi__bar-part'), '--size'));
    const rest = parseFloat(styleVar(container.querySelector('.kpi__bar-rest'), '--size'));
    expect(part).toBeCloseTo((166 / 177) * 100, 6);
    expect(part + rest).toBeCloseTo(100, 6);
  });

  it('takes one cell, with only the total, when it has neither progress nor a grouping', () => {
    const { container } = draw(
      result(
        { kind: 'hero', type: 'task', title: 'Tasks' },
        { shape: 'hero', total: 3, part: null, groups: [], highlight: null },
      ),
    );
    expect(styleVar(container.querySelector('.widget'), '--cells')).toBe('1');
    expect(textsOf(container, '.kpi__value')).toEqual(['3']);
    expect(container.querySelector('.kpi__sub')).toBeNull();
    expect(container.querySelector('.kpi__bar')).toBeNull();
  });
});

describe('RankList', () => {
  const rank = (data: Partial<Extract<WidgetData, { shape: 'rank' }>> = {}) =>
    draw(
      result(
        { kind: 'rank', type: 'task', groupBy: 'phase', title: 'Largest phases' },
        {
          shape: 'rank',
          rows: [
            { label: '13', count: 33, fraction: 1 },
            { label: '15', count: 12, fraction: 12 / 33 },
          ],
          shown: 45,
          total: 90,
          highlight: '15',
          ...data,
        },
      ),
    );

  it('names each group with its count and a bar against the largest, under headings', () => {
    const { container } = rank();
    expect(screen.getAllByRole('columnheader').map((cell) => cell.textContent)).toEqual([
      'Phase',
      'Tasks',
    ]);
    const rows = [...container.querySelectorAll('.rank__row')];
    expect(rows.map((row) => row.querySelector('.rank__name')?.textContent)).toEqual([
      'Phase 13',
      'Phase 15',
    ]);
    expect(rows.map((row) => row.querySelector('.rank__count')?.textContent)).toEqual(['33', '12']);
    expect(rows.map((row) => styleVar(row.querySelector('.rank__bar'), '--at'))).toEqual([
      '100%',
      `${(12 / 33) * 100}%`,
    ]);
  });

  it('says how much of the whole the ranking holds, beside the title', () => {
    rank();
    const panel = screen.getByRole('region', { name: 'Largest phases' });
    expect(within(panel).getByText('45 of 90 tasks').className).toBe('widget__note');
  });

  it('says nothing beside the title of an empty ranking', () => {
    rank({ rows: [], shown: 0, total: 0, highlight: null });
    expect(screen.queryByText(/ of /)).toBeNull();
  });

  it('calls out the highlighted group', () => {
    const { container } = rank();
    const current = container.querySelectorAll('.rank__row--current');
    expect(current).toHaveLength(1);
    expect(current[0]?.querySelector('.rank__name')?.textContent).toBe('Phase 15');
  });

  it('says so when there is nothing to rank', () => {
    rank({ rows: [], shown: 0, total: 0, highlight: null });
    expect(screen.getByText('Nothing to rank yet.')).toBeDefined();
  });
});
