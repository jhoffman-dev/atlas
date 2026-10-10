import { describe, expect, it } from 'vitest';
import { statusMappingFor } from './status-mapping.ts';
import { automationStatusRewrite, rewrittenQuery, viewStatusRewrite } from './status-references.ts';

/** P30-02: views and automations that name an old status move with the tasks, or are listed. */
const mapping = statusMappingFor({ found: ['backlog', 'next', 'doing', 'review', 'done'] });

describe('rewrittenQuery', () => {
  it('changes only the value’s characters, so the rest of the text stays as typed', () => {
    const text = 'FROM task\nWHERE status  =  "doing" OR  status != done\nSORT BY due';
    expect(rewrittenQuery({ text, mapping })).toEqual({
      text: 'FROM task\nWHERE status  =  in-progress OR  status != archive\nSORT BY due',
      moved: ['doing → in-progress', 'done → archive'],
    });
  });

  it('lists leaving out a status that becomes one other statuses become too', () => {
    // review and doing both become in-progress: leaving it out would leave out doing as well.
    for (const text of [
      'FROM task WHERE status != review',
      'FROM task WHERE NOT (status = review)',
    ]) {
      expect(rewrittenQuery({ text, mapping })).toEqual({
        problem: expect.stringContaining('along with “doing”'),
      });
    }
    expect(rewrittenQuery({ text: 'FROM task WHERE NOT (status = done)', mapping })).toMatchObject({
      text: 'FROM task WHERE NOT (status = archive)',
    });
  });

  it('lists leaving out a status tasks already hold, picking it still carried (round 2)', () => {
    const inUse = new Set(['archive']);
    expect(rewrittenQuery({ text: 'FROM task WHERE status != done', mapping, inUse })).toEqual({
      problem: expect.stringContaining('a status tasks already hold'),
    });
    expect(rewrittenQuery({ text: 'FROM task WHERE status = done', mapping, inUse })).toMatchObject(
      {
        text: 'FROM task WHERE status = archive',
      },
    );
    const view = {
      atlas: 'view',
      type: 'task',
      filters: [{ key: 'status', operator: 'isNot', value: 'done' }],
    };
    expect(viewStatusRewrite(view, mapping, inUse)).toHaveProperty('problem');
  });

  it('lists a status nobody knew, rather than pointing the view at the Inbox', () => {
    const withBlocked = statusMappingFor({ found: ['done', 'blocked'] });
    expect(
      rewrittenQuery({ text: 'FROM task WHERE status = blocked', mapping: withBlocked }),
    ).toEqual({
      problem: expect.stringContaining('no status GTD knows'),
    });
  });

  it('lists a query over tasks and another type that names an old status', () => {
    expect(rewrittenQuery({ text: 'FROM task, project WHERE status = done', mapping })).toEqual({
      problem: expect.stringContaining('other types beside tasks'),
    });
    expect(
      rewrittenQuery({ text: 'FROM task, project WHERE status = archive', mapping }),
    ).toBeNull();
  });

  it('reaches comparisons inside NOT and brackets', () => {
    const text = 'FROM task WHERE NOT (due < @today AND status = next)';
    expect(rewrittenQuery({ text, mapping })).toMatchObject({
      text: 'FROM task WHERE NOT (due < @today AND status = next-action)',
    });
  });

  it('leaves a query that names no old status, lists other types, or does not read', () => {
    expect(rewrittenQuery({ text: 'FROM task WHERE status = archive', mapping })).toBeNull();
    expect(rewrittenQuery({ text: 'FROM project WHERE status = done', mapping })).toBeNull();
    expect(rewrittenQuery({ text: 'FROM task WHERE status = (', mapping })).toBeNull();
    expect(rewrittenQuery({ text: 'FROM task WHERE owner.status = done', mapping })).toBeNull();
  });

  it('lists a comparison no single GTD status can stand for', () => {
    const rewrite = rewrittenQuery({ text: 'FROM task WHERE status CONTAINS do', mapping });
    expect(rewrite).toEqual({ problem: expect.stringContaining('“do” using contains') });
  });
});

describe('viewStatusRewrite', () => {
  it('moves a task view’s filters, keeping each filter’s other settings', () => {
    const view = {
      atlas: 'view',
      type: 'task',
      filters: [
        { key: 'status', operator: 'isNot', value: 'done' },
        { key: 'due', operator: 'lessThan', value: '@tomorrow' },
        { key: 'status', operator: 'is', value: 'inbox' },
      ],
    };
    expect(viewStatusRewrite(view, mapping)).toEqual({
      changes: {
        filters: [
          { key: 'status', operator: 'isNot', value: 'archive' },
          { key: 'due', operator: 'lessThan', value: '@tomorrow' },
          { key: 'status', operator: 'is', value: 'inbox' },
        ],
      },
      moved: ['done → archive'],
    });
  });

  it('lists a filter that matches part of a status', () => {
    const view = {
      atlas: 'view',
      type: 'task',
      filters: [{ key: 'status', operator: 'startsWith', value: 'do' }],
    };
    expect(viewStatusRewrite(view, mapping)).toHaveProperty('problem');
  });

  it('moves a query view’s text', () => {
    const view = {
      atlas: 'view',
      layout: 'list',
      query: 'FROM task WHERE status = backlog OR status = next',
    };
    expect(viewStatusRewrite(view, mapping)).toEqual({
      changes: { query: 'FROM task WHERE status = backlog OR status = next-action' },
      moved: ['next → next-action'],
    });
  });

  it('lists a SQL view that reads status, and leaves one that does not', () => {
    const reads = { atlas: 'view', sql: "SELECT path FROM props WHERE key = 'status'" };
    expect(viewStatusRewrite(reads, mapping)).toHaveProperty('problem');
    expect(viewStatusRewrite({ atlas: 'view', sql: 'SELECT path FROM files' }, mapping)).toBeNull();
  });

  it('leaves views of other types, and notes that are not views', () => {
    const projects = {
      atlas: 'view',
      type: 'project',
      filters: [{ key: 'status', operator: 'is', value: 'done' }],
    };
    expect(viewStatusRewrite(projects, mapping)).toBeNull();
    expect(viewStatusRewrite({ type: 'task', status: 'done' }, mapping)).toBeNull();
    expect(viewStatusRewrite({ atlas: 'view', type: 'task' }, mapping)).toBeNull();
  });
});

describe('automationStatusRewrite', () => {
  const rule = (which: string, set?: Record<string, unknown>) => ({
    atlas: 'automation',
    name: 'Tidy',
    which,
    do: set === undefined ? 'archive' : 'set',
    ...(set === undefined ? {} : { set }),
  });

  it('moves the statuses it takes and the status it sets', () => {
    expect(
      automationStatusRewrite(
        rule('FROM task WHERE status = review', { status: 'done', points: 1 }),
        mapping,
      ),
    ).toEqual({
      changes: {
        which: 'FROM task WHERE status = in-progress',
        set: { status: 'archive', points: 1 },
      },
      moved: ['review → in-progress', 'sets done → archive'],
    });
  });

  it('moves the preset that archives finished tasks', () => {
    expect(automationStatusRewrite(rule('FROM task WHERE status = done'), mapping)).toEqual({
      changes: { which: 'FROM task WHERE status = archive' },
      moved: ['done → archive'],
    });
  });

  it('leaves a rule over other types, and lists one it cannot carry over', () => {
    expect(
      automationStatusRewrite(
        rule('FROM project WHERE status = done', { status: 'done' }),
        mapping,
      ),
    ).toBeNull();
    expect(automationStatusRewrite(rule('FROM task WHERE status > done'), mapping)).toHaveProperty(
      'problem',
    );
    expect(automationStatusRewrite(rule('FROM task WHERE ('), mapping)).toBeNull();
    expect(automationStatusRewrite({ atlas: 'view', which: 'x' }, mapping)).toBeNull();
  });

  it('lists a rule that would set a status nobody knew, or Waiting, or one over mixed types', () => {
    const withBlocked = statusMappingFor({
      found: ['done', 'blocked', 'parked'],
      chosen: new Map([['parked', 'waiting']]),
    });
    for (const [which, set] of [
      ['FROM task WHERE status = archive', { status: 'blocked' }],
      ['FROM task WHERE status = archive', { status: 'parked' }],
      ['FROM task, project WHERE due < @today', { status: 'done' }],
    ] as const) {
      expect(automationStatusRewrite(rule(which, set), withBlocked)).toHaveProperty('problem');
    }
  });
});
