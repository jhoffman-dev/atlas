import { describe, expect, it } from 'vitest';
import type { IndexPort } from '../index/ports.ts';
import { apiFixture, bodyOf, codeOf, encoded, TODAY } from '../testing/api-fixture.ts';
import { jsonMarkdown, jsonNote } from '../testing/json-markdown.ts';

/* U-14 through the local API: a saved view's notes on a month, week, 3 days, a day or an agenda. */

const WEEK_VIEW = {
  atlas: 'view',
  type: 'task',
  layout: 'calendar',
  dateKey: 'due',
  columns: ['status'],
  calendarRange: 'week',
};
const SPAN_VIEW = { ...WEEK_VIEW, startKey: 'due', endKey: 'until' };

const COLUMNS = ['path', 'title', 'status', 'due', 'until'];
const ROWS: unknown[][] = [
  ['Standup.md', 'Standup', 'todo', '2026-09-23T09:00', null],
  ['Trip.md', 'Trip', 'todo', '2026-09-20', '2026-09-22'],
  ['Review.md', 'Review', 'done', '2026-09-22', null],
  ['Someday.md', 'Someday', 'todo', null, null],
  ['Later.md', 'Later', 'todo', '2026-10-30', null],
];

type Api = ReturnType<typeof apiFixture>;

function vault({ rows = ROWS, truncated = false } = {}) {
  const sql: string[] = [];
  const index: Partial<IndexPort> = {
    query: async (text: string) => {
      sql.push(text);
      return { columns: COLUMNS, rows, truncated };
    },
  };
  const api = apiFixture({
    markdown: jsonMarkdown(),
    index,
    files: {
      '.atlas/views/Week.md': jsonNote(WEEK_VIEW),
      '.atlas/views/Span.md': jsonNote(SPAN_VIEW),
      '.atlas/views/Table.md': jsonNote({ atlas: 'view', type: 'task' }),
      '.atlas/views/Sql.md': jsonNote({ atlas: 'view', sql: 'SELECT 1', dateKey: 'due' }),
      '.atlas/dashboards/Home.md': jsonNote({ atlas: 'dashboard', widgets: [] }),
    },
  });
  return { api, sql };
}

const calendar = (api: Api, body: unknown, view = '.atlas/views/Week.md') =>
  api.send({ method: 'POST', path: `/v1/views/${encoded(view)}/calendar`, body });

const titles = (response: Awaited<ReturnType<typeof calendar>>) =>
  (bodyOf(response)['events'] as { title: string; on: string[] }[]).map(({ title, on }) => [
    title,
    on,
  ]);

describe('POST /v1/views/{path}/calendar', () => {
  it("shows the view's saved range around today when nothing is asked: a week from Monday", async () => {
    const { api, sql } = vault();

    const response = await calendar(api, {});

    expect(response.status).toBe(200);
    expect(TODAY).toBe('2026-09-22');
    expect(bodyOf(response)).toMatchObject({
      range: 'week',
      days: [
        '2026-09-21',
        '2026-09-22',
        '2026-09-23',
        '2026-09-24',
        '2026-09-25',
        '2026-09-26',
        '2026-09-27',
      ],
      unscheduled: 1,
      truncated: false,
    });
    expect(titles(response)).toEqual([
      ['Review', ['2026-09-22']],
      ['Standup', ['2026-09-23']],
    ]);
    // The date is asked for even though the view does not show it as a column.
    expect(sql[0]).toContain('"due"');
  });

  it('writes each note as the calendar reads it: all day or on the clock', async () => {
    const { api } = vault();
    const events = bodyOf(await calendar(api, { range: 'day', anchor: '2026-09-23' }))['events'];
    expect(events).toEqual([
      {
        path: 'Standup.md',
        title: 'Standup',
        start: '2026-09-23T09:00',
        end: null,
        allDay: false,
        on: ['2026-09-23'],
      },
    ]);
  });

  it("spans a note to the end its timeline reads, when the view's timeline starts on its date", async () => {
    const { api } = vault();

    const response = await calendar(
      api,
      { range: '3day', anchor: '2026-09-21' },
      '.atlas/views/Span.md',
    );

    expect(titles(response)).toEqual([
      ['Trip', ['2026-09-21', '2026-09-22']],
      ['Review', ['2026-09-22']],
      ['Standup', ['2026-09-23']],
    ]);
    expect((bodyOf(response)['events'] as { end: unknown }[])[0]?.end).toBe('2026-09-22');
  });

  it('lists an agenda as long as asked, and a month as its six-week grid', async () => {
    const { api } = vault();

    const agenda = await calendar(api, { range: 'agenda', anchor: '2026-09-22', days: 40 });
    const month = await calendar(api, { range: 'month', anchor: '2026-10-15' });

    expect((bodyOf(agenda)['days'] as string[]).length).toBe(40);
    expect(titles(agenda).map(([title]) => title)).toEqual(['Review', 'Standup', 'Later']);
    const days = bodyOf(month)['days'] as string[];
    expect([days.length, days[0], days.at(-1)]).toEqual([42, '2026-09-28', '2026-11-08']);
    expect(titles(month).map(([title]) => title)).toEqual(['Later']);
  });

  it('says when the view left notes out', async () => {
    const { api } = vault({ truncated: true });
    expect(bodyOf(await calendar(api, {}))['truncated']).toBe(true);
  });

  it.each([
    ['an unknown range', { range: 'year' }],
    ['an anchor that is not a day', { anchor: '2026-02-30' }],
    ['an anchor with a time', { anchor: '2026-09-22T09:00' }],
    ['days for a range that is not an agenda', { range: 'week', days: 3 }],
    ['an agenda past a year', { range: 'agenda', days: 367 }],
    ['a body that is not an object', 'week'],
  ])('refuses %s as invalid', async (_why, body) => {
    const { api, sql } = vault();
    expect(codeOf(await calendar(api, body))).toBe('invalid');
    expect(sql).toEqual([]);
  });

  it.each([
    ['a view with no date to place notes on', '.atlas/views/Table.md', 'invalid'],
    ['a SQL view', '.atlas/views/Sql.md', 'invalid'],
    ['a dashboard', '.atlas/dashboards/Home.md', 'not_found'],
    ['a view that is not there', '.atlas/views/Gone.md', 'not_found'],
    ['a path outside the vault', '../x.md', 'invalid'],
  ])('refuses %s', async (_why, view, code) => {
    const { api } = vault();
    expect(codeOf(await calendar(api, {}, view))).toBe(code);
  });
});
