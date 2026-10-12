import { describe, expect, it } from 'vitest';
import type { BoardRow } from '../query/group-rows.ts';
import type { RowGroup } from '../query-language/result-groups.ts';
import {
  daysWaited,
  firstRows,
  inWorkOrder,
  nextActionHint,
  sectionRows,
  waitedText,
  withDaysWaited,
} from './linked-rows.ts';

const TODAY = '2026-10-13';

const row = (title: string, values: Record<string, unknown> = {}): BoardRow => ({
  path: `tasks/${title}.md`,
  title,
  values,
});

const group = (value: string | null, rows: readonly BoardRow[]): RowGroup => ({
  id: `/${String(value)}`,
  field: 'status',
  kind: 'select',
  label: value ?? 'No value',
  value,
  tone: null,
  rows,
  subgroups: [],
});

describe('daysWaited', () => {
  it('counts whole days from the day the file last changed to today', () => {
    expect(daysWaited('2026-10-01', TODAY)).toBe(12);
    expect(daysWaited('2026-10-12', TODAY)).toBe(1);
    expect(daysWaited(TODAY, TODAY)).toBe(0);
    expect(daysWaited('2025-10-13', TODAY)).toBe(365);
  });

  it('reads the day of a moment, and is never less than none', () => {
    expect(daysWaited('2026-10-11T23:59:00', TODAY)).toBe(2);
    expect(daysWaited('2026-10-20', TODAY)).toBe(0);
  });

  it('is null for what is no day', () => {
    expect(daysWaited(null, TODAY)).toBeNull();
    expect(daysWaited(1_760_000_000_000, TODAY)).toBeNull();
    expect(daysWaited('yesterday', TODAY)).toBeNull();
  });
});

describe('waitedText and withDaysWaited', () => {
  it('says an age as a row reads it', () => {
    expect(waitedText(0)).toBe('waiting since today');
    expect(waitedText(1)).toBe('waiting 1 day');
    expect(waitedText(12)).toBe('waiting 12 days');
  });

  it('gives each row its age, and none to a row without a day', () => {
    const rows = withDaysWaited(
      [row('Send contract', { modified: '2026-10-01' }), row('Undated', { modified: null })],
      TODAY,
    );
    expect(rows.map((found) => found.values['waited'])).toEqual(['waiting 12 days', '']);
    expect(rows[0]?.values['modified']).toBe('2026-10-01');
  });
});

describe('inWorkOrder', () => {
  it('puts what to do next first, then what is under way, then the rest', () => {
    const asTyped = ['inbox', 'backlog', 'next-action', 'in-progress', 'waiting', 'someday'].map(
      (status) => group(status, []),
    );
    expect(inWorkOrder(asTyped).map((found) => found.value)).toEqual([
      'next-action',
      'in-progress',
      'inbox',
      'backlog',
      'waiting',
      'someday',
    ]);
  });

  it('leaves statuses GTD does not know after them, in the order they came', () => {
    const groups = [
      group('todo', []),
      group(null, []),
      group('next-action', []),
      group('doing', []),
    ];
    expect(inWorkOrder(groups).map((found) => found.value)).toEqual([
      'next-action',
      'todo',
      null,
      'doing',
    ]);
  });
});

describe('nextActionHint', () => {
  it('says so when open tasks hold nothing moving', () => {
    expect(
      nextActionHint({
        projectStatus: 'active',
        statuses: ['inbox', 'backlog'],
        waiting: 1,
        complete: true,
      }),
    ).toBe('No next action: none of its 3 open tasks is Next Action or In Progress.');
    expect(
      nextActionHint({ projectStatus: 'active', statuses: [], waiting: 1, complete: true }),
    ).toBe('No next action: its one open task is not Next Action or In Progress.');
  });

  it.each(['next-action', 'in-progress'])('says nothing when a task is %s', (status) => {
    expect(
      nextActionHint({
        projectStatus: 'active',
        statuses: ['inbox', status],
        waiting: 0,
        complete: true,
      }),
    ).toBeNull();
  });

  it.each(['paused', 'done', 'planned', null])(
    'says nothing of a project that is %s: only an active one should be moving',
    (projectStatus) => {
      expect(
        nextActionHint({ projectStatus, statuses: ['inbox'], waiting: 0, complete: true }),
      ).toBeNull();
    },
  );

  it('reads the project’s status trimmed, as the index does', () => {
    expect(
      nextActionHint({
        projectStatus: ' active ',
        statuses: ['inbox'],
        waiting: 0,
        complete: true,
      }),
    ).not.toBeNull();
  });

  it('says nothing with no open work, with tasks that are not GTD’s, or on a cut-off list', () => {
    expect(
      nextActionHint({ projectStatus: 'active', statuses: [], waiting: 0, complete: true }),
    ).toBeNull();
    expect(
      nextActionHint({ projectStatus: 'active', statuses: ['todo'], waiting: 0, complete: true }),
    ).toBeNull();
    expect(
      nextActionHint({
        projectStatus: 'active',
        statuses: ['inbox', null],
        waiting: 0,
        complete: true,
      }),
    ).toBeNull();
    expect(
      nextActionHint({ projectStatus: 'active', statuses: ['inbox'], waiting: 0, complete: false }),
    ).toBeNull();
  });
});

describe('sectionRows', () => {
  const found = ['a', 'b', 'c'].map((title) => row(title));

  it('holds the first rows and says when more were found', () => {
    expect(sectionRows({ rows: found, page: 'p.md', limit: 2 })).toEqual({
      rows: found.slice(0, 2),
      truncated: true,
    });
    expect(sectionRows({ rows: found, page: 'p.md', limit: 3 })).toEqual({
      rows: found,
      truncated: false,
    });
  });

  it('leaves the page itself out before it counts', () => {
    const held = sectionRows({ rows: found, page: 'tasks/a.md', limit: 2 });
    expect(held.rows.map((one) => one.title)).toEqual(['b', 'c']);
    expect(held.truncated).toBe(false);
  });
});

describe('firstRows', () => {
  const rows = ['a', 'b', 'c', 'd', 'e'].map((title) => row(title));

  it('draws everything when it fits', () => {
    expect(firstRows({ rows, groups: [], shown: 5 })).toEqual({ rows, groups: [], more: 0 });
  });

  it('draws the first rows and counts the rest', () => {
    const drawn = firstRows({ rows, groups: [], shown: 2 });
    expect(drawn.rows.map((found) => found.title)).toEqual(['a', 'b']);
    expect(drawn.more).toBe(3);
  });

  it('cuts through the groups in the order they are drawn, dropping an emptied one', () => {
    const groups = [
      group('next-action', rows.slice(0, 2)),
      group('inbox', rows.slice(2, 4)),
      group('someday', rows.slice(4)),
    ];
    const drawn = firstRows({ rows, groups, shown: 3 });
    expect(drawn.groups.map((found) => [found.value, found.rows.map((r) => r.title)])).toEqual([
      ['next-action', ['a', 'b']],
      ['inbox', ['c']],
    ]);
    expect(drawn.rows.map((found) => found.title)).toEqual(['a', 'b', 'c']);
    expect(drawn.more).toBe(2);
  });
});
