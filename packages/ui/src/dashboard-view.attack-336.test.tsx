// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { WidgetBar, WidgetData, WidgetResult } from '@dfai/application';
import { parseDashboard, percentOf, type Widget } from '@dfai/domain';
import { DashboardView } from './dashboard-view.tsx';

/**
 * Attack on PR #336 (UI v2 slice 10, the dashboard). Each test names the one
 * invariant it holds the drawing to.
 */

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/** mulberry32: a seeded RNG, so a failing case replays exactly. */
function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

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

const barsOf = (...pairs: [string, number][]): WidgetBar[] => {
  const total = pairs.reduce((sum, [, count]) => sum + Math.max(count, 0), 0);
  return pairs.map(([label, count]) => ({
    label,
    count,
    share: total === 0 ? 0 : Math.round((Math.max(count, 0) / total) * 100),
  }));
};

const barData = (bars: WidgetBar[], highlight: string | null = null): WidgetData => ({
  shape: 'bars',
  bars,
  unset: 0,
  total: bars.reduce((sum, bar) => sum + bar.count, 0),
  highlight,
});

const styleVar = (element: Element | null | undefined, name: string): string =>
  (element as HTMLElement | null)?.style.getPropertyValue(name) ?? '';

const textsOf = (container: Element, selector: string): (string | null)[] =>
  [...container.querySelectorAll(selector)].map((element) => element.textContent);

const SQL_BAR = {
  kind: 'sql',
  title: 'Hours by client',
  sql: 'SELECT client, SUM(hours) FROM v_task GROUP BY client;',
  show: 'bar',
};

describe('BarChart, attacked', () => {
  const bar = (data: WidgetData) =>
    draw(result({ kind: 'bar', type: 'task', groupBy: 'phase', title: 'Per phase' }, data));

  it('the hidden reading, the hover title and the drawn value agree for every bar (seeded)', () => {
    for (let seed = 1; seed <= 40; seed += 1) {
      const random = seeded(seed);
      const pairs = Array.from(
        { length: 1 + Math.floor(random() * 12) },
        (_, at): [string, number] => [String(at + 1), Math.floor(random() * 60)],
      );
      const highlight = random() < 0.5 ? null : String(1 + Math.floor(random() * pairs.length));
      const { container, unmount } = bar(barData(barsOf(...pairs), highlight));
      for (const column of container.querySelectorAll('.bars__column')) {
        const hidden = column.querySelector('.visually-hidden')?.textContent;
        expect(column.getAttribute('title'), `seed ${seed}`).toBe(hidden);
        const value = column.querySelector('.bars__value')?.textContent;
        if (value !== undefined)
          expect(hidden, `seed ${seed}`).toMatch(new RegExp(` ${value} task`));
      }
      unmount();
    }
  });

  it('a negative value (a SQL bar can return one) puts no bar or value below the floor', () => {
    const { container } = draw(
      result(SQL_BAR, barData(barsOf(['Larkspur', 4], ['Fenn & Co', -3]))),
    );
    const placed = [...container.querySelectorAll('.bars__bar, .bars__value')].map((mark) =>
      parseFloat(styleVar(mark, '--at')),
    );
    expect(placed.length).toBeGreaterThan(0);
    for (const at of placed) expect(at).toBeGreaterThanOrEqual(0);
  });

  it('every value negative still writes a value inside the plot, not under the axis', () => {
    const { container } = draw(result(SQL_BAR, barData(barsOf(['Larkspur', -2], ['Quill', -5]))));
    for (const value of container.querySelectorAll('.bars__value')) {
      expect(parseFloat(styleVar(value, '--at'))).toBeGreaterThanOrEqual(0);
    }
  });

  it('two bars with the same label (a SQL result may repeat one) draw without a key clash', () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { container } = draw(result(SQL_BAR, barData(barsOf(['Quill', 2], ['Quill', 5]))));
    expect(container.querySelectorAll('.bars__column')).toHaveLength(2);
    const clashes = errors.mock.calls.filter((call) => String(call[0]).includes('same key'));
    expect(clashes).toEqual([]);
  });

  it('a SQL widget drawn as bars offers the table toggle, like a bar widget', () => {
    draw(result(SQL_BAR, barData(barsOf(['Larkspur', 4], ['Quill', 3]))));
    expect(screen.getByRole('button', { name: 'Show as table', pressed: false })).toBeDefined();
  });

  it('a very long label stays one line, ending in an ellipsis, and is read whole', () => {
    const long = 'Mara Quill and the extremely long name of a Larkspur Payroll phase';
    const { container } = draw(
      result(
        { kind: 'bar', type: 'task', groupBy: 'client', title: 'Per client' },
        barData(barsOf([long, 3], ['Fenn', 1])),
      ),
    );
    expect(container.querySelector('.bars__label')?.textContent).toBe(long);
    expect(screen.getByText(`Client ${long} · 3 tasks`)).toBeDefined();
  });
});

describe('Table toggle, attacked', () => {
  const chart = barData(barsOf(['backlog', 4], ['doing', 2], ['done', 1]));
  const source = { kind: 'bar', type: 'task', groupBy: 'status', title: 'By status' };

  it('works from the keyboard: Space and Enter flip it, and aria-pressed follows', async () => {
    const user = userEvent.setup();
    const { container } = draw(result(source, chart));
    const toggle = screen.getByRole('button', { name: 'Show as table' });
    toggle.focus();
    await user.keyboard(' ');
    expect(toggle.getAttribute('aria-pressed')).toBe('true');
    expect(container.querySelector('.count-table')).not.toBeNull();
    await user.keyboard('{Enter}');
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    expect(container.querySelector('.bars')).not.toBeNull();
  });

  it('keeps focus on the toggle across the swap, so a keyboard user is not dropped', async () => {
    const user = userEvent.setup();
    draw(result(source, chart));
    const toggle = screen.getByRole('button', { name: 'Show as table' });
    toggle.focus();
    await user.keyboard(' ');
    expect(document.activeElement).toBe(toggle);
  });

  it('the table shows the same counts as the bars, in the same order, after a round trip', async () => {
    const user = userEvent.setup();
    const { container } = draw(result(source, chart));
    const drawn = [...container.querySelectorAll('.bars__column .visually-hidden')].map(
      (reading) => reading.textContent,
    );
    await user.click(screen.getByRole('button', { name: 'Show as table' }));
    expect(textsOf(container, '.count-table__count')).toEqual(['4', '2', '1']);
    expect(textsOf(container, '.count-table__label')).toEqual(['Backlog', 'Doing', 'Done']);
    await user.click(screen.getByRole('button', { name: 'Show as table' }));
    expect(
      [...container.querySelectorAll('.bars__column .visually-hidden')].map(
        (reading) => reading.textContent,
      ),
    ).toEqual(drawn);
  });
});

describe('Donut, attacked', () => {
  /** The colour a swatch ends up wearing: its status tone wins over its rank, as in the sheet. */
  const paintOf = (swatch: Element) =>
    swatch.getAttribute('data-tone') ?? `rank-${swatch.getAttribute('data-rank') ?? ''}`;

  it('no two status groups with something in them share a segment colour', () => {
    const { container } = draw(
      result(
        { kind: 'donut', type: 'task', groupBy: 'status', title: 'Share of status' },
        barData(barsOf(['backlog', 3], ['blocked', 2], ['cancelled', 1], ['', 1])),
      ),
    );
    const paints = [...container.querySelectorAll('.donut__segment')].map(paintOf);
    expect(paints).toHaveLength(4);
    expect(new Set(paints).size).toBe(paints.length);
  });

  it('the gathered "Other" tail of a status donut is not painted as Backlog', () => {
    const { container } = draw(
      result(
        { kind: 'donut', type: 'task', groupBy: 'status', title: 'Share of status' },
        barData(barsOf(['doing', 5], ['backlog', 3], ['Other', 2])),
      ),
    );
    const [, backlog, other] = [...container.querySelectorAll('.donut__segment')].map(paintOf);
    expect(other).not.toBe(backlog);
  });

  it('an option nothing has yet is listed in the table but gets no segment', () => {
    const { container } = draw(
      result(
        { kind: 'donut', type: 'task', groupBy: 'status', title: 'Share of status' },
        barData(barsOf(['doing', 2], ['review', 0], ['done', 1])),
      ),
    );
    expect(container.querySelectorAll('.donut__segment')).toHaveLength(2);
    expect(textsOf(container, '.count-table__count')).toEqual(['2', '0', '1']);
    expect(container.querySelectorAll('.count-table__row--empty')).toHaveLength(1);
  });
});

describe('HeroStrip, attacked', () => {
  const hero = {
    kind: 'hero',
    type: 'task',
    title: 'Tasks',
    groupBy: 'phase',
    progress: { filters: [{ key: 'status', operator: 'is', value: 'done' }] },
  };
  const heroData = (total: number, done: number): WidgetData => ({
    shape: 'hero',
    total,
    part: { label: 'done', count: done },
    groups: [],
    highlight: null,
  });
  const sizes = (container: Element) => ({
    part: parseFloat(styleVar(container.querySelector('.kpi__bar-part'), '--size')),
    rest: parseFloat(styleVar(container.querySelector('.kpi__bar-rest'), '--size')),
  });

  it('the bar, its label and the sub agree, and read 100% only when all is done (seeded)', () => {
    const random = seeded(336);
    for (let run = 0; run < 60; run += 1) {
      const total = Math.floor(random() * 2000);
      const done = Math.floor(random() * (total + 1));
      const { container, unmount } = draw(result(hero, heroData(total, done)));
      const label = container.querySelector('.kpi__bar')?.getAttribute('aria-label');
      const percent = percentOf(done, total);
      expect(label, `${done}/${total}`).toBe(`${percent}% of all`);
      expect(textsOf(container, '.kpi__sub')).toContain(`${percent}%`);
      expect(percent === 100, `${done}/${total}`).toBe(total > 0 && done === total);
      const { part } = sizes(container);
      if (total > 0) expect(Math.abs(part - (done / total) * 100)).toBeLessThan(1e-9);
      unmount();
    }
  });

  it('a total of zero divides nothing by zero: no NaN in the bar', () => {
    const { container } = draw(result(hero, heroData(0, 0)));
    const { part, rest } = sizes(container);
    expect(Number.isNaN(part) || Number.isNaN(rest)).toBe(false);
    expect(screen.getByRole('img', { name: '0% of all' })).toBeDefined();
  });

  it('done above the total reads 100% and fills the bar, never more', () => {
    const { container } = draw(result(hero, heroData(3, 5)));
    expect(screen.getByRole('img', { name: '100% of all' })).toBeDefined();
    expect(sizes(container)).toEqual({ part: 100, rest: 0 });
  });

  it('no phases and no current group: the total alone, with no "0 phases" and no cell for it', () => {
    const { container } = draw(result(hero, heroData(4, 1)));
    expect(styleVar(container.querySelector('.widget'), '--cells')).toBe('2');
    expect(textsOf(container, '.kpi__label')).toEqual(['Tasks', 'Done']);
    expect(textsOf(container, '.kpi__sub')).toEqual(['25%']);
  });
});

describe('Strip and panels, attacked', () => {
  it('an errored number widget is drawn, as a panel holding its message', () => {
    const { container } = draw(
      result(
        { kind: 'number', type: 'ghost', title: 'Nowhere' },
        { shape: 'error', message: 'There is no type called ghost.' },
      ),
    );
    expect(screen.getByText('There is no type called ghost.')).toBeDefined();
    expect(container.querySelector('.dashboard__strip')).toBeNull();
  });

  it('a dashboard of strip widgets only draws no empty panel grid', () => {
    const { container } = draw(
      result({ kind: 'number', type: 'task', title: 'Open' }, { shape: 'number', value: '0' }),
    );
    expect(container.querySelector('.dashboard__panels')).toBeNull();
    expect(textsOf(container, '.kpi__value')).toEqual(['0']);
  });
});

describe('RankList head wording, attacked', () => {
  const rank = (shown: number, total: number, rows: { label: string; count: number }[]) =>
    draw(
      result(
        { kind: 'rank', type: 'task', groupBy: 'client', title: 'Largest clients' },
        {
          shape: 'rank',
          rows: rows.map((row) => ({ ...row, fraction: row.count / (rows[0]?.count || 1) })),
          shown,
          total,
          highlight: null,
        },
      ),
    );

  it('reads "1 of 1 task" in the singular', () => {
    const { container } = rank(1, 1, [{ label: 'Larkspur', count: 1 }]);
    expect(container.querySelector('.widget__note')?.textContent).toBe('1 of 1 task');
  });

  it('an empty ranking does not claim "0 of 0 tasks" beside "Nothing to rank yet"', () => {
    const { container } = rank(0, 0, []);
    expect(screen.getByText('Nothing to rank yet.')).toBeDefined();
    expect(container.querySelector('.widget__note')).toBeNull();
  });

  it('tied rows are both listed, in the order given', () => {
    const { container } = rank(4, 4, [
      { label: 'Larkspur', count: 2 },
      { label: 'Quill', count: 2 },
    ]);
    expect(textsOf(container, '.rank__count')).toEqual(['2', '2']);
    expect(textsOf(container, '.rank__name')).toEqual(['Client Larkspur', 'Client Quill']);
  });
});
