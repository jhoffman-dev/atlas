import { describe, expect, it } from 'vitest';
import { checkDashboardSpec, dashboardFrontmatter } from './dashboard-spec.ts';
import { MAX_WIDGETS, parseDashboard } from './dashboard.ts';
import { draftFromEntry, widgetProblems } from './widget-draft.ts';

const KNOWN = { knownTypes: ['task', 'project'] };

const PAYROLL = {
  name: 'Larkspur Payroll',
  description: 'Where the payroll migration stands',
  widgets: [
    { kind: 'hero', title: 'Tasks', type: 'task', groupBy: 'status', span: 4 },
    { kind: 'bar', type: 'task', groupBy: 'status' },
    {
      kind: 'number',
      type: 'project',
      filters: [{ key: 'status', operator: 'is', value: 'doing' }],
    },
  ],
};

describe('checkDashboardSpec', () => {
  it('passes a spec whose every widget draws, and writes the widgets the parser reads', () => {
    const reading = checkDashboardSpec(PAYROLL, KNOWN);

    expect(reading.ok).toBe(true);
    if (!reading.ok) return;
    expect(reading.spec.name).toBe('Larkspur Payroll');
    expect(reading.spec.description).toBe('Where the payroll migration stands');
    const frontmatter = dashboardFrontmatter(reading.spec);
    expect(frontmatter).toMatchObject({ atlas: 'dashboard', description: PAYROLL.description });
    expect(parseDashboard(frontmatter).map(({ kind, title }) => [kind, title])).toEqual([
      ['hero', 'Tasks'],
      ['bar', 'task'],
      ['number', 'project count'],
    ]);
  });

  it('carries no key the widget editor does not know into what is written', () => {
    const reading = checkDashboardSpec(
      {
        name: 'Board',
        widgets: [{ kind: 'number', type: 'task', path: '../../.atlas/x', sql: 'DROP' }],
      },
      KNOWN,
    );

    expect(reading.ok && reading.spec.widgets).toEqual([{ kind: 'number', type: 'task' }]);
  });

  it('refuses a widget in the editor’s own words, at the widget it is about', () => {
    const bar = { kind: 'bar', type: 'task' };
    const reading = checkDashboardSpec(
      {
        name: 'Board',
        widgets: [{ kind: 'number', type: 'task' }, bar, { kind: 'list', type: 'deal' }],
      },
      KNOWN,
    );

    expect(reading.ok).toBe(false);
    if (reading.ok) return;
    // Verbatim: exactly what the widget editor says of the same entry.
    expect(reading.problems).toEqual([
      ...widgetProblems(draftFromEntry(bar), KNOWN).map((message) => ({
        at: 'widgets[1]',
        message,
      })),
      { at: 'widgets[2]', message: 'There is no type called “deal”.' },
    ]);
    expect(reading.problems[0]?.message).toBe('A bar chart needs a property to group by.');
  });

  it('refuses a widget kind the dashboard has not got, rather than read it as a number', () => {
    const reading = checkDashboardSpec(
      { name: 'Board', widgets: [{ kind: 'pie', type: 'task' }] },
      KNOWN,
    );

    expect(reading).toEqual({
      ok: false,
      problems: [
        {
          at: 'widgets[0]',
          message:
            'There is no widget kind called “pie”: use one of number, hero, list, table, bar, donut, line, rank, sql, query.',
        },
      ],
    });
  });

  it.each([
    [{ name: 'Board' }, 'widgets', 'A dashboard needs at least one widget.'],
    [{ name: 'Board', widgets: [] }, 'widgets', 'A dashboard needs at least one widget.'],
    [
      { name: 'Board', widgets: 'all of them' },
      'widgets',
      'A dashboard needs at least one widget.',
    ],
    [{ name: 'Board', widgets: ['number'] }, 'widgets[0]', 'A widget is a set of keys and values.'],
    [
      {
        name: 'Board',
        widgets: Array.from({ length: MAX_WIDGETS + 1 }, () => ({ kind: 'number', type: 'task' })),
      },
      'widgets',
      `A dashboard holds at most ${MAX_WIDGETS} widgets.`,
    ],
    [{ widgets: [{ kind: 'number', type: 'task' }] }, 'name', 'Name the dashboard.'],
    [
      { name: '../.atlas/types/task', widgets: [{ kind: 'number', type: 'task' }] },
      'name',
      'A dashboard’s name cannot hold / \\ : * ? " < > or |.',
    ],
    [
      { name: '.hidden', widgets: [{ kind: 'number', type: 'task' }] },
      'name',
      'A dashboard’s name cannot start with a dot.',
    ],
    [
      { name: 'x'.repeat(300), widgets: [{ kind: 'number', type: 'task' }] },
      'name',
      'A dashboard’s name is too long for a file name.',
    ],
    [
      { name: 'Board', description: 7, widgets: [{ kind: 'number', type: 'task' }] },
      'description',
      'description must be text.',
    ],
    [
      { name: 'Board', description: 'x'.repeat(501), widgets: [{ kind: 'number', type: 'task' }] },
      'description',
      'description must be at most 500 characters.',
    ],
  ])('refuses %j at %s', (spec, at, message) => {
    expect(checkDashboardSpec(spec, KNOWN)).toEqual({ ok: false, problems: [{ at, message }] });
  });

  it('names every problem at once, so one answer can fix them all', () => {
    const reading = checkDashboardSpec(
      { name: '', widgets: [{ kind: 'donut', type: 'task' }, 3] },
      KNOWN,
    );

    expect(reading.ok ? [] : reading.problems.map(({ at }) => at)).toEqual([
      'name',
      'widgets[0]',
      'widgets[1]',
    ]);
  });
});

describe('checkDashboardSpec refuses what the editor would read as something else', () => {
  const board = (widget: Record<string, unknown>) => ({
    name: 'Board',
    widgets: [{ kind: 'number', type: 'task', ...widget }],
  });

  it.each([
    [{ filters: 'status != done' }, 'filters must be a list of { key, operator, value }.'],
    [
      { filters: [{ key: 'status', operator: 'is-not', value: 'done' }] },
      'filters[0]’s operator must be one of',
    ],
    [{ filters: [{ operator: 'is', value: 'done' }] }, 'filters[0] needs a key.'],
    [{ filters: ['status'] }, 'filters[0] must be { key, operator, value }.'],
    [
      { filters: [{ key: 'status', operator: 'is', value: ['done'] }] },
      'filters[0]’s value must be text, a number or true/false.',
    ],
    [{ kind: 'hero', progress: { filters: 'done' } }, 'progress.filters must be a list'],
    [{ kind: 'hero', progress: 'done' }, 'progress must be { filters }.'],
    [{ kind: 'sql', sql: 'SELECT 1', show: 'pie' }, 'show must be one of table, number, bar.'],
    [{ icon: 'rocket' }, 'icon must be one of'],
    [{ span: 3.5 }, 'span must be a whole number from 1 to 12.'],
    [{ span: 13 }, 'span must be a whole number from 1 to 12.'],
    [{ span: '4' }, 'span must be a whole number from 1 to 12.'],
    [{ kind: 'rank', groupBy: 'status', limit: 21 }, 'limit must be a whole number from 1 to 20.'],
    [{ kind: 'list', limit: 2.5 }, 'limit must be a whole number of 1 or more.'],
    [{ title: 7 }, 'title must be text.'],
    [{ type: ['task'] }, 'type must be text.'],
  ])('refuses %j', (widget, message) => {
    const reading = checkDashboardSpec(board(widget), KNOWN);
    expect(reading.ok).toBe(false);
    expect(reading.ok ? [] : reading.problems.map((problem) => problem.message)).toEqual([
      expect.stringContaining(message),
    ]);
  });

  it('passes the same keys when they say what they mean', () => {
    const reading = checkDashboardSpec(
      board({
        filters: [{ key: 'status', operator: 'is', value: 'done' }],
        icon: 'bolt',
        span: 3,
        title: 'Done',
      }),
      KNOWN,
    );
    expect(reading.ok).toBe(true);
  });

  it.each(['Board​', 'Bo‮ard', '﻿Board', 'Board⁦x⁩'])(
    'refuses a name holding an invisible formatting character: %j',
    (name) => {
      expect(
        checkDashboardSpec({ name, widgets: [{ kind: 'number', type: 'task' }] }, KNOWN),
      ).toEqual({
        ok: false,
        problems: [
          {
            at: 'name',
            message: 'A dashboard’s name cannot hold an invisible formatting character.',
          },
        ],
      });
    },
  );

  it('keeps an emoji held together by a joiner', () => {
    const name = 'Team \u{1F468}‍\u{1F469}‍\u{1F467}';
    expect(
      checkDashboardSpec({ name, widgets: [{ kind: 'number', type: 'task' }] }, KNOWN).ok,
    ).toBe(true);
  });

  it('refuses a name that is not text', () => {
    expect(
      checkDashboardSpec({ name: 7, widgets: [{ kind: 'number', type: 'task' }] }, KNOWN),
    ).toEqual({ ok: false, problems: [{ at: 'name', message: 'name must be text.' }] });
  });
});
