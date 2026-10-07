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

describe('DashboardView', () => {
  it('says what to do when there are no widgets', () => {
    draw();
    expect(screen.getByText(/no widgets yet/)).toBeDefined();
  });

  it('shows a number tile with its value, its title under it, and a glyph', () => {
    const { container } = draw(
      result(
        { kind: 'number', type: 'task', title: 'In flight', icon: 'bolt' },
        { shape: 'number', value: '12' },
      ),
    );
    const tile = screen.getByRole('region', { name: 'In flight' });
    expect(within(tile).getByText('12').className).toBe('stat__value');
    expect(within(tile).getByText('In flight').className).toBe('stat__label');
    expect(container.querySelector('.stat__icon')).not.toBeNull();
  });

  it('titles a card in sentence case as a heading, with no SQL tag beside it', () => {
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
    const labels = [...container.querySelectorAll('.bars__label')].map(
      (label) => label.textContent,
    );
    expect(labels).toEqual(['2', '10', '13']);
  });

  it('sizes bars against the top of the scale, not against the total', () => {
    const { container } = bars(barData(barsOf(['1', 20], ['2', 10])));
    const heights = [...container.querySelectorAll('.bars__bar')].map((bar) =>
      styleVar(bar, '--at'),
    );
    // Ticks run 0 to 20, so 20 fills the plot and 10 half of it.
    expect(heights).toEqual(['100%', '50%']);
  });

  it('calls out the highlighted bar and only that one', () => {
    const { container } = bars(barData(barsOf(['1', 4], ['2', 9]), { highlight: '1' }));
    const current = container.querySelectorAll('.bars__column--current');
    expect(current).toHaveLength(1);
    expect(current[0]?.querySelector('.bars__label')?.textContent).toBe('1');
  });

  it('calls nothing out when there is no highlight', () => {
    const { container } = bars(barData(barsOf(['1', 4], ['2', 9])));
    expect(container.querySelectorAll('.bars__column--current')).toHaveLength(0);
    expect(container.querySelectorAll('.bars__column')).toHaveLength(2);
  });

  it('marks the scale with round ticks from zero past the largest', () => {
    const { container } = bars(barData(barsOf(['1', 33])));
    const ticks = [...container.querySelectorAll('.bars__tick')].map((tick) => tick.textContent);
    expect(ticks[0]).toBe('0');
    expect(Number(ticks.at(-1))).toBeGreaterThanOrEqual(33);
  });

  it('says how many it counted, and how many have no value, beside the title', () => {
    bars(barData(barsOf(['1', 3]), { unset: 7 }));
    const card = screen.getByRole('region', { name: 'Per phase' });
    expect(within(card).getByText('7 without a phase')).toBeDefined();
    expect(within(card).getByText('10').className).toBe('widget__total');
  });

  it('says nothing about unset notes when every note has a value', () => {
    bars(barData(barsOf(['1', 3])));
    expect(screen.queryByText(/without a/)).toBeNull();
  });

  it('says so when a chart has nothing to chart', () => {
    bars(barData([]));
    expect(screen.getByText('Nothing to chart yet.')).toBeDefined();
  });
});

describe('DonutChart', () => {
  const donut = (bars: WidgetBar[]) =>
    draw(result({ kind: 'donut', type: 'task', groupBy: 'status' }, barData(bars)));

  it('draws a slice per counted value', () => {
    const { container } = donut(barsOf(['doing', 3], ['done', 1]));
    expect(container.querySelectorAll('.donut__slice')).toHaveLength(2);
  });

  it('draws no slice for a value nothing has, but still lists it, faintly', () => {
    const { container } = donut(barsOf(['done', 3], ['review', 0]));
    expect(container.querySelectorAll('.donut__slice')).toHaveLength(1);
    const empty = container.querySelectorAll('.donut__entry--empty');
    expect(empty).toHaveLength(1);
    expect(empty[0]?.textContent).toContain('Review');
  });

  it('shows the total and what it counts on the disc in the middle', () => {
    const { container } = donut(barsOf(['doing', 3], ['done', 1]));
    expect(container.querySelector('.donut__total')?.textContent).toBe('4');
    expect(container.querySelector('.donut__noun')?.textContent).toBe('tasks');
  });

  it('lists every slice with its name capitalised, its share and its count', () => {
    const { container } = donut(barsOf(['doing', 3], ['done', 1]));
    const rows = [...container.querySelectorAll('.donut__entry')].map((row) =>
      [...row.querySelectorAll('span')].map((cell) => cell.textContent).slice(1),
    );
    expect(rows).toEqual([
      ['Doing', '75%', '3'],
      ['Done', '25%', '1'],
    ]);
  });

  it('names a slice with no value rather than leaving it blank', () => {
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
    expect(container.querySelectorAll('.donut__slice')).toHaveLength(7);
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

describe('HeroCard', () => {
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

  it('leads with the title and total, and says how many groups they span', () => {
    const { container } = draw(result(hero, heroData));
    expect(container.querySelector('.hero__title')?.textContent).toBe('Tasks');
    expect(container.querySelector('.hero__total')?.textContent).toBe('177');
    expect(screen.getByText('across 2 phases')).toBeDefined();
  });

  it('shows the done part as a figure and as a ring of the whole', () => {
    const { container } = draw(result(hero, heroData));
    expect(container.querySelector('.hero__part-value')?.textContent).toBe('166');
    expect(container.querySelector('.hero__part-label')?.textContent).toBe('done');
    expect(screen.getByRole('img', { name: '94% of all' })).toBeDefined();
    const dash = container.querySelector('.hero__ring-value')?.getAttribute('stroke-dasharray');
    const [painted, whole] = (dash ?? '').split(' ').map(Number);
    expect((painted ?? 0) / (whole ?? 1)).toBeCloseTo(166 / 177, 3);
  });

  it('draws the grouping as a sparkline and calls out the current group below it', () => {
    const { container } = draw(result(hero, heroData));
    expect(container.querySelector('.hero__spark-line')?.getAttribute('d')).toMatch(/^M/);
    expect(container.querySelector('.hero__foot')?.textContent).toBe(
      'This phase+12tasks per phase',
    );
  });

  it('draws only the total when it has neither progress nor a grouping', () => {
    const { container } = draw(
      result(
        { kind: 'hero', type: 'task', title: 'Tasks' },
        { shape: 'hero', total: 3, part: null, groups: [], highlight: null },
      ),
    );
    expect(container.querySelector('.hero__total')?.textContent).toBe('3');
    expect(container.querySelector('.hero__ring')).toBeNull();
    expect(container.querySelector('.hero__spark')).toBeNull();
    expect(container.querySelector('.hero__foot')).toBeNull();
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

  it('names each group with its count and a bar against the largest', () => {
    const { container } = rank();
    const rows = [...container.querySelectorAll('.rank__row')];
    expect(rows.map((row) => row.querySelector('.rank__name')?.textContent)).toEqual([
      'Phase 13',
      'Phase 15',
    ]);
    expect(rows.map((row) => row.querySelector('.rank__count')?.textContent)).toEqual([
      '33 tasks',
      '12 tasks',
    ]);
    expect(rows.map((row) => styleVar(row.querySelector('.rank__bar'), '--at'))).toEqual([
      '100%',
      `${(12 / 33) * 100}%`,
    ]);
  });

  it('says how much of the whole the ranking holds, in words and as a bar', () => {
    const { container } = rank();
    expect(screen.getByText('45 of 90')).toBeDefined();
    expect(styleVar(container.querySelector('.rank__whole-bar'), '--at')).toBe('50%');
  });

  it('calls out the highlighted group', () => {
    const { container } = rank();
    expect(container.querySelector('.rank__row--current .rank__tile')?.textContent).toBe('15');
    expect(container.querySelectorAll('.rank__row--current')).toHaveLength(1);
  });

  it('says so when there is nothing to rank', () => {
    rank({ rows: [], shown: 0, total: 0, highlight: null });
    expect(screen.getByText('Nothing to rank yet.')).toBeDefined();
  });
});
