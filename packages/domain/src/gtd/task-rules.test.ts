import { describe, expect, it } from 'vitest';
import { taskRuleChanges, WAITING_NEEDS_SOMEONE } from './task-rules.ts';

/** P30-02: the rules every change to a task is held to (ADR-0029). */
const TODAY = '2026-10-08';
const rule = (before: Record<string, unknown>, changes: Record<string, unknown>) =>
  taskRuleChanges({ before, changes, today: TODAY });

describe('a waiting task waits on someone', () => {
  it('refuses moving a task to Waiting with nobody to wait on, and says why', () => {
    expect(rule({ type: 'task', status: 'next-action' }, { status: 'waiting' })).toEqual({
      refused: WAITING_NEEDS_SOMEONE,
    });
    expect(
      rule({ type: 'task', status: 'next-action', waiting_on: '' }, { status: 'waiting' }),
    ).toEqual({ refused: WAITING_NEEDS_SOMEONE });
    expect(
      rule({ type: 'task', status: 'next-action', waiting_on: [] }, { status: 'waiting' }),
    ).toEqual({ refused: WAITING_NEEDS_SOMEONE });
  });

  it('lets it move once someone is set, before or in the same change', () => {
    const before = { type: 'task', status: 'next-action', waiting_on: '[[Mara Quill]]' };
    expect(rule(before, { status: 'waiting' })).toEqual({ changes: { status: 'waiting' } });
    const both = { status: 'waiting', waiting_on: '[[Tobias Fenn]]' };
    expect(rule({ type: 'task', status: 'inbox' }, both)).toEqual({ changes: both });
  });

  it('refuses taking the person away from a task still waiting', () => {
    const before = { type: 'task', status: 'waiting', waiting_on: '[[Mara Quill]]' };
    expect(rule(before, { waiting_on: null })).toEqual({ refused: WAITING_NEEDS_SOMEONE });
  });

  it('leaves other changes to a task already waiting on nobody alone', () => {
    expect(rule({ type: 'task', status: 'waiting' }, { due: '2026-10-09' })).toEqual({
      changes: { due: '2026-10-09' },
    });
  });

  it('holds a note that becomes a task in the same change to the rule', () => {
    expect(rule({ status: 'next-action' }, { type: 'task', status: 'waiting' })).toEqual({
      refused: WAITING_NEEDS_SOMEONE,
    });
  });

  it('is only a task’s rule', () => {
    expect(rule({ type: 'project', status: 'active' }, { status: 'waiting' })).toEqual({
      changes: { status: 'waiting' },
    });
  });
});

describe('finishing a task is a day', () => {
  it('dates a task moved to Archive with today', () => {
    expect(rule({ type: 'task', status: 'in-progress' }, { status: 'archive' })).toEqual({
      changes: { status: 'archive', completed: TODAY },
    });
  });

  it('keeps a day the change says, or the task already holds', () => {
    expect(
      rule({ type: 'task', status: 'next-action' }, { status: 'archive', completed: '2026-10-01' }),
    ).toEqual({ changes: { status: 'archive', completed: '2026-10-01' } });
    expect(
      rule({ type: 'task', status: 'next-action', completed: '2026-10-01' }, { status: 'archive' }),
    ).toEqual({ changes: { status: 'archive' } });
  });

  it('takes the day away when the task leaves the Archive', () => {
    expect(
      rule({ type: 'Task', status: 'archive', completed: '2026-10-01' }, { status: 'next-action' }),
    ).toEqual({ changes: { status: 'next-action', completed: null } });
  });

  it('writes nothing more when the status does not move', () => {
    expect(rule({ type: 'task', status: 'archive' }, { status: 'archive' })).toEqual({
      changes: { status: 'archive' },
    });
    expect(rule({ type: 'task', status: 'inbox' }, { status: 'backlog' })).toEqual({
      changes: { status: 'backlog' },
    });
  });
});
