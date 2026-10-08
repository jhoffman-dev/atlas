import { describe, expect, it } from 'vitest';
import { GTD_STATUSES } from './gtd-status.ts';
import {
  defaultStatusFor,
  isInboxFallback,
  mappedStatus,
  statusMappingFor,
  statusValueOf,
  taskStatusChanges,
  taskStatusMove,
  WAITING_HELD,
} from './status-mapping.ts';

/** P30-02 / ADR-0029: the mapping table old statuses are moved by. */
const DAY = '2026-09-30';

describe('the default mapping', () => {
  it.each([
    ['backlog', 'backlog'],
    ['next', 'next-action'],
    ['doing', 'in-progress'],
    ['review', 'in-progress'],
    ['done', 'archive'],
  ])('moves the old board’s %s to %s, as ADR-0029 says', (from, to) => {
    expect(defaultStatusFor(from)).toBe(to);
  });

  it.each([
    ['Next Action', 'next-action'],
    ['in_progress', 'in-progress'],
    [' Waiting ', 'waiting'],
    ['DONE', 'archive'],
  ])('reads %j in any spelling', (from, to) => {
    expect(defaultStatusFor(from)).toBe(to);
  });

  it.each(['blocked', '', 'constructor', '__proto__', 'toString'])(
    'sends anything else — %j — to the Inbox',
    (from) => {
      expect(defaultStatusFor(from)).toBe('inbox');
    },
  );
});

describe('statusMappingFor', () => {
  it('offers each old status found once, with its default, leaving GTD statuses out', () => {
    const mapping = statusMappingFor({ found: ['doing', 'done', 'doing', 'waiting', 'blocked'] });
    expect([...mapping]).toEqual([
      ['doing', 'in-progress'],
      ['done', 'archive'],
      ['blocked', 'inbox'],
    ]);
  });

  it('lays the person’s choices over the defaults', () => {
    const mapping = statusMappingFor({
      found: ['review', 'blocked'],
      chosen: new Map([['blocked', 'waiting']]),
    });
    expect(mapping.get('review')).toBe('in-progress');
    expect(mapping.get('blocked')).toBe('waiting');
  });
});

describe('mappedStatus', () => {
  it('keeps every GTD status as it is, whatever the mapping says', () => {
    const mapping = new Map(GTD_STATUSES.map((status) => [status, 'inbox' as const]));
    for (const status of GTD_STATUSES) expect(mappedStatus(mapping, status)).toBe(status);
  });

  it('follows the mapping, and the default for a status it does not name', () => {
    const mapping = new Map([['doing', 'next-action' as const]]);
    expect(mappedStatus(mapping, 'doing')).toBe('next-action');
    expect(mappedStatus(mapping, 'review')).toBe('in-progress');
  });
});

describe('statusValueOf', () => {
  it('reads no status as empty, and a list as its words', () => {
    expect(statusValueOf({})).toBe('');
    expect(statusValueOf({ status: null })).toBe('');
    expect(statusValueOf({ status: ['a', 'b'] })).toBe('a, b');
    expect(statusValueOf({ status: 3 })).toBe('3');
  });
});

describe('taskStatusMove', () => {
  const mapping = statusMappingFor({ found: ['done', 'doing'] });

  it('moves a status, and changes nothing for one already moved — running twice is running once', () => {
    const first = taskStatusMove({ properties: { status: 'doing' }, mapping, lastChanged: DAY });
    expect(first).toEqual({ from: 'doing', to: 'in-progress', completed: null, held: null });
    const after = { status: 'in-progress' };
    expect(taskStatusMove({ properties: after, mapping, lastChanged: DAY })).toBeNull();
  });

  it('dates a finished task by the day its file last changed', () => {
    const move = taskStatusMove({ properties: { status: 'done' }, mapping, lastChanged: DAY });
    expect(move).toEqual({ from: 'done', to: 'archive', completed: DAY, held: null });
    expect(taskStatusChanges(move!)).toEqual({ status: 'archive', completed: DAY });
  });

  it('keeps the day a finished task already says', () => {
    const properties = { status: 'done', completed: '2026-01-02' };
    expect(taskStatusMove({ properties, mapping, lastChanged: DAY })?.completed).toBeNull();
  });

  it('gives a task with no status the Inbox, and writes no day for one not finished', () => {
    const move = taskStatusMove({ properties: { title: 'x' }, mapping, lastChanged: DAY });
    expect(move).toEqual({ from: '', to: 'inbox', completed: null, held: null });
    expect(taskStatusChanges(move!)).toEqual({ status: 'inbox' });
  });
});

describe('a task the mapping sends to Waiting', () => {
  const toWaiting = statusMappingFor({
    found: ['blocked'],
    chosen: new Map([['blocked', 'waiting']]),
  });

  it('goes to the Inbox, saying why, when nobody is in Waiting on', () => {
    const move = taskStatusMove({
      properties: { status: 'blocked' },
      mapping: toWaiting,
      lastChanged: DAY,
    });
    expect(move).toEqual({ from: 'blocked', to: 'inbox', completed: null, held: WAITING_HELD });
  });

  it('goes to Waiting when it says who', () => {
    const properties = { status: 'blocked', waiting_on: '[[Mara Quill]]' };
    expect(taskStatusMove({ properties, mapping: toWaiting, lastChanged: DAY })?.to).toBe(
      'waiting',
    );
  });
});

describe('isInboxFallback', () => {
  const mapping = statusMappingFor({ found: ['blocked', 'done', 'inbox-ish'] });

  it('is a status nobody knew, sent to the Inbox for that reason alone', () => {
    expect(isInboxFallback(mapping, 'blocked')).toBe(true);
    expect(isInboxFallback(mapping, 'done')).toBe(false);
    expect(isInboxFallback(mapping, 'Inbox')).toBe(false);
    expect(isInboxFallback(new Map([['blocked', 'someday']]), 'blocked')).toBe(false);
  });
});
